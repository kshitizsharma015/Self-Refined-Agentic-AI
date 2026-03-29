require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { planGoal } = require('./modules/planner');
const { executePlan } = require('./modules/executor');
const { critiqueExecution } = require('./modules/critic');
const { runRefinementLoop } = require('./modules/refiner');
const { saveEpisode, getRecentEpisodes } = require('./modules/memoryStore');
const { runCodeSnippet } = require('./modules/codeRunner');
const { performWebOperation } = require('./modules/webOperator');

const app = express();
const PORT = process.env.PORT || 3000;

async function runAgentPipeline(goal, emit) {
  const safeEmit = typeof emit === 'function' ? emit : () => {};

  safeEmit('stage_start', { stage: 'planner', message: 'Planning tasks from high-level goal.' });
  const plan = await planGoal(goal);

  if (!plan.success) {
    throw {
      code: 'PLANNER_FAILED',
      message: 'Failed to plan goal',
      details: plan.error,
    };
  }

  safeEmit('stage_complete', {
    stage: 'planner',
    message: 'Planning complete.',
    plannedTasks: Array.isArray(plan.plan) ? plan.plan.length : 0,
  });

  safeEmit('stage_start', { stage: 'executor', message: 'Executing planned tasks.' });
  const execution = await executePlan(plan.plan);

  if (!execution.success) {
    throw {
      code: 'EXECUTOR_FAILED',
      message: 'Failed to execute plan',
      details: execution.error,
    };
  }

  safeEmit('stage_complete', {
    stage: 'executor',
    message: 'Execution complete.',
    completedTasks: execution.completedTasks,
    totalTasks: execution.totalTasks,
  });

  safeEmit('stage_start', { stage: 'critic', message: 'Evaluating execution quality.' });
  const critique = critiqueExecution(execution);

  if (!critique.success) {
    throw {
      code: 'CRITIC_FAILED',
      message: 'Failed to critique execution',
      details: critique.error,
    };
  }

  safeEmit('stage_complete', {
    stage: 'critic',
    message: 'Critique complete.',
    qualityScore: critique.qualityScore,
    flaggedTasks: Array.isArray(critique.flaggedTasks) ? critique.flaggedTasks.length : 0,
  });

  safeEmit('stage_start', { stage: 'refiner', message: 'Running self-refinement loop.' });
  const refinement = await runRefinementLoop(plan.plan, execution, critique);

  if (!refinement.success) {
    throw {
      code: 'REFINER_FAILED',
      message: 'Failed to run refinement loop',
      details: refinement.error,
    };
  }

  const finalExecution = refinement.refinedExecution || execution;
  const finalCritique = refinement.refinedCritique || critique;

  safeEmit('stage_complete', {
    stage: 'refiner',
    message: 'Refinement complete.',
    refinementApplied: Boolean(refinement.refinementApplied),
  });

  safeEmit('stage_start', { stage: 'memory', message: 'Persisting run to memory.' });
  const memoryWrite = await saveEpisode({
    goal,
    plan,
    execution: finalExecution,
    critique: finalCritique,
    refinement,
  });

  safeEmit('stage_complete', {
    stage: 'memory',
    message: 'Memory persistence complete.',
    backend: memoryWrite.backend,
    fallbackUsed: Boolean(memoryWrite.fallbackUsed),
  });

  return {
    message: 'Agent planning, execution, critique, and refinement complete.',
    goal,
    plan,
    execution: finalExecution,
    critique: finalCritique,
    refinement,
    memory: {
      persisted: memoryWrite.success,
      episodeId: memoryWrite.episode.id,
      backend: memoryWrite.backend,
      fallbackUsed: Boolean(memoryWrite.fallbackUsed),
      warning: memoryWrite.warning || null,
    },
  };
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check — used by Render to verify the service is alive
app.get('/health', (req, res) => {
  res.json({ status: 'Synthetix AI Backend is Live', timestamp: new Date().toISOString() });
});

// Memory read endpoint — helps inspect persistent local run history
app.get('/memory/recent', async (req, res) => {
  const { limit } = req.query;
  const memory = await getRecentEpisodes(limit);
  res.json(memory);
});

// Hacker Mode endpoint — execute a direct code snippet request
app.post('/tools/run-code', async (req, res) => {
  const { language, code } = req.body || {};

  if (!code || typeof code !== 'string' || code.trim() === '') {
    return res.status(400).json({ error: 'Code string is required.' });
  }

  const result = await runCodeSnippet(language || 'javascript', code.trim());

  if (!result.success) {
    return res.status(500).json({
      error: 'Code execution failed.',
      details: result.error || result.output,
      source: result.source,
    });
  }

  res.json({
    success: true,
    language: result.language,
    source: result.source,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: result.output,
  });
});

// Web Operator endpoint — perform external API actions (Reddit/YouTube)
app.post('/tools/web-operator', async (req, res) => {
  const { action, subreddit, limit, url } = req.body || {};

  const result = await performWebOperation({
    action,
    subreddit,
    limit,
    url,
  });

  if (!result.success) {
    return res.status(400).json({
      error: 'Web operator action failed.',
      details: result.error,
      action: result.action,
      source: result.source || null,
    });
  }

  res.json(result);
});

// Main agent entry point — accepts a high-level goal from the frontend
app.post('/agent', async (req, res) => {
  const { goal } = req.body;

  if (!goal || typeof goal !== 'string' || goal.trim() === '') {
    return res.status(400).json({ error: 'A goal string is required in the request body.' });
  }

  try {
    const result = await runAgentPipeline(goal.trim());
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Agent pipeline failed',
      code: error.code || 'PIPELINE_FAILED',
      details: error.details || null,
    });
  }
});

// Live thought stream endpoint — emits agent stage updates over Server-Sent Events
app.post('/agent/stream', async (req, res) => {
  const { goal } = req.body;

  if (!goal || typeof goal !== 'string' || goal.trim() === '') {
    return res.status(400).json({ error: 'A goal string is required in the request body.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const sendEvent = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent('connected', { message: 'Live agent stream connected.' });

  try {
    const result = await runAgentPipeline(goal.trim(), sendEvent);
    sendEvent('final_result', result);
    sendEvent('done', { message: 'Stream completed.' });
  } catch (error) {
    sendEvent('error', {
      error: error.message || 'Agent stream failed',
      code: error.code || 'PIPELINE_FAILED',
      details: error.details || null,
    });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Agentic AI server running on http://localhost:${PORT}`);
});


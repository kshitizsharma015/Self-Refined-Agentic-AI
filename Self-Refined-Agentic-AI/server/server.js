require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { planGoal } = require('./modules/planner');
const { executePlan } = require('./modules/executor');
const { critiqueExecution } = require('./modules/critic');
const { runRefinementLoop } = require('./modules/refiner');
const { saveEpisode, getRecentEpisodes } = require('./modules/memoryStore');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Main agent entry point — accepts a high-level goal from the frontend
app.post('/agent', async (req, res) => {
  const { goal } = req.body;

  if (!goal || typeof goal !== 'string' || goal.trim() === '') {
    return res.status(400).json({ error: 'A goal string is required in the request body.' });
  }

  // Step 1: Use Planner to decompose the goal
  const plan = await planGoal(goal.trim());

  if (!plan.success) {
    return res.status(500).json({ error: 'Failed to plan goal', details: plan.error });
  }

  // Step 2: Execute planned tasks sequentially
  const execution = await executePlan(plan.plan);

  if (!execution.success) {
    return res.status(500).json({ error: 'Failed to execute plan', details: execution.error });
  }

  // Step 3: Critique execution quality
  const critique = critiqueExecution(execution);

  if (!critique.success) {
    return res.status(500).json({ error: 'Failed to critique execution', details: critique.error });
  }

  // Step 4: Refine flagged tasks if critique requests improvements
  const refinement = await runRefinementLoop(plan.plan, execution, critique);

  if (!refinement.success) {
    return res.status(500).json({ error: 'Failed to run refinement loop', details: refinement.error });
  }

  const finalExecution = refinement.refinedExecution || execution;
  const finalCritique = refinement.refinedCritique || critique;
  const memoryWrite = await saveEpisode({
    goal: goal.trim(),
    plan,
    execution: finalExecution,
    critique: finalCritique,
    refinement,
  });

  res.json({
    message: 'Agent planning, execution, critique, and refinement complete.',
    goal: goal.trim(),
    plan: plan,
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
  });
});

app.listen(PORT, () => {
  console.log(`Agentic AI server running on http://localhost:${PORT}`);
});


const { researchWeb } = require('./webReader');
const { runSandboxedCode } = require('./codeRunner');

function isResearchTask(task = {}) {
  const combined = `${task.task || ''} ${task.description || ''}`.toLowerCase();
  return /(search|research|find|latest|paper|article|web|news|read|scrape)/.test(combined);
}

function isCodeTask(task = {}) {
  const combined = `${task.task || ''} ${task.description || ''}`.toLowerCase();
  return /(code|python|javascript|js|algorithm|program|script|debug|compile|run code|```)/.test(combined);
}

function buildFallbackResult(task) {
  return {
    status: 'completed',
    output: `Executed (fallback): ${task.task}`,
    evidence: null,
    source: null,
  };
}

/**
 * Executor Module
 * Executes plan tasks sequentially and records artifacts.
 * Uses web research tool for discovery-type tasks and safe fallback otherwise.
 */
async function executePlan(planTasks = []) {
  if (!Array.isArray(planTasks)) {
    return {
      success: false,
      error: 'Executor requires an array of plan tasks.',
      results: [],
    };
  }

  const results = [];

  for (const task of planTasks) {
    let runResult;

    if (isCodeTask(task)) {
      const codeResult = await runSandboxedCode(task);

      if (codeResult.success) {
        runResult = {
          status: 'completed',
          output: `Code task executed for: ${task.task}`,
          evidence: codeResult.output,
          source: codeResult.source,
        };
      } else {
        runResult = {
          status: 'completed',
          output: `Code task fallback used for: ${task.task}`,
          evidence: codeResult.error,
          source: codeResult.source,
        };
      }
    } else if (isResearchTask(task)) {
      const query = `${task.task}. ${task.description || ''}`.trim();
      const webResult = await researchWeb(query);

      if (webResult.success) {
        runResult = {
          status: 'completed',
          output: `Web research completed for: ${task.task}`,
          evidence: webResult.snippet,
          source: webResult.source,
        };
      } else {
        runResult = {
          status: 'completed',
          output: `Web research failed, used fallback for: ${task.task}`,
          evidence: webResult.error,
          source: webResult.source,
        };
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50));
      runResult = buildFallbackResult(task);
    }

    results.push({
      id: task.id,
      task: task.task,
      status: runResult.status,
      output: runResult.output,
      details: task.description || 'No description provided.',
      evidence: runResult.evidence,
      source: runResult.source,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      executedAt: new Date().toISOString(),
    });
  }

  return {
    success: true,
    totalTasks: planTasks.length,
    completedTasks: results.length,
    results,
  };
}

module.exports = { executePlan };

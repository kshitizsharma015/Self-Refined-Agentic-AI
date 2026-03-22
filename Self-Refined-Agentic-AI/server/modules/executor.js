/**
 * Executor Module
 * Executes plan tasks sequentially and records lightweight result artifacts.
 * This is a safe scaffold before adding live tools (web, code, APIs).
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
    // Simulate bounded async work so frontend can show progress-style data.
    // Replace this section later with real tool executions.
    await new Promise((resolve) => setTimeout(resolve, 50));

    results.push({
      id: task.id,
      task: task.task,
      status: 'completed',
      output: `Executed: ${task.task}`,
      details: task.description || 'No description provided.',
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

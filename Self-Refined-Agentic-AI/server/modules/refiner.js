const { executePlan } = require('./executor');
const { critiqueExecution } = require('./critic');

/**
 * Self-Refinement Loop
 * Re-runs flagged tasks with an explicit improvement hint and compares quality.
 */
async function runRefinementLoop(planTasks = [], execution = {}, critique = {}) {
  if (!Array.isArray(planTasks)) {
    return {
      success: false,
      error: 'Refiner requires the original plan task array.',
    };
  }

  if (!execution || !Array.isArray(execution.results)) {
    return {
      success: false,
      error: 'Refiner requires valid execution results.',
    };
  }

  if (!critique || !Array.isArray(critique.flaggedTasks)) {
    return {
      success: false,
      error: 'Refiner requires valid critique output.',
    };
  }

  if (critique.flaggedTasks.length === 0) {
    return {
      success: true,
      refinementApplied: false,
      reason: 'No flagged tasks; refinement skipped.',
      refinedExecution: execution,
      refinedCritique: critique,
    };
  }

  const flaggedIds = new Set(critique.flaggedTasks.map((item) => item.id));
  const flaggedPlanTasks = planTasks
    .filter((task) => flaggedIds.has(task.id))
    .map((task) => ({
      ...task,
      description: `${task.description || 'No description provided.'} Improve answer quality with concrete evidence.`,
    }));

  const rerun = await executePlan(flaggedPlanTasks);

  if (!rerun.success) {
    return {
      success: false,
      error: 'Failed to re-execute flagged tasks during refinement.',
    };
  }

  const rerunById = new Map(rerun.results.map((item) => [item.id, item]));
  const mergedResults = execution.results.map((item) => {
    if (!rerunById.has(item.id)) {
      return item;
    }

    const refined = rerunById.get(item.id);
    return {
      ...refined,
      output: `${refined.output} [refined]`,
    };
  });

  const refinedExecution = {
    ...execution,
    results: mergedResults,
    completedTasks: mergedResults.filter((item) => item.status === 'completed').length,
  };

  const refinedCritique = critiqueExecution(refinedExecution);

  return {
    success: true,
    refinementApplied: true,
    rerunTaskCount: flaggedPlanTasks.length,
    refinedExecution,
    refinedCritique,
  };
}

module.exports = { runRefinementLoop };

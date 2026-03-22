/**
 * Critic Module
 * Evaluates execution artifacts and produces a quality report that can
 * feed the future self-refinement loop.
 */
function critiqueExecution(execution = {}) {
  if (!execution || !Array.isArray(execution.results)) {
    return {
      success: false,
      error: 'Critic requires execution results from Executor.',
      qualityScore: 0,
      summary: 'No executable results found.',
      flaggedTasks: [],
      recommendations: [],
    };
  }

  const results = execution.results;
  const totalTasks = results.length;
  const completedTasks = results.filter((item) => item.status === 'completed').length;

  const flaggedTasks = results
    .filter((item) => {
      const outputText = (item.output || '').toLowerCase();
      const detailsText = (item.details || '').toLowerCase();
      return outputText.includes('todo') || detailsText.includes('no description');
    })
    .map((item) => ({
      id: item.id,
      task: item.task,
      reason: 'Output/detail quality is too shallow for a final answer.',
    }));

  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const penalty = flaggedTasks.length * 0.1;
  const rawScore = Math.max(0, Math.min(1, completionRatio - penalty));
  const qualityScore = Math.round(rawScore * 100);

  const recommendations = [];

  if (flaggedTasks.length > 0) {
    recommendations.push('Re-run flagged tasks with richer tool usage and evidence collection.');
  }

  if (qualityScore < 70) {
    recommendations.push('Trigger self-refinement loop to improve execution quality.');
  } else {
    recommendations.push('Execution quality is acceptable; proceed to response synthesis.');
  }

  return {
    success: true,
    qualityScore,
    summary: `${completedTasks}/${totalTasks} tasks completed with ${flaggedTasks.length} flagged for refinement.`,
    flaggedTasks,
    recommendations,
  };
}

module.exports = { critiqueExecution };

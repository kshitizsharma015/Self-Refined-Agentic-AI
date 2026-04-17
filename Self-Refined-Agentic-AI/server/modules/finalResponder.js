const Groq = require('groq-sdk');

function stripHeadingMarkers(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trimEnd())
    .join('\n')
    .trim();
}

function buildFallbackFinalAnswer(goal, execution = {}, critique = {}) {
  const results = Array.isArray(execution?.results) ? execution.results : [];
  const lines = results
    .slice(0, 8)
    .map((item, index) => {
      const title = String(item?.task || `Task ${index + 1}`).trim();
      const detail = String(item?.evidence || item?.output || item?.details || '').trim();
      if (!detail) {
        return `${index + 1}. ${title}`;
      }
      return `${index + 1}. ${title}\n   ${detail.slice(0, 320)}`;
    })
    .join('\n\n');

  const quality = typeof critique?.qualityScore === 'number' ? critique.qualityScore : 'n/a';

  return stripHeadingMarkers([
    'Final Answer',
    '',
    `Goal: ${goal}`,
    '',
    lines || 'No execution details were produced.',
    '',
    `Quality score: ${quality}`,
  ].join('\n'));
}

async function composeFinalAnswer(goal, plan = {}, execution = {}, critique = {}) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return {
        success: true,
        source: 'fallback',
        answer: buildFallbackFinalAnswer(goal, execution, critique),
      };
    }

    const groq = new Groq({ apiKey });
    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const planTasks = Array.isArray(plan?.plan)
      ? plan.plan.map((task) => ({ id: task.id, task: task.task, description: task.description }))
      : [];

    const execTasks = Array.isArray(execution?.results)
      ? execution.results.map((task) => ({
          task: task.task,
          output: task.output,
          evidence: task.evidence,
          source: task.source,
        }))
      : [];

    const prompt = [
      `User goal:\n${goal}`,
      '',
      `Plan tasks:\n${JSON.stringify(planTasks, null, 2)}`,
      '',
      `Execution artifacts:\n${JSON.stringify(execTasks, null, 2)}`,
      '',
      `Critique:\n${JSON.stringify({
        qualityScore: critique?.qualityScore,
        flaggedTasks: critique?.flaggedTasks,
      })}`,
      '',
      'Write a complete and user-ready final answer.',
      'Rules:',
      '1) Give a direct, polished final response, not pipeline logs.',
      '2) Be concrete and actionable.',
      '3) Use short section headings only when helpful.',
      '4) Do not mention internal stage names (planner/executor/critic/refiner).',
    ].join('\n');

    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are an expert assistant that writes final, polished answers for users.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return {
        success: true,
        source: 'fallback',
        answer: buildFallbackFinalAnswer(goal, execution, critique),
      };
    }

    return {
      success: true,
      source: 'groq',
      answer: stripHeadingMarkers(answer),
    };
  } catch (error) {
    return {
      success: true,
      source: 'fallback',
      answer: buildFallbackFinalAnswer(goal, execution, critique),
      warning: error.message,
    };
  }
}

module.exports = { composeFinalAnswer };

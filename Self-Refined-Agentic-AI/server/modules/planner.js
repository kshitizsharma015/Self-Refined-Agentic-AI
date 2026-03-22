const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Planner returned empty text.');
  }

  let candidate = text.trim();

  if (candidate.includes('```json')) {
    candidate = candidate.split('```json')[1].split('```')[0].trim();
  } else if (candidate.includes('```')) {
    candidate = candidate.split('```')[1].split('```')[0].trim();
  }

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Planner did not return a valid JSON object.');
  }

  return candidate.substring(firstBrace, lastBrace + 1);
}

/**
 * Planner Module
 * Takes a high-level goal and decomposes it into executable sub-tasks.
 * Returns a structured plan with tasks, dependencies, and reasoning.
 */
async function planGoal(goal) {
  try {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('Missing GROQ_API_KEY in environment variables.');
    }

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const systemPrompt = `You are an expert task decomposer for an autonomous AI agent.
Your job is to take a high-level abstract goal and break it into concrete, executable sub-tasks.

Rules:
1. Each task must be simple enough to execute in one step.
2. Include dependencies between tasks if they exist.
3. Return ONLY a valid JSON object (no markdown, no extra text).
4. The JSON structure must be:
{
  "plan": [
    { "id": 1, "task": "...", "description": "...", "dependsOn": [] },
    { "id": 2, "task": "...", "description": "...", "dependsOn": [1] }
  ],
  "reasoning": "Why this plan makes sense"
}`;

    const userMessage = `Goal: ${goal}\n\nCreate a step-by-step execution plan as JSON.`;

    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const responseText = completion.choices?.[0]?.message?.content || '';
    const jsonString = extractJsonObject(responseText);
    const plan = JSON.parse(jsonString);

    if (!Array.isArray(plan.plan)) {
      throw new Error('Planner JSON missing "plan" array.');
    }

    return {
      success: true,
      goal: goal,
      plan: plan.plan,
      reasoning: plan.reasoning || 'No reasoning provided by planner.',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      goal: goal,
    };
  }
}

module.exports = { planGoal };

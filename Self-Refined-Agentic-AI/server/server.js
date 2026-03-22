require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { planGoal } = require('./modules/planner');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check — used by Render to verify the service is alive
app.get('/health', (req, res) => {
  res.json({ status: 'Synthetix AI Backend is Live', timestamp: new Date().toISOString() });
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

  // TODO: Step 2 — Execute each task (Executor Module) [Step 3]
  // TODO: Step 3 — Critique results (Critic Module) [Step 4]
  // TODO: Step 4 — Refine if needed (Refinement Loop) [Step 5]

  res.json({
    message: 'Agent planning complete.',
    goal: goal.trim(),
    plan: plan,
  });
});

app.listen(PORT, () => {
  console.log(`Agentic AI server running on http://localhost:${PORT}`);
});


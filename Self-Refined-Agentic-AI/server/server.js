require('dotenv').config();
const express = require('express');
const cors = require('cors');

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

  // Placeholder — full agentic loop will be wired here in later steps
  res.json({
    message: 'Agent received your goal.',
    goal: goal.trim(),
    status: 'planning',
  });
});

app.listen(PORT, () => {
  console.log(`Agentic AI server running on http://localhost:${PORT}`);
});


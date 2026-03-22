const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const memoryFile = path.join(dataDir, 'agent-memory.json');

function ensureMemoryFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, JSON.stringify({ episodes: [] }, null, 2), 'utf8');
  }
}

function readMemory() {
  ensureMemoryFile();
  const raw = fs.readFileSync(memoryFile, 'utf8');
  return JSON.parse(raw);
}

function writeMemory(memory) {
  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), 'utf8');
}

function buildEpisode({ goal, plan, execution, critique, refinement }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal,
    stats: {
      plannedTasks: Array.isArray(plan?.plan) ? plan.plan.length : 0,
      completedTasks: Number(execution?.completedTasks || 0),
      qualityScore: Number(critique?.qualityScore || 0),
      refinementApplied: Boolean(refinement?.refinementApplied),
    },
    snapshot: {
      plan,
      execution,
      critique,
      refinement,
    },
    createdAt: new Date().toISOString(),
  };
}

function saveEpisode(payload) {
  const memory = readMemory();
  const episode = buildEpisode(payload);

  memory.episodes.unshift(episode);
  memory.episodes = memory.episodes.slice(0, 100);

  writeMemory(memory);

  return {
    success: true,
    episode,
  };
}

function getRecentEpisodes(limit = 10) {
  const memory = readMemory();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));

  return {
    success: true,
    totalStored: memory.episodes.length,
    episodes: memory.episodes.slice(0, safeLimit).map((item) => ({
      id: item.id,
      goal: item.goal,
      stats: item.stats,
      createdAt: item.createdAt,
    })),
  };
}

module.exports = {
  saveEpisode,
  getRecentEpisodes,
};

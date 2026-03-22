const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const dataDir = path.join(__dirname, '..', 'data');
const memoryFile = path.join(dataDir, 'agent-memory.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'agent_memory_episodes';

const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

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

function saveEpisodeLocal(payload) {
  const memory = readMemory();
  const episode = buildEpisode(payload);

  memory.episodes.unshift(episode);
  memory.episodes = memory.episodes.slice(0, 100);

  writeMemory(memory);

  return {
    success: true,
    backend: 'local',
    episode,
  };
}

function getRecentEpisodesLocal(limit = 10) {
  const memory = readMemory();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));

  return {
    success: true,
    backend: 'local',
    totalStored: memory.episodes.length,
    episodes: memory.episodes.slice(0, safeLimit).map((item) => ({
      id: item.id,
      goal: item.goal,
      stats: item.stats,
      createdAt: item.createdAt,
    })),
  };
}

async function saveEpisode(payload) {
  const localResult = saveEpisodeLocal(payload);

  if (!supabaseEnabled) {
    return {
      ...localResult,
      fallbackUsed: true,
      warning: 'Supabase not configured. Stored in local memory file only.',
    };
  }

  try {
    const episode = localResult.episode;

    const { error } = await supabase.from(SUPABASE_TABLE).insert({
      id: episode.id,
      goal: episode.goal,
      stats: episode.stats,
      snapshot: episode.snapshot,
      created_at: episode.createdAt,
    });

    if (error) {
      return {
        ...localResult,
        fallbackUsed: true,
        warning: `Supabase insert failed. Stored locally. ${error.message}`,
      };
    }

    return {
      success: true,
      backend: 'supabase+local',
      fallbackUsed: false,
      episode,
    };
  } catch (error) {
    return {
      ...localResult,
      fallbackUsed: true,
      warning: `Supabase unavailable. Stored locally. ${error.message}`,
    };
  }
}

async function getRecentEpisodes(limit = 10) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));

  if (!supabaseEnabled) {
    return getRecentEpisodesLocal(safeLimit);
  }

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('id, goal, stats, created_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      const local = getRecentEpisodesLocal(safeLimit);
      return {
        ...local,
        fallbackUsed: true,
        warning: `Supabase read failed. Returning local memory. ${error.message}`,
      };
    }

    return {
      success: true,
      backend: 'supabase',
      fallbackUsed: false,
      totalStored: data.length,
      episodes: data.map((item) => ({
        id: item.id,
        goal: item.goal,
        stats: item.stats,
        createdAt: item.created_at,
      })),
    };
  } catch (error) {
    const local = getRecentEpisodesLocal(safeLimit);
    return {
      ...local,
      fallbackUsed: true,
      warning: `Supabase unavailable. Returning local memory. ${error.message}`,
    };
  }
}

module.exports = {
  saveEpisode,
  getRecentEpisodes,
};

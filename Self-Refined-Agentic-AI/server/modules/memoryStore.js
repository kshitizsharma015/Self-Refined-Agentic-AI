const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const dataDir = path.join(__dirname, '..', 'data');
const memoryFile = path.join(dataDir, 'agent-memory.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'agent_memory_episodes';
const EMBEDDING_DIM = 64;
const JINA_EMBEDDING_MODEL = process.env.JINA_EMBEDDING_MODEL || 'jina-embeddings-v3';

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

function buildMemoryText({ goal, plan, critique }) {
  const planTasks = Array.isArray(plan?.plan)
    ? plan.plan.map((item) => item.task).join(', ')
    : '';
  const summary = critique?.summary || '';
  return `${goal || ''}\nTasks: ${planTasks}\nCritique: ${summary}`.trim();
}

function normalizeVector(values = []) {
  const safe = values.slice(0, EMBEDDING_DIM).map((value) => Number(value) || 0);
  while (safe.length < EMBEDDING_DIM) {
    safe.push(0);
  }

  const norm = Math.sqrt(safe.reduce((acc, item) => acc + item * item, 0)) || 1;
  return safe.map((value) => value / norm);
}

function buildLocalEmbedding(text = '') {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const clean = String(text || '').toLowerCase();

  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const bucket = code % EMBEDDING_DIM;
    vec[bucket] += 1;
  }

  return normalizeVector(vec);
}

function cosineSimilarity(a = [], b = []) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (Number(a[i]) || 0) * (Number(b[i]) || 0);
  }
  return dot;
}

function formatPgVector(values = []) {
  return `[${values.map((v) => Number(v).toFixed(8)).join(',')}]`;
}

async function getTextEmbedding(text) {
  const inputText = String(text || '').trim();

  if (!inputText) {
    return {
      vector: new Array(EMBEDDING_DIM).fill(0),
      backend: 'empty',
    };
  }

  if (!process.env.JINA_API_KEY) {
    return {
      vector: buildLocalEmbedding(inputText),
      backend: 'local-hash',
    };
  }

  try {
    const response = await axios.post(
      'https://api.jina.ai/v1/embeddings',
      {
        model: JINA_EMBEDDING_MODEL,
        input: [inputText],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.JINA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const vector = response.data?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Invalid embedding response.');
    }

    return {
      vector: normalizeVector(vector),
      backend: 'jina',
    };
  } catch {
    return {
      vector: buildLocalEmbedding(inputText),
      backend: 'local-hash-fallback',
    };
  }
}

function saveEpisodeLocal(payload, embeddingMeta) {
  const memory = readMemory();
  const episode = buildEpisode(payload);
  episode.embedding = embeddingMeta?.vector || null;
  episode.embeddingBackend = embeddingMeta?.backend || 'unknown';

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
  const embeddingText = buildMemoryText(payload);
  const embeddingMeta = await getTextEmbedding(embeddingText);
  const localResult = saveEpisodeLocal(payload, embeddingMeta);

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
      embedding: formatPgVector(embeddingMeta.vector),
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

async function getSimilarEpisodesLocal(goal, limit = 5) {
  const memory = readMemory();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const queryEmbedding = (await getTextEmbedding(goal)).vector;

  const ranked = memory.episodes
    .map((episode) => {
      const candidateEmbedding = Array.isArray(episode.embedding)
        ? normalizeVector(episode.embedding)
        : buildLocalEmbedding(episode.goal || '');
      const similarity = cosineSimilarity(queryEmbedding, candidateEmbedding);
      return {
        id: episode.id,
        goal: episode.goal,
        stats: episode.stats,
        createdAt: episode.createdAt,
        similarity: Number(similarity.toFixed(4)),
        summary: episode.snapshot?.critique?.summary || '',
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, safeLimit);

  return {
    success: true,
    backend: 'local-similarity',
    episodes: ranked,
  };
}

async function getSimilarEpisodes(goal, limit = 5) {
  const safeGoal = String(goal || '').trim();
  if (!safeGoal) {
    return {
      success: false,
      backend: 'none',
      episodes: [],
      error: 'Goal text is required for similarity search.',
    };
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const queryEmbeddingMeta = await getTextEmbedding(safeGoal);

  if (!supabaseEnabled) {
    return getSimilarEpisodesLocal(safeGoal, safeLimit);
  }

  try {
    const { data, error } = await supabase.rpc('match_agent_memory_episodes', {
      query_embedding: formatPgVector(queryEmbeddingMeta.vector),
      match_count: safeLimit,
    });

    if (error) {
      const local = await getSimilarEpisodesLocal(safeGoal, safeLimit);
      return {
        ...local,
        fallbackUsed: true,
        warning: `Supabase similarity search failed. ${error.message}`,
      };
    }

    return {
      success: true,
      backend: 'supabase-pgvector',
      fallbackUsed: false,
      episodes: (data || []).map((item) => ({
        id: item.id,
        goal: item.goal,
        stats: item.stats,
        createdAt: item.created_at,
        similarity: Number((item.similarity || 0).toFixed(4)),
        summary: item.snapshot?.critique?.summary || '',
      })),
    };
  } catch (error) {
    const local = await getSimilarEpisodesLocal(safeGoal, safeLimit);
    return {
      ...local,
      fallbackUsed: true,
      warning: `Supabase similarity endpoint unavailable. ${error.message}`,
    };
  }
}

module.exports = {
  saveEpisode,
  getRecentEpisodes,
  getSimilarEpisodes,
};

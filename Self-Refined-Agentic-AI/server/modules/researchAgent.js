const axios = require('axios');
const Groq = require('groq-sdk');
const { researchWeb } = require('./webReader');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

function trimText(text, maxLength = 360) {
  const value = String(text || '').trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function normalizeUrl(url) {
  const value = String(url || '').trim();

  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);

    if (parsed.hostname.includes('duckduckgo.com') || parsed.hostname.includes('r.jina.ai')) {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function extractCandidateUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>\]\)]+/g) || [];
  const seen = new Set();
  const urls = [];

  for (const candidate of matches) {
    const normalized = normalizeUrl(candidate);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

async function fetchReadablePage(url) {
  const source = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;

  try {
    const response = await axios.get(source, { timeout: 15000 });
    const rawText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    return {
      success: true,
      source,
      url,
      excerpt: trimText(rawText, 1200),
    };
  } catch (error) {
    return {
      success: false,
      source,
      url,
      error: error.message,
    };
  }
}

async function researchQuery(query) {
  const seed = await researchWeb(query);

  if (!seed.success) {
    return {
      success: false,
      query,
      error: seed.error || 'Web research failed.',
      source: seed.source,
    };
  }

  const candidateUrls = extractCandidateUrls(seed.snippet).slice(0, 3);
  const sources = [];

  for (const url of candidateUrls) {
    const page = await fetchReadablePage(url);

    if (page.success) {
      sources.push(page);
    }
  }

  const fallbackSources = sources.length
    ? sources
    : [{ success: true, source: seed.source, url: seed.source, excerpt: seed.snippet }];

  if (groq) {
    try {
      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a concise web research analyst. Return only JSON with keys summary, keyPoints, and recommendation. keyPoints must be an array of short strings.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              query,
              sources: fallbackSources.map((item) => ({ url: item.url, excerpt: trimText(item.excerpt, 500) })),
            }),
          },
        ],
      });

      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');

      return {
        success: true,
        artifactType: 'web-research',
        query,
        source: seed.source,
        summary: parsed.summary || `Reviewed ${fallbackSources.length} source(s) for ${query}.`,
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 6) : [],
        recommendation: parsed.recommendation || '',
        sources: fallbackSources,
        modelSource: 'groq',
      };
    } catch {
      // Fall through to a deterministic summary.
    }
  }

  return {
    success: true,
    artifactType: 'web-research',
    query,
    source: seed.source,
    summary: `Reviewed ${fallbackSources.length} source(s) for "${query}".`,
    keyPoints: fallbackSources.map((item, index) => `${index + 1}. ${trimText(item.excerpt, 220)}`),
    recommendation: 'Review the source snippets and follow up with a narrower query if needed.',
    sources: fallbackSources,
    modelSource: 'fallback',
  };
}

module.exports = { researchQuery };
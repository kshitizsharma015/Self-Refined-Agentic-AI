const axios = require('axios');

function buildReaderUrl(query) {
  const q = encodeURIComponent(query);
  return `https://r.jina.ai/http://duckduckgo.com/?q=${q}`;
}

function trimText(text, maxLength = 1200) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

async function researchWeb(query) {
  const url = buildReaderUrl(query);
  const headers = {};

  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  try {
    const response = await axios.get(url, {
      headers,
      timeout: 15000,
    });

    const rawText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const snippet = trimText(rawText, 1400);

    return {
      success: true,
      source: url,
      snippet,
    };
  } catch (error) {
    return {
      success: false,
      source: url,
      error: error.message,
    };
  }
}

module.exports = { researchWeb };

const axios = require('axios');

function pickRedditPosts(items = [], limit = 5) {
  return items.slice(0, limit).map((entry) => {
    const data = entry?.data || {};
    return {
      title: data.title || 'Untitled post',
      subreddit: data.subreddit || 'unknown',
      score: data.score || 0,
      author: data.author || 'unknown',
      url: `https://reddit.com${data.permalink || ''}`,
    };
  });
}

async function fetchRedditTop(subreddit = 'technology', limit = 5) {
  const safeSubreddit = String(subreddit || 'technology').replace(/[^a-zA-Z0-9_]/g, '');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 10));
  const source = `https://www.reddit.com/r/${safeSubreddit}/top.json?t=day&limit=${safeLimit}`;

  try {
    const response = await axios.get(source, {
      headers: {
        'User-Agent': process.env.REDDIT_USER_AGENT || 'SynthetixAI/0.1 by student-project',
      },
      timeout: 15000,
    });

    const posts = pickRedditPosts(response.data?.data?.children || [], safeLimit);

    return {
      success: true,
      source,
      action: 'reddit_top',
      subreddit: safeSubreddit,
      posts,
      summary: posts.map((post, idx) => `${idx + 1}. ${post.title}`).join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      source,
      action: 'reddit_top',
      error: error.message,
    };
  }
}

async function fetchYouTubeMeta(videoUrl) {
  const safeUrl = String(videoUrl || '').trim();

  if (!safeUrl) {
    return {
      success: false,
      action: 'youtube_meta',
      error: 'A YouTube URL is required.',
    };
  }

  const source = `https://www.youtube.com/oembed?url=${encodeURIComponent(safeUrl)}&format=json`;

  try {
    const response = await axios.get(source, { timeout: 15000 });

    return {
      success: true,
      source,
      action: 'youtube_meta',
      metadata: {
        title: response.data?.title || 'Untitled',
        authorName: response.data?.author_name || 'Unknown',
        authorUrl: response.data?.author_url || '',
        thumbnailUrl: response.data?.thumbnail_url || '',
      },
      summary: `${response.data?.title || 'Untitled'} by ${response.data?.author_name || 'Unknown'}`,
    };
  } catch (error) {
    return {
      success: false,
      source,
      action: 'youtube_meta',
      error: error.message,
    };
  }
}

function inferOperationFromTask(task = {}) {
  const text = `${task.task || ''} ${task.description || ''}`;
  const lower = text.toLowerCase();

  if (lower.includes('reddit')) {
    const match = lower.match(/r\/([a-z0-9_]+)/);
    return {
      action: 'reddit_top',
      subreddit: match?.[1] || 'technology',
      limit: 5,
    };
  }

  if (lower.includes('youtube')) {
    const urlMatch = text.match(/https?:\/\/\S+/i);
    return {
      action: 'youtube_meta',
      url: urlMatch ? urlMatch[0] : '',
    };
  }

  return null;
}

async function performWebOperation(input = {}) {
  const action = input.action;

  if (action === 'reddit_top') {
    return fetchRedditTop(input.subreddit, input.limit);
  }

  if (action === 'youtube_meta') {
    return fetchYouTubeMeta(input.url);
  }

  return {
    success: false,
    action: action || 'unknown',
    error: 'Unsupported action. Use reddit_top or youtube_meta.',
  };
}

module.exports = {
  performWebOperation,
  inferOperationFromTask,
};

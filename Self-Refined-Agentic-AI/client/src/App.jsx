import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = 'http://localhost:3000';
const STORAGE_KEYS = {
  profile: 'synthetix.profile.v1',
  sessions: 'synthetix.sessions.v1',
  settings: 'synthetix.settings.v1',
  activeSessionId: 'synthetix.activeSessionId.v1',
};

const DEFAULT_SETTINGS = {
  theme: 'aurora',
  density: 'comfortable',
  autoSpeak: true,
  showReasoning: true,
  assistantVoice: 'calm',
  keyboardHints: true,
};

function createId(prefix = 'id') {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in demo mode.
  }
}

function trimText(text, maxLength = 180) {
  const value = String(text ?? '');
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function stripMarkdownForSpeech(text) {
  return String(text ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readResponsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { raw: rawText };
    }
  }

  if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { raw: rawText };
    }
  }

  return { raw: rawText };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Just now' : date.toLocaleString();
}

function escapeTableCell(value) {
  return String(value ?? '').replaceAll('|', '\\|');
}

function extractLatestUserPrompt(messages) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages[userMessages.length - 1]?.content || '';
}

function buildConversationTitle(messages, fallbackIndex = 1) {
  const prompt = extractLatestUserPrompt(messages) || messages.find((m) => m.role === 'assistant')?.content || '';
  return trimText(prompt, 42) || `Conversation ${fallbackIndex}`;
}

function createWelcomeConversation(index = 1) {
  return {
    id: createId('chat'),
    title: `Starter workspace ${index}`,
    pinned: index === 1,
    archived: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    messages: [
      {
        id: createId('msg'),
        role: 'assistant',
        content:
          'Welcome to Synthetix AI. Ask me to research, plan, compare, write, summarize, or continue a project workflow, and I will stream the work live.',
        createdAt: new Date().toISOString(),
        kind: 'welcome',
      },
    ],
    stream: [],
    lastResult: null,
  };
}

function createSeedSessions() {
  const first = createWelcomeConversation(1);
  first.title = 'Launch plan review';
  first.messages.push({
    id: createId('msg'),
    role: 'user',
    content: 'Plan a launch checklist for an AI product demo.',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  });
  first.messages.push({
    id: createId('msg'),
    role: 'assistant',
    content:
      'I would break the work into research, demo script, product walkthrough, backup troubleshooting, and closing Q&A preparation.',
    createdAt: new Date(Date.now() - 85800000).toISOString(),
  });

  const second = createWelcomeConversation(2);
  second.title = 'Research summary';
  second.pinned = false;
  second.messages.push({
    id: createId('msg'),
    role: 'user',
    content: 'Summarize the current architecture for the assistant pipeline.',
    createdAt: new Date(Date.now() - 43200000).toISOString(),
  });
  second.messages.push({
    id: createId('msg'),
    role: 'assistant',
    content:
      'The architecture combines memory lookup, planning, execution, critique, refinement, and persistence, then streams those stages to the frontend.',
    createdAt: new Date(Date.now() - 42600000).toISOString(),
  });

  const third = createWelcomeConversation(3);
  third.title = 'Bug triage notes';
  third.messages.push({
    id: createId('msg'),
    role: 'user',
    content: 'List the main frontend gaps in the current version.',
    createdAt: new Date(Date.now() - 21600000).toISOString(),
  });
  third.messages.push({
    id: createId('msg'),
    role: 'assistant',
    content:
      'The main gaps were the lack of chat navigation, message actions, settings, login, and a richer answer renderer.',
    createdAt: new Date(Date.now() - 21000000).toISOString(),
  });

  return [first, second, third];
}

const FALLBACK_SESSIONS = createSeedSessions();

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const remaining = parts[parts.length - 1] || '';

  for (const block of complete) {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const rawData = dataLines.join('\n');
    let payload = rawData;

    try {
      payload = JSON.parse(rawData);
    } catch {
      // Keep raw payload when JSON parsing fails.
    }

    onEvent({ event: eventName, data: payload });
  }

  return remaining;
}

function compactPayload(eventName, data) {
  if (eventName === 'final_result' && typeof data === 'object' && data) {
    return {
      message: data.message,
      goal: trimText(data.goal, 80),
      plannedTasks: data?.plan?.plan?.length || 0,
      completedTasks: data?.execution?.completedTasks || 0,
      qualityScore: data?.critique?.qualityScore || null,
      memoryBackend: data?.memory?.backend || 'unknown',
    };
  }

  if (typeof data === 'string') {
    return trimText(data);
  }

  if (typeof data === 'object' && data) {
    const compact = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        compact[key] = trimText(value, 120);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        compact[key] = value;
      }
    }
    return compact;
  }

  return data;
}

function buildConversationContext(messages, settings, mode = 'ask') {
  const relevant = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${trimText(message.content, 240)}`)
    .join('\n');

  const promptStyle = settings.showReasoning
    ? 'Respond with structured detail, practical steps, and clear reasoning.'
    : 'Respond clearly and directly.';

  const modeInstruction =
    mode === 'continue'
      ? 'Continue the previous answer with more depth, stronger structure, and any missing implementation details.'
      : mode === 'retry'
        ? 'Retry the request with a cleaner, more polished, and more reliable answer.'
        : '';

  return [
    modeInstruction,
    relevant ? `Conversation context:\n${relevant}` : '',
    promptStyle,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildAssistantFinalText(result) {
  if (typeof result?.finalAnswer === 'string' && result.finalAnswer.trim()) {
    return result.finalAnswer.trim();
  }

  const tasks = Array.isArray(result?.execution?.results) ? result.execution.results : [];

  const cleanText = (value) =>
    String(value || '')
      .replace(/^Web research completed for:\s*/i, '')
      .replace(/^Web operator action completed for:\s*/i, '')
      .replace(/^Code task executed for:\s*/i, '')
      .replace(/^Executed \(fallback\):\s*/i, '')
      .replace(/^Code task fallback used for:\s*/i, '')
      .replace(/^Web research failed, used fallback for:\s*/i, '')
      .trim();

  if (tasks.length) {
    const summaryLines = tasks.slice(0, 6).map((task, index) => {
      const title = cleanText(task?.task || `Task ${index + 1}`) || `Task ${index + 1}`;
      const detailSource =
        (typeof task?.evidence === 'string' && task.evidence.trim()) ||
        (typeof task?.output === 'string' && task.output.trim()) ||
        (typeof task?.details === 'string' && task.details.trim()) ||
        '';
      const detail = cleanText(detailSource);

      if (!detail || detail.toLowerCase() === title.toLowerCase()) {
        return `${index + 1}. ${title}`;
      }

      return `${index + 1}. ${title}\n   ${trimText(detail, 220)}`;
    });

    const quality = result?.critique?.qualityScore;
    const qualityLine = typeof quality === 'number' ? `\n\nQuality score: ${quality}/100` : '';

    return `Here is the final result:\n\n${summaryLines.join('\n\n')}${qualityLine}`;
  }

  if (typeof result?.message === 'string' && result.message.trim()) {
    return result.message.trim();
  }

  return 'The request completed successfully.';
}

function markdownInline(text) {
  const source = String(text ?? '');
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parts.push(source.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a key={`${match.index}-link`} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < source.length) {
    parts.push(source.slice(lastIndex));
  }

  return parts;
}

function parseTableLines(lines) {
  const rows = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean));

  const cleanRows = rows.filter((row) => row.some((cell) => !/^:?-{2,}:?$/.test(cell)));
  if (cleanRows.length < 2) {
    return null;
  }

  const header = cleanRows[0];
  const body = cleanRows.slice(2);

  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {header.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={`${row.join('-')}-${index}`}>
              {row.map((cell) => (
                <td key={cell}>{markdownInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderRichText(content) {
  const text = String(content ?? '');
  if (!text.trim()) {
    return null;
  }

  const codeFencePattern = /```([\w+-]*)\n([\s\S]*?)```/g;
  const blocks = [];
  let lastIndex = 0;
  let match;

  while ((match = codeFencePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    blocks.push({ type: 'code', language: match[1], value: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    blocks.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return blocks.map((block, blockIndex) => {
    if (block.type === 'code') {
      return (
        <pre key={`code-${blockIndex}`} className="code-block">
          <div className="code-block__label">{block.language || 'text'}</div>
          <code>{block.value.trim()}</code>
        </pre>
      );
    }

    const paragraphs = block.value
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    return paragraphs.map((paragraph, paragraphIndex) => {
      if (/^#{1,6}\s+/.test(paragraph)) {
        const level = paragraph.match(/^#{1,6}/)[0].length;
        const textValue = paragraph.replace(/^#{1,6}\s+/, '');
        const HeadingTag = `h${Math.min(level, 6)}`;
        return (
          <HeadingTag key={`heading-${blockIndex}-${paragraphIndex}`} className={`md-h md-h-${level}`}>
            {markdownInline(textValue)}
          </HeadingTag>
        );
      }

      const lines = paragraph.split('\n');
      if (lines.every((line) => /^\s*\|/.test(line))) {
        return <div key={`table-${blockIndex}-${paragraphIndex}`}>{parseTableLines(lines)}</div>;
      }

      if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
        return (
          <ul key={`list-${blockIndex}-${paragraphIndex}`} className="md-list">
            {lines.map((line, idx) => (
              <li key={`${line}-${idx}`}>{markdownInline(line.replace(/^\s*[-*+]\s+/, ''))}</li>
            ))}
          </ul>
        );
      }

      if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
        return (
          <ol key={`olist-${blockIndex}-${paragraphIndex}`} className="md-list md-list--ordered">
            {lines.map((line, idx) => (
              <li key={`${line}-${idx}`}>{markdownInline(line.replace(/^\s*\d+\.\s+/, ''))}</li>
            ))}
          </ol>
        );
      }

      if (lines.every((line) => /^\s*>\s?/.test(line))) {
        return (
          <blockquote key={`quote-${blockIndex}-${paragraphIndex}`} className="md-quote">
            {markdownInline(lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' '))}
          </blockquote>
        );
      }

      return (
        <p key={`p-${blockIndex}-${paragraphIndex}`} className="md-p">
          {markdownInline(paragraph)}
        </p>
      );
    });
  });
}

function DemoLogin({ onLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('signup');

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">S</div>
          <div>
            <h1>Synthetix AI</h1>
            <p>Secure demo workspace for agentic research, chat, and product walkthroughs.</p>
          </div>
        </div>

        <div className="login-hero">
          <h2>{authMode === 'signup' ? 'Create your account' : 'Log in to your account'}</h2>
          <p>
            Use your credentials to access the workspace. This demo stores authentication data locally.
          </p>
        </div>

        <div className="login-form">
          <div className="login-mode">
            <button type="button" className={authMode === 'signup' ? 'is-active' : ''} onClick={() => setAuthMode('signup')}>
              Sign up
            </button>
            <button type="button" className={authMode === 'login' ? 'is-active' : ''} onClick={() => setAuthMode('login')}>
              Log in
            </button>
          </div>

          <label>
            Display name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" />
          </label>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onLogin({
                name: name.trim() || 'Demo User',
                email: email.trim() || 'demo@synthetix.ai',
                role: 'user',
                authMode,
              })
            }
          >
            {authMode === 'signup' ? 'Create account' : 'Log in'}
          </button>

          <div className="login-footnote">Auth state is saved locally for the demo and can be changed anytime from settings.</div>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, setSettings, profile, onClose, onLogout }) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h3>Settings</h3>
          <p>Customize the demo workspace and presentation behavior.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-grid">
        <label>
          Theme
          <select value={settings.theme} onChange={(event) => setSettings((prev) => ({ ...prev, theme: event.target.value }))}>
            <option value="aurora">Aurora</option>
            <option value="ink">Ink</option>
            <option value="sand">Sand</option>
          </select>
        </label>

        <label>
          Density
          <select value={settings.density} onChange={(event) => setSettings((prev) => ({ ...prev, density: event.target.value }))}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        <label>
          Assistant voice
          <select value={settings.assistantVoice} onChange={(event) => setSettings((prev) => ({ ...prev, assistantVoice: event.target.value }))}>
            <option value="calm">Calm</option>
            <option value="crisp">Crisp</option>
            <option value="studio">Studio</option>
          </select>
        </label>
      </div>

      <div className="toggle-list">
        <label className="toggle-row">
          <span>Auto speak final answer</span>
          <input
            type="checkbox"
            checked={settings.autoSpeak}
            onChange={(event) => setSettings((prev) => ({ ...prev, autoSpeak: event.target.checked }))}
          />
        </label>
        <label className="toggle-row">
          <span>Show reasoning stream</span>
          <input
            type="checkbox"
            checked={settings.showReasoning}
            onChange={(event) => setSettings((prev) => ({ ...prev, showReasoning: event.target.checked }))}
          />
        </label>
        <label className="toggle-row">
          <span>Keyboard hints</span>
          <input
            type="checkbox"
            checked={settings.keyboardHints}
            onChange={(event) => setSettings((prev) => ({ ...prev, keyboardHints: event.target.checked }))}
          />
        </label>
      </div>

      <div className="profile-card">
        <div>
          <strong>{profile.name}</strong>
          <p>{profile.email}</p>
        </div>
        <span className="role-pill">{profile.role}</span>
      </div>

      <button type="button" className="danger-button" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}

function AssistantResultDetails({ result }) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const planTasks = Array.isArray(result?.plan?.plan) ? result.plan.plan : [];
  const executionTasks = Array.isArray(result?.execution?.results) ? result.execution.results : [];
  const flaggedTasks = Array.isArray(result?.critique?.flaggedTasks) ? result.critique.flaggedTasks : [];

  return (
    <div className="result-expansions">
      <details>
        <summary>Details ({planTasks.length} plan tasks, {executionTasks.length} execution items)</summary>

        <div className="result-section">
          <strong>Goal</strong>
          <p>{result?.goal || 'No goal available.'}</p>
        </div>

        <div className="result-section">
          <strong>Plan</strong>
          {planTasks.length ? (
            <ol className="result-list">
              {planTasks.map((task, index) => (
                <li key={`${task.id || index}-${task.task || 'task'}`}>
                  <strong>{task.task || `Task ${index + 1}`}</strong>
                  <p>{task.description || 'No description.'}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No plan tasks found.</p>
          )}
        </div>

        <div className="result-section">
          <strong>Execution</strong>
          {executionTasks.length ? (
            <ul className="result-list">
              {executionTasks.map((item, index) => (
                <li key={`${item.id || index}-${item.task || 'execution'}`}>
                  <strong>{item.task || `Execution ${index + 1}`}</strong>
                  <p>{item.output || 'No output.'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No execution details found.</p>
          )}
        </div>

        <div className="result-section">
          <strong>Critique</strong>
          <ul className="result-list">
            <li>
              <strong>Quality score</strong>
              <p>{result?.critique?.qualityScore ?? 'n/a'}</p>
            </li>
            <li>
              <strong>Flagged tasks</strong>
              <p>{flaggedTasks.length}</p>
            </li>
          </ul>
        </div>

        <div className="result-section">
          <strong>Memory</strong>
          <ul className="result-list">
            <li>
              <strong>Backend</strong>
              <p>{result?.memory?.backend || 'unknown'}</p>
            </li>
            <li>
              <strong>Persisted</strong>
              <p>{result?.memory?.persisted ? 'yes' : 'no'}</p>
            </li>
          </ul>
        </div>

        <div className="result-section">
          <strong>Raw output (JSON)</strong>
          <pre className="code-block">
            <code>{JSON.stringify(result, null, 2)}</code>
          </pre>
        </div>
      </details>
    </div>
  );
}

function ToolResultCard({ title, result, onDownload }) {
  if (!result) {
    return null;
  }

  const safeSummary =
    typeof result.summary === 'string'
      ? result.summary
      : result.summary == null
        ? ''
        : JSON.stringify(result.summary);

  const safeKeyPoints = Array.isArray(result.keyPoints)
    ? result.keyPoints
        .map((point) => (typeof point === 'string' ? point : point == null ? '' : JSON.stringify(point)))
        .filter(Boolean)
    : [];

  const safePreviewMarkdown = typeof result.previewMarkdown === 'string' ? result.previewMarkdown : '';

  const safeSources = Array.isArray(result.sources)
    ? result.sources
        .map((source) => ({
          url: typeof source?.url === 'string' ? source.url.trim() : '',
        }))
        .filter((source) => Boolean(source.url))
    : [];

  return (
    <div className="inspector-card tool-result-card">
      <div className="inspector-card__head">
        <h3>{title}</h3>
        {onDownload ? (
          <button type="button" className="ghost-button" onClick={onDownload}>
            Download
          </button>
        ) : null}
      </div>

      <div className="tool-result-card__body">
        {safeSummary ? <p>{safeSummary}</p> : null}
        {safeKeyPoints.length ? (
          <ul className="result-list">
            {safeKeyPoints.map((point, index) => (
              <li key={`${point}-${index}`}>{point}</li>
            ))}
          </ul>
        ) : null}
        {safePreviewMarkdown ? <div className="rich-content rich-content--plain">{renderRichText(safePreviewMarkdown)}</div> : null}
        {safeSources.length ? (
          <div className="tool-source-list">
            {safeSources.map((source, index) => (
              <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                Source {index + 1}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageActions({ message, onCopy, onEdit, onRegenerate, onRetry, onContinue, onShare }) {
  return (
    <div className="message-actions">
      <button type="button" onClick={() => onCopy(message)}>
        Copy
      </button>
      {message.role === 'user' ? (
        <button type="button" onClick={() => onEdit(message)}>
          Edit
        </button>
      ) : null}
      {message.role === 'assistant' ? (
        <>
          <button type="button" onClick={() => onRegenerate(message)}>
            Regenerate
          </button>
          <button type="button" onClick={() => onRetry(message)}>
            Retry
          </button>
          <button type="button" onClick={() => onContinue(message)}>
            Continue
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => onShare(message)}>
        Share
      </button>
    </div>
  );
}

function MessageBubble({ message, onCopy, onEdit, onRegenerate, onRetry, onContinue, onShare }) {
  return (
    <article className={`message message--${message.role}`}>
      <div className="message__head">
        <div className="message__meta">
          <span className="message__role">{message.role === 'user' ? 'You' : 'Synthetix AI'}</span>
          <span className="message__time">{formatDateTime(message.createdAt)}</span>
        </div>
        <MessageActions
          message={message}
          onCopy={onCopy}
          onEdit={onEdit}
          onRegenerate={onRegenerate}
          onRetry={onRetry}
          onContinue={onContinue}
          onShare={onShare}
        />
      </div>
      <div className="message__body">
        {message.kind === 'assistant-result' ? (
          <>
            <div className="rich-content rich-content--plain">{renderRichText(message.content)}</div>
            <AssistantResultDetails result={message.result} />
          </>
        ) : message.kind === 'assistant-markdown' ? (
          <div className="rich-content">{renderRichText(message.content)}</div>
        ) : message.kind === 'system' ? (
          <div className="system-card">{message.content}</div>
        ) : (
          <div className="rich-content rich-content--plain">{renderRichText(message.content)}</div>
        )}
      </div>
    </article>
  );
}

function SessionSidebar({
  conversations,
  activeConversationId,
  search,
  setSearch,
  onSelect,
  onNew,
  onPin,
  onRename,
  onDelete,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand-mark">S</div>
        <div>
          <h2>Synthetix AI</h2>
          <p>Agentic product shell</p>
        </div>
      </div>

      <button type="button" className="primary-button sidebar__new" onClick={onNew}>
        + New conversation
      </button>

      <label className="search-box">
        <span>Search chats</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles or content" />
      </label>

      <div className="session-list">
        {conversations.length === 0 ? <div className="empty-list">No saved chats yet.</div> : null}
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            className={`session-card ${conversation.id === activeConversationId ? 'is-active' : ''}`}
            onClick={() => onSelect(conversation.id)}
          >
            <div className="session-card__top">
              <strong>{conversation.title}</strong>
              <span>{conversation.pinned ? 'Pinned' : formatDateTime(conversation.updatedAt)}</span>
            </div>
            <p>{trimText(conversation.messages[conversation.messages.length - 1]?.content || 'No messages yet.', 88)}</p>
            <div className="session-card__actions">
              <span>{conversation.messages.length} messages</span>
              <div>
                <button type="button" onClick={(event) => { event.stopPropagation(); onPin(conversation.id); }}>
                  {conversation.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); onRename(conversation.id); }}>
                  Rename
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(conversation.id); }}>
                  Delete
                </button>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <div>
          <strong>Saved sessions</strong>
          <p>{conversations.length} conversations in local storage</p>
        </div>
      </div>
    </aside>
  );
}

function App() {
  const [profile, setProfile] = useState(() => readStorage(STORAGE_KEYS.profile, null));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...readStorage(STORAGE_KEYS.settings, {}) }));
  const [conversations, setConversations] = useState(() => {
    const stored = readStorage(STORAGE_KEYS.sessions, null);
    return Array.isArray(stored) && stored.length ? stored : FALLBACK_SESSIONS;
  });
  const [activeConversationId, setActiveConversationId] = useState(() => {
    const stored = readStorage(STORAGE_KEYS.activeSessionId, null);
    return stored || FALLBACK_SESSIONS[0]?.id || null;
  });
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [composerValue, setComposerValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentStreamEvents, setCurrentStreamEvents] = useState([]);
  const [currentStage, setCurrentStage] = useState('idle');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [researchResult, setResearchResult] = useState(null);
  const [sheetResult, setSheetResult] = useState(null);
  const messagesEndRef = useRef(null);
  const logRef = useRef(null);
  const recognitionRef = useRef(null);
  const speechUtteranceRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0] || null,
    [activeConversationId, conversations]
  );

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    if (!query) {
      return sorted;
    }

    return sorted.filter((conversation) => {
      const haystack = `${conversation.title} ${conversation.messages.map((message) => message.content).join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, search]);

  const tokenEstimate = useMemo(() => {
    if (!activeConversation) {
      return 0;
    }

    return activeConversation.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  }, [activeConversation]);

  const tokenUsagePercent = Math.min(100, Math.round((tokenEstimate / 8000) * 100));

  const liveSummary = currentStreamEvents[currentStreamEvents.length - 1];

  useEffect(() => {
    writeStorage(STORAGE_KEYS.profile, profile);
  }, [profile]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.sessions, conversations);
    writeStorage(STORAGE_KEYS.activeSessionId, activeConversationId);
  }, [conversations, activeConversationId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [activeConversation?.messages.length, currentStreamEvents.length]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [currentStreamEvents]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setComposerValue(transcript.trim());
    };

    recognition.onerror = () => {
      setIsListening(false);
      setError('Voice capture failed. Try again or type the request manually.');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);
  }, []);

  useEffect(() => {
    if (!lastResult || !settings.autoSpeak || !window.speechSynthesis) {
      return;
    }

    const summary = stripMarkdownForSpeech(lastResult.finalAnswer || buildAssistantFinalText(lastResult) || '');

    if (!summary) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.rate = 1;
    utterance.pitch = settings.assistantVoice === 'studio' ? 0.9 : 1;
    utterance.voice = null;
    utterance.onstart = () => setVoiceStatus('speaking');
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      setVoiceStatus('idle');
    };
    utterance.onerror = () => {
      speechUtteranceRef.current = null;
      setVoiceStatus('idle');
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.cancel();
    setVoiceStatus('speaking');
    window.speechSynthesis.speak(utterance);
  }, [lastResult, settings.autoSpeak, settings.assistantVoice]);

  const stopVoice = () => {
    if (!window.speechSynthesis) {
      return;
    }

    window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
    setVoiceStatus('idle');
  };

  const pauseVoice = () => {
    if (!window.speechSynthesis || !speechUtteranceRef.current) {
      return;
    }

    window.speechSynthesis.pause();
    setVoiceStatus('paused');
  };

  const resumeVoice = () => {
    if (!window.speechSynthesis || !speechUtteranceRef.current) {
      return;
    }

    window.speechSynthesis.resume();
    setVoiceStatus('speaking');
  };

  const replayVoice = () => {
    if (!lastResult || !window.speechSynthesis) {
      return;
    }

    const summary = stripMarkdownForSpeech(lastResult.finalAnswer || buildAssistantFinalText(lastResult) || '');
    if (!summary) {
      return;
    }

    stopVoice();

    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.rate = 1;
    utterance.pitch = settings.assistantVoice === 'studio' ? 0.9 : 1;
    utterance.voice = null;
    utterance.onstart = () => setVoiceStatus('speaking');
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      setVoiceStatus('idle');
    };
    utterance.onerror = () => {
      speechUtteranceRef.current = null;
      setVoiceStatus('idle');
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const updateConversation = (conversationId, updater) => {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const nextValue = typeof updater === 'function' ? updater(conversation) : updater;
        return {
          ...conversation,
          ...nextValue,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  const createConversation = () => {
    const nextConversation = createWelcomeConversation(conversations.length + 1);
    setConversations((previous) => [nextConversation, ...previous]);
    setActiveConversationId(nextConversation.id);
    setComposerValue('');
    setCurrentStreamEvents([]);
    setCurrentStage('idle');
    setError('');
  };

  const renameConversation = (conversationId) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    const nextTitle = window.prompt('Rename conversation', conversation?.title || 'New conversation');

    if (!nextTitle) {
      return;
    }

    updateConversation(conversationId, { title: nextTitle.trim() || conversation?.title || 'Conversation' });
  };

  const deleteConversation = (conversationId) => {
    const next = window.confirm('Delete this conversation?');
    if (!next) {
      return;
    }

    setConversations((previous) => {
      const filtered = previous.filter((conversation) => conversation.id !== conversationId);
      if (activeConversationId === conversationId) {
        setActiveConversationId(filtered[0]?.id || null);
      }
      return filtered.length ? filtered : [createWelcomeConversation(1)];
    });
  };

  const togglePin = (conversationId) => {
    updateConversation(conversationId, (conversation) => ({ pinned: !conversation.pinned }));
  };

  const login = (nextProfile) => {
    const loggedInProfile = {
      ...nextProfile,
      loggedInAt: new Date().toISOString(),
    };

    setProfile(loggedInProfile);
    setShowSettings(false);

    if (!activeConversationId && conversations[0]) {
      setActiveConversationId(conversations[0].id);
    }
  };

  const logout = () => {
    setProfile(null);
    setShowSettings(false);
  };

  const handleCopy = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1200);
    } catch {
      setError('Could not copy message content.');
    }
  };

  const shareConversation = async () => {
    if (!activeConversation) {
      return;
    }

    const text = activeConversation.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError('Could not share conversation.');
    }
  };

  const exportConversation = () => {
    if (!activeConversation) {
      return;
    }

    const blob = new Blob([JSON.stringify(activeConversation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeConversation.title.replaceAll(' ', '_').toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openLoginPreset = () => {
    if (!profile) {
      login({ name: 'Demo User', email: 'demo@synthetix.ai', role: 'user', authMode: 'login' });
    }
  };

  const editMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingValue(message.content);
  };

  const saveEditedMessage = () => {
    if (!activeConversation || !editingMessageId) {
      return;
    }

    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== activeConversation.id) {
          return conversation;
        }

        return {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === editingMessageId ? { ...message, content: editingValue.trim() } : message
          ),
          title:
            conversation.messages[0]?.id === editingMessageId
              ? buildConversationTitle(
                  conversation.messages.map((message) =>
                    message.id === editingMessageId ? { ...message, content: editingValue.trim() } : message
                  ),
                  1
                )
              : conversation.title,
        };
      })
    );

    setEditingMessageId(null);
    setEditingValue('');
  };

  const buildPromptFromConversation = (conversation, messageText, mode = 'ask') => {
    const context = buildConversationContext(conversation.messages, settings, mode);
    return [context, `Current user request:\n${messageText}`].filter(Boolean).join('\n\n');
  };

  const runResearch = async () => {
    const query = window.prompt('Research query', 'Top 5 competitors of Notion in 2026');

    if (!query || !query.trim()) {
      return;
    }

    setError('');
    setResearchResult(null);

    try {
      const response = await fetch(`${API_BASE}/tools/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await readResponsePayload(response);

      if (!response.ok) {
        const message = String(data?.error || data?.raw || 'Research request failed.');
        throw new Error(message.includes('<!DOCTYPE') ? 'Research backend returned HTML instead of JSON. Make sure the server is running on port 3000.' : message);
      }

      setResearchResult({
        ...data,
        summary: typeof data?.summary === 'string' ? data.summary : data?.summary == null ? '' : JSON.stringify(data.summary),
        keyPoints: Array.isArray(data?.keyPoints)
          ? data.keyPoints.map((item) => (typeof item === 'string' ? item : item == null ? '' : JSON.stringify(item))).filter(Boolean)
          : [],
        sources: Array.isArray(data?.sources) ? data.sources : [],
      });
      setSheetResult(null);
    } catch (requestError) {
      setError(requestError.message || 'Research request failed.');
    }
  };

  const runSheetCreator = async () => {
    const prompt = window.prompt('Sheet prompt', 'Create a project budget sheet with monthly costs and yearly total');

    if (!prompt || !prompt.trim()) {
      return;
    }

    setError('');
    setSheetResult(null);

    try {
      const response = await fetch(`${API_BASE}/tools/create-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await readResponsePayload(response);

      if (!response.ok) {
        const message = String(data?.error || data?.raw || 'Sheet request failed.');
        throw new Error(message.includes('<!DOCTYPE') ? 'Sheet backend returned HTML instead of JSON. Make sure the server is running on port 3000.' : message);
      }

      setSheetResult({
        ...data,
        summary: typeof data?.summary === 'string' ? data.summary : data?.summary == null ? '' : JSON.stringify(data.summary),
        previewMarkdown:
          typeof data?.previewMarkdown === 'string'
            ? data.previewMarkdown
            : data?.previewMarkdown == null
              ? ''
              : JSON.stringify(data.previewMarkdown),
        csv: typeof data?.csv === 'string' ? data.csv : '',
        filename: typeof data?.filename === 'string' && data.filename.trim() ? data.filename.trim() : 'agent-sheet.csv',
      });
      setResearchResult(null);
    } catch (requestError) {
      setError(requestError.message || 'Sheet request failed.');
    }
  };

  const downloadSheetCsv = () => {
    if (!sheetResult?.csv) {
      return;
    }

    const blob = new Blob([sheetResult.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sheetResult.filename || 'agent-sheet.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const submitPrompt = async (promptText, mode = 'ask', sourceConversationId = activeConversationId) => {
    const trimmedPrompt = String(promptText ?? '').trim();
    if (!trimmedPrompt) {
      setError('Enter a message or a goal before sending.');
      return;
    }

    const conversationId = sourceConversationId || activeConversationId || createConversation();
    const conversation = conversations.find((item) => item.id === conversationId) || conversations[0];
    if (!conversation) {
      return;
    }

    const userMessage = {
      id: createId('msg'),
      role: 'user',
      content: trimmedPrompt,
      createdAt: new Date().toISOString(),
      kind: 'user',
    };

    const assistantMessageId = createId('msg');
    const assistantPlaceholder = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Working on it... the agent is planning, executing, and refining in real time.',
      createdAt: new Date().toISOString(),
      kind: 'assistant-result',
      result: null,
      streaming: true,
    };

    setLoading(true);
    setError('');
    setCurrentStreamEvents([]);
    setCurrentStage('memory_lookup');
    setLastResult(null);

    updateConversation(conversationId, (current) => ({
      title: current.messages.length <= 2 ? trimText(trimmedPrompt, 42) : current.title,
      messages: [...current.messages, userMessage, assistantPlaceholder],
      stream: [],
    }));

    setComposerValue('');

    try {
      const payload = buildPromptFromConversation(conversation, trimmedPrompt, mode);

      const response = await fetch(`${API_BASE}/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: payload }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, (evt) => {
          setCurrentStreamEvents((previous) => [...previous, evt]);
          setCurrentStage(evt.event);

          updateConversation(conversationId, (current) => ({
            stream: [...current.stream, evt],
          }));

          if (evt.event === 'final_result') {
            setLastResult(evt.data);
            const finalText = buildAssistantFinalText(evt.data);
            updateConversation(conversationId, (current) => ({
              messages: current.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: finalText,
                      result: evt.data,
                      streaming: false,
                    }
                  : message
              ),
              lastResult: evt.data,
              title: buildConversationTitle(
                current.messages.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, content: finalText }
                    : message
                ),
                conversations.findIndex((item) => item.id === conversationId) + 1
              ),
            }));
          }

          if (evt.event === 'error') {
            setError(typeof evt.data === 'string' ? evt.data : evt.data?.error || 'Streaming failed.');
            updateConversation(conversationId, (current) => ({
              messages: current.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: 'The request failed while streaming. Please retry or edit the prompt.',
                      streaming: false,
                    }
                  : message
              ),
            }));
          }
        });
      }
    } catch (streamError) {
      setError(streamError.message || 'Unable to stream events.');
      updateConversation(conversationId, (current) => ({
        messages: current.messages.map((message) =>
          message.role === 'assistant' && message.streaming
            ? {
                ...message,
                content: 'The assistant could not complete this request.',
                streaming: false,
              }
            : message
        ),
      }));
    } finally {
      setLoading(false);
      setCurrentStage('done');
    }
  };

  const regenerateMessage = (message) => {
    const lastUser = [...(activeConversation?.messages || [])].reverse().find((item) => item.role === 'user');
    if (!lastUser) {
      return;
    }

    submitPrompt(lastUser.content, message?.role === 'assistant' ? 'retry' : 'ask');
  };

  const continueGeneration = () => {
    const lastUser = [...(activeConversation?.messages || [])].reverse().find((item) => item.role === 'user');
    if (!lastUser) {
      return;
    }

    submitPrompt(
      `${lastUser.content}\n\nContinue the answer with deeper implementation details, practical next steps, and a polished finish.`,
      'continue'
    );
  };

  const retryResponse = (message) => {
    const lastUser = [...(activeConversation?.messages || [])].reverse().find((item) => item.role === 'user');
    if (!lastUser) {
      return;
    }

    submitPrompt(`${lastUser.content}\n\nRetry with a cleaner structure and a more production-ready explanation.`, 'retry');
  };

  const handleComposerSend = () => {
    submitPrompt(composerValue, 'ask');
  };

  if (!profile) {
    return <DemoLogin onLogin={login} />;
  }

  return (
    <div className={`shell theme-${settings.theme} density-${settings.density}`}>
      <SessionSidebar
        conversations={filteredConversations}
        activeConversationId={activeConversationId}
        search={search}
        setSearch={setSearch}
        onSelect={setActiveConversationId}
        onNew={createConversation}
        onPin={togglePin}
        onRename={renameConversation}
        onDelete={deleteConversation}
      />

      <main className="workspace">
        <header className="topbar">
          <div className="topbar__title">
            <span className="topbar__eyebrow">Conversations</span>
            <h1>{activeConversation?.title || 'Untitled conversation'}</h1>
            <div className="topbar__subline">
              <span>{profile.name}</span>
              <span>{profile.email}</span>
            </div>
          </div>

          <div className="topbar__actions">
            <div className="context-chip">
              <strong>{tokenEstimate} tokens</strong>
              <span>{tokenUsagePercent}% of the context window</span>
              <div className="context-chip__bar">
                <div style={{ width: `${tokenUsagePercent}%` }} />
              </div>
            </div>

            <button type="button" className="ghost-button" onClick={shareConversation}>
              Share
            </button>
            <button type="button" className="ghost-button" onClick={exportConversation}>
              Export
            </button>
            <button type="button" className="primary-button" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </header>

        <section className="workspace-grid">
          <div className="chat-panel">
            <div className="chat-panel__header">
              <div>
                <h2>Chat</h2>
                <p>
                  Ask anything, continue responses, and manage your conversation history from the sidebar.
                </p>
              </div>
              <div className="header-stats">
                <span>{activeConversation?.messages.length || 0} messages</span>
                <span>{lastResult?.critique?.qualityScore ?? '—'} quality</span>
                <span>{currentStage || 'idle'}</span>
              </div>
              <div className="chat-panel__tools">
                <button type="button" className="primary-button" onClick={runResearch}>
                  Web research
                </button>
                <button type="button" className="primary-button" onClick={runSheetCreator}>
                  Create sheet
                </button>
              </div>
            </div>

            {researchResult || sheetResult ? (
              <div className="chat-tool-results">
                {researchResult ? <ToolResultCard title="Research brief" result={researchResult} /> : null}
                {sheetResult ? <ToolResultCard title="Sheet preview" result={sheetResult} onDownload={downloadSheetCsv} /> : null}
              </div>
            ) : null}

            <div className="message-stream">
              {(activeConversation?.messages || []).map((message) => (
                <div key={message.id}>
                  {editingMessageId === message.id ? (
                    <div className="edit-card">
                      <textarea value={editingValue} onChange={(event) => setEditingValue(event.target.value)} />
                      <div className="edit-card__actions">
                        <button type="button" className="primary-button" onClick={saveEditedMessage}>
                          Save
                        </button>
                        <button type="button" className="ghost-button" onClick={() => setEditingMessageId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MessageBubble
                      message={message}
                      onCopy={handleCopy}
                      onEdit={editMessage}
                      onRegenerate={regenerateMessage}
                      onRetry={retryResponse}
                      onContinue={continueGeneration}
                      onShare={shareConversation}
                    />
                  )}
                </div>
              ))}

              <div ref={messagesEndRef} />
            </div>

            <div className="composer">
              <div className="composer__input-wrap">
                <textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      handleComposerSend();
                    }
                  }}
                  placeholder="Ask Synthetix AI to research, draft, plan, compare, or continue the demo..."
                  rows={4}
                />
                <div className="composer__meta">
                  <span>{estimateTokens(composerValue)} est. tokens</span>
                  <span>Ctrl/Cmd + Enter to send</span>
                </div>
              </div>

              <div className="composer__actions">
                <button type="button" className="ghost-button" onClick={() => setComposerValue('')}>
                  Clear
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={isListening ? () => recognitionRef.current?.stop() : () => recognitionRef.current?.start()}
                  disabled={!voiceSupported}
                >
                  {isListening ? 'Stop mic' : 'Voice input'}
                </button>
                <button type="button" className="primary-button" onClick={handleComposerSend} disabled={loading}>
                  {loading ? 'Generating...' : 'Send'}
                </button>
              </div>
            </div>

            <div className="voice-controls">
              <span className="voice-controls__status">Voice: {voiceStatus}</span>
              <button type="button" className="ghost-button" onClick={pauseVoice} disabled={voiceStatus !== 'speaking'}>
                Pause
              </button>
              <button type="button" className="ghost-button" onClick={resumeVoice} disabled={voiceStatus !== 'paused'}>
                Resume
              </button>
              <button type="button" className="ghost-button" onClick={replayVoice} disabled={!lastResult}>
                Restart
              </button>
              <button type="button" className="danger-button" onClick={stopVoice} disabled={voiceStatus === 'idle'}>
                Mute / Stop
              </button>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
          </div>

          <aside className="inspector">
            <div className="inspector-card">
              <div className="inspector-card__head">
                <h3>Live stream</h3>
                <span className={`stage-pill stage-pill--${currentStage || 'idle'}`}>{currentStage}</span>
              </div>
              <div className="stream-log" ref={logRef}>
                {currentStreamEvents.length === 0 ? (
                  <div className="muted-card">No live stream yet. Send a prompt to start the pipeline.</div>
                ) : (
                  currentStreamEvents.map((item, index) => (
                    <div key={`${item.event}-${index}`} className="stream-line">
                      <span>[{item.event}]</span>
                      <p>{JSON.stringify(compactPayload(item.event, item.data))}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="inspector-card">
              <div className="inspector-card__head">
                <h3>Quick actions</h3>
              </div>
              <div className="action-stack">
                <button type="button" className="ghost-button" onClick={createConversation}>
                  New chat
                </button>
                <button type="button" className="ghost-button" onClick={continueGeneration}>
                  Continue generation
                </button>
                <button type="button" className="ghost-button" onClick={shareConversation}>
                  Copy thread
                </button>
                <button type="button" className="ghost-button" onClick={openLoginPreset}>
                  Demo login preset
                </button>
              </div>
            </div>

            <div className="inspector-card">
              <div className="inspector-card__head">
                <h3>Conversation health</h3>
              </div>
              <div className="health-grid">
                <div>
                  <span>Context window</span>
                  <strong>{tokenUsagePercent}%</strong>
                </div>
                <div>
                  <span>Stream state</span>
                  <strong>{loading ? 'Busy' : 'Ready'}</strong>
                </div>
                <div>
                  <span>Auto speak</span>
                  <strong>{settings.autoSpeak ? 'On' : 'Off'}</strong>
                </div>
                <div>
                  <span>Sessions</span>
                  <strong>{conversations.length}</strong>
                </div>
              </div>
            </div>

            {lastResult ? (
              <div className="inspector-card">
                <div className="inspector-card__head">
                  <h3>Latest result</h3>
                </div>
                <div className="mini-card-list">
                  <div className="mini-card">
                    <span>Tasks completed</span>
                    <strong>{lastResult?.execution?.completedTasks || 0}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Quality score</span>
                    <strong>{lastResult?.critique?.qualityScore ?? 'n/a'}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Memory backend</span>
                    <strong>{lastResult?.memory?.backend || 'unknown'}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </main>

      {showSettings ? (
        <div className="settings-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-shell" onClick={(event) => event.stopPropagation()}>
            <SettingsPanel
              settings={settings}
              setSettings={setSettings}
              profile={profile}
              onClose={() => setShowSettings(false)}
              onLogout={logout}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
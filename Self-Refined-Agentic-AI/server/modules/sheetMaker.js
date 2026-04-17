const Groq = require('groq-sdk');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

function sanitizeFilename(name) {
  return String(name || 'agent-sheet')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent-sheet';
}

function escapeCsvCell(value) {
  const text = String(value ?? '');

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function rowsToCsv(columns, rows) {
  const header = columns.map(escapeCsvCell).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row?.[column] ?? '')).join(','));
  return [header, ...body].join('\n');
}

function buildPreviewMarkdown(columns, rows, limit = 5) {
  const previewRows = rows.slice(0, limit);
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = previewRows.map((row) => `| ${columns.map((column) => String(row?.[column] ?? '').replaceAll('|', '\\|')).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function fallbackSheet(prompt) {
  const columns = ['Item', 'Value', 'Notes'];
  const rows = [
    { Item: 'Topic', Value: prompt, Notes: 'Original request' },
    { Item: 'Milestone 1', Value: 'Planning', Notes: 'Define scope and timeline' },
    { Item: 'Milestone 2', Value: 'Execution', Notes: 'Complete the primary work' },
    { Item: 'Milestone 3', Value: 'Review', Notes: 'Check quality and finalize' },
  ];

  return {
    title: 'agent-sheet',
    filename: 'agent-sheet.csv',
    columns,
    rows,
    summary: `Created a simple fallback sheet for: ${prompt}`,
  };
}

async function createSheet(prompt) {
  const safePrompt = String(prompt || '').trim();

  if (!safePrompt) {
    return {
      success: false,
      error: 'A sheet prompt is required.',
    };
  }

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
              'You generate spreadsheet-ready data. Return only JSON with keys title, filename, columns, rows, and summary. columns must be an array of strings. rows must be an array of objects where each key matches a column name.',
          },
          {
            role: 'user',
            content: `Create a useful spreadsheet for: ${safePrompt}`,
          },
        ],
      });

      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
      const columns = Array.isArray(parsed.columns) && parsed.columns.length ? parsed.columns.map((item) => String(item)) : ['Item', 'Value', 'Notes'];
      const rows = Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : [];

      if (!rows.length) {
        throw new Error('Sheet generator returned no rows.');
      }

      const title = String(parsed.title || safePrompt || 'agent-sheet');
      const filename = `${sanitizeFilename(parsed.filename || title)}.csv`;
      const csv = rowsToCsv(columns, rows);

      return {
        success: true,
        artifactType: 'sheet',
        title,
        filename,
        columns,
        rows,
        csv,
        previewMarkdown: buildPreviewMarkdown(columns, rows),
        summary: parsed.summary || `Created spreadsheet data for ${title}.`,
        source: 'groq',
      };
    } catch {
      // Fall back to deterministic sheet output.
    }
  }

  const fallback = fallbackSheet(safePrompt);
  const csv = rowsToCsv(fallback.columns, fallback.rows);

  return {
    success: true,
    artifactType: 'sheet',
    title: fallback.title,
    filename: fallback.filename,
    columns: fallback.columns,
    rows: fallback.rows,
    csv,
    previewMarkdown: buildPreviewMarkdown(fallback.columns, fallback.rows),
    summary: fallback.summary,
    source: 'fallback',
  };
}

module.exports = { createSheet };
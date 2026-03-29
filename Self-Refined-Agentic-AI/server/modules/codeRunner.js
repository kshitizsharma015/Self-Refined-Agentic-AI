const axios = require('axios');
const https = require('https');
const vm = require('vm');

const PISTON_URL = process.env.PISTON_API_URL || 'https://piston.rs/api/v2/execute';

function extractCodeFence(text = '') {
  const match = text.match(/```(\w+)?\n([\s\S]*?)```/);
  if (!match) {
    return null;
  }

  return {
    language: (match[1] || '').toLowerCase(),
    code: match[2].trim(),
  };
}

function resolveRuntime(language) {
  if (language === 'python' || language === 'py') {
    return { language: 'python', version: '3.10.0' };
  }

  if (language === 'javascript' || language === 'js' || language === 'node') {
    return { language: 'javascript', version: '18.15.0' };
  }

  return { language: 'python', version: '3.10.0' };
}

function buildFallbackCode(task) {
  const safeTask = String(task.task || 'Unnamed task').replace(/'/g, '');
  const safeDescription = String(task.description || '').replace(/'/g, '');

  return {
    language: 'javascript',
    code: `console.log('Task:', '${safeTask}');\nconsole.log('Description:', '${safeDescription}');`,
  };
}

function runLocalJavaScript(code) {
  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.map((item) => String(item)).join(' ')),
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 1000 });

  return logs.join('\n') || 'Local JS execution completed with no console output.';
}

async function runCodeSnippet(language = 'javascript', code = '') {
  const normalizedLanguage = String(language || 'javascript').toLowerCase();
  const safeCode = String(code || '').trim();

  if (!safeCode) {
    return {
      success: false,
      source: 'input-validation',
      error: 'Code snippet is required.',
      output: 'Code snippet is required.',
    };
  }

  const descriptor = {
    task: `Run ${normalizedLanguage} code snippet`,
    description: `\`\`\`${normalizedLanguage}\n${safeCode}\n\`\`\``,
  };

  return runSandboxedCode(descriptor);
}

async function runSandboxedCode(task = {}) {
  const combinedText = `${task.task || ''}\n${task.description || ''}`;
  const fenced = extractCodeFence(combinedText);

  const selected = fenced && fenced.code ? fenced : buildFallbackCode(task);
  const runtime = resolveRuntime(selected.language);
  const allowInsecureTls = String(process.env.PISTON_ALLOW_INSECURE_TLS || 'true').toLowerCase() === 'true';
  const requestConfig = { timeout: 20000 };

  if (PISTON_URL.startsWith('https://') && allowInsecureTls) {
    requestConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  try {
    const response = await axios.post(
      PISTON_URL,
      {
        language: runtime.language,
        version: runtime.version,
        files: [{ content: selected.code }],
      },
      requestConfig
    );

    const run = response.data?.run || {};
    const stdout = run.stdout || '';
    const stderr = run.stderr || '';

    return {
      success: true,
      source: PISTON_URL,
      language: runtime.language,
      stdout,
      stderr,
      output: stdout || stderr || 'Code executed with empty output.',
    };
  } catch (error) {
    if (runtime.language === 'javascript') {
      try {
        const localOutput = runLocalJavaScript(selected.code);
        return {
          success: true,
          source: 'local-vm-fallback',
          language: runtime.language,
          stdout: localOutput,
          stderr: '',
          output: localOutput,
        };
      } catch (localError) {
        return {
          success: false,
          source: 'local-vm-fallback',
          error: localError.message,
          output: `Local JS fallback failed: ${localError.message}`,
        };
      }
    }

    return {
      success: false,
      source: PISTON_URL,
      error: error.message,
      output: `Code execution failed: ${error.message}`,
    };
  }
}

module.exports = { runSandboxedCode, runCodeSnippet };

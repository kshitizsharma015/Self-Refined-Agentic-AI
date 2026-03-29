import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = 'http://localhost:3000';

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
      // Keep raw text payload when JSON parse fails.
    }

    onEvent({ event: eventName, data: payload });
  }

  return remaining;
}

function trimText(text, maxLength = 180) {
  const value = String(text ?? '');
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
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

export default function App() {
  const [goal, setGoal] = useState('Find latest AI papers and summarize trends');
  const [events, setEvents] = useState([]);
  const [finalResult, setFinalResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const logRef = useRef(null);
  const recognitionRef = useRef(null);

  const timeline = useMemo(
    () =>
      events.map((item, index) => ({
        id: `${index}-${item.event}`,
        ...item,
        compactData: compactPayload(item.event, item.data),
      })),
    [events]
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [timeline]);

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
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setGoal(transcript.trim());
    };

    recognition.onerror = () => {
      setIsListening(false);
      setError('Voice capture failed. Try again or type the goal manually.');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);
  }, []);

  useEffect(() => {
    if (!finalResult || !autoSpeak || !window.speechSynthesis) {
      return;
    }

    const summary = [
      finalResult.message,
      `Completed ${finalResult?.execution?.completedTasks || 0} tasks.`,
      `Quality score ${finalResult?.critique?.qualityScore || 0}.`,
    ].join(' ');

    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [finalResult, autoSpeak]);

  const startListening = () => {
    if (!recognitionRef.current) {
      setError('Speech recognition is not available in this browser.');
      return;
    }

    try {
      setError('');
      setIsListening(true);
      recognitionRef.current.start();
    } catch {
      setIsListening(false);
      setError('Microphone could not start. Please retry.');
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  const copyFinalResult = async () => {
    if (!finalResult) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(finalResult, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      setError('Could not copy final result to clipboard.');
    }
  };

  const startStream = async () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      setError('Goal is required.');
      return;
    }

    setLoading(true);
    setError('');
    setFinalResult(null);
    setEvents([]);

    try {
      const response = await fetch(`${API_BASE}/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmedGoal }),
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
          setEvents((prev) => [...prev, evt]);

          if (evt.event === 'final_result') {
            setFinalResult(evt.data);
          }

          if (evt.event === 'error') {
            setError(typeof evt.data === 'string' ? evt.data : evt.data?.error || 'Streaming failed.');
          }
        });
      }
    } catch (streamError) {
      setError(streamError.message || 'Unable to stream events.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <section className="card">
        <h1>Synthetix AI Live Thought Visualizer</h1>
        <p>Submit a high-level goal and watch the agent stream internal stage updates in real time.</p>

        <label htmlFor="goal">Goal</label>
        <textarea
          id="goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={4}
          placeholder="Enter an abstract goal..."
        />

        <div className="actions">
          <button type="button" onClick={startStream} disabled={loading}>
            {loading ? 'Streaming...' : 'Run Agent Stream'}
          </button>
          <button type="button" onClick={isListening ? stopListening : startListening} disabled={!voiceSupported}>
            {isListening ? 'Stop Mic' : 'Jarvis Mic'}
          </button>
          <label className="voiceToggle">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
            />
            Auto speak result
          </label>
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>

      <section className="card terminal">
        <h2>Live Timeline</h2>
        <div className="log" ref={logRef}>
          {timeline.length === 0 ? <p className="muted">No events yet.</p> : null}
          {timeline.map((item) => (
            <div key={item.id} className="line">
              <span className="event">[{item.event}]</span>
              <span className="payload">{JSON.stringify(item.compactData)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="resultHead">
          <h2>Final Result Snapshot</h2>
          <button type="button" onClick={copyFinalResult} disabled={!finalResult}>
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
        </div>
        <pre>{finalResult ? JSON.stringify(finalResult, null, 2) : 'No final result yet.'}</pre>
      </section>
    </div>
  );
}
import { useMemo, useState } from 'react';

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

export default function App() {
  const [goal, setGoal] = useState('Find latest AI papers and summarize trends');
  const [events, setEvents] = useState([]);
  const [finalResult, setFinalResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const timeline = useMemo(
    () => events.map((item, index) => ({ id: `${index}-${item.event}`, ...item })),
    [events]
  );

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
        </div>

        {error ? <div className="error">{error}</div> : null}
      </section>

      <section className="card terminal">
        <h2>Live Timeline</h2>
        <div className="log">
          {timeline.length === 0 ? <p className="muted">No events yet.</p> : null}
          {timeline.map((item) => (
            <div key={item.id} className="line">
              <span className="event">[{item.event}]</span>
              <span className="payload">{typeof item.data === 'string' ? item.data : JSON.stringify(item.data)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Final Result Snapshot</h2>
        <pre>{finalResult ? JSON.stringify(finalResult, null, 2) : 'No final result yet.'}</pre>
      </section>
    </div>
  );
}
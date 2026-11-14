import { useState, type FormEvent } from 'react';

export function MockResearchChat({ onAddEvent }: { onAddEvent: (topic: string) => Promise<void> }) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<string[]>(['Demo mode is on. Explore the sample graph or add a simulated event; no backend/API calls are made.']);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || busy) return;
    setBusy(true);
    setPrompt('');
    setMessages((items) => [...items, `You: ${value}`, 'Demo: Added a simulated event to this graph.']);
    try { await onAddEvent(value); } finally { setBusy(false); }
  };
  return <section className="gh-research gh-mock-chat" aria-label="Demo research chat">
    <header className="gh-chat-heading"><h2>Research chat <span className="gh-demo-badge">Local demo</span></h2><p>Simulated interaction · backend disabled</p></header>
    <div className="gh-chat-messages">{messages.map((message, index) => <p className="gh-chat-intro" key={`${index}-${message}`}>{message}</p>)}</div>
    <form className="gh-composer" onSubmit={(event) => void submit(event)}>
      <label htmlFor="mock-chat-prompt">Add a simulated event</label>
      <textarea id="mock-chat-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe an event to add to this demo graph" />
      <button className="gh-primary" type="submit" disabled={!prompt.trim() || busy}>{busy ? 'Adding…' : 'Add demo event'}</button>
    </form>
  </section>;
}

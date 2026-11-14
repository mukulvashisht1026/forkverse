import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageDto, ResearchActionDto, ResearchStreamEventDto, SourceCitationDto } from '../../../contracts/investigations';
import { getConversation, renderSafeMarkdown, runResearchAction, safeSourceUrl } from '../services/research';

interface Props {
  investigationId: string; disabled?: boolean; historyAvailable?: boolean;
  onGraphUpdated: (graph: ResearchStreamEventDto & { type: 'graph_updated' }) => void;
  /** Highlight the graph evidence an answer cited ("Show in graph"). */
  onShowSources?: (evidenceIds: string[], eventIds: string[]) => void;
}
type Message = ChatMessageDto & { pending?: boolean; interrupted?: boolean };
const localId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function ResearchChat({ investigationId, disabled, historyAvailable = true, onGraphUpdated, onShowSources }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [action, setAction] = useState<ResearchActionDto>('answer_question');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [nextCursor, setNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const currentId = useRef(investigationId);
  const historyRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  currentId.current = investigationId;

  // Follow the conversation (new messages, streamed tokens) unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const loadHistory = useCallback(async (cursor?: string) => {
    const id = investigationId;
    if (!historyAvailable) {
      setHistoryError('Conversation history is currently unavailable.');
      setLoadingHistory(false);
      return;
    }
    const epoch = generation.current;
    historyRef.current?.abort();
    const controller = new AbortController(); historyRef.current = controller;
    if (cursor) setLoadingMore(true); else { setLoadingHistory(true); setHistoryError(''); }
    try {
      const page = await getConversation(id, cursor, controller.signal);
      if (controller.signal.aborted || currentId.current !== id || generation.current !== epoch || page.investigationId !== id) return;
      setMessages((previous) => {
        const prior = new Map(previous.map((message) => [message.id, message]));
        for (const message of page.items) if (!prior.has(message.id)) prior.set(message.id, message);
        const merged = [...prior.values()];
        return cursor ? merged : merged.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && currentId.current === id && generation.current === epoch) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        if (import.meta.env.DEV) console.error('Conversation history request failed', detail);
        setHistoryError('Conversation history is currently unavailable.');
      }
    } finally {
      if (currentId.current === id && generation.current === epoch) { setLoadingHistory(false); setLoadingMore(false); }
    }
  }, [historyAvailable, investigationId]);

  useEffect(() => {
    generation.current += 1;
    requestRef.current?.abort(); requestRef.current = null;
    historyRef.current?.abort();
    setMessages([]); setNextCursor(undefined); setDraft(''); setSending(false); setSendError('');
    void loadHistory();
    return () => { generation.current += 1; requestRef.current?.abort(); historyRef.current?.abort(); };
  }, [investigationId, loadHistory]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const prompt = draft.trim();
    if (!historyAvailable) { setSendError('Research chat is not available for this temporary timeline context.'); return; }
    if (!prompt || sending || loadingHistory || disabled) return;
    const id = investigationId; const epoch = generation.current; const controller = new AbortController();
    requestRef.current = controller; setSending(true); setSendError(''); setDraft(''); stickToBottom.current = true;
    const userMessage: Message = { id: localId(), investigationId: id, role: 'user', content: prompt, sources: [], createdAt: new Date().toISOString(), pending: true };
    const assistantId = localId();
    setMessages((items) => [...items, userMessage, { id: assistantId, investigationId: id, role: 'assistant', content: '', sources: [], createdAt: new Date().toISOString(), pending: true }]);
    const isCurrent = () => !controller.signal.aborted && currentId.current === id && generation.current === epoch;
    const update = (fn: (items: Message[]) => Message[]) => { if (isCurrent()) setMessages(fn); };
    try {
      await runResearchAction({ investigationId: id, action, message: prompt }, controller.signal, (event) => {
        if (!isCurrent()) return;
        if (event.type === 'token') update((items) => items.map((item) => item.id === assistantId ? { ...item, content: item.content + event.text } : item));
        else if (event.type === 'sources') update((items) => items.map((item) => item.id === assistantId ? { ...item, sources: event.sources } : item));
        else if (event.type === 'graph_updated') { if (event.graph.investigationId === id) onGraphUpdated(event); }
        else if (event.type === 'message_complete' && event.message.investigationId === id) update((items) => items.map((item) => item.id === assistantId ? { ...event.message, pending: false } : item.id === userMessage.id ? { ...item, pending: false } : item));
      });
      update((items) => items.map((item) => item.id === userMessage.id || item.id === assistantId ? { ...item, pending: false } : item));
    } catch (error) {
      if (currentId.current === id && generation.current === epoch) {
        if (controller.signal.aborted) {
          setSendError('Response stopped. Partial answer kept; retry to continue.');
          setMessages((items) => items.map((item) => item.id === assistantId || item.id === userMessage.id ? { ...item, pending: false, interrupted: true } : item));
        } else {
          setSendError(error instanceof Error ? error.message : 'Research request failed.');
          update((items) => items.filter((item) => item.id !== userMessage.id && item.id !== assistantId));
          setDraft(prompt);
        }
      }
    } finally {
      if (currentId.current === id && generation.current === epoch) { setSending(false); requestRef.current = null; }
    }
  };

  return <aside className="gh-research" aria-label="Investigation research chat">
    <div className="gh-chat-heading"><h2>Research</h2><p>Investigation-scoped conversation</p></div>
    <div className="gh-chat-messages" ref={scrollRef} onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} aria-live="polite" aria-busy={loadingHistory || sending}>
      {loadingHistory && <p className="gh-muted">Loading conversation…</p>}
      {historyError && <div role="alert" className="gh-library-unavailable"><p>{historyError}</p><button type="button" onClick={() => void loadHistory()}>Retry history</button></div>}
      {!loadingHistory && !historyError && messages.length === 0 && <p className="gh-chat-intro">No saved conversation yet. Research history appears here when backend supports it.</p>}
      {nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadHistory(nextCursor)}>{loadingMore ? 'Loading…' : 'Load older messages'}</button>}
      {messages.map((message) => <article className={`gh-chat-message ${message.role}`} key={message.id}>
        <div>{renderSafeMarkdown(message.content).map((block, index) => {
          if (block.type === 'rule') return <hr key={index} />;
          const children = block.inline.map((part, tokenIndex) => {
            if (part.type === 'link') return <a key={tokenIndex} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>;
            if (part.type === 'citation') {
              const source = message.sources.find((item) => item.id === part.citationId);
              const href = source && safeSourceUrl(source.url);
              const label = (part.citationId ?? '').replace(/^S/i, '');
              return href ? <a key={tokenIndex} className="gh-cite" href={href} target="_blank" rel="noopener noreferrer" title={`${source.title}${source.publisher ? ` · ${source.publisher}` : ''}`}>{label}</a> : <span key={tokenIndex} className="gh-cite gh-cite-missing" title="Source metadata unavailable or unsafe">{label}</span>;
            }
            if (part.type === 'strong') return <strong key={tokenIndex}>{part.text}</strong>;
            if (part.type === 'emphasis') return <em key={tokenIndex}>{part.text}</em>;
            if (part.type === 'code') return <code key={tokenIndex}>{part.text}</code>;
            return <span key={tokenIndex}>{part.text}</span>;
          });
          if (block.type === 'heading') return <div key={index} className={`gh-markdown-h${block.level}`}>{children}</div>;
          if (block.type === 'quote') return <blockquote key={index}>{children}</blockquote>;
          if (block.type === 'list-item') return <div key={index} role="listitem" className="gh-markdown-list-item">{children}</div>;
          if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
          return <p key={index}>{children}</p>;
        })}</div>
        {message.pending && <span className="gh-muted">{message.content ? 'Generating…' : 'Researching…'}</span>}
        {message.interrupted && <span className="gh-muted">Response interrupted.</span>}
        {message.sources.length > 0 && <div className="gh-chat-sources"><span className="gh-chat-sources-label">Sources</span>{message.sources.map((source) => { const href = safeSourceUrl(source.url); return href ? <a key={source.id} href={href} target="_blank" rel="noopener noreferrer" className="gh-chat-source" title={source.title}><b>{source.id.replace(/^S/i, '')}</b>{source.publisher ?? source.title}</a> : null; })}</div>}
        {onShowSources && !message.pending && message.sources.some((source) => source.evidenceId) && <button type="button" className="gh-show-in-graph" onClick={() => onShowSources(
          message.sources.flatMap((source) => source.evidenceId ? [source.evidenceId] : []),
          [...new Set(message.sources.flatMap((source) => source.eventId ? [source.eventId] : []))],
        )}>Show {message.sources.filter((source) => source.evidenceId).length} cited in graph</button>}
      </article>)}
      {sendError && <p role="alert" className="gh-error">{sendError}</p>}
    </div>
    {sending && <button type="button" onClick={() => requestRef.current?.abort()}>Stop response</button>}
    <form className="gh-composer" onSubmit={submit}>
      <div className="gh-composer-row"><label htmlFor="research-action">Action</label><select id="research-action" value={action} onChange={(event) => setAction(event.target.value as ResearchActionDto)} disabled={sending || loadingHistory || disabled}>
        <option value="answer_question">Answer question</option><option value="extend_graph">Extend evidence graph</option>
      </select></div>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={action === 'answer_question' ? 'Ask about this investigation…' : 'What should the evidence graph explore next?'} rows={3} disabled={sending || loadingHistory || disabled} aria-label="Research prompt" />
      <button type="submit" className="gh-primary" disabled={sending || disabled || !draft.trim()}>{sending ? 'Researching…' : action === 'answer_question' ? 'Ask question' : 'Extend graph'}</button>
    </form>
  </aside>;
}

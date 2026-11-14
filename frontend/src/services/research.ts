import type { ApiErrorDto, ChatMessageDto, ChatPageDto, ResearchActionDto, ResearchRequestDto, ResearchStreamEventDto, SourceCitationDto } from '../../../contracts/investigations';

const API_BASE = import.meta.env?.VITE_API_BASE_URL ?? '';

export class ResearchApiError extends Error {
  constructor(message: string, readonly code = 'request_failed') { super(message); this.name = 'ResearchApiError'; }
}

function endpoint(path: string) { return `${API_BASE.replace(/\/$/, '')}${path}`; }
async function checked(response: Response) {
  if (response.ok) return;
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch((error) => { console.error('Invalid JSON error response', error); return {}; }) as { error?: string; message?: string; code?: string }
    : {};
  if (!contentType.includes('application/json')) console.error('Expected JSON API error but received', { status: response.status, contentType });
  const isHtmlFallback = contentType.includes('text/html');
  throw new ResearchApiError(payload.message ?? payload.error ?? (isHtmlFallback ? 'Research service is temporarily unavailable.' : `Research request failed (${response.status}).`), payload.code);
}

export async function getConversation(investigationId: string, cursor?: string, signal?: AbortSignal): Promise<ChatPageDto> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetch(endpoint(`/api/investigations/${encodeURIComponent(investigationId)}/messages${query}`), { signal });
  await checked(response);
  return response.json() as Promise<ChatPageDto>;
}

function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { void reader.cancel().catch(() => undefined); reject(new DOMException('The operation was aborted.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then((result) => { signal.removeEventListener('abort', abort); resolve(result); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export async function runResearchAction(input: ResearchRequestDto, signal: AbortSignal, onEvent: (event: ResearchStreamEventDto) => void): Promise<void> {
  const response = await fetch(endpoint(`/api/investigations/${encodeURIComponent(input.investigationId)}/research`), {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(input),
  });
  await checked(response);
  if (!response.body) throw new ResearchApiError('Backend did not provide a research stream.', 'stream_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (frame: string) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) return;
    let event: ResearchStreamEventDto;
    try { event = JSON.parse(data) as ResearchStreamEventDto; } catch { throw new ResearchApiError('Backend sent malformed research stream data.', 'invalid_stream'); }
    onEvent(event);
    if (event.type === 'error') throw new ResearchApiError(event.error.message, event.error.code);
  };
  try {
    while (true) {
      const { value, done } = await readWithAbort(reader, signal);
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      const frames = buffer.split('\n\n'); buffer = frames.pop() ?? '';
      frames.forEach(dispatch);
      if (done) break;
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if (signal.aborted) { await reader.cancel().catch(() => undefined); throw error; }
    throw error;
  } finally { reader.releaseLock(); }
}

// Conservative inline renderer: no HTML parsing, URL schemes restricted to HTTP(S).
export type MarkdownBlock =
  | { type: 'paragraph' | 'heading' | 'quote' | 'list-item' | 'code'; text: string; level?: number; ordered?: boolean; inline: MarkdownInline[] }
  | { type: 'rule' };
export type MarkdownInline = { type: 'text' | 'link' | 'citation' | 'strong' | 'emphasis' | 'code'; text: string; href?: string; citationId?: string };

function safeHttpUrl(raw: string): string | undefined {
  try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; }
  catch { return undefined; }
}

export function renderSafeMarkdown(text: string): MarkdownBlock[] {
  const inline = (line: string): MarkdownInline[] => {
    const tokens: MarkdownInline[] = [];
    const pattern = /\[\[source:([A-Za-z0-9_-]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
    let cursor = 0; let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) {
      if (match.index > cursor) tokens.push({ type: 'text', text: line.slice(cursor, match.index) });
      if (match[1]) tokens.push({ type: 'citation', text: `[${match[1]}]`, citationId: match[1] });
      else if (match[2]) { const href = safeHttpUrl(match[3]); tokens.push(href ? { type: 'link', text: match[2], href } : { type: 'text', text: match[0] }); }
      else if (match[4]) tokens.push({ type: 'code', text: match[4] });
      else if (match[5] || match[6]) tokens.push({ type: 'strong', text: match[5] ?? match[6] });
      else tokens.push({ type: 'emphasis', text: match[7] ?? match[8] });
      cursor = pattern.lastIndex;
    }
    if (cursor < line.length) tokens.push({ type: 'text', text: line.slice(cursor) });
    return tokens;
  };
  const blocks: MarkdownBlock[] = []; const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      index++; const code: string[] = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({ type: 'code', text: code.join('\n'), inline: [{ type: 'code', text: code.join('\n') }] }); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], inline: inline(heading[2]) }); index++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push({ type: 'rule' }); index++; continue; }
    const list = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) { blocks.push({ type: 'list-item', text: list[3], ordered: Boolean(list[2]), inline: inline(list[3]) }); index++; continue; }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { blocks.push({ type: 'quote', text: quote[1], inline: inline(quote[1]) }); index++; continue; }
    if (!line.trim()) { index++; continue; }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|\s*```|\s*(?:[-+*]|\d+\.)\s|\s*>|\s*(?:---+|\*\*\*+)\s*$)/.test(lines[index])) paragraph.push(lines[index++]);
    const content = paragraph.join(' '); blocks.push({ type: 'paragraph', text: content, inline: inline(content) });
  }
  return blocks;
}

export function safeSourceUrl(url: string): string | undefined { return safeHttpUrl(url); }

export function citationsById(sources: SourceCitationDto[]) { return new Map(sources.map((source) => [source.id, source])); }
export type { ApiErrorDto, ChatMessageDto, ChatPageDto, ResearchActionDto, ResearchRequestDto, ResearchStreamEventDto, SourceCitationDto };

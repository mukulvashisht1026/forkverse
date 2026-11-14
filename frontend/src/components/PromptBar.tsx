import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import type { PromptTargetMode, ScrapeProviderPreference } from '../types/tree';
import { validatePromptInput } from '../utils/scrapeNormalizer';

interface PromptBarProps {
  selectedNodeName: string;
  onSubmitPrompt: (input: {
    prompt: string;
    mode: PromptTargetMode;
    provider: ScrapeProviderPreference;
  }) => Promise<void>;
}

export function PromptBar({ selectedNodeName, onSubmitPrompt }: PromptBarProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<PromptTargetMode>('new-node');
  const [provider, setProvider] = useState<ScrapeProviderPreference>('auto');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!selectedNodeName && mode === 'branch') {
      setMode('new-node');
    }
  }, [selectedNodeName, mode]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt]);

  const submitCurrentPrompt = async () => {
    if (sending) return;
    setErrorMsg(null);
    const check = validatePromptInput(prompt);
    if (!check.valid) {
      setErrorMsg(check.error || 'Enter a prompt to send.');
      return;
    }

    setSending(true);
    try {
      await onSubmitPrompt({
        prompt: check.prompt,
        mode: selectedNodeName ? mode : 'new-node',
        provider,
      });
      setPrompt('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to send prompt to backend.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitCurrentPrompt();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitCurrentPrompt();
    }
  };

  const canSend = prompt.trim().length >= 3 && !sending;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex flex-col items-center px-4 sm:bottom-5">
      {errorMsg && (
        <p
          role="alert"
          className="pointer-events-auto mb-2 max-w-[min(640px,100%)] rounded-lg border border-[#ff9a4d]/40 bg-[rgba(12,16,32,0.94)] px-3 py-1.5 text-[12.5px] text-[#ffcca6] backdrop-blur-md"
        >
          {errorMsg}
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        data-testid="prompt-composer"
        className="pointer-events-auto w-full max-w-[640px] rounded-2xl border border-white/16 bg-[rgba(5,10,22,0.92)] px-3.5 pt-2.5 pb-2 shadow-[0_18px_48px_rgba(0,0,0,0.72)] backdrop-blur-md transition-colors focus-within:border-[#ff9a4d]/60"
      >
        <label htmlFor="backend-prompt-input" className="sr-only">
          Send prompt to backend
        </label>
        <textarea
          ref={textareaRef}
          id="backend-prompt-input"
          rows={1}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder="Message backend to track an X declaration, URL, or impact..."
          className="max-h-[120px] w-full resize-none border-0 bg-transparent px-1 py-0.5 text-[14.5px] leading-[1.45] font-light text-[#eef2fb] placeholder:text-[#8e9bb8]/70 focus:outline-none disabled:opacity-60"
        />

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-[#8e9bb8]">
            {selectedNodeName && (
              <div className="flex items-center gap-0.5 rounded-lg bg-white/6 p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('new-node')}
                  className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                    mode === 'new-node'
                      ? 'bg-white/14 text-white'
                      : 'text-[#8e9bb8] hover:text-white'
                  }`}
                >
                  New node
                </button>
                <button
                  type="button"
                  onClick={() => setMode('branch')}
                  className={`cursor-pointer max-w-[170px] truncate rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                    mode === 'branch'
                      ? 'bg-white/14 text-white'
                      : 'text-[#8e9bb8] hover:text-white'
                  }`}
                  title={`Attach branch onto ${selectedNodeName}`}
                >
                  Branch → {selectedNodeName}
                </button>
              </div>
            )}

            <div className="hidden items-center gap-0.5 rounded-lg bg-white/6 p-0.5 sm:flex">
              {(
                [
                  { id: 'auto', label: 'Auto' },
                  { id: 'exa', label: 'Exa' },
                  { id: 'context.dev', label: 'Context.dev' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setProvider(opt.id)}
                  className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] transition-colors ${
                    provider === opt.id
                      ? 'bg-white/14 text-white'
                      : 'text-[#8e9bb8] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send prompt"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all focus-visible:outline-2 focus-visible:outline-[#ff9a4d] ${
              canSend
                ? 'cursor-pointer border-[#ff9a4d] bg-[#ff9a4d] text-[#1a0e04] hover:opacity-95'
                : 'cursor-not-allowed border-white/12 bg-white/8 text-[#8e9bb8]'
            }`}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

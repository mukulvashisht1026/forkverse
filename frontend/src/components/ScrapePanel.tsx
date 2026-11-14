import { useState, type FormEvent } from 'react';
import { Globe, Loader2, Plus, X } from 'lucide-react';
import type {
  BranchGrowthSide,
  ScrapeProviderPreference,
} from '../types/tree';
import {
  validateManualNodeInput,
  validateScrapeRequest,
} from '../utils/scrapeNormalizer';

interface ScrapePanelProps {
  open: boolean;
  selectedNodeName: string;
  exaConfigured: boolean | null;
  contextDevConfigured: boolean | null;
  onClose: () => void;
  onScrapeNewMainNode: (input: {
    query: string;
    url?: string;
    provider: ScrapeProviderPreference;
  }) => Promise<void>;
  onScrapeBranchOntoSelected: (
    query: string,
    provider: ScrapeProviderPreference
  ) => Promise<void>;
  onAddManualBranch: (
    name: string,
    info: string,
    growthSide: BranchGrowthSide
  ) => Promise<void>;
  onAddManualMain: (name: string, info: string) => Promise<void>;
}

const PRESET_QUERIES = [
  'Trump X tariff declaration market reaction',
  'Trump X Federal Reserve interest rates post',
  'NVIDIA AI export curbs market impact',
];

export function ScrapePanel({
  open,
  selectedNodeName,
  exaConfigured,
  contextDevConfigured,
  onClose,
  onScrapeNewMainNode,
  onScrapeBranchOntoSelected,
  onAddManualBranch,
  onAddManualMain,
}: ScrapePanelProps) {
  const [tab, setTab] = useState<'scrape' | 'manual'>('scrape');
  const [provider, setProvider] = useState<ScrapeProviderPreference>('auto');
  const [query, setQuery] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualInfo, setManualInfo] = useState('');
  const [manualSide, setManualSide] = useState<BranchGrowthSide>('bottom');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleScrapeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const check = validateScrapeRequest({ query, url: targetUrl });
    if (!check.valid) {
      setErrorMsg(check.error || 'Invalid scrape query.');
      return;
    }

    setIsLoading(true);
    try {
      await onScrapeNewMainNode({
        query: check.query,
        url: check.targetUrl,
        provider,
      });
      setQuery('');
      setTargetUrl('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Live search request failed.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleScrapeBranch = async () => {
    setErrorMsg(null);
    const clean = query.trim();
    if (clean.length < 3) {
      setErrorMsg(
        'Enter at least 3 characters describing the support evidence to search.'
      );
      return;
    }
    setIsLoading(true);
    try {
      await onScrapeBranchOntoSelected(clean, provider);
      setQuery('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Branch search failed.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualAction = async (mode: 'branch' | 'main') => {
    setErrorMsg(null);
    const check = validateManualNodeInput({
      name: manualName,
      info: manualInfo,
    });
    if (!check.valid) {
      setErrorMsg(check.error || 'Please enter a node name.');
      return;
    }
    setIsLoading(true);
    try {
      if (mode === 'branch') {
        await onAddManualBranch(check.name, check.info, manualSide);
      } else {
        await onAddManualMain(check.name, check.info);
      }
      setManualName('');
      setManualInfo('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to save manual node.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside
      aria-label="Live Web Scrape and Node Builder"
      data-testid="scrape-panel"
      className="glass-panel-surface absolute right-4 top-16 z-30 w-[min(350px,calc(100%-32px))] p-4 sm:right-8 sm:top-[68px]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-white/6 p-1">
          <button
            type="button"
            onClick={() => {
              setTab('scrape');
              setErrorMsg(null);
            }}
            className={`cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
              tab === 'scrape'
                ? 'bg-white/15 text-white'
                : 'text-[#8e9bb8] hover:text-white'
            }`}
          >
            Exa / Live Web
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('manual');
              setErrorMsg(null);
            }}
            className={`cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
              tab === 'manual'
                ? 'bg-white/15 text-white'
                : 'text-[#8e9bb8] hover:text-white'
            }`}
          >
            Manual Node
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {tab === 'scrape' ? (
        <form onSubmit={handleScrapeSubmit} className="grid gap-2.5">
          <div>
            <span className="mb-1 block text-[12px] text-[#8e9bb8]">
              Search engine
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/6 p-1">
              {(
                [
                  { id: 'auto', label: 'Auto' },
                  { id: 'exa', label: 'Exa AI' },
                  { id: 'context.dev', label: 'Context.dev' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setProvider(opt.id);
                    setErrorMsg(null);
                  }}
                  className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                    provider === opt.id
                      ? 'bg-white/15 text-white'
                      : 'text-[#8e9bb8] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="scrape-query"
              className="mb-1 block text-[12px] text-[#8e9bb8]"
            >
              Declaration, X topic, or event
            </label>
            <input
              id="scrape-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={140}
              placeholder="e.g. Trump X tariffs declaration"
              className="w-full rounded-lg border border-white/15 bg-white/6 px-2.5 py-1.5 text-[13.5px] text-white placeholder:text-[#8e9bb8]/60 focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
            />
          </div>

          <div>
            <label
              htmlFor="scrape-url"
              className="mb-1 block text-[12px] text-[#8e9bb8]"
            >
              Optional target URL (X post, site, article)
            </label>
            <input
              id="scrape-url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://x.com/... or https://..."
              className="w-full rounded-lg border border-white/15 bg-white/6 px-2.5 py-1.5 text-[13px] text-white placeholder:text-[#8e9bb8]/60 focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {PRESET_QUERIES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setQuery(preset);
                  setErrorMsg(null);
                }}
                className="cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-[11.5px] text-[#cfd8ea] transition-colors hover:bg-white/12 hover:text-white"
              >
                {preset}
              </button>
            ))}
          </div>

          {errorMsg && (
            <p
              role="alert"
              className="m-0 rounded-lg border border-[#ff9a4d]/40 bg-[#ff9a4d]/10 px-2.5 py-1.5 text-[12.5px] text-[#ffcca6]"
            >
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-1 inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#ff9a4d] bg-[#ff9a4d] px-3 py-2 text-[13px] font-medium text-[#1a0e04] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching web & social...
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5" />
                Scrape live main node
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isLoading || !selectedNodeName}
            onClick={handleScrapeBranch}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[12.5px] text-white transition-colors hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="truncate">
              Scrape branch onto {selectedNodeName || 'selected'}
            </span>
          </button>

          {exaConfigured === false && contextDevConfigured === false && (
            <p className="m-0 pt-0.5 text-[11.5px] leading-snug text-[#8e9bb8]">
              Uses <span className="font-mono-tabular">EXA_API_KEY</span> or{' '}
              <span className="font-mono-tabular">CONTEXT_DEV_API_KEY</span>{' '}
              from Secrets when set; otherwise live search grounding runs automatically.
            </p>
          )}
        </form>
      ) : (
        <div className="grid gap-2.5">
          <div>
            <label
              htmlFor="manual-name"
              className="mb-1 block text-[12px] text-[#8e9bb8]"
            >
              Node title
            </label>
            <input
              id="manual-name"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Fed Reaction"
              className="w-full rounded-lg border border-white/15 bg-white/6 px-2.5 py-1.5 text-[13.5px] text-white placeholder:text-[#8e9bb8]/60 focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
            />
          </div>

          <div>
            <label
              htmlFor="manual-info"
              className="mb-1 block text-[12px] text-[#8e9bb8]"
            >
              Description / impact summary
            </label>
            <input
              id="manual-info"
              value={manualInfo}
              onChange={(e) => setManualInfo(e.target.value)}
              maxLength={180}
              placeholder="Shown in the center focus card"
              className="w-full rounded-lg border border-white/15 bg-white/6 px-2.5 py-1.5 text-[13.5px] text-white placeholder:text-[#8e9bb8]/60 focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
            />
          </div>

          <div>
            <span className="mb-1 block text-[12px] text-[#8e9bb8]">
              Branch growth direction
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/6 p-1">
              <button
                type="button"
                onClick={() => setManualSide('top')}
                className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  manualSide === 'top'
                    ? 'bg-white/15 text-white'
                    : 'text-[#8e9bb8] hover:text-white'
                }`}
              >
                Grow above spine
              </button>
              <button
                type="button"
                onClick={() => setManualSide('bottom')}
                className={`cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  manualSide === 'bottom'
                    ? 'bg-white/15 text-white'
                    : 'text-[#8e9bb8] hover:text-white'
                }`}
              >
                Grow below spine
              </button>
            </div>
          </div>

          {errorMsg && (
            <p
              role="alert"
              className="m-0 rounded-lg border border-[#ff9a4d]/40 bg-[#ff9a4d]/10 px-2.5 py-1.5 text-[12.5px] text-[#ffcca6]"
            >
              {errorMsg}
            </p>
          )}

          <button
            type="button"
            disabled={isLoading || !selectedNodeName}
            onClick={() => void handleManualAction('branch')}
            className="mt-1 cursor-pointer truncate rounded-lg border border-[#ff9a4d] bg-[#ff9a4d] px-3 py-2 text-[13px] font-medium text-[#1a0e04] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add branch to {selectedNodeName || 'selected'}
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void handleManualAction('main')}
            className="cursor-pointer whitespace-nowrap rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-[12.5px] text-white transition-colors hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add main node
          </button>
        </div>
      )}
    </aside>
  );
}

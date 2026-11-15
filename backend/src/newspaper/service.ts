/**
 * Newspaper editions per investigation, cached by graph state (editionStateKey): an edition is
 * rewritten only after claims are rebuilt, sources are added or screening changes. Concurrent
 * requests for the same state share one build. Page images found via og:image are cached per URL.
 */
import { InvestigationError } from '../investigations/service.js';
import type { InvestigationStore } from '../investigations/store.js';
import type { NewspaperEditionDto } from '../investigations/types.js';
import type { JsonLlm } from '../proof/agents.js';
import { buildEdition, editionStateKey } from './edition.js';
import { renderNewspaperHtml } from './render.js';

export interface NewspaperServiceDeps {
  store: Pick<InvestigationStore, 'get'>;
  json: JsonLlm;
  /** og:image lookup for a page (e.g. Context.dev scrape metadata). */
  pageImage?: (url: string) => Promise<string | undefined>;
}

export class NewspaperService {
  private cache = new Map<string, { key: string; edition: Promise<NewspaperEditionDto> }>();
  private images = new Map<string, Promise<string | undefined>>();

  constructor(private deps: NewspaperServiceDeps) {}

  private pageImage = (url: string): Promise<string | undefined> => {
    if (!this.deps.pageImage) return Promise.resolve(undefined);
    let p = this.images.get(url);
    if (!p) {
      p = this.deps.pageImage(url).catch(() => undefined);
      this.images.set(url, p);
      if (this.images.size > 500) this.images.delete(this.images.keys().next().value!);
    }
    return p;
  };

  async edition(investigationId: string): Promise<NewspaperEditionDto> {
    const record = await this.deps.store.get(investigationId);
    if (!record) throw new InvestigationError(404, 'investigation_not_found', `Investigation "${investigationId}" was not found.`);
    const key = editionStateKey(record);
    const hit = this.cache.get(investigationId);
    if (hit?.key === key) return hit.edition;
    const edition = buildEdition(record, { json: this.deps.json, pageImage: this.pageImage });
    this.cache.set(investigationId, { key, edition });
    edition.catch(() => {
      if (this.cache.get(investigationId)?.edition === edition) this.cache.delete(investigationId);
    });
    return edition;
  }

  async html(investigationId: string): Promise<string> {
    return renderNewspaperHtml(await this.edition(investigationId));
  }
}

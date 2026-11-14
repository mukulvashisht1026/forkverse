import { logger } from '../utils/logger.js';

export interface DomainAge {
  available: boolean;           // false = signal unavailable (never treated as risky)
  registeredAt: string | null;
  ageDays: number | null;
}

const cache = new Map<string, DomainAge>();

/** Naive registrable domain: last two labels, or three for common 2nd-level ccTLDs (co.uk etc). */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2]!;
  const take = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(sld) && parts[parts.length - 1]!.length === 2 ? 3 : 2;
  return parts.slice(-take).join('.');
}

export async function domainAge(host: string, now = Date.now()): Promise<DomainAge> {
  const domain = registrableDomain(host);
  const hit = cache.get(domain);
  if (hit) return hit;
  let result: DomainAge = { available: false, registeredAt: null, ageDays: null };
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
      const reg = body.events?.find((e) => e.eventAction === 'registration')?.eventDate;
      if (reg && !Number.isNaN(Date.parse(reg))) {
        result = { available: true, registeredAt: reg, ageDays: Math.floor((now - Date.parse(reg)) / 86_400_000) };
      }
    }
  } catch (err) {
    logger.debug({ err, domain }, 'rdap lookup failed');
  }
  cache.set(domain, result);
  return result;
}

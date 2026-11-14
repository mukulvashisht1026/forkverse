/**
 * Render a NewspaperEditionDto as a standalone broadsheet page (design from
 * todo/modern-newspaper.html, "white-paper broadsheet edition").
 *
 * Every string from the graph / editor model is HTML-escaped; URLs are limited to http(s).
 * Images are the articles' own lead images (greyscale "print" look, colour on hover); when one
 * fails to load, a generated geometric illustration is shown instead. When embedded in an
 * iframe, the page posts its height to the parent (`tracewire:newspaper-height`).
 */
import type { NewspaperEditionDto, NewspaperSourceDto, NewspaperStoryDto } from '../investigations/types.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeUrl = (u?: string) => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '');
const fmtDate = (iso?: string, long = false) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const PALETTES = [
  ['#c5cabc', '#c16b43', '#9b9f87', '#65796d', '#354f42'],
  ['#304e80', '#536b91', '#223a64', '#e8e5da', '#b54e39'],
  ['#d6c8ad', '#8b4b34', '#b7a287', '#f1e7cb', '#52664c'],
  ['#a55542', '#bc7057', '#844637', '#ded3ac', '#405c56'],
];

/** Generated editorial illustration (geometric, seeded) used when an article has no usable image. */
export function artSvg(seedText: string, label: string, w = 550, h = 480): string {
  const r = seedOf(seedText);
  const p = PALETTES[r % PALETTES.length]!;
  const n = (k: number, max: number) => ((r >>> (k * 3)) % max);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid slice"><rect width="${w}" height="${h}" fill="${p[0]}"/><circle cx="${w * 0.62 + n(1, 120)}" cy="${h * 0.22 + n(2, 60)}" r="${h * 0.14 + n(3, 30)}" fill="${p[1]}"/><path d="M0 ${h * 0.56}L${w} ${h * 0.44 - n(4, 40)}V${h}H0Z" fill="${p[2]}"/><path d="M${w * 0.08} ${h * 0.25}L${w * 0.26} ${h * 0.16}V${h * 0.74}L${w * 0.08} ${h * 0.84}Z" fill="${p[3]}"/><path d="M${w * 0.42} ${h * 0.34}L${w * 0.58} ${h * 0.3}V${h * 0.6}L${w * 0.42} ${h * 0.64}Z" fill="${p[3]}" opacity=".8"/><g fill="${p[4]}"><circle cx="${w * 0.12}" cy="${h * 0.7}" r="${h * 0.12}"/><circle cx="${w * 0.88}" cy="${h * 0.78}" r="${h * 0.13}"/></g></svg>`;
}

function figure(story: NewspaperStoryDto, cls: string, seed: string, w: number, h: number): string {
  const art = artSvg(seed, story.headline, w, h);
  const img = safeUrl(story.imageUrl);
  return img
    ? `<div class="${cls} has-img">${art}<img src="${esc(img)}" alt="${esc(story.headline)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>`
    : `<div class="${cls}">${art}</div>`;
}

const statusChip = (s?: NewspaperStoryDto['status']) =>
  s === 'pending' ? '<span class="chip chip-unverified">Unverified</span>' : s === 'disputed' ? '<span class="chip chip-disputed">Disputed</span>' : s === 'established' ? '<span class="chip chip-established">Verified by 2+ sources</span>' : '';

function sourceLinks(sources: NewspaperSourceDto[], max = 4): string {
  if (!sources.length) return '';
  return `<ul class="sources">${sources
    .slice(0, max)
    .map((s) => {
      const url = safeUrl(s.url);
      const label = `${esc(s.publisher ?? host(s.url))}${s.publishedAt ? ` · ${esc(fmtDate(s.publishedAt))}` : ''}`;
      return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} <span aria-hidden="true">↗</span></a>` : label}<span class="src-title">${esc(s.title)}</span></li>`;
    })
    .join('')}</ul>`;
}

const CSS = `:root{--paper:#fff;--ink:#111;--muted:#444;--rule:#aaa;--red:#ae392a;--wash:#f5f5f5}*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font-family:"Times New Roman",Times,serif}a{color:inherit}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid var(--red);outline-offset:4px}
main,header,footer{max-width:1320px;margin:auto;padding:0 32px}
.utility{display:flex;justify-content:space-between;gap:12px;padding:13px 0 10px;font:9px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}.utility span:last-child{color:var(--muted)}
.masthead{border-top:3px double #111;border-bottom:5px double #111;text-align:center;padding:17px 0 12px}.masthead h1{font:900 clamp(44px,8vw,104px)/.95 Georgia,"Times New Roman",serif;letter-spacing:-5px;margin:0}.masthead p{font:italic 14px Georgia,serif;margin:9px 0 0}
.nav{display:flex;justify-content:center;gap:30px;border-bottom:1px solid #111;overflow-x:auto}.nav span{font:10px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;padding:11px 0 8px;white-space:nowrap}.nav span:first-child{border-bottom:3px solid var(--red);font-weight:bold}
.edition{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #111;margin-bottom:15px;font:9px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase}.edition strong{color:var(--red)}
.crux{display:flex;gap:16px;align-items:baseline;border-bottom:1px solid #111;padding:4px 0 16px;margin-bottom:18px}.crux b{flex:none;font:700 10px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:var(--red)}.crux p{margin:0;font:italic 21px/1.35 Georgia,serif}
.lead{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.55fr) minmax(190px,.72fr);gap:20px;padding:0 0 20px;border-bottom:4px double #111}
.kicker{font:700 10px/1.4 Arial,sans-serif;letter-spacing:1.1px;text-transform:uppercase;color:var(--red);margin:0 0 10px}
.headline{font:700 clamp(32px,3.5vw,50px)/1.03 Georgia,serif;letter-spacing:-1.6px;margin:0 0 13px}
.dek{font:italic 18px/1.35 Georgia,serif;color:#222;border-bottom:1px solid #aaa;padding-bottom:14px;margin:0 0 14px}
.byline{font:700 9px/1.5 Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;margin:12px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-block;border:1px solid #111;padding:1px 6px;font:700 8px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}.chip-unverified{border-style:dashed;color:#7a5b00;border-color:#b8952c}.chip-disputed{color:var(--red);border-color:var(--red)}
.print-copy{font:15px/1.45 "Times New Roman",serif;text-align:justify;hyphens:auto;margin:10px 0 15px}.print-copy p{margin:0 0 9px}.print-copy p:first-child:first-letter{float:left;font:700 48px/.85 Georgia,serif;margin:5px 5px 0 0}
.text-button{background:none;border:0;border-bottom:1px solid #111;padding:0 0 3px;font:italic 13px Georgia,serif}.text-button:hover{text-decoration:underline}
.feature-art{margin:0}.feature-art .pic{position:relative;height:350px;overflow:hidden;background:#ddd}
.pic svg,.art svg{position:absolute;inset:0;width:100%;height:100%;display:block;filter:grayscale(1) contrast(1.12)}
.pic img,.art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(1) contrast(1.08);transition:filter .5s ease}
.pic:hover img,.art:hover img{filter:none}
.feature-art figcaption{font:11px/1.4 "Times New Roman",serif;padding:8px 0 10px;border-bottom:1px solid #aaa;display:flex;justify-content:space-between;gap:12px;color:var(--muted)}
.photo-report{margin-top:12px}.photo-report h4,.side-label{font:700 10px Arial,sans-serif;letter-spacing:1.2px;text-transform:uppercase;margin:0 0 6px}
.sources{list-style:none;margin:0;padding:0;display:grid;gap:6px;font:13px/1.35 "Times New Roman",serif}.sources a{font:700 10px Arial,sans-serif;letter-spacing:.4px;text-decoration:none;border-bottom:1px solid #999}.sources a:hover{border-color:#111}.src-title{display:block;color:var(--muted);font-style:italic}
.briefs{border-left:1px solid var(--rule);padding-left:18px}.section-label{font:700 16px Georgia,serif;border-top:2px solid #111;border-bottom:1px solid #111;padding:7px 0;margin:0 0 14px}
.brief{padding-bottom:15px;margin-bottom:15px;border-bottom:1px solid var(--rule)}.brief:last-child{border:0;margin:0;padding:0}.brief small{font:9px Arial,sans-serif;letter-spacing:1px;color:var(--red);text-transform:uppercase}.brief h3{font:bold 21px/1.08 Georgia,serif;margin:8px 0}.brief p{font:15px/1.4 "Times New Roman",serif;color:#222;margin:0 0 6px}.brief a{font:italic 12px Georgia,serif}
.stories-heading{display:flex;justify-content:space-between;align-items:center;margin:18px 0 16px;padding-bottom:8px;border-bottom:1px solid #111}.stories-heading h2{font:bold 22px Georgia,serif;letter-spacing:-.5px;margin:0}.stories-heading span{font:9px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px}
.stories{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.story{min-width:0;border-right:1px solid var(--rule);padding-right:20px}.story:last-child{border:0;padding:0}
.art{position:relative;height:160px;overflow:hidden;margin-bottom:12px;background:#ddd}.story h3{font:bold 25px/1.08 Georgia,serif;letter-spacing:-.4px;margin:0 0 10px}.story p{font:16px/1.4 "Times New Roman",serif;color:#222;margin:0}.story .kicker{font:700 10px/1.4 Arial,sans-serif;letter-spacing:1.1px;color:var(--red);margin:0 0 8px}
.chronology{margin:26px 0 10px;border-top:4px double #111;border-bottom:1px solid #111;padding:18px 0 8px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px}.chronology h2{font:bold 29px/1.05 Georgia,serif;margin:0}.chronology .intro{font:15px/1.4 "Times New Roman",serif;color:#333;margin:10px 0 0}
.chronology ol{list-style:none;margin:0;padding:0;border-left:2px solid #111}.chronology li{position:relative;padding:0 0 12px 18px;font:16px/1.35 "Times New Roman",serif}.chronology li::before{content:"";position:absolute;left:-6px;top:5px;width:10px;height:10px;border-radius:50%;background:#111}.chronology li.pending::before{background:#fff;border:2px dashed #b8952c}.chronology li.disputed::before{background:var(--red)}.chronology time{display:block;font:700 9px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
.watch{margin:22px 0;border:1px solid var(--red);padding:14px 18px;display:grid;grid-template-columns:200px minmax(0,1fr);gap:20px}.watch h2{font:bold 22px Georgia,serif;margin:0;color:var(--red)}.watch p{font:14px/1.4 "Times New Roman",serif;margin:6px 0 0;color:#333}.watch ul{margin:0;padding-left:18px;font:15px/1.4 "Times New Roman",serif}.watch b{color:var(--red);font:700 11px Arial,sans-serif}
footer .foot{border-top:1px solid #111;margin-top:24px;padding:15px 0 23px;display:flex;justify-content:space-between;gap:15px;align-items:center}footer strong{font:bold 23px Georgia,serif}footer span{font:10px Arial,sans-serif;color:var(--muted)}
dialog{max-width:680px;width:calc(100% - 36px);padding:34px;background:#fff;color:#111;border:1px solid #111}dialog::backdrop{background:#1119}dialog h2{font:bold 34px/1.1 Georgia,serif;margin:0 0 14px}dialog p{font:18px/1.6 Georgia,serif}dialog .close{float:right;background:none;border:1px solid var(--rule);padding:7px 12px}
@media(max-width:1000px){.lead{grid-template-columns:1fr 1.3fr}.briefs{grid-column:1/-1;border:0;border-top:1px solid var(--rule);padding:16px 0 0;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.briefs .section-label{grid-column:1/-1}.brief{border:0;margin:0;padding:0}.chronology,.watch{grid-template-columns:1fr}}
@media(max-width:650px){main,header,footer{padding:0 18px}.masthead h1{font-size:46px;letter-spacing:-3px}.utility span:last-child{display:none}.lead,.stories,.briefs{grid-template-columns:1fr}.feature-art .pic{height:260px}.story{border:0;border-bottom:1px solid var(--rule);padding:0 0 18px}.crux{flex-direction:column;gap:6px}.crux p{font-size:18px}}`;

const SCRIPT = `(function(){var d=document.querySelector('dialog');document.querySelectorAll('[data-open]').forEach(function(b){b.addEventListener('click',function(){d&&d.showModal()})});var c=document.querySelector('dialog .close');if(c)c.onclick=function(){d.close()};if(d)d.addEventListener('click',function(e){if(e.target===d)d.close()});
function post(){try{parent.postMessage({type:'tracewire:newspaper-height',height:Math.ceil(document.documentElement.scrollHeight)},'*')}catch(e){}}
if(window.ResizeObserver)new ResizeObserver(post).observe(document.body);window.addEventListener('load',post);document.querySelectorAll('img').forEach(function(i){i.addEventListener('load',post);i.addEventListener('error',post)});post();})();`;

export function renderNewspaperHtml(e: NewspaperEditionDto, opts: { masthead?: string } = {}): string {
  const masthead = opts.masthead ?? 'The Daily Trace';
  const lead = e.lead;
  const date = fmtDate(e.editionDate, true);
  const leadSources = sourceLinks(lead.sources, 4);

  const briefs = e.briefs.length
    ? e.briefs
        .map(
          (b, i) => `<article class="brief"><small>${String(i + 1).padStart(2, '0')} / ${esc(b.kicker)}</small><h3>${esc(b.headline)}</h3><p>${esc(b.dek)}</p>${statusChip(b.status)}${
            b.sources[0] && safeUrl(b.sources[0].url) ? ` <a href="${esc(safeUrl(b.sources[0].url))}" target="_blank" rel="noopener noreferrer">${esc(b.sources[0].publisher ?? host(b.sources[0].url))} ↗</a>` : ''
          }</article>`,
        )
        .join('')
    : '<article class="brief"><p>No further developments yet.</p></article>';

  const stories = e.stories
    .map(
      (s, i) => `<article class="story">${figure(s, 'art', `${s.claimId ?? s.headline}${i}`, 400, 190)}<p class="kicker">${esc(s.kicker)}</p><h3>${esc(s.headline)}</h3><p>${esc(s.dek)}</p><div class="byline">${s.date ? `<span>${esc(fmtDate(s.date))}</span>` : ''}${statusChip(s.status)}<span>${s.sources.length} source${s.sources.length === 1 ? '' : 's'}</span></div>${sourceLinks(s.sources, 2)}</article>`,
    )
    .join('');

  const timeline = e.timeline.length
    ? `<section class="chronology" aria-label="The story so far"><div><p class="kicker">Chronology</p><h2>The story so far</h2><p class="intro">Developments in date order, as recorded in the claim graph. Hollow markers are not yet verified.</p></div><ol>${e.timeline
        .map((t) => `<li class="${esc(t.status)}">${t.date ? `<time>${esc(fmtDate(t.date))}</time>` : ''}${esc(t.text)}</li>`)
        .join('')}</ol></section>`
    : '';

  const watch = e.propagandaWatch.length
    ? `<section class="watch" aria-label="Propaganda watch"><div><p class="kicker">Source screening</p><h2>⚑ Propaganda watch</h2><p>These sources were red-flagged by automatic screening (documented influence operations or verified propaganda techniques) and are not used in this edition.</p></div><ul>${e.propagandaWatch
        .map((w) => `<li>${esc(w.title)}${w.publisher ? ` — ${esc(w.publisher)}` : ''}${w.score !== undefined ? ` <b>${w.score}%</b>` : ''}</li>`)
        .join('')}</ul></section>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(masthead)} — ${esc(e.title)}</title><style>${CSS}</style></head><body>
<header><div class="utility"><span>Evidence first. Every claim sourced.</span><span>Edition No. ${e.editionNumber} · ${esc(date)}</span><span>${e.stats.sources} sources · ${e.stats.established} verified · ${e.stats.unverified} unverified</span></div><div class="masthead"><h1>${esc(masthead)}</h1><p>${e.entity ? `${esc(e.entity)} › ` : ''}${esc(e.title)}</p></div><nav class="nav" aria-label="Sections"><span>Front Page</span><span>The Story So Far</span><span>Developments</span><span>In Brief</span>${e.propagandaWatch.length ? '<span>Propaganda Watch</span>' : ''}</nav></header>
<main><div class="edition"><span>${esc(date)}</span><strong>${e.writer === 'llm' ? 'Live edition' : 'Live edition · compiled from claims'}</strong><span>Updated ${esc(new Date(e.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))} UTC</span></div>
<div class="crux"><b>The crux</b><p>${esc(e.crux)}</p></div>
<section class="lead" aria-label="Cover story"><article><p class="kicker">${esc(lead.kicker)}</p><h2 class="headline">${esc(lead.headline)}</h2><p class="dek">${esc(lead.dek)}</p><div class="byline"><span>From ${lead.sources.length} source${lead.sources.length === 1 ? '' : 's'}</span>${lead.date ? `<span>· ${esc(fmtDate(lead.date))}</span>` : ''}${statusChip(lead.status)}</div><div class="print-copy">${lead.paragraphs.slice(0, 2).map((p) => `<p>${esc(p)}</p>`).join('')}</div>${lead.paragraphs.length ? '<button class="text-button" data-open>Read the cover story <span aria-hidden="true">↗</span></button>' : ''}</article>
<figure class="feature-art">${figure(lead, 'pic', lead.claimId ?? lead.headline, 550, 480)}<figcaption><span>${esc(lead.headline)}</span><span>${lead.imageCredit ? `Photo: ${esc(lead.imageCredit)}` : 'Illustration / The Daily Trace'}</span></figcaption><div class="photo-report"><h4>Sources</h4>${leadSources || '<p>No sources yet.</p>'}</div></figure>
<aside class="briefs"><h2 class="section-label">In Brief</h2>${briefs}</aside></section>
${e.stories.length ? `<div class="stories-heading"><h2>Developments</h2><span>${e.stats.established} verified claims · ${e.stats.unverified} unverified</span></div><section class="stories" aria-label="Developments">${stories}</section>` : ''}
${timeline}${watch}</main>
<footer><div class="foot"><strong>${esc(masthead)}.</strong><span>Written automatically from the TRACEWIRE claim graph. Unverified claims are labelled; red-flagged sources are excluded. Not financial advice.</span><span>Edition generated ${esc(new Date(e.generatedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC</span></div></footer>
<dialog aria-labelledby="leadTitle"><button class="close" aria-label="Close article">Close ×</button><p class="kicker">${esc(lead.kicker)}</p><h2 id="leadTitle">${esc(lead.headline)}</h2>${lead.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${leadSources}</dialog>
<script>${SCRIPT}</script></body></html>`;
}

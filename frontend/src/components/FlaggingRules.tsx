import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scale, X } from 'lucide-react';

/**
 * Static explainer of how a source gets red-flagged. Mirrors the backend rules in
 * backend/src/vetting/ (ratings.ts, rhetoric.ts groundRhetoric, vet.ts combineVetting); keep in sync.
 */
export function FlaggingRulesButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="tw-rules-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" title="How sources are screened and red-flagged">
        <Scale size={13} aria-hidden="true" /> Flagging rules
      </button>
      {open && createPortal(
        <div className="tw-rules-backdrop" onClick={() => setOpen(false)}>
          <div className="tw-rules" role="dialog" aria-modal="true" aria-labelledby="tw-rules-title" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2 id="tw-rules-title"><Scale size={16} aria-hidden="true" /> How a website gets red-flagged</h2>
              <button type="button" className="tw-rules-close" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </header>
            <div className="tw-rules-body">
              <p className="tw-rules-lead">Every source used to build the graph is screened automatically, with two independent checks. A flag means the <strong>propaganda score is above 74%</strong>. Flagged sources stay visible (faded, with the reason) but <strong>never count as evidence</strong> for a claim.</p>

              <section>
                <h3><span>1</span> Domain lists</h3>
                <p>The site's domain (and parent domains) is looked up in a labelled dataset of about 13,600 domains.</p>
                <ul>
                  <li><b className="k-bad">Documented influence operation</b> (e.g. takedowns reported by Meta, VIGINUM, Citizen Lab) → <em>manipulative</em>, score at least <b>90%</b>.</li>
                  <li><b className="k-warn">State media</b>, <b className="k-warn">low credibility</b> (contested ratings) or <b className="k-warn">satire</b> → shown as a caution tag only. <em>Never flagged on the listing alone.</em></li>
                  <li><b className="k-good">Reliable</b> → a positive signal.</li>
                </ul>
              </section>

              <section>
                <h3><span>2</span> Page text (rhetoric analysis)</h3>
                <p>The article text (at least 500 characters) is screened by a language model for these techniques: loaded language, fear/prejudice, name calling, false dilemma, causal oversimplification, whataboutism, straw man, repetition, exaggeration/minimisation, appeal to popularity or authority, flag waving, slogans, casting doubt, dehumanisation, smears.</p>
                <p>The model's answer is then <strong>checked by code</strong>:</p>
                <ul>
                  <li>Every quoted passage must appear <b>word for word</b> in the page, otherwise it is discarded.</li>
                  <li>Only the <b>author's own words</b> count. Quoting someone else's propaganda is reporting, not propaganda.</li>
                  <li>A propaganda finding needs <b>at least 2 different verified passages</b> in the author's voice.</li>
                  <li>A propaganda finding also needs a score <b>above 74%</b>; anything lower stays <em>uncertain</em>.</li>
                  <li><b>Data pages</b> (weather, market prices, sports scores, schedules, tables) only display data: <em>never assessed</em>, score 0.</li>
                  <li>Satire, ads, landing pages, unclear genres or partially read pages → <em>uncertain</em>, never flagged.</li>
                </ul>
              </section>

              <section>
                <h3><span>3</span> Propaganda score (0–100%)</h3>
                <table>
                  <tbody>
                    <tr><td>0–20%</td><td>neutral reporting</td></tr>
                    <tr><td>21–40%</td><td>some persuasive or emotive language</td></tr>
                    <tr><td>41–60%</td><td>notable one-sided framing</td></tr>
                    <tr><td>61–74%</td><td>strongly one-sided rhetoric (not flagged)</td></tr>
                    <tr className="is-flag"><td>75–89%</td><td>systematic manipulative rhetoric ⚑</td></tr>
                    <tr className="is-flag"><td>90–100%</td><td>pervasive propaganda (dehumanisation, fabricated enemies, fear-based calls to action) ⚑</td></tr>
                  </tbody>
                </table>
                <p>The score is capped so it always agrees with the verified evidence: <b>above 74% only with a verified propaganda finding</b>, at most 40% when there is no clear evidence, at most 74% when uncertain, and 0% for data pages.</p>
              </section>

              <section>
                <h3><span>4</span> Final verdict</h3>
                <ul>
                  <li><b className="k-bad">Manipulative</b>: a documented influence operation <em>or</em> a verified propaganda finding (score above 74%) in the text. Pruned from claims.</li>
                  <li><b className="k-good">Credible</b>: a positive signal (reliable listing or no clear evidence in the text) and no caution listing.</li>
                  <li><b className="k-warn">Uncertain</b>: everything else. A failed check (unreadable page, unknown domain) only lowers coverage; it never counts as risky or as safe.</li>
                </ul>
              </section>

              <section>
                <h3><span>5</span> What is never used as evidence</h3>
                <p>Who the publisher is, its political alignment, nationality or religion, or disagreeing with a position. The screen does not judge whether a statement is true; it only looks at how the text persuades.</p>
              </section>

              <p className="tw-rules-foot">Screening is a hint, not proof of intent, coordination or falsity. Hover the red flags in the graph or the screening badge to see each site's score and verified quotes.</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

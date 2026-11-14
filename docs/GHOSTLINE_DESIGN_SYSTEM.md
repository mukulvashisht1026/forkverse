# Ghostline design system — proposed v1

Status: Checkpoint 1 proposal, not applied to UI. Identity: precise, calm charcoal/teal interface; organic expression belongs to existing evidence graph. No new screens, services, controls or data capabilities.

## Reference research and translation

First-party references:
- https://linear.app/now/how-we-redesigned-the-linear-ui (2024): cohesive application chrome, improved hierarchy, perceptually coherent theme generation and iterative validation.
- https://linear.app/now/behind-the-latest-design-refresh (2026): restrained chrome, earned attention, quieter separation and content-first hierarchy.

Secondary reference read: https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md . This is a community reconstruction of public visual patterns, not Linear's internal specification. Marketing-oriented display sizes, exact hex colors and radius values are not authoritative app requirements.

Adopt principles, not branding: coherent surfaces, reduced chrome noise, compact controls and intentional typography. Reject purple/near-black copying, 80px marketing headings, contrast-slider features, feature-flag toolbars and new navigation. They do not fit this task. Our tonal progression is independently proposed and contrast-tested; no claim that Linear's actual luminance ratios were measured.

## Semantic colors

CSS names below are proposed. Retain old variable aliases during migration to avoid breaking shared controls. Values are Ghostline design choices, NOT extracted Linear tokens or measured Linear luminance matches.

| Role / proposed CSS token | Value |
|---|---|
| background.canvas / `--bg-canvas` | `#0D1319` |
| background.sidebar / `--bg-sidebar` | `#111820` |
| background.surface / `--bg-surface` | `#141C24` |
| background.elevated / `--bg-elevated` | `#1B2630` |
| background.hover / `--bg-hover` | `#202D38` |
| border.subtle / `--border-subtle` | `#253440` |
| border.default / `--border-default` | `#30404C` |
| border.focus / `--border-focus` | `#4DAFB8` |
| text.primary / `--text-primary` | `#E6EDF3` |
| text.secondary / `--text-secondary` | `#A3B0BD` |
| text.muted / `--text-muted` | `#8B9BAA` |
| accent.primary / `--accent-primary` | `#4DAFB8` |
| accent.subtle / `--accent-subtle` | `#183139` |
| text.on-accent / `--text-on-accent` | `#0D1319` |

Computed WCAG relative-luminance contrast on solid colors: primary text on canvas 15.81:1, secondary on surface 7.78:1, muted on elevated 5.39:1 and hover 4.93:1. Canvas-colored text on teal 7.24:1. These are numerical token checks, not rendered-page certification. Subtle dividers are decorative; do not rely on them alone to identify actionable controls. Focus outlines use teal with 2px width and offset.

## Typography

Keep `Geist, Inter, system-ui, sans-serif` fallback stack; neither named font is currently confirmed loaded. Do not claim Geist rendering. No proprietary fonts or new font dependency in this phase.

| Role | Size / line height | Weight |
|---|---|---|
| Home title | 36 / 42px desktop; 28 / 34px mobile | 500 |
| Screen / contextual heading | 16 / 24px | 600 |
| Section heading | 14 / 20px | 600 |
| Body, chat, input | 14 / 22px; mobile input 16 / 24px | 400 |
| Secondary text, labels, buttons | 12 / 18px | 400; controls 500 |
| Graph metadata | 12 / 16px | 400 |

Tracking: title -0.035em; section -0.01em; body normal. Uppercase only small brand mark, not routine labels. Monospace reserved for genuine identifiers/code.

## Geometry and state language

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px. Control radius 4px; composer/dialog 8px. Desktop control height 36px; touch targets at least 44px where feasible. Compact graph labels may remain denser, but interactive hit areas must stay accessible.

Home: keep 720px centered content, modest brand, single title/support line, integrated composer and secondary examples. Library is a quiet continuation, not another card. Preserve real loading, unavailable, empty and success states.

Workspace: preserve 46–48px header, approximately 360px chat, graph filling remaining area. No new sidebar/footer/timeline. Normalize chat text and spacing without changing stream/history behavior. Contextual evidence overlay remains dismissible and source-oriented.

Controls: accent on primary action and meaningful selected states only. Neutral controls use hover surface, visible keyboard outline, restrained disabled styling. No gradients, shadows around every card, purple palette, or organic button shapes.

## Implementation ownership and sequence

- Research/audit agents are read-only. One implementer owns `src/index.css` and shared tokens to prevent competing CSS edits.
- Home/Workspace JSX refinements happen sequentially in `App.tsx`; inspect latest edits from other sessions first. Chat changes must coordinate with owner of `ResearchChat.tsx`.
- Keep backend, DTOs, research services, graph geometry and event handling untouched by visual polish.
- Recheck `npm run check` after every frontend stage; add regression tests for behavior fixes. Never call paid scraping providers for QA.
- Capture real before/after screenshots and keyboard states; use isolated deterministic test data only in a test harness, never production library fixtures.

## Optional organic accent — deferred

The SVG already has branch growth, filaments and selected-node emphasis. Do not stack another animation onto them. After Home/Workspace approval, consider only reducing saturation/opacity of inactive graph decorations to emphasize selected evidence. Preserve graph topology, particle counts, projection, event timing and hit targets. Skip if comparison does not improve legibility.

## Approval gates

Checkpoint 1: approve this proposal before UI implementation.
Checkpoint 2: review rendered Home + Workspace before any graph change.
Checkpoint 3: review optional graph accent separately.

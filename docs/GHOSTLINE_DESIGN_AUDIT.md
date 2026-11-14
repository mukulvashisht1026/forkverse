# Ghostline design audit — Checkpoint 1

Status: code-based audit; proposed changes await review. No rendered screenshot inspected in this phase. Development checkpoint: `ae1ed06`. Other sessions may continue editing; recheck diffs before implementation.

## Current implementation

- Two screens remain: centered Home and Workspace with left research conversation and dominant graph.
- Active renderer is `TreeCanvasAdapter` → `investigationTree/components/TreeCanvas.tsx` (SVG from teammate ZIP). Legacy `TreeMapCanvas` is NOT active. Preserve current renderer, topology, projection, selection and streaming behavior.
- `ResearchChat.tsx` and research services have changed since earlier sessions. Do not replace them with an older shell.

## Findings and actions

| Area | Evidence | Smallest action |
|---|---|---|
| Typography | `src/index.css` declares Geist/Inter but no bundled font or font-face found | Use honest system fallback initially; explicit licensed font loading is a separate review decision. Standardize sizes/weights regardless of font |
| Color | Root variables coexist with many literal colors; SVG retains brass/navy palette | Alias existing variables to semantic tokens first; reserve graph palette changes for later approval |
| Home | 720px content, integrated composer, low-priority example links | Preserve composition; normalize labels, button dimensions, disabled/focus states |
| Workspace | 360px chat, graph remainder; stacked layout below 760px | Preserve architecture; unify spacing, message readability, contextual details and controls |
| Accessibility | Uneven focus styles; motion control lacks pressed state | Scope common focus styles; add state semantics without changing behavior |
| Graph semantics | Interactive SVG descendants inside image role | Verify screen-reader exposure before changing role; separate bug fix with regression coverage |
| Motion | CSS and JS animations coexist | Verify reduced motion and pause in both systems, not just stylesheet rules |
| Identity | Organic tree already provides signature; ordinary controls should remain quiet | No new illustration, particle system, toolbar or ornamental widget |

## Constraints and verification

No supplied Instagram collage files available for inspection. Descriptions alone inform proposed direction; no claim of image analysis.

No local browser executable or installed Playwright/Puppeteer found during audit. Screenshot tooling must be established before claiming visual approval. HTTP responses and builds are not visual verification.

Baseline `npm run check` passed (28 tests, production build; existing Vite `__dirname` warning). This validates the working tree at test time, not necessarily the exact checkpoint commit while another session edits.

## Review gates

1. Approve design tokens, typography and implementation scope.
2. Implement shared styles and Home/Workspace in bounded edits; capture before/after at 1440, 1280, 1024 and 390px. Stop for visual review.
3. Only after approval, consider one graph accent. Do not add new speculative effects now.

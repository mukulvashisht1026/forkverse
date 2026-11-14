# Required checks

For every frontend change, run `cd frontend && npm run check` before finishing. This runs TypeScript validation, automated tests, and production build. Add or update regression tests for bug fixes. Tests must not call paid external scraping providers; exercise validation, reducers, adapters, and HTTP routes with invalid or deterministic local inputs. Preserve unrelated concurrent edits.

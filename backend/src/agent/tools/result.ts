/**
 * Shared helpers for tool return values.
 *
 * Contains: `ok()` to serialise tool output as JSON for the model, and `notImplemented()`
 * used by stubbed tools so the agent abstains honestly instead of inventing data.
 */

export function ok(data: unknown): string {
  return JSON.stringify(data);
}

export function notImplemented(tool: string, args: unknown): string {
  return JSON.stringify({
    error: 'not_implemented',
    tool,
    args,
    note: 'This tool is not built yet. Tell the user the data is not available.',
  });
}

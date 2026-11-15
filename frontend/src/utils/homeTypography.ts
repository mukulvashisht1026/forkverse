export interface ProtectedContentRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Give the peripheral glyph field a soft continuation below the Home content. */
export function homeGlyphOpacity(
  x: number,
  y: number,
  content: ProtectedContentRect,
  inset = 24,
  fadeDistance = 140,
): number {
  if (
    x >= content.left - inset && x <= content.right + inset &&
    y >= content.top - inset && y <= content.bottom + inset
  ) return 0;

  const sideDistance = x < content.left - inset
    ? content.left - inset - x
    : x > content.right + inset
      ? x - content.right - inset
      : 0;
  const bottomDistance = y > content.bottom + inset
    ? y - content.bottom - inset
    : 0;
  return 0.12 * Math.min(1, Math.max(sideDistance, bottomDistance) / fadeDistance);
}

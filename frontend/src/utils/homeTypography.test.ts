import assert from 'node:assert/strict';
import test from 'node:test';
import { homeGlyphOpacity } from './homeTypography';

const content = { left: 300, right: 900, top: 100, bottom: 700 };

test('home typography protects content and fills the blank area below it', () => {
  assert.equal(homeGlyphOpacity(500, 400, content), 0);
  assert.equal(homeGlyphOpacity(500, 710, content), 0);
  assert.equal(homeGlyphOpacity(500, 794, content), 0.06);
  assert.equal(homeGlyphOpacity(500, 864, content), 0.12);
});

test('home typography still fades in from the side margins', () => {
  assert.equal(homeGlyphOpacity(276, 400, content), 0);
  assert.equal(homeGlyphOpacity(206, 400, content), 0.06);
  assert.equal(homeGlyphOpacity(136, 400, content), 0.12);
});

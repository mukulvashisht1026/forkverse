import { describe, expect, it } from 'vitest';
import { filterVerified, verifyQuote } from '../src/utils/quotes.js';

const source = 'The minister said:\n  “We will   cut taxes by 2025.”  Critics disagreed.';

describe('verifyQuote', () => {
  it('matches across whitespace, case and smart quotes', () => {
    expect(verifyQuote('"we will cut TAXES by 2025."', source)).toBe(true);
  });
  it('rejects paraphrase', () => {
    expect(verifyQuote('We will lower taxes by 2025', source)).toBe(false);
  });
  it('rejects empty quote or text', () => {
    expect(verifyQuote('', source)).toBe(false);
    expect(verifyQuote('   ', source)).toBe(false);
    expect(verifyQuote('x', null)).toBe(false);
  });
  it('filterVerified splits kept and discarded', () => {
    const { kept, discarded } = filterVerified([{ quote: 'Critics disagreed' }, { quote: 'invented' }], source);
    expect(kept).toHaveLength(1);
    expect(discarded).toHaveLength(1);
  });
});

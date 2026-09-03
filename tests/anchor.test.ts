// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { capturePath, idConfidence, looksStable, resolvePath } from '~/cs/anchor/element.ts';
import {
  buildTextIndex,
  CONTEXT_LEN,
  captureText,
  findQuote,
  offsetOf,
  overlapAt,
  rangeAt,
} from '~/cs/anchor/text.ts';
import type { TextAnchor } from '~/cs/anchor/types.ts';

const ARTICLE = `
  <article id="post">
    <h1>The Xerox Machine</h1>
    <p id="p1">A photocopier degrades an image a little every generation.</p>
    <p id="p2">Contrast climbs and midtones collapse into pure black and white.</p>
    <p id="p3">Zine makers leaned into it, and made a fourth copy.</p>
    <script>const noise = "this must never be indexed";</script>
    <p id="p4" style="display:none">Hidden text must never be indexed either.</p>
  </article>
`;

beforeEach(() => {
  document.body.innerHTML = ARTICLE;
});

describe('buildTextIndex', () => {
  it('collects visible prose and nothing else', () => {
    const idx = buildTextIndex();
    expect(idx.text).toContain('A photocopier degrades');
    expect(idx.text).not.toContain('must never be indexed');
  });

  it('normalizes runs of whitespace so markup reflow does not change offsets', () => {
    document.body.innerHTML = '<p>one   \n\n  two</p>';
    expect(buildTextIndex().text).toBe('one two');
  });

  it('keeps node starts in step with the flattened text', () => {
    const idx = buildTextIndex();
    for (let i = 0; i < idx.nodes.length; i++) {
      const start = idx.starts[i] as number;
      const value = (idx.nodes[i]?.nodeValue ?? '').replace(/\s+/g, ' ');
      expect(idx.text.slice(start, start + value.length)).toBe(value);
    }
  });

  it('survives a document with no text at all', () => {
    document.body.innerHTML = '<div></div>';
    const idx = buildTextIndex();
    expect(idx.text).toBe('');
    expect(rangeAt(idx, 0, 1)).toBeNull();
  });
});

/** Select `needle` in the document and return the resulting anchor. */
function anchorFor(needle: string): TextAnchor {
  const idx = buildTextIndex();
  const at = idx.text.indexOf(needle);
  expect(at, `"${needle}" should be in the page`).toBeGreaterThanOrEqual(0);
  const range = rangeAt(idx, at, at + needle.length);
  expect(range).not.toBeNull();
  const a = captureText(idx, range as Range);
  expect(a).toBeDefined();
  return a as TextAnchor;
}

describe('captureText', () => {
  it('records the quote with context on both sides', () => {
    const a = anchorFor('midtones collapse');
    expect(a.quote.exact).toBe('midtones collapse');
    expect(a.quote.prefix.length).toBeLessThanOrEqual(CONTEXT_LEN);
    expect(a.quote.prefix.endsWith('climbs and ')).toBe(true);
    expect(a.quote.suffix.startsWith(' into pure')).toBe(true);
  });

  it('round-trips through rangeAt', () => {
    const a = anchorFor('Zine makers');
    const idx = buildTextIndex();
    const r = rangeAt(idx, a.position.start, a.position.end) as Range;
    expect(r.toString()).toBe('Zine makers');
  });
});

describe('findQuote', () => {
  it('finds an unchanged quote exactly', () => {
    const a = anchorFor('midtones collapse');
    const hit = findQuote(buildTextIndex(), a);
    expect(hit?.exact).toBe(true);
    expect(hit?.score).toBe(1);
    expect(buildTextIndex().text.slice(hit?.start, hit?.end)).toBe('midtones collapse');
  });

  it('still finds the quote after the surrounding page changes', () => {
    const a = anchorFor('Zine makers leaned into it');
    // A whole new section appears above -- every offset moves.
    document.body.innerHTML = `<p>Breaking news banner that did not exist before.</p>${ARTICLE}`;
    const hit = findQuote(buildTextIndex(), a);
    expect(hit).not.toBeNull();
    expect(buildTextIndex().text.slice(hit?.start, hit?.end)).toBe('Zine makers leaned into it');
  });

  it('tolerates a small edit inside the quote', () => {
    const a = anchorFor('Contrast climbs and midtones collapse');
    document.body.innerHTML = ARTICLE.replace('Contrast climbs and', 'Contrast rises and');
    const hit = findQuote(buildTextIndex(), a);
    expect(hit).not.toBeNull();
    expect(hit?.exact).toBe(false);
    expect(hit?.score).toBeGreaterThan(0.55);
    expect(hit?.score).toBeLessThan(0.9);
  });

  it('gives up rather than guessing when the text is gone', () => {
    const a = anchorFor('Zine makers leaned into it');
    document.body.innerHTML = '<p>An entirely unrelated page about bicycles and weather.</p>';
    expect(findQuote(buildTextIndex(), a)).toBeNull();
  });

  /** The case that makes naive indexOf anchoring wrong on real pages. */
  it('picks the repeat closest to where the quote used to be', () => {
    document.body.innerHTML = `
      <p>alpha Read more beta</p>
      <p>${'filler '.repeat(40)}</p>
      <p>gamma Read more delta</p>`;
    const idx = buildTextIndex();
    const secondAt = idx.text.lastIndexOf('Read more');
    const anchor: TextAnchor = {
      quote: { exact: 'Read more', prefix: 'gamma ', suffix: ' delta' },
      position: { start: secondAt, end: secondAt + 9 },
    };
    const hit = findQuote(idx, anchor);
    expect(hit?.start).toBe(secondAt);
  });

  it('uses the prefix and suffix to disambiguate identical quotes', () => {
    document.body.innerHTML = '<p>one target two</p><p>three target four</p>';
    const idx = buildTextIndex();
    const anchor: TextAnchor = {
      quote: { exact: 'target', prefix: 'three ', suffix: ' four' },
      position: { start: 0, end: 6 },
    };
    const hit = findQuote(idx, anchor);
    expect(idx.text.slice((hit?.start ?? 0) - 6, hit?.start)).toBe('three ');
  });
});

describe('overlapAt', () => {
  it('is 1 when nothing moved and low when everything did', () => {
    const a = anchorFor('Zine makers');
    expect(overlapAt(buildTextIndex(), a)).toBeCloseTo(1, 5);
    document.body.innerHTML = '<p>Something completely different indeed.</p>';
    expect(overlapAt(buildTextIndex(), a)).toBeLessThan(0.5);
  });

  it('does not throw when the stored offsets are past the end', () => {
    const a: TextAnchor = {
      quote: { exact: 'x', prefix: '', suffix: '' },
      position: { start: 9e6, end: 9e6 },
    };
    expect(overlapAt(buildTextIndex(), a)).toBe(0);
  });
});

describe('offsetOf', () => {
  it('returns -1 for a node that is not in the index', () => {
    const idx = buildTextIndex();
    const orphan = document.createTextNode('not in the document');
    expect(offsetOf(idx, orphan, 0)).toBe(-1);
  });
});

describe('looksStable', () => {
  it.each([
    ['post', true],
    ['main-content', true],
    // A record id, not a position: perfectly stable for comment 42. It is still scored a
    // little lower than a digit-free id, because `item_3` is indistinguishable from it.
    ['comment_42_body', true],
    [':r3:', false],
    ['radix-17', false],
    ['mui-1734', false],
    ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', false],
    ['12345', false],
    ['', false],
  ])('%j -> %s', (id, want) => {
    expect(looksStable(id)).toBe(want);
  });
});

describe('idConfidence', () => {
  it('trusts a digit-free id more than one that might encode a position', () => {
    expect(idConfidence('main-content')).toBeGreaterThan(idConfidence('item_3'));
    expect(idConfidence('item_3')).toBeGreaterThan(0.65); // still good enough to use
  });
});

describe('capturePath / resolvePath', () => {
  it('round-trips an element', () => {
    const p3 = document.getElementById('p3') as Element;
    const path = capturePath(p3);
    expect(resolvePath(path)).toBe(p3);
  });

  it('distinguishes siblings of the same tag', () => {
    const p1 = document.getElementById('p1') as Element;
    const p2 = document.getElementById('p2') as Element;
    expect(resolvePath(capturePath(p1))).toBe(p1);
    expect(resolvePath(capturePath(p2))).toBe(p2);
  });

  it('returns null instead of a wrong element when the path no longer exists', () => {
    const path = capturePath(document.getElementById('p3') as Element);
    document.body.innerHTML = '<div><span>nothing like the original</span></div>';
    expect(resolvePath(path)).toBeNull();
  });

  it('is capped so a deep tree cannot produce an unbounded path', () => {
    let html = '<div>';
    for (let i = 0; i < 40; i++) html += '<div>';
    html += '<b id="deep">x</b>';
    document.body.innerHTML = html;
    const path = capturePath(document.getElementById('deep') as Element);
    expect(path.length).toBeLessThanOrEqual(12);
  });
});

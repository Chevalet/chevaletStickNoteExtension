/**
 * The font table, and the two rules everything else depends on.
 *
 * The whole feature turns on one thing: the name the build writes a file under and the name
 * the runtime asks for have to be the same string. If they drift, the font silently never
 * loads -- and "silently never loads" is indistinguishable from "the system happens not to
 * have this face", which is exactly the confusion the feature exists to end. So both ends call
 * `faceFile`, and this checks that the files it names are the files the package actually ships
 * by reading node_modules.
 *
 * That last part makes this test do something unusual: it touches the filesystem, and it will
 * fail if the dependency is not installed. That is the point. A test that only checked
 * `faceFile` against a hard-coded expectation would agree with itself while the build copied
 * nothing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONTS, faceFamily, faceFile, fontById, fontStack } from '~/shared/fonts.ts';

const BUNDLED = FONTS.filter((f) => f.bundle);

describe('the table', () => {
  it('offers exactly the faces we can actually deliver', () => {
    // Two system stacks plus six bundled. Any face without a bundle and without a system
    // stack would be a menu item that does nothing, which is what this release fixed.
    expect(FONTS).toHaveLength(8);
    expect(BUNDLED).toHaveLength(6);
    for (const font of FONTS) {
      expect(font.stack.length, `${font.id} has no fallback stack`).toBeGreaterThan(0);
    }
  });

  it('has a unique id for every face', () => {
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(FONTS.length);
  });

  it('falls back to the system face for an id that is not there', () => {
    // A note carrying a font id from a future version must still render.
    expect(fontById('a-face-from-2030').id).toBe('system');
    expect(fontById('').id).toBe('system');
  });

  it('covers Arabic with both Persian faces, and says so honestly for the rest', () => {
    for (const id of ['vazir', 'estedad']) {
      expect(fontById(id).scripts).toContain('arabic');
    }
    for (const id of ['marker', 'display', 'hand', 'grotesk']) {
      expect(fontById(id).scripts).not.toContain('arabic');
    }
  });
});

describe('faceFile', () => {
  it('names a file after the face, its subset and its weight', () => {
    const font = fontById('vazir');
    const files = font.bundle?.files ?? [];
    expect(files.map((f) => faceFile(font, f))).toEqual([
      'vazir-arabic-400.woff2',
      'vazir-arabic-700.woff2',
      'vazir-latin-400.woff2',
      'vazir-latin-700.woff2',
    ]);
  });

  it('names nothing twice across the whole table', () => {
    const names = BUNDLED.flatMap((f) => (f.bundle?.files ?? []).map((x) => faceFile(f, x)));
    expect(new Set(names).size).toBe(names.length);
  });

  it('names only files that cannot escape the fonts directory', () => {
    // The background matches the requested name against this table and then joins it onto a
    // path, so a name containing a separator would be the one interesting bug in that handler.
    for (const font of BUNDLED) {
      for (const file of font.bundle?.files ?? []) {
        expect(faceFile(font, file)).toMatch(/^[a-z0-9-]+\.woff2$/);
      }
    }
  });

  it('names files the installed package really contains', () => {
    // The check that stops the build and the runtime drifting apart. Reads node_modules on
    // purpose: the alternative agrees with itself and ships nothing.
    for (const font of BUNDLED) {
      const bundle = font.bundle;
      if (!bundle) continue;
      for (const file of bundle.files) {
        const source = join(
          'node_modules',
          bundle.package,
          'files',
          `${bundle.base}-${file.subset}-${file.weight}-normal.woff2`,
        );
        expect(existsSync(source), `${font.label}: ${source} is not in the package`).toBe(true);
      }
      expect(
        existsSync(join('node_modules', bundle.package, 'LICENSE')),
        `${font.label} ships no LICENSE, and the OFL requires one to travel with the font`,
      ).toBe(true);
    }
  });
});

describe('the CSS stack', () => {
  it('is the plain system stack for a system face', () => {
    const font = fontById('system');
    expect(fontStack(font)).toBe(font.stack);
    expect(fontStack(font)).not.toContain('cn');
  });

  it('puts the Arabic subset before the Latin one', () => {
    // The two files share no glyphs -- measured in spikes/firefox-fonts.mjs -- so both have to
    // be in the stack, and a right-to-left note should reach the Arabic one first.
    const stack = fontStack(fontById('vazir'));
    const arabic = stack.indexOf('vazir-arabic');
    const latin = stack.indexOf('vazir-latin');
    expect(arabic).toBeGreaterThanOrEqual(0);
    expect(latin).toBeGreaterThan(arabic);
  });

  it('keeps a system fallback on the end, so an unsupported script is not tofu', () => {
    // Neither subset has Cyrillic or CJK. Without the tail, that text would be boxes.
    expect(fontStack(fontById('vazir'))).toContain('sans-serif');
    expect(fontStack(fontById('hand'))).toContain('cursive');
  });

  it('lists each subset once, however many weights use it', () => {
    const stack = fontStack(fontById('vazir'));
    expect(stack.match(/vazir-arabic/g)).toHaveLength(1);
    expect(stack.match(/vazir-latin/g)).toHaveLength(1);
  });

  it('namespaces the family so a page cannot collide with it', () => {
    // A page defining its own "Vazirmatn" must not be able to change what a note looks like,
    // and ours must not change the page.
    const family = faceFamily(fontById('vazir'), 'arabic');
    expect(family).not.toBe('Vazirmatn');
    expect(family.startsWith('cn')).toBe(true);
    expect(fontStack(fontById('vazir'))).toContain(family);
  });
});

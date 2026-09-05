/**
 * A guard against a mistake I have now made four times.
 *
 * Three stylesheets in this project are single template literals -- `src/cs/styles.ts`,
 * `src/ui/manager/style.ts` and `src/ui/chrome-theme.ts`. A backtick inside one of their
 * comments ENDS THE STRING, and what follows is parsed as TypeScript. The error that comes out
 * is never about the backtick:
 *
 *     src/ui/manager/style.ts:136  Expected ";" but found "overflow"
 *     src/cs/styles.ts(257,31): Property 'handle' does not exist on type '"\n:host {...
 *     src/cs/styles.ts:87:24  Expected ";" but found "auto"
 *
 * Each time it cost a build cycle and a minute of confusion, because the reported line is
 * wherever the accidental code stops making sense -- twenty or thirty lines past the cause.
 * Writing NO BACKTICKS at the top of the file did not stop me doing it again.
 *
 * ## How this checks it, and why not by looking for backticks
 *
 * "Does the literal contain a backtick" is unanswerable by definition: the literal ENDS at the
 * first one. So each stylesheet now ends with a sentinel comment, and the test asserts the
 * literal reaches it. A stray backtick anywhere earlier truncates the string before the
 * sentinel, and the failure names the file and says what to do.
 *
 * The rule is easy to live with: in these files write auto, not the backticked kind.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SENTINEL = '/* end of stylesheet */';

/** [file, the export that holds the CSS] */
const SHEETS: ReadonlyArray<readonly [string, string]> = [
  ['src/cs/styles.ts', 'SHEET_CSS'],
  ['src/ui/manager/style.ts', 'MANAGER_CSS'],
  ['src/ui/chrome-theme.ts', 'THEME_CSS'],
];

/** The text between the literal's opening backtick and the next one. */
function literalOf(file: string, exportName: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`export const ${exportName}`);
  if (start < 0) throw new Error(`${exportName} is not in ${file}`);
  const open = source.indexOf('`', start);
  if (open < 0) throw new Error(`${exportName} in ${file} is not a template literal`);
  const rest = source.slice(open + 1);
  const close = rest.indexOf('`');
  if (close < 0) throw new Error(`${exportName} in ${file} is never closed`);
  return rest.slice(0, close);
}

describe('the CSS template literals', () => {
  it.each(SHEETS)('%s: the whole of %s is inside the literal', (file, exportName) => {
    const css = literalOf(file, exportName);
    expect(
      css.includes(SENTINEL),
      `The literal stops before the end of the stylesheet, which means a backtick inside it ` +
        `closed the string early. Look in ${file} for a comment containing one, and write it ` +
        'plainly instead.',
    ).toBe(true);
  });

  it.each(SHEETS)('%s: %s really does hold a stylesheet', (file, exportName) => {
    // The sanity check the one above depends on: if that sentinel were the only thing in the
    // literal, the test above would pass and mean nothing.
    const css = literalOf(file, exportName);
    expect(css.length).toBeGreaterThan(400);
    expect(css).toContain('{');
    expect(css).toContain('}');
  });
});

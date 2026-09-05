/**
 * Getting a bundled typeface into a note, on any page, whatever its CSP says.
 *
 * The reasoning and the measurements are in `theme.ts`, above `FontChoice`. In short: a shadow
 * root cannot declare a font face, and a `url(moz-extension://...)` is fetched with the page's
 * principal so a strict site blocks it. The way through is bytes -- a `FontFace` built from an
 * ArrayBuffer, added to the page's own `document.fonts`. No fetch, nothing to forbid.
 *
 * ## Once per page, not once per note
 *
 * A page can hold twenty notes in the same face. The register below is module state in the
 * content script, which is exactly one instance per page, so twenty notes cost one request and
 * one `FontFace`. A note that asks while the bytes are in flight waits on the same promise
 * rather than starting a second request.
 *
 * ## Nothing here is allowed to matter
 *
 * Every failure is swallowed. A note whose font did not arrive renders in the system stack --
 * which is exactly what it did before any of this existed, and is perfectly readable. There is
 * no state in which a font problem can stop someone writing a note, and no error dialog: the
 * only person who could act on the information is me, and the way I find out is the spike.
 */

import { type FontChoice, faceFamily, faceFile } from '~/shared/fonts.ts';

/** One entry per family we have registered, or are registering, on this page. */
const inflight = new Map<string, Promise<void>>();

export interface FontSource {
  /** Fetch the bytes of one packaged file. Resolves null if it cannot. */
  bytes(file: string): Promise<ArrayBuffer | null>;
}

/**
 * Make sure every file of one face is registered on this document.
 *
 * Resolves when there is nothing further to wait for -- including when it failed. Callers do
 * not branch on the result, because there is nothing useful for them to do differently.
 */
export function ensureFont(font: FontChoice, source: FontSource): Promise<void> {
  if (!font.bundle) return Promise.resolve();
  const key = font.id;
  const already = inflight.get(key);
  if (already) return already;

  const work = (async () => {
    await Promise.all(
      font.bundle?.files.map(async (file) => {
        try {
          const bytes = await source.bytes(faceFile(font, file));
          if (!bytes || bytes.byteLength === 0) return;
          const face = new FontFace(faceFamily(font, file.subset), bytes, {
            weight: String(file.weight),
            style: 'normal',
            // The text is there the moment the note is, in the fallback face, and swaps when
            // the bytes arrive. `block` would leave a note briefly blank, which for a sticky
            // note -- often two words, read at a glance -- is worse than a font that changes.
            display: 'swap',
          });
          await face.load();
          document.fonts.add(face);
        } catch {
          // See the header: a font is not worth a broken note.
        }
      }) ?? [],
    );
  })();

  inflight.set(key, work);
  return work;
}

/** Test seam. Also used when a page is torn down and re-injected after an update. */
export function forgetFonts(): void {
  inflight.clear();
}

/** Which faces this page has asked for, for the dev overlay. */
export function loadedFonts(): string[] {
  return [...inflight.keys()];
}

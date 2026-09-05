/**
 * The translation engine, with no strings in it.
 *
 * ## Why this is a separate file
 *
 * `t()` used to live next to the whole catalogue, and the moment a note's toolbar started
 * calling it the content script gained every string in the extension -- three hundred and
 * thirty entries in two languages. Measured, by the bundle budget doing its job:
 *
 *     cs/renderer.js  33.7 kB gz  ->  46.2 kB gz  (budget 36)  OVER BUDGET
 *
 * A note needs about fifty of those keys. The other two hundred and eighty were the cabinet's
 * settings prose, the options page and the popup, injected into every annotated page for
 * nothing.
 *
 * So the engine is here, the strings are in two tables, and each bundle imports the table it
 * uses: `i18n-note.ts` for the content script, `i18n.ts` for the extension's own pages -- and
 * `i18n.ts` includes the note's table, because the cabinet shows some of the same words.
 * One definition per string, in exactly one place, and esbuild drops what a bundle does not
 * import.
 *
 * The language STATE lives here, which means one copy per bundle. That is correct rather than
 * unfortunate: a content script and the cabinet are different worlds, and each one sets the
 * language from the same stored setting.
 */

export type Lang = 'en' | 'fa';

export interface Entry {
  en: string;
  fa: string;
  /** Shown to translators and to AMO reviewers. */
  note?: string;
}

let lang: Lang = 'en';

/**
 * Pick a language. `''` means follow the browser.
 *
 * English is the default, and following the browser is a choice rather than the starting
 * state: an extension that comes up in a language you did not ask for is startling even when
 * it guesses right.
 */
export function setLang(explicit: Lang | ''): void {
  if (explicit) {
    lang = explicit;
    return;
  }
  const ui = typeof navigator === 'undefined' ? 'en' : navigator.language;
  lang = ui.startsWith('fa') ? 'fa' : 'en';
}

export function isRtl(): boolean {
  return lang === 'fa';
}

/** `$1`, `$2` … replaced positionally, the same convention `browser.i18n` uses. */
export function fill(text: string, substitutions: string[]): string {
  if (substitutions.length === 0) return text;
  return text.replace(/\$(\d)/g, (_m, d: string) => substitutions[Number(d) - 1] ?? '');
}

/**
 * Build a `t()` over one table.
 *
 * A key the table does not have comes back as the key itself, which is ugly on purpose: an
 * untranslated string should be obvious while developing rather than at review time.
 */
export function makeT<K extends string>(
  table: Record<K, Entry>,
): (key: K, ...substitutions: string[]) => string {
  return (key, ...substitutions) => {
    const entry = table[key];
    if (!entry) return key;
    return fill(entry[lang] ?? entry.en, substitutions);
  };
}

/**
 * What "this section" means for a page.
 *
 * A note can be scoped to a path PREFIX -- every page under `/blog/` -- and the prefix has to
 * come from somewhere. It is the URL's path with its last segment dropped:
 *
 *     https://blog.example.dev/blog/what-is-defi   ->  /blog/
 *     https://blog.example.dev/blog/2026/january   ->  /blog/2026/
 *     https://blog.example.dev/blog                ->  /
 *     https://blog.example.dev/                    ->  /
 *
 * At the top of a site it degrades to `/`, which means every page on that ORIGIN -- not the
 * same thing as the domain scope, which spans subdomains and both schemes. So the picker shows
 * the computed prefix in its label: "This section (/blog/)" is unambiguous in a way that "This
 * section" on its own is not, because the answer depends on where you are standing.
 *
 * ## Why this is in `shared/`
 *
 * Two places need to agree about it and they run in different worlds. The note's settings panel
 * computes it from `location.href`, to write the label. The background computes it again, from
 * the tab's real URL, to build the scope. If they used different rules the label would promise
 * one thing and the click would do another -- so there is one rule, in one file, imported by
 * both.
 *
 * ## Why the background does not simply trust the note
 *
 * A content script may not name a URL: that is how a page would file a note under another
 * page's notes. But `sender.tab.url` comes from the browser rather than from the message, so
 * the background uses that -- and it is also the RIGHT url, being the page the person is
 * actually looking at rather than the one the note was first made on.
 */

/** The path prefix for the section a URL sits in. Always starts and ends with a slash. */
export function sectionPrefix(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return '/';
  }
  // Trailing slash first: `/blog/` and `/blog` name the same page, and their section is the
  // same section. Without this, `/blog/` would give `/blog/` -- itself -- and a note scoped to
  // "this section" from the section index would cover only that one page.
  const trimmed = pathname.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut <= 0) return '/';
  return `${trimmed.slice(0, cut)}/`;
}

/**
 * How to describe that prefix to a person.
 *
 * `/` is not a path anyone thinks of as a section, so at the top of a site the label says the
 * host instead. Anything deeper is shown as the path, because that is what it is.
 */
export function sectionLabel(url: string): string {
  const prefix = sectionPrefix(url);
  if (prefix !== '/') return prefix;
  try {
    return new URL(url).host;
  } catch {
    return '/';
  }
}

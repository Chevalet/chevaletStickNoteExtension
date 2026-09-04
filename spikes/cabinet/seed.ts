/**
 * Fill a cabinet with something worth looking at, then start the real cabinet.
 *
 * Seeding goes through the SHIPPED store functions -- `createNote`, `trashNote`, `setMeta` --
 * so the drawers, the search index, the index columns and the trash are all the real thing.
 * Only the four `browser.*` edges are stubbed, in the harness page itself.
 *
 * The manager bundle is appended by this file rather than sitting in the HTML, because it calls
 * `openDb()` and reads every note the moment it loads. A `<script>` tag next to this one would
 * race the seeding and show an empty cabinet about half the time.
 *
 * Dev-only. Never shipped.
 */

import { allNotes, createNote, setMeta, trashNote } from '~/bg/db/notes.ts';
import { openDb } from '~/bg/db/open.ts';
import { defaultScopeFor } from '~/bg/scope/match.ts';

interface Seed {
  url: string;
  title: string;
  text: string;
  palette: string;
  /** Straight into the trash, so the trash view and the retention copy have something in them. */
  trashed?: boolean;
}

const SEED: Seed[] = [
  {
    url: 'https://demo.chevalet.dev/blog/xerox-and-the-zine',
    title: 'Xerox and the zine',
    text:
      '# Third generation\n\nContrast climbs, midtones collapse into pure black and white.\n' +
      '**Lean into it.**\n\n- [x] scan the page\n- [ ] copy the copy\n- [ ] copy that',
    palette: 'postit',
  },
  {
    url: 'https://demo.chevalet.dev/blog/xerox-and-the-zine',
    title: 'Xerox and the zine',
    text:
      'Halftone dots want to be *coarse enough to see*.\n\n' +
      '> A photocopier degrades an image a little\n> every generation.\n\n' +
      'See `paper.ts` for the tear path.',
    palette: 'riso-pink',
  },
  {
    url: 'https://demo.chevalet.dev/blog/something-else',
    title: 'Something else entirely',
    text: 'یادداشت فارسی، در همان نوتی که انگلیسی هم دارد.\n\n1. اول\n2. دوم\n3. سوم',
    palette: 'legal',
  },
  {
    url: 'https://www.youtube.com/watch?v=aaa111',
    title: 'A video worth a note',
    text: 'The bit at 15:02 is the only part worth keeping.\n\n`ffmpeg -ss 902 -t 30 -i in.mkv`',
    palette: 'blueprint',
  },
  {
    url: 'https://news.example.org/2026/09/print-is-back',
    title: 'Print is back, apparently',
    text: 'Ask whether the paper stock is the point or the excuse.',
    palette: 'kraft',
  },
  {
    url: 'https://news.example.org/2026/09/print-is-back',
    title: 'Print is back, apparently',
    text: 'A second note on the same page, so one folder holds two cards.',
    palette: 'mint',
  },
  {
    url: 'https://old.example.com/a-page-i-changed-my-mind-about',
    title: 'Changed my mind',
    text: 'This one belongs in the trash, so the trash is not empty.',
    palette: 'ledger',
    trashed: true,
  },
];

async function seed(): Promise<void> {
  // Guarded, or every reload piles up another six notes.
  if ((await allNotes()).length > 0) return;

  let z = 10;
  for (const s of SEED) {
    const scope = defaultScopeFor(s.url);
    if (!scope) continue;
    const rec = await createNote({
      scope,
      text: s.text,
      ui: { x: 80, y: 140, w: 260, h: 180, z: ++z, collapsed: false, locked: false, opacity: 1 },
      style: { palette: s.palette },
      context: { url: s.url, title: s.title },
    });
    if (s.trashed) await trashNote(rec.id);
  }
  await setMeta('style.defaults', {});
}

void (async () => {
  await openDb();
  const wanted = new URLSearchParams(location.search).get('seed') !== '0';
  if (wanted) await seed();

  /*
   * Which of the three pages to show.
   *
   * All three share one palette (`ui/chrome-theme.ts`), so all three have to be LOOKED AT in
   * both themes -- a dark cabinet next to a blinding cream popup is worse than no dark theme
   * at all. The popup and the options page need the same four browser stubs the cabinet does,
   * so they get the same harness rather than two more of them.
   */
  const which = new URLSearchParams(location.search).get('page') ?? 'manager';
  const bundle = which === 'popup' ? 'popup' : which === 'options' ? 'options' : 'manager';

  const tag = document.createElement('script');
  tag.src = `/dist/ui/${bundle}.js`;
  document.body.append(tag);
})();

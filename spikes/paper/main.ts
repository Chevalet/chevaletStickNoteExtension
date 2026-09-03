/**
 * R4 -- the paper-feel harness.
 *
 * Mounts the REAL host, the REAL springs and the REAL NoteView outside the extension, on a
 * page with realistic content behind them, with live controls for every tuning constant.
 * Whatever numbers feel right here get copied into TUNING in NoteView.ts.
 *
 * Dev-only. Built by `pnpm build:dev`, never shipped.
 */

import { createSharedDefs } from '~/cs/art/defs.ts';
import { createHost } from '~/cs/host.ts';
import { NoteView } from '~/cs/note/NoteView.ts';
import { PALETTES } from '~/cs/note/theme.ts';
import { Loop } from '~/cs/physics/spring.ts';
import { SHEET_CSS } from '~/cs/styles.ts';

const sheet = new CSSStyleSheet();
sheet.replaceSync(SHEET_CSS);
const host = createHost(sheet);
host.root.prepend(createSharedDefs());

const loop = new Loop();
const notes: NoteView[] = [];
let topZ = 10;

const SAMPLES: Array<[string, string, number, number, number, number]> = [
  ['postit', 'Anchored to the paragraph below.\n\nScroll — it stays put.', 60, 150, 250, 168],
  ['riso-pink', 'Grab the header and flick it.\nThe lean comes from pointer velocity.', 360, 250, 236, 150],
  ['acid', 'Torn edge, halftone, grain,\nmasking tape.\n\nAll seeded from the note id,\nso it never changes on reload.', 660, 130, 262, 190],
  ['cyan', 'راست‌چین و چپ‌چین در یک نوت.\nMixed RTL and LTR, per paragraph.', 120, 470, 268, 130],
  ['newsprint', 'Grab a top corner and yank\ndownward — the lever term makes\nit swing like real paper.', 430, 540, 252, 150],
  ['carbon', 'Dark paper, light ink.\nSame tokens, no special case.', 740, 430, 236, 132],
];

function spawnAll(): void {
  for (const n of notes.splice(0)) n.destroy();
  SAMPLES.forEach(([palette, text, x, y, w, h], i) => {
    notes.push(
      new NoteView(
        { id: `demo-${i}`, x, y, w, h, z: ++topZ, text, style: { palette } },
        {
          loop,
          layer: host.docLayer,
          raise: () => ++topZ,
        },
      ),
    );
  });
}

spawnAll();

// Drive the real API from the console / from an automated screenshot pass, rather than poking
// at the DOM behind its back.
declare global {
  interface Window {
    cn: {
      notes: NoteView[];
      host: typeof host;
      loop: Loop;
      spawnAll: () => void;
      slowmo: (scale?: number) => void;
      /** Show exactly one note, blown up, for judging the art at scale. */
      solo: (index: number, w?: number, h?: number) => void;
    };
  }
}
window.cn = {
  notes,
  host,
  loop,
  spawnAll,
  slowmo(scale = 8) {
    for (const n of notes) n.setTimeScale(scale);
  },
  solo(index, w = 620, h = 340) {
    notes.forEach((n, i) => {
      n.el.style.display = i === index ? '' : 'none';
    });
    const n = notes[index];
    if (!n) return;
    n.resize(w, h);
    n.moveTo(60, 90, false);
  },
};

// ---------------------------------------------------------------- live controls

const panel = document.getElementById('panel');
if (panel) {
  const frameCounter = document.getElementById('fps');
  let frames = 0;
  let lastReport = performance.now();
  const measure = (): void => {
    frames++;
    const now = performance.now();
    if (now - lastReport >= 500 && frameCounter) {
      frameCounter.textContent = `${Math.round((frames * 1000) / (now - lastReport))} fps · loop ${loop.running ? 'running' : 'idle'} · ${loop.size} animating`;
      frames = 0;
      lastReport = now;
    }
    requestAnimationFrame(measure);
  };
  requestAnimationFrame(measure);

  document.getElementById('respawn')?.addEventListener('click', spawnAll);

  document.getElementById('add')?.addEventListener('click', () => {
    const p = PALETTES[notes.length % PALETTES.length];
    notes.push(
      new NoteView(
        {
          id: `demo-${Date.now()}`,
          x: 80 + Math.random() * 700,
          y: 120 + Math.random() * 500,
          w: 230,
          h: 150,
          z: ++topZ,
          text: 'New note.',
          style: { palette: p?.id ?? 'postit' },
        },
        { loop, layer: host.docLayer, raise: () => ++topZ },
      ),
    );
  });

  document.getElementById('stress')?.addEventListener('click', () => {
    for (let i = 0; i < 30; i++) {
      const p = PALETTES[i % PALETTES.length];
      notes.push(
        new NoteView(
          {
            id: `stress-${i}-${Date.now()}`,
            x: 40 + (i % 8) * 130,
            y: 120 + Math.floor(i / 8) * 130,
            w: 190,
            h: 120,
            z: ++topZ,
            text: `stress ${i}`,
            style: { palette: p?.id ?? 'postit' },
          },
          { loop, layer: host.docLayer, raise: () => ++topZ },
        ),
      );
    }
  });

  for (const key of ['tornEdges', 'grain'] as const) {
    document.getElementById(key)?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      for (const n of notes) n.setStyle({ [key]: v });
      const out = document.getElementById(`${key}-out`);
      if (out) out.textContent = v.toFixed(2);
    });
  }

  document.getElementById('physics')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as 'full' | 'reduced' | 'off';
    for (const n of notes) n.setStyle({ physics: v });
  });

  document.getElementById('shadow')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as 'none' | 'soft' | 'hard';
    for (const n of notes) n.setStyle({ shadow: v });
  });

  document.getElementById('slowmo')?.addEventListener('change', (e) => {
    const scale = (e.target as HTMLInputElement).checked ? 8 : 1;
    for (const n of notes) n.setTimeScale(scale);
  });

  document.getElementById('tape')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as 'none' | 'one' | 'two';
    for (const n of notes) n.setStyle({ tape: v });
  });
}

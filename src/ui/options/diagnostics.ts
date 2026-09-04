/**
 * A live, hands-on test for the one thing tests here cannot reach.
 *
 * Backspace not working inside a note was reported three times before the mechanism was
 * found, and every attempt to reproduce it failed for a reason that had nothing to do with the
 * bug: the automation available here runs on Blink, and injected key events carry no physical
 * `code`, so the browser delivers them as events and performs no editing action. Under that
 * kind of test every `contenteditable` on earth looks broken, and a real one looks fine.
 *
 * So this asks the person at the keyboard, whose Firefox is the only instrument that can
 * answer. Two editable boxes, identical except for one line: the first stops keyboard events
 * at its shadow host, the way the note used to; the second does not, the way the note does
 * now. Press Backspace in each. If the first is dead and the second is alive, event
 * containment was the cause and the fix is right. If both work, or both fail, it is something
 * else and the report says what else to look at.
 *
 * It runs nothing on its own and touches no note data.
 */

interface Probe {
  label: string;
  /** Stop keyboard events at the host, as the note used to. */
  containKeys: boolean;
  host: HTMLDivElement;
  editable: HTMLDivElement;
  /** Set from a real keypress, which is the whole point. */
  sawDelete: boolean | null;
  keysSeenAtDocument: number;
}

const HOST_CSS = 'all: initial; pointer-events: none; contain: style; display: block;';
const CONTAINED = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'keydown',
  'keyup',
  'keypress',
  'input',
  'beforeinput',
] as const;

const SEED = 'abcdef';

function buildProbe(label: string, containKeys: boolean): Probe {
  const host = document.createElement('div');
  host.style.cssText = HOST_CSS;
  // Closed, exactly as the shipped note is. An open root behaves differently in ways that
  // would make this test lie.
  const root = host.attachShadow({ mode: 'closed' });

  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'plaintext-only');
  if (editable.contentEditable !== 'plaintext-only') {
    editable.setAttribute('contenteditable', 'true');
  }
  editable.textContent = SEED;
  editable.style.cssText =
    'pointer-events:auto; font:14px/1.5 monospace; padding:8px; min-height:22px;' +
    'border:2px solid currentColor; background:#ffe94a; color:#14110e;';
  root.append(editable);

  const probe: Probe = {
    label,
    containKeys,
    host,
    editable,
    sawDelete: null,
    keysSeenAtDocument: 0,
  };

  if (containKeys) {
    const stop = (e: Event): void => e.stopPropagation();
    for (const type of CONTAINED) host.addEventListener(type, stop);
  } else {
    // Only the pointer half, which is what the note contains now.
    const stop = (e: Event): void => e.stopPropagation();
    for (const type of CONTAINED.slice(0, 6)) host.addEventListener(type, stop);
  }

  /**
   * Did the delete actually happen?
   *
   * Measured from `input`, not from a frame comparison. `requestAnimationFrame` is throttled
   * to nearly nothing in a hidden or backgrounded tab, so a frame-based check can simply never
   * report -- which is a diagnostic that hangs instead of answering. The `input` event fires
   * when the edit lands, immediately, whatever the tab is doing. The listener sits on the
   * editable itself, inside the shadow root, so it runs before any containment at the host.
   */
  editable.addEventListener('input', (e) => {
    const type = (e as InputEvent).inputType ?? '';
    if (!type.startsWith('delete')) return;
    probe.sawDelete = true;
    paint();
  });

  // A keydown with no input event after it means the editor never acted. A short timer rather
  // than a frame, for the same reason.
  editable.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const seen = probe.sawDelete;
    const had = editable.textContent ?? '';
    setTimeout(() => {
      if (probe.sawDelete === true && seen !== null) return;
      // Nothing arrived, and the text is unchanged: the key reached us and did nothing.
      if ((editable.textContent ?? '') === had && probe.sawDelete !== true) {
        probe.sawDelete = false;
        paint();
      }
    }, 120);
  });

  return probe;
}

const probes: Probe[] = [];
let statusEl: HTMLElement | null = null;
let reportEl: HTMLTextAreaElement | null = null;

function paint(): void {
  if (!statusEl) return;
  statusEl.textContent = '';
  for (const p of probes) {
    const verdict =
      p.sawDelete === null ? 'not tried yet' : p.sawDelete ? 'Backspace WORKS' : 'Backspace DEAD';
    const row = document.createElement('div');
    row.className = 'note';
    row.textContent = `${p.label}: ${verdict}`;
    statusEl.append(row);
  }
  if (reportEl) reportEl.value = buildReport();
}

/** Everything worth knowing about this browser, in one paste-able block. */
export function buildReport(): string {
  const lines: string[] = [];
  lines.push(`userAgent: ${navigator.userAgent}`);

  const test = document.createElement('div');
  test.setAttribute('contenteditable', 'plaintext-only');
  lines.push(`contenteditable plaintext-only: ${test.contentEditable === 'plaintext-only'}`);

  const probeRoot = document.createElement('div').attachShadow({ mode: 'closed' });
  lines.push(
    `ShadowRoot.getSelection: ${typeof (probeRoot as { getSelection?: unknown }).getSelection === 'function'}`,
  );
  lines.push(
    `caretPositionFromPoint: ${typeof (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint === 'function'}`,
  );
  lines.push(
    `caretRangeFromPoint: ${typeof (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint === 'function'}`,
  );

  for (const p of probes) {
    const state =
      p.sawDelete === null ? 'not-tried' : p.sawDelete ? 'backspace-works' : 'backspace-dead';
    lines.push(`${p.containKeys ? 'keys-contained' : 'keys-free'}: ${state}`);
  }

  // The conclusion, so the report is useful even without me reading it.
  const contained = probes.find((p) => p.containKeys);
  const free = probes.find((p) => !p.containKeys);
  if (contained?.sawDelete === false && free?.sawDelete === true) {
    lines.push('VERDICT: event containment was the cause. The fix in 0.0.3 is correct.');
  } else if (contained?.sawDelete === true && free?.sawDelete === true) {
    lines.push('VERDICT: both work here, so containment is NOT the cause. Look elsewhere.');
  } else if (contained?.sawDelete === false && free?.sawDelete === false) {
    lines.push('VERDICT: neither works, so it is not containment. Editing in a closed shadow');
    lines.push('root is itself failing in this browser -- that is the thing to chase.');
  }
  return lines.join('\n');
}

/** Build the section. Returns null if the host page cannot take it. */
export function diagnosticsSection(): HTMLElement {
  probes.length = 0;
  probes.push(
    buildProbe('A — keyboard events stopped at the host (the old behaviour)', true),
    buildProbe('B — keyboard events left alone (what 0.0.3 does)', false),
  );

  const wrap = document.createElement('div');
  const intro = document.createElement('p');
  intro.className = 'note';
  intro.textContent =
    'Click inside each yellow box, then press Backspace. Both boxes are a note’s exact ' +
    'structure — a closed shadow root with the same host styling — differing only in whether ' +
    'keyboard events are stopped at the host. This is the one test that needs a real keyboard ' +
    'and a real Firefox, which is why it is here rather than in the test suite.';
  wrap.append(intro);

  for (const p of probes) {
    const label = document.createElement('p');
    label.className = 'note';
    label.textContent = p.label;
    wrap.append(label, p.host);
  }

  statusEl = document.createElement('div');
  wrap.append(statusEl);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset the boxes';
  reset.addEventListener('click', () => {
    for (const p of probes) {
      p.editable.textContent = SEED;
      p.sawDelete = null;
    }
    paint();
  });

  reportEl = document.createElement('textarea');
  reportEl.rows = 10;
  reportEl.readOnly = true;
  reportEl.style.cssText = 'width:100%; font-family:ui-monospace, monospace; font-size:12px;';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy the report';
  copy.addEventListener('click', () => {
    reportEl?.select();
    void navigator.clipboard?.writeText(buildReport()).catch(() => undefined);
    copy.textContent = 'Copied';
    setTimeout(() => {
      copy.textContent = 'Copy the report';
    }, 1500);
  });

  const row = document.createElement('div');
  row.className = 'row';
  row.append(reset, copy);
  wrap.append(row, reportEl);

  paint();
  return wrap;
}

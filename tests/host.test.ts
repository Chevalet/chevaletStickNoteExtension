// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createHost } from '~/cs/host.ts';

/**
 * Where the shadow host is attached, which is the single most consequential line in the
 * content script.
 *
 * It used to be `document.documentElement.append(el)` -- a sibling of `<body>`, outside it --
 * on the reasoning that a child of `<html>` is the hardest place for a page to disturb. That
 * one line is why Backspace did nothing inside a note in Firefox, through three releases and
 * three wrong fixes.
 *
 * Gecko will not perform an editing command for an editing host outside `<body>`. It
 * dispatches `beforeinput` with `deleteContentBackward`, does not cancel it, and then declines
 * to edit: no `input` event, no change, no error. Text insertion takes a different path and
 * kept working, which is what made the symptom so lopsided.
 *
 * `spikes/firefox-where.mjs` proves it in a real Firefox, with real key events, across four
 * hosts differing only in position and tag name. These tests are the cheap guard that keeps
 * the conclusion from being undone by someone reading the old reasoning and finding it
 * persuasive.
 */

function sheet(): CSSStyleSheet {
  const s = new CSSStyleSheet();
  s.replaceSync('.lyr { position: absolute; }');
  return s;
}

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('where the host is attached', () => {
  it('puts the host inside <body>, never as a sibling of it', () => {
    const host = createHost(sheet());
    expect(host.rootEl.parentElement, 'the host must be a child of <body>').toBe(document.body);
    expect(document.body.contains(host.rootEl)).toBe(true);
    // The failure mode this exists to prevent, stated as the thing it must not be.
    expect(host.rootEl.parentElement).not.toBe(document.documentElement);
    host.destroy();
  });

  it('is inside <body> for editing to work at all, so document.body must contain it', () => {
    const host = createHost(sheet());
    // Gecko resolves an editing host through document -> body -> host. Anything above <body>
    // is unreachable for edit commands.
    let node: Node | null = host.root.host;
    let reachedBody = false;
    while (node) {
      if (node === document.body) {
        reachedBody = true;
        break;
      }
      node = node.parentNode;
    }
    expect(reachedBody, 'the host is not reachable from <body>').toBe(true);
    host.destroy();
  });

  it('cleans up after itself', () => {
    const host = createHost(sheet());
    host.destroy();
    expect(host.rootEl.isConnected).toBe(false);
    expect(document.body.children.length).toBe(0);
  });

  it('gives the note layers a home inside the shadow root', () => {
    const host = createHost(sheet());
    expect(host.docLayer.getRootNode()).toBe(host.root);
    expect(host.pinLayer.getRootNode()).toBe(host.root);
    host.destroy();
  });
});

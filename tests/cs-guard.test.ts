// @vitest-environment happy-dom
/**
 * The close guard's own file, which had no tests until the day R1 was answered.
 *
 * ## Why now
 *
 * "Does a content script's `beforeunload` actually prompt when a tab is closed?" was the one
 * open question in this project from the plan onwards. Two spikes tried and both reported
 * themselves useless -- `firefox-r1.mjs`, because WebDriver's Close Window command does not run
 * unload prompts at all, and `firefox-unload.mjs`, because Marionette never opens the tab-modal
 * prompt either. Their controls failed, which is the only reason they were trustworthy.
 *
 * It was answered by hand, on Firefox 155 on Windows: make a note, type in it, press Ctrl+W,
 * and Firefox asks. So the guard is not speculative any more, and `src/cs/guard.ts` went from
 * "a mechanism nobody had confirmed" to "the file that decides whether a warning appears".
 *
 * `bg/guard/budget.ts` -- which tabs get a slot, and why -- had eighteen tests all along. This
 * is the other half: the part that runs on the page.
 *
 * ## What can be checked here, and what cannot
 *
 * Not the dialog. happy-dom has no browser chrome and no Gecko, and neither does any harness
 * this project can build -- that is the whole reason R1 needed a person. What IS checkable is
 * every decision the file makes on its own: that the listener is added and REMOVED rather than
 * left attached, which is what keeps an annotated page eligible for the bfcache; that the
 * handler both cancels the event and sets `returnValue`, because older Gecko honours only the
 * second; that entering the bfcache disarms it; and that it leaves other messages alone.
 *
 * ## ONE module instance, loaded once
 *
 * The first version of this file called `vi.resetModules()` before each test and two of them
 * failed -- a disarmed guard still cancelling the event, and three listener removals where one
 * was expected. Neither was a bug. `resetModules` stops the NEXT import returning the cached
 * module; it does not unload the instance already running, and that instance still has its
 * listeners on this window. So four tests meant four guards, all reacting at once.
 *
 * Proved with a one-instance file before rewriting this one, rather than assumed. Now the
 * module is imported once and each test puts it into the state it needs, which is both correct
 * and a better model of the real thing: a page has one guard.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (msg: unknown) => Promise<unknown> | undefined;

const listeners: Listener[] = [];
let send: Listener;
let added: string[] = [];
let removed: string[] = [];

beforeAll(async () => {
  (globalThis as Record<string, unknown>).browser = {
    runtime: { onMessage: { addListener: (fn: Listener) => listeners.push(fn) } },
  };

  /*
   * `addEventListener` is spied rather than inferred: "is a beforeunload listener attached
   * right now" is the actual question, and the DOM offers no way to ask it.
   */
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    added.push(String(type));
    realAdd(type, listener, options);
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    removed.push(String(type));
    realRemove(type, listener, options);
  });

  await import('~/cs/guard.ts');
  const first = listeners[0];
  if (!first) throw new Error('the guard registered no message listener');
  send = first;
});

/** Back to disarmed, and forget what was counted getting there. */
beforeEach(async () => {
  await send({ t: 'guard/set', armed: false });
  added = [];
  removed = [];
});

const arm = (armed: boolean) => send({ t: 'guard/set', armed, reason: armed ? 'policy' : 'clean' });

const unloads = () => added.filter((t) => t === 'beforeunload').length;
const detaches = () => removed.filter((t) => t === 'beforeunload').length;

/** Dispatch what Firefox dispatches, and report whether the guard stopped it. */
function wouldPrompt(): boolean {
  const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('arming', () => {
  it('holds no listener while disarmed', () => {
    // A page nobody has annotated must cost nothing, and a `beforeunload` listener is not
    // nothing: it makes the page ineligible for the bfcache.
    expect(wouldPrompt()).toBe(false);
    expect(unloads()).toBe(0);
  });

  it('attaches on arm and detaches on disarm', async () => {
    await arm(true);
    expect(unloads()).toBe(1);
    expect(wouldPrompt()).toBe(true);

    await arm(false);
    expect(detaches()).toBe(1);
    expect(wouldPrompt()).toBe(false);
  });

  it('does not attach twice for two arms in a row', async () => {
    // The background re-sends its state freely -- on every allocation pass -- so this has to
    // be idempotent, or a page would accumulate listeners for as long as it is open.
    await arm(true);
    await arm(true);
    await arm(true);
    expect(unloads()).toBe(1);
    expect(detaches()).toBe(0);
  });

  it('does not detach when it was never armed', async () => {
    await arm(false);
    expect(detaches()).toBe(0);
  });

  it('answers the background with the state it ended up in', async () => {
    expect(await arm(true)).toEqual({ ok: true, armed: true });
    expect(await arm(false)).toEqual({ ok: true, armed: false });
  });

  it('treats a missing flag as disarm rather than as arm', async () => {
    // Fail safe in the direction of NOT interrupting someone: a malformed message that armed
    // the guard would prompt on a page with nothing to lose.
    expect(await send({ t: 'guard/set' })).toEqual({ ok: true, armed: false });
    expect(wouldPrompt()).toBe(false);
  });

  it('leaves messages that are not its own to other listeners', () => {
    /*
     * `undefined`, not a promise. The renderer's own listener lives on the same channel, and a
     * listener that answered every message would swallow the ones meant for it -- in Firefox
     * the first non-undefined return wins.
     */
    expect(send({ t: 'note/changed', id: 'n_1' })).toBeUndefined();
    expect(send(null)).toBeUndefined();
    expect(send('guard/set')).toBeUndefined();
    expect(send(42)).toBeUndefined();
  });
});

describe('the handler Firefox calls', () => {
  it('both cancels the event and sets returnValue', async () => {
    /*
     * Two ways of saying the same thing, and both are needed: `preventDefault()` is the spec,
     * `returnValue` is what older Gecko honours. This is the line R1 was about -- with it,
     * Firefox asks; without it, the tab closes silently.
     */
    await arm(true);
    const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(e.returnValue).toBe('');
  });
});

describe('the bfcache', () => {
  const pagehide = (persisted: boolean): void => {
    const e = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(e, 'persisted', { value: persisted });
    window.dispatchEvent(e);
  };

  it('disarms when the page is frozen into it', async () => {
    /*
     * State is deliberately not remembered across a bfcache round trip: the note may have been
     * committed while the page was frozen, and the background re-arms as part of
     * re-establishing context. Guessing on the way back would prompt about an edit that is
     * already saved.
     */
    await arm(true);
    pagehide(true);
    expect(detaches()).toBe(1);
    expect(wouldPrompt()).toBe(false);
  });

  it('stays armed for an ordinary unload, which is the case it exists for', async () => {
    // `persisted: false` is a real navigation away. Disarming there would defeat the feature.
    await arm(true);
    pagehide(false);
    expect(detaches()).toBe(0);
    expect(wouldPrompt()).toBe(true);
  });
});

/**
 * Markdown, rendered to DOM nodes.
 *
 * `marked` tokenizes; this file walks the tokens and builds elements with `createElement` and
 * `textContent`. **Nothing is ever assigned to innerHTML.** That is not belt-and-braces: note
 * text arrives from an imported ZIP as readily as from the keyboard, and a renderer that never
 * parses HTML cannot be made to execute any, so there is no sanitiser to get wrong and nothing
 * for an AMO reviewer to object to.
 *
 * The supported subset is what a sticky note actually needs. Anything unrecognised falls
 * through as its own literal text, which is the right failure mode for a note: you see what
 * you typed rather than losing it.
 */

import { marked, type Token, type Tokens } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export interface MarkdownOptions {
  /** Resolve an `att:` image reference to something renderable. */
  resolveAsset?: (id: string) => HTMLElement | null;
  /** Called when a task-list checkbox is toggled, with its index in document order. */
  onToggleTask?: (index: number, checked: boolean) => void;
  /** Read-only notes render checkboxes disabled. */
  readOnly?: boolean;
}

/** Render markdown source into a fragment. Safe to insert anywhere. */
export function renderMarkdown(source: string, opts: MarkdownOptions = {}): DocumentFragment {
  const frag = document.createDocumentFragment();
  const state = { taskIndex: 0 };
  let tokens: Token[];
  try {
    tokens = marked.lexer(source);
  } catch {
    // A tokenizer failure must never cost someone their note.
    frag.append(plain(source));
    return frag;
  }
  for (const t of tokens) {
    const el = block(t, opts, state);
    if (el) frag.append(el);
  }
  return frag;
}

function plain(text: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function block(token: Token, opts: MarkdownOptions, state: { taskIndex: number }): Node | null {
  switch (token.type) {
    case 'space':
      return null;

    case 'checkbox':
      // marked emits the "[x] " marker as a token of the list ITEM, not an inline token.
      // Falling through to the default branch printed a literal "[x]" beside every box; the
      // real checkbox is built from item.task / item.checked in `listItem`.
      return null;

    case 'heading': {
      const t = token as Tokens.Heading;
      // Notes are small; h1 in a 240px card is shouting. Everything shifts down two levels.
      const level = Math.min(6, t.depth + 2);
      const el = document.createElement(`h${level}`);
      el.className = 'md-h';
      inline(el, t.tokens, opts, state);
      return el;
    }

    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      const el = document.createElement('p');
      inline(el, t.tokens, opts, state);
      return el;
    }

    case 'list': {
      const t = token as Tokens.List;
      const el = document.createElement(t.ordered ? 'ol' : 'ul');
      el.className = 'md-list';
      if (t.ordered && typeof t.start === 'number' && t.start !== 1) {
        (el as HTMLOListElement).start = t.start;
      }
      for (const item of t.items) el.append(listItem(item, opts, state));
      return el;
    }

    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      const el = document.createElement('blockquote');
      for (const child of t.tokens) {
        const c = block(child, opts, state);
        if (c) el.append(c);
      }
      return el;
    }

    case 'code': {
      const t = token as Tokens.Code;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = t.text;
      pre.append(code);
      return pre;
    }

    case 'hr':
      return document.createElement('hr');

    case 'html':
      // Deliberately literal: a note is not a web page, and rendering arbitrary HTML from
      // note text is exactly the hole this renderer exists to avoid.
      return plain((token as Tokens.HTML).raw);

    default: {
      const raw = (token as { raw?: string }).raw;
      return raw ? plain(raw) : null;
    }
  }
}

function listItem(
  item: Tokens.ListItem,
  opts: MarkdownOptions,
  state: { taskIndex: number },
): HTMLLIElement {
  const li = document.createElement('li');
  if (item.task) {
    li.className = 'md-task';
    const index = state.taskIndex++;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(item.checked);
    box.disabled = Boolean(opts.readOnly);
    box.className = 'md-check';
    box.addEventListener('change', () => opts.onToggleTask?.(index, box.checked));
    li.append(box);
    li.classList.toggle('is-done', Boolean(item.checked));
  }
  const body = document.createElement('span');
  body.className = 'md-item';
  for (const child of item.tokens) {
    if (child.type === 'text') {
      inline(
        body,
        (child as Tokens.Text).tokens ?? [
          { type: 'text', raw: child.raw, text: (child as Tokens.Text).text } as Token,
        ],
        opts,
        state,
      );
    } else {
      const c = block(child, opts, state);
      if (c) body.append(c);
    }
  }
  li.append(body);
  return li;
}

function inline(
  parent: Node,
  tokens: Token[] | undefined,
  opts: MarkdownOptions,
  state: { taskIndex: number },
): void {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) inline(parent, t.tokens, opts, state);
        else parent.appendChild(document.createTextNode(t.text));
        break;
      }
      case 'escape':
        parent.appendChild(document.createTextNode((token as Tokens.Escape).text));
        break;
      case 'strong': {
        const el = document.createElement('strong');
        inline(el, (token as Tokens.Strong).tokens, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'em': {
        const el = document.createElement('em');
        inline(el, (token as Tokens.Em).tokens, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'del': {
        const el = document.createElement('del');
        inline(el, (token as Tokens.Del).tokens, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'codespan': {
        const el = document.createElement('code');
        el.textContent = (token as Tokens.Codespan).text;
        parent.appendChild(el);
        break;
      }
      case 'br':
        parent.appendChild(document.createElement('br'));
        break;
      case 'link': {
        const t = token as Tokens.Link;
        const el = document.createElement('a');
        const href = safeHref(t.href);
        if (href) {
          el.href = href;
          el.target = '_blank';
          // A note lives on someone else's page; never hand it a window reference.
          el.rel = 'noopener noreferrer';
        }
        if (t.title) el.title = t.title;
        inline(el, t.tokens, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'image': {
        const t = token as Tokens.Image;
        parent.appendChild(image(t, opts));
        break;
      }
      default: {
        const raw = (token as { raw?: string }).raw;
        if (raw) parent.appendChild(document.createTextNode(raw));
      }
    }
  }
}

function image(t: Tokens.Image, opts: MarkdownOptions): Node {
  // Pasted images are stored as blobs and referenced as att:<id>; the host resolves them into
  // a canvas, because a canvas paint is not a fetch and so no page CSP can block it.
  const att = /^att:([A-Za-z0-9_-]+)$/.exec(t.href);
  if (att) {
    const el = opts.resolveAsset?.(att[1] as string);
    if (el) {
      el.classList.add('md-img');
      if (t.text) el.setAttribute('aria-label', t.text);
      return el;
    }
  }
  // Anything else stays as its source text. A note must not silently fetch from the network.
  const span = document.createElement('span');
  span.className = 'md-missing';
  span.textContent = t.raw;
  return span;
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Only ever produce a link a click can safely follow. */
export function safeHref(href: string): string | null {
  try {
    const u = new URL(href, location.href);
    return SAFE_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Flip the nth task checkbox in the SOURCE text.
 *
 * Editing the markdown rather than the rendered DOM keeps the source as the single truth --
 * the rendered view is always a pure function of it.
 */
export function toggleTaskInSource(source: string, index: number, checked: boolean): string {
  let seen = -1;
  return source
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line);
      if (!m) return line;
      seen++;
      if (seen !== index) return line;
      return `${m[1]}${checked ? 'x' : ' '}${m[3]}`;
    })
    .join('\n');
}

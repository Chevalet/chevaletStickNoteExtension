/**
 * Markdown, rendered to DOM nodes.
 *
 * `md-lex.ts` tokenizes; this file walks the tokens and builds elements with `createElement`
 * and `textContent`. **Nothing is ever assigned to innerHTML.** That is not belt-and-braces:
 * note text arrives from an imported ZIP as readily as from the keyboard, and a renderer that
 * never parses HTML cannot be made to execute any, so there is no sanitiser to get wrong and
 * nothing for an AMO reviewer to object to.
 *
 * Anything the lexer does not recognise stays as literal text, which is the right failure
 * mode for a note: you see what you typed rather than losing it.
 */

import { type Block, type Inline, type ListItem, lex } from './md-lex.ts';

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
  let blocks: Block[];
  try {
    blocks = lex(source);
  } catch {
    // A tokenizer failure must never cost someone their note.
    frag.append(plain(source));
    return frag;
  }
  for (const b of blocks) {
    const node = block(b, opts, state);
    if (node) frag.append(node);
  }
  return frag;
}

function plain(text: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function block(token: Block, opts: MarkdownOptions, state: { taskIndex: number }): Node | null {
  switch (token.type) {
    case 'heading': {
      // Notes are small; an h1 inside a 240px card is shouting. Everything shifts down two.
      const level = Math.min(6, token.depth + 2);
      const el = document.createElement(`h${level}`);
      el.className = 'md-h';
      inline(el, token.kids, opts, state);
      return el;
    }

    case 'paragraph': {
      const el = document.createElement('p');
      inline(el, token.kids, opts, state);
      return el;
    }

    case 'code': {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = token.text;
      pre.append(code);
      return pre;
    }

    case 'hr':
      return document.createElement('hr');

    case 'blockquote': {
      const el = document.createElement('blockquote');
      for (const child of token.kids) {
        const node = block(child, opts, state);
        if (node) el.append(node);
      }
      return el;
    }

    case 'list': {
      const el = document.createElement(token.ordered ? 'ol' : 'ul');
      el.className = 'md-list';
      if (token.ordered && token.start !== 1) (el as HTMLOListElement).start = token.start;
      for (const item of token.items) el.append(listItem(item, opts, state));
      return el;
    }
  }
}

function listItem(
  item: ListItem,
  opts: MarkdownOptions,
  state: { taskIndex: number },
): HTMLLIElement {
  const li = document.createElement('li');
  if (item.task !== null) {
    li.className = 'md-task';
    const index = state.taskIndex++;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.checked;
    box.disabled = Boolean(opts.readOnly);
    box.className = 'md-check';
    box.addEventListener('change', () => opts.onToggleTask?.(index, box.checked));
    li.append(box);
    li.classList.toggle('is-done', item.checked);
  }

  const body = document.createElement('span');
  body.className = 'md-item';
  for (const child of item.kids) {
    // A lone paragraph in a list item renders inline rather than as a block, so a one-line
    // item does not carry a paragraph's margins inside a small card.
    if (child.type === 'paragraph' && item.kids.length === 1) {
      inline(body, child.kids, opts, state);
    } else {
      const node = block(child, opts, state);
      if (node) body.append(node);
    }
  }
  li.append(body);
  return li;
}

function inline(
  parent: Node,
  tokens: Inline[],
  opts: MarkdownOptions,
  state: { taskIndex: number },
): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        parent.appendChild(document.createTextNode(token.text));
        break;
      case 'br':
        parent.appendChild(document.createElement('br'));
        break;
      case 'code': {
        const el = document.createElement('code');
        el.textContent = token.text;
        parent.appendChild(el);
        break;
      }
      case 'strong':
      case 'em':
      case 'del': {
        const el = document.createElement(token.type);
        inline(el, token.kids, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'link': {
        const el = document.createElement('a');
        const href = safeHref(token.href);
        if (href) {
          el.href = href;
          el.target = '_blank';
          // A note lives on someone else's page; never hand it a window reference.
          el.rel = 'noopener noreferrer';
        }
        if (token.title) el.title = token.title;
        inline(el, token.kids, opts, state);
        parent.appendChild(el);
        break;
      }
      case 'image':
        parent.appendChild(image(token, opts));
        break;
    }
  }
}

function image(token: Extract<Inline, { type: 'image' }>, opts: MarkdownOptions): Node {
  // Pasted images are stored as blobs and referenced as att:<id>; the host resolves them into
  // a canvas, because a canvas paint is not a fetch and so no page CSP can block it.
  const att = /^att:([A-Za-z0-9_-]+)$/.exec(token.href);
  if (att) {
    const el = opts.resolveAsset?.(att[1] as string);
    if (el) {
      el.classList.add('md-img');
      if (token.alt) el.setAttribute('aria-label', token.alt);
      return el;
    }
  }
  // Anything else stays as its source text. A note must never fetch from the network.
  const span = document.createElement('span');
  span.className = 'md-missing';
  span.textContent = token.raw;
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

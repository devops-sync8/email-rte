/**
 * Clipboard HTML (Word for Windows/Mac, Google Docs, web pages, and this
 * editor's own output) → simple markup the editor can load without losing
 * formatting.
 *
 * Kept: paragraphs, headings (h1–h3), block quotes, dividers, alignment,
 * bulleted/numbered lists with nesting (Word's list paragraphs are rebuilt
 * as real lists), bold, italic, underline, strikethrough, sub/superscript,
 * links (http, https, mailto, tel), text colour, highlight, text size,
 * email-safe font families, and images with an http(s) address.
 * Dropped: other fonts, classes, Office markup, comments, local or inline
 * (data:) images, embeds, scripts, event handlers and other attributes.
 * Tables become one paragraph per row.
 *
 * Default formatting is dropped so body text follows the editor's base
 * style: the source's own defaults (Word's Normal style, Google Docs' 11pt
 * black) and any value equal to the editor's base font, size or colour.
 *
 * The clipboard is parsed in an inert document (nothing runs or loads) and
 * the output is rebuilt from escaped strings and an allow-list.
 */
import { FONTS, TOKEN_LINK, escapeAttr, escapeText, isImageSource, normColor, normSize } from './render';

const PASTED_IMAGE = /^data:image\/(webp|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Links kept from pasted HTML: web, mail and phone addresses, or a merge field address (`{{…}}`, see TOKEN_LINK). */
const PASTED_PROTOCOL = /^(https?:|mailto:|tel:)/i;
const isPastedLink = (href: string) => PASTED_PROTOCOL.test(href) || TOKEN_LINK.test(href);

export interface CleanOptions {
  /** Keep images: http(s) and embedded (data:) ones, and Word's local ones via `localImages` (default false). */
  keepImages?: boolean;
  /**
   * Data URLs for the HTML's local (file://) images, in document order —
   * Word's pictures, taken from the clipboard's RTF (see rtfImages).
   */
  localImages?: (string | null)[];
  /** Editor base font key, size (px) and colour; equal values are dropped. */
  baseFont?: string;
  baseSize?: number;
  baseColor?: string;
}

interface Fmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sup?: boolean;
  sub?: boolean;
  color?: string;
  size?: number;
  bg?: string;
  font?: string;
  href?: string;
}

type Run = { text: string; fmt: Fmt } | { br: true } | { img: { src: string; width?: number; alt?: string }; fmt: Fmt };

type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'hr' | 'raw';

interface Block {
  kind: BlockKind;
  /** Pre-built markup for 'raw' blocks (columns, buttons). */
  html?: string;
  list?: { ordered: boolean; level: number };
  align?: string;
  indent?: number;
  runs: Run[];
}

interface StyleRule {
  tag?: string;
  cls?: string;
  decls: [string, string][];
  isDefault: boolean;
}

interface Source {
  rules: StyleRule[];
  drop: { size: Set<number>; color: Set<string>; font: Set<string> };
}

const DROP = new Set([
  'script', 'style', 'head', 'title', 'meta', 'link', 'base', 'picture', 'source', 'svg', 'math',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'video', 'audio', 'canvas', 'noscript', 'template',
  'button', 'input', 'select', 'textarea', 'option', 'map', 'area', 'xml',
]);
const BLOCKS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li', 'dt', 'dd', 'address',
  'section', 'article', 'header', 'footer', 'main', 'aside', 'tr', 'caption', 'figure', 'figcaption',
]);


// ------------------------------------------------------------ values ---

const WORD_HIGHLIGHTS: Record<string, string> = {
  darkblue: '#00008b', darkcyan: '#008b8b', darkgreen: '#006400', darkmagenta: '#8b008b', darkred: '#8b0000',
  darkyellow: '#808000', darkgray: '#a9a9a9', lightgray: '#d3d3d3',
};
const color = (v: string | undefined) => normColor(v) ?? (v ? WORD_HIGHLIGHTS[v.trim().toLowerCase()] : undefined);

/** Email-safe font key for a CSS font-family list (first family only), if any. */
export function fontKey(family: string | undefined): string | undefined {
  const first = family?.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!first) return undefined;
  if (first === 'times') return 'times';
  if (first === 'courier') return 'courier';
  return Object.entries(FONTS).find(([, f]) => f.label.toLowerCase() === first)?.[0];
}

function backgroundColor(value: string): string | undefined {
  for (const token of value.split(/\s+(?![^(]*\))/)) {
    const c = color(token);
    if (c) return c;
  }
  return undefined;
}

function parseDecls(style: string | null): [string, string][] {
  if (!style) return [];
  return style
    .split(';')
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? null : ([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string]);
    })
    .filter((d): d is [string, string] => !!d && !!d[0]);
}

function applyDecls(fmt: Fmt, decls: [string, string][]) {
  for (const [prop, raw] of decls) {
    const value = raw.toLowerCase().replace(/\s*!important$/, '');
    switch (prop) {
      case 'font-weight':
        if (/^(bold|bolder|[6-9]00)$/.test(value)) fmt.b = true;
        else if (/^(normal|lighter|[1-5]00)$/.test(value)) fmt.b = false;
        break;
      case 'font-style':
        fmt.i = /^(italic|oblique)/.test(value) ? true : value === 'normal' ? false : fmt.i;
        break;
      case 'text-decoration':
      case 'text-decoration-line':
        if (value.includes('none')) fmt.u = fmt.s = false;
        if (value.includes('underline')) fmt.u = true;
        if (value.includes('line-through')) fmt.s = true;
        break;
      case 'color': {
        const c = color(raw);
        if (c) fmt.color = c;
        break;
      }
      case 'font-size': {
        const px = normSize(raw);
        if (px) fmt.size = px;
        break;
      }
      case 'font-family': {
        const f = fontKey(raw);
        if (f) fmt.font = f;
        else delete fmt.font; // a font email clients lack: fall back to the base font
        break;
      }
      case 'background':
      case 'background-color': {
        const c = backgroundColor(raw);
        if (c) fmt.bg = c;
        else if (/^(transparent|none|initial)$/.test(value)) delete fmt.bg;
        break;
      }
      case 'mso-highlight': {
        const c = color(raw);
        if (c) fmt.bg = c;
        break;
      }
      case 'vertical-align':
        if (value === 'super') fmt.sup = true;
        if (value === 'sub') fmt.sub = true;
        break;
    }
  }
}

/** Declarations for an element: matching style sheet rules, then its style attribute. */
function declsFor(el: Element, rules: StyleRule[]): [string, string][] {
  const tag = el.tagName.toLowerCase();
  return [
    ...rules.filter((r) => (!r.tag || r.tag === tag) && (!r.cls || el.classList.contains(r.cls))).flatMap((r) => r.decls),
    ...parseDecls(el.getAttribute('style')),
  ];
}

/** Paragraph indent level (24px steps) from margin-left / padding-left. */
function indentOf(el: Element, rules: StyleRule[]): number | undefined {
  let px = 0;
  for (const [prop, value] of declsFor(el, rules)) {
    let v: string | undefined;
    if (prop === 'margin-left' || prop === 'padding-left') v = value;
    else if (prop === 'margin') {
      const parts = value.trim().split(/\s+/);
      v = parts.length === 4 ? parts[3] : parts.length >= 2 ? parts[1] : parts[0];
    } else continue;
    const m = v.toLowerCase().match(/^(-?[\d.]+)(px|pt|in|cm)?$/);
    if (!m) continue;
    const n = Number(m[1]) * ({ pt: 4 / 3, in: 96, cm: 37.8 } as Record<string, number>)[m[2] ?? 'px'] || Number(m[1]);
    if (prop === 'padding-left') px += n;
    else px = n;
  }
  const level = Math.round(px / 24);
  return level > 0 ? Math.min(level, 8) : undefined;
}

function alignOf(el: Element, rules: StyleRule[]): string | undefined {
  let align = el.getAttribute('align')?.toLowerCase();
  for (const [prop, value] of declsFor(el, rules)) if (prop === 'text-align') align = value.toLowerCase();
  return align === 'center' || align === 'right' || align === 'justify' ? align : undefined;
}

// ----------------------------------------------------- style sheets ---

function parseRules(doc: Document): StyleRule[] {
  const css = Array.from(doc.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
    .replace(/<!--|-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: StyleRule[] = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    for (const selector of m[1].split(',')) {
      const sm = selector.trim().match(/^([a-z][a-z0-9]*)?(?:\.([\w-]+))?$/i);
      if (!sm || (!sm[1] && !sm[2])) continue;
      const tag = sm[1]?.toLowerCase();
      const cls = sm[2];
      rules.push({ tag, cls, decls, isDefault: tag === 'body' || cls === 'MsoNormal' });
    }
  }
  return rules;
}

function detectSource(doc: Document, html: string, opts: CleanOptions): Source {
  const rules = parseRules(doc);
  const drop: Source['drop'] = { size: new Set(), color: new Set(), font: new Set() };
  for (const rule of rules.filter((r) => r.isDefault)) {
    const f: Fmt = {};
    applyDecls(f, rule.decls);
    if (f.size) drop.size.add(f.size);
    if (f.color) drop.color.add(f.color);
    if (f.font) drop.font.add(f.font);
  }
  if (/id="docs-internal-guid/.test(html)) {
    drop.size.add(normSize('11pt')!);
    drop.color.add('#000000');
    drop.font.add('arial');
  }
  if (opts.baseSize) drop.size.add(opts.baseSize);
  const base = normColor(opts.baseColor);
  if (base) drop.color.add(base);
  if (opts.baseFont) drop.font.add(opts.baseFont);
  return { rules, drop };
}

// ------------------------------------------------------ Word lists ---

function wordListInfo(el: Element): { level: number } | null {
  const m = (el.getAttribute('style') ?? '').match(/mso-list:\s*l\d+\s+level(\d+)/i);
  return m ? { level: Number(m[1]) } : null;
}

const isOrderedMarker = (marker: string) => /^\(?([0-9]+|[a-z]{1,3})[.)]$/i.test(marker.trim());

function extractWordMarkers(doc: Document) {
  const setMarker = (node: Node, text: string) => {
    const block = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest('p,li,div,h1,h2,h3,h4,h5,h6');
    if (block && !block.hasAttribute('data-mw-marker')) block.setAttribute('data-mw-marker', text.replace(/\s+/g, ' ').trim());
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const starts: Comment[] = [];
  for (let c = walker.nextNode(); c; c = walker.nextNode()) {
    if (/\[if !supportLists\]/i.test((c as Comment).data)) starts.push(c as Comment);
  }
  for (const start of starts) {
    const doomed: Node[] = [];
    let text = '';
    for (let n = start.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === Node.COMMENT_NODE && /\[endif\]/i.test((n as Comment).data)) {
        doomed.push(n);
        break;
      }
      text += n.textContent ?? '';
      doomed.push(n);
    }
    setMarker(start, text);
    [start, ...doomed].forEach((n) => n.parentNode?.removeChild(n));
  }
  for (const span of Array.from(doc.querySelectorAll('[style*="mso-list"]'))) {
    if (/mso-list:\s*ignore/i.test(span.getAttribute('style') ?? '')) {
      setMarker(span, span.textContent ?? '');
      span.remove();
    }
  }
}

// ------------------------------------------------------------ walk ---

class Collector {
  blocks: Block[] = [];
  private current: Block | null = null;

  start(kind: BlockKind, extra: Partial<Block> = {}) {
    this.end();
    this.current = { kind, runs: [], ...extra };
  }

  end() {
    if (this.current) this.blocks.push(this.current);
    this.current = null;
  }

  /** A block with no runs of its own (dividers, columns, buttons). */
  add(kind: BlockKind, extra: Partial<Block> = {}) {
    this.start(kind, extra);
    this.end();
  }

  run(run: Run) {
    if (!this.current) this.current = { kind: 'p', runs: [] };
    this.current.runs.push(run);
  }
}

interface Ctx {
  keepImages: boolean;
  localImages: (string | null)[];
  skippedImages: number;
  source: Source;
  lists: boolean[];
  quote: number;
  out: Collector;
  /** Cells per table, counted once (every cell asks). */
  cells: WeakMap<Element, number>;
}

function cellCount(table: Element | null, ctx: Ctx): number | undefined {
  if (!table) return undefined;
  let n = ctx.cells.get(table);
  if (n === undefined) ctx.cells.set(table, (n = table.querySelectorAll('td,th').length));
  return n;
}

const HEADING = /^h([1-6])$/;

function computeFmt(el: Element, parent: Fmt, ctx: Ctx): Fmt {
  const tag = el.tagName.toLowerCase();
  const fmt: Fmt = { ...parent };
  if (tag === 'b' || tag === 'strong') fmt.b = true;
  if (tag === 'i' || tag === 'em') fmt.i = true;
  if (tag === 'u' || tag === 'ins') fmt.u = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') fmt.s = true;
  if (tag === 'sup') fmt.sup = true;
  if (tag === 'sub') fmt.sub = true;
  if (tag === 'font') {
    const c = color(el.getAttribute('color') ?? undefined);
    if (c) fmt.color = c;
    const f = fontKey(el.getAttribute('face') ?? undefined);
    if (f) fmt.font = f;
  }
  applyDecls(fmt, declsFor(el, ctx.source.rules));
  if (HEADING.test(tag) || el.classList.contains('MsoTitle') || el.classList.contains('MsoSubtitle')) {
    // A heading's own size and weight come from the heading level.
    fmt.size = parent.size;
    fmt.b = parent.b;
  }
  if (tag === 'a') {
    const href = (el.getAttribute('href') ?? '').trim();
    if (isPastedLink(href)) fmt.href = href;
    // Link colour and underline come from the editor's link style.
    fmt.color = parent.color;
    fmt.u = parent.u;
  }
  return fmt;
}

function headingKind(el: Element): BlockKind | null {
  const m = el.tagName.toLowerCase().match(HEADING);
  if (m) return `h${Math.min(Number(m[1]), 3)}` as BlockKind;
  if (el.classList.contains('MsoTitle')) return 'h1';
  if (el.classList.contains('MsoSubtitle')) return 'h2';
  return null;
}

function walk(node: Node, fmt: Fmt, ctx: Ctx) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node as Text).data.replace(/[ \t\r\n]+/g, ' ');
    if (text) ctx.out.run({ text, fmt });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag) || tag.includes(':')) return; // o:p, v:shape, w:* …
  if (tag === 'br') return ctx.out.run({ br: true });
  if (tag === 'hr') return ctx.out.add('hr');
  if (tag === 'img') {
    const src = (el.getAttribute('src') ?? '').trim();
    const width = Number(el.getAttribute('width')) || undefined;
    const height = Number(el.getAttribute('height')) || undefined;
    const pixel = (width !== undefined && width <= 2) || (height !== undefined && height <= 2); // tracking pixels
    if (!ctx.keepImages || pixel) return;
    if (/^file:/i.test(src)) {
      // Word: the picture's data comes from the clipboard's RTF, in the same order.
      const data = ctx.localImages.shift();
      if (data) ctx.out.run({ img: { src: data, width, alt: el.getAttribute('alt') ?? '' }, fmt });
      else ctx.skippedImages++;
      return;
    }
    // Embedded pictures in any common format; the editor converts them to PNG/JPEG before use.
    if (isImageSource(src) || PASTED_IMAGE.test(src)) {
      ctx.out.run({ img: { src, width, alt: el.getAttribute('alt') ?? '' }, fmt });
    }
    return;
  }

  const childFmt = computeFmt(el, fmt, ctx);
  const children = () => el.childNodes.forEach((c) => walk(c, childFmt, ctx));
  const quoted = () => {
    ctx.out.end();
    ctx.quote++;
    children();
    ctx.quote--;
    ctx.out.end();
  };

  if (tag === 'ul' || tag === 'ol') {
    ctx.out.end();
    ctx.lists.push(tag === 'ol');
    children();
    ctx.lists.pop();
    ctx.out.end();
    return;
  }
  if (tag === 'blockquote') return quoted();
  if (tag === 'table') {
    const columns = sectionColumns(el);
    if (columns) return ctx.out.add('raw', { html: renderSectionMarkup(columns, ctx) });
  }
  if (tag === 'td' && el.hasAttribute('bgcolor') && /mso-padding-alt/i.test(el.getAttribute('style') ?? '')) {
    // This editor's own buttons: a coloured cell holding one link (or span).
    const face = el.querySelector('a, span');
    const text = (face?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (face && text) return ctx.out.add('raw', { html: buttonMarkup(el, face, text) });
  }
  if (tag === 'td' || tag === 'th') {
    // This editor's own quotes and dividers are single-cell tables.
    const cellStyle = el.getAttribute('style') ?? '';
    const onlyCell = cellCount(el.closest('table'), ctx) === 1;
    if (onlyCell && /border-left\s*:/i.test(cellStyle)) return quoted();
    if (onlyCell && /border-top\s*:/i.test(cellStyle) && !(el.textContent ?? '').replace(/\u00a0/g, '').trim()) return ctx.out.add('hr');
    children();
    ctx.out.run({ text: ' ', fmt });
    return;
  }
  if (BLOCKS.has(tag)) {
    const align = alignOf(el, ctx.source.rules);
    const word = wordListInfo(el);
    if (word) {
      ctx.out.start('p', { align, list: { ordered: isOrderedMarker(el.getAttribute('data-mw-marker') ?? ''), level: word.level } });
    } else if (tag === 'li') {
      const level = Math.max(1, ctx.lists.length);
      ctx.out.start('p', { align, list: { ordered: ctx.lists[ctx.lists.length - 1] ?? false, level } });
    } else if (tag === 'p' && el.closest('li') && ctx.lists.length) {
      children(); // Google Docs wraps each list item's text in a <p>
      return;
    } else {
      ctx.out.start(headingKind(el) ?? (ctx.quote ? 'quote' : 'p'), { align, indent: ctx.quote ? undefined : indentOf(el, ctx.source.rules) });
    }
    children();
    ctx.out.end();
    return;
  }
  children();
}

// ----------------------------------------------- columns and buttons ---

const childrenOf = (el: Element, tag: string) => Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);

/** This editor's column sections: one cell holding inline-block divs (plus Outlook comments). */
function sectionColumns(table: Element): Element[] | null {
  const rows = [...childrenOf(table, 'tr'), ...childrenOf(table, 'tbody').flatMap((b) => childrenOf(b, 'tr'))];
  if (rows.length !== 1) return null;
  const cells = childrenOf(rows[0], 'td');
  if (cells.length !== 1) return null;
  const columns = Array.from(cells[0].children);
  if (columns.length < 2 || !columns.every((c) => c.tagName === 'DIV' && /display\s*:\s*inline-block/i.test(c.getAttribute('style') ?? ''))) return null;
  return columns;
}

/** The layout from the columns' widths. */
function layoutOf(columns: Element[]): string {
  if (columns.length >= 3) return '1-1-1';
  const [a, b] = columns.map((c) => Number(/max-width\s*:\s*(\d+)px/i.exec(c.getAttribute('style') ?? '')?.[1]) || 1);
  return a / b < 0.75 ? '1-2' : a / b > 1.33 ? '2-1' : '1-1';
}

function renderSectionMarkup(columns: Element[], ctx: Ctx): string {
  const inner = columns.map((col) => {
    const out = new Collector();
    const sub: Ctx = { ...ctx, lists: [], quote: 0, out };
    col.childNodes.forEach((c) => walk(c, {}, sub));
    out.end();
    ctx.skippedImages = sub.skippedImages;
    return `<div class="erte-column">${renderBlocks(out.blocks, ctx.source)}</div>`;
  });
  return `<div class="erte-section" data-layout="${layoutOf(columns)}">${inner.join('')}</div>`;
}

function buttonMarkup(cell: Element, face: Element, text: string): string {
  const href = (face.getAttribute('href') ?? '').trim();
  const bg = normColor(cell.getAttribute('bgcolor') ?? undefined);
  const colour = normColor(/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(face.getAttribute('style') ?? '')?.[1]);
  const align = cell.parentElement?.closest('table')?.parentElement?.closest('td')?.getAttribute('align');
  const attrs = [
    `data-text="${escapeAttr(text)}"`,
    `data-href="${escapeAttr(isPastedLink(href) ? href : '')}"`,
    bg ? `data-background="${bg}"` : '',
    colour ? `data-color="${colour}"` : '',
    align === 'center' || align === 'right' ? `data-align="${align}"` : '',
  ];
  return `<div class="erte-button" ${attrs.filter(Boolean).join(' ')}></div>`;
}

// ---------------------------------------------------------- render ---

const FMT_KEYS = ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'size', 'bg', 'font', 'href'] as const;
const sameFmt = (a: Fmt, b: Fmt) => FMT_KEYS.every((k) => (a[k] ?? false) === (b[k] ?? false));

function renderRuns(runs: Run[], source: Source): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if ('text' in run && prev && 'text' in prev && sameFmt(prev.fmt, run.fmt)) {
      merged[merged.length - 1] = { text: prev.text + run.text, fmt: prev.fmt };
    } else merged.push(run);
  }
  while (merged.length && 'text' in merged[0] && !merged[0].text.trim()) merged.shift();
  while (merged.length && 'text' in merged[merged.length - 1] && !(merged[merged.length - 1] as { text: string }).text.trim()) merged.pop();
  if (merged.length && 'text' in merged[0]) merged[0] = { ...merged[0], text: merged[0].text.replace(/^ +/, '') };
  const last = merged[merged.length - 1];
  if (last && 'text' in last) merged[merged.length - 1] = { ...last, text: last.text.replace(/ +$/, '') };

  const { drop } = source;
  return merged
    .map((run) => {
      if ('br' in run) return '<br>';
      const f = run.fmt;
      let html: string;
      if ('img' in run) {
        const { src, width, alt } = run.img;
        html = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt ?? '')}"${width ? ` width="${width}"` : ''}>`;
      } else {
        html = escapeText(run.text);
        if (!run.text.trim()) return html;
        if (f.sub) html = `<sub>${html}</sub>`;
        else if (f.sup) html = `<sup>${html}</sup>`;
        if (f.s) html = `<s>${html}</s>`;
        if (f.u && !f.href) html = `<u>${html}</u>`;
        if (f.i) html = `<em>${html}</em>`;
        if (f.b) html = `<strong>${html}</strong>`;
        const style = [
          f.color && !drop.color.has(f.color) ? `color:${f.color};` : '',
          f.size && !drop.size.has(f.size) ? `font-size:${f.size}px;` : '',
          f.bg && f.bg !== '#ffffff' ? `background-color:${f.bg};` : '',
        ].join('');
        const font = f.font && !drop.font.has(f.font) ? ` data-erte-font="${f.font}"` : '';
        if (style || font) html = `<span${style ? ` style="${style}"` : ''}${font}>${html}</span>`;
      }
      if (f.href) html = `<a href="${escapeAttr(f.href)}">${html}</a>`;
      return html;
    })
    .join('');
}

function renderBlocks(blocks: Block[], source: Source): string {
  const out: string[] = [];
  const stack: { tag: 'ul' | 'ol'; liOpen: boolean }[] = [];
  const closeTop = () => {
    const top = stack.pop()!;
    if (top.liOpen) out.push('</li>');
    out.push(`</${top.tag}>`);
  };
  const alignAttr = (b: Block) =>
    (b.align ? ` style="text-align:${b.align}"` : '') + (b.indent && !b.list ? ` class="ql-indent-${b.indent}"` : '');

  for (const block of blocks) {
    if (block.kind === 'raw') {
      while (stack.length) closeTop();
      out.push(block.html ?? '');
      continue;
    }
    if (block.kind === 'hr') {
      while (stack.length) closeTop();
      out.push('<hr>');
      continue;
    }
    // A paragraph holding only &nbsp; is a deliberate blank line (Word's
    // empty paragraphs use <o:p>, which is dropped).
    if (!block.list && block.kind === 'p' && block.runs.length && block.runs.every((r) => 'text' in r && !r.text.replace(/\u00a0/g, '').trim() && r.text.includes('\u00a0'))) {
      while (stack.length) closeTop();
      out.push('<p><br></p>');
      continue;
    }
    const content = renderRuns(block.runs, source);
    if (!content.replace(/<br>/g, '').trim()) continue;
    if (!block.list) {
      while (stack.length) closeTop();
      const tag = block.kind === 'quote' ? 'blockquote' : block.kind;
      out.push(`<${tag}${alignAttr(block)}>${content}</${tag}>`);
      continue;
    }
    const tag = block.list.ordered ? 'ol' : 'ul';
    const level = Math.min(Math.max(block.list.level, 1), 8);
    while (stack.length > level) closeTop();
    if (stack.length === level && stack[level - 1].tag !== tag) closeTop();
    while (stack.length < level) {
      const parent = stack[stack.length - 1];
      if (parent && !parent.liOpen) {
        out.push('<li>');
        parent.liOpen = true;
      }
      out.push(`<${tag}>`);
      stack.push({ tag, liOpen: false });
    }
    const top = stack[level - 1];
    if (top.liOpen) out.push('</li>');
    out.push(`<li${alignAttr(block)}>${content}`);
    top.liOpen = true;
  }
  while (stack.length) closeTop();
  return out.join('');
}

// ------------------------------------------------------------- API ---

/**
 * Clean clipboard or stored HTML into markup the editor loads faithfully.
 * `skippedImages` counts local (Word) images without data to replace them.
 */
export function cleanHtmlDetailed(html: string, opts: CleanOptions = {}): { html: string; skippedImages: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: no scripts run, nothing loads
  const source = detectSource(doc, html, opts);
  extractWordMarkers(doc);
  const out = new Collector();
  const ctx: Ctx = { keepImages: !!opts.keepImages, localImages: [...(opts.localImages ?? [])], skippedImages: 0, source, lists: [], quote: 0, out, cells: new WeakMap() };
  walk(doc.body, {}, ctx);
  out.end();
  return { html: renderBlocks(out.blocks, source), skippedImages: ctx.skippedImages };
}

/** Clean clipboard or stored HTML into markup the editor loads faithfully. */
export function cleanHtml(html: string, opts: CleanOptions = {}): string {
  return cleanHtmlDetailed(html, opts).html;
}

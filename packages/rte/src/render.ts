/**
 * Delta → email-safe HTML and plain text.
 *
 * DOM-free (runs in browsers, Node and workers), so a server can re-render
 * stored content itself instead of trusting HTML from a browser.
 *
 * Email rules applied (Outlook desktop uses Word's renderer, Gmail strips
 * <style>, Outlook on the web rewrites classes):
 * - every style is inline; no classes, ids or <style> blocks;
 * - every text block carries its font family, size, colour and line height,
 *   because Outlook desktop does not reliably inherit them;
 * - explicit margins on paragraphs, headings and lists (clients disagree on
 *   the defaults); lists indent by margin, which Outlook honours, not padding;
 * - blockquotes and dividers are single-cell tables (borders on <hr> and
 *   <blockquote> render inconsistently in Outlook);
 * - images carry a width attribute (Outlook ignores CSS max-width) capped at
 *   the content width, plus max-width:100%;height:auto for mobile. Embedded
 *   images stay as data: URIs here (self-contained, storable); convert them
 *   to cid: inline attachments for sending with {@link extractEmbeddedImages};
 * - every value is validated: colours, pixel sizes, a fixed font list and
 *   http/https/mailto/tel links. Anything else is dropped, so rendering an
 *   untrusted Delta is safe.
 *
 * Merge fields (`{{firstName}}`) render as their text; replace them with
 * values first with {@link replaceTokens}, or use {@link renderEmail}.
 */
import { TOKEN_PATTERN, asToken, replaceTokens, tokenText, type ReplaceTokensOptions, type TokenValues } from './tokens';

export * from './tokens';
export * from './templates';

export interface DeltaOp {
  insert?: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
  retain?: unknown;
  delete?: unknown;
}

export interface DeltaLike {
  ops: DeltaOp[];
}

export interface EmailStyle {
  /** Default font: a key of {@link FONTS}. */
  fontFamily: string;
  /** Default text size in px. */
  fontSize: number;
  /** Default text colour. */
  color: string;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Link colour. */
  linkColor: string;
  /** Space below paragraphs, headings, lists, quotes and dividers, in px. */
  blockSpacing: number;
  /** Border colour for quotes and dividers. */
  ruleColor: string;
  /** Widest an image may be, in px (the email's content width). */
  maxImageWidth: number;
}

export const DEFAULT_STYLE: EmailStyle = {
  fontFamily: 'arial',
  fontSize: 16,
  color: '#1f2328',
  lineHeight: 1.5,
  linkColor: '#0b57d0',
  blockSpacing: 12,
  ruleColor: '#d0d7de',
  maxImageWidth: 600,
};

/** Fonts that render (or have close fallbacks) in Outlook, Outlook on the web and Gmail. */
export const FONTS: Record<string, { label: string; stack: string }> = {
  arial: { label: 'Arial', stack: "Arial, Helvetica, sans-serif" },
  helvetica: { label: 'Helvetica', stack: "Helvetica, Arial, sans-serif" },
  verdana: { label: 'Verdana', stack: "Verdana, Geneva, sans-serif" },
  tahoma: { label: 'Tahoma', stack: "Tahoma, Geneva, sans-serif" },
  trebuchet: { label: 'Trebuchet MS', stack: "'Trebuchet MS', Helvetica, sans-serif" },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', Times, serif" },
  times: { label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  courier: { label: 'Courier New', stack: "'Courier New', Courier, monospace" },
};

/** Heading sizes relative to the base font size. */
const HEADING_SCALE: Record<number, number> = { 1: 1.75, 2: 1.5, 3: 1.25 };
const INDENT_PX = 24;
const px = (n: number) => (n ? `${n}px` : '0');
const LINK_PROTOCOL = /^(https?:\/\/|mailto:|tel:)/i;
/** A template link starting with a merge field (`{{unsubscribeUrl}}`, `{{site}}/account`), checked again once replaced. */
const TOKEN_LINK = new RegExp(`^${TOKEN_PATTERN.source}`);
const isLink = (href: string) => LINK_PROTOCOL.test(href) || TOKEN_LINK.test(href);
const IMAGE_PROTOCOL = /^https?:\/\//i;
/** Embedded images: base64 PNG, JPEG or GIF only (what Outlook and Gmail display). */
export const EMBEDDED_IMAGE = /^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A usable image address: http(s), or an embedded (data:) PNG/JPEG/GIF. */
export function isImageSource(src: unknown): src is string {
  return typeof src === 'string' && (IMAGE_PROTOCOL.test(src) || EMBEDDED_IMAGE.test(src));
}

// ------------------------------------------------------------ values ---

export const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', yellow: '#ffff00', lime: '#00ff00', green: '#008000',
  blue: '#0000ff', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080',
  grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080',
  teal: '#008080', orange: '#ffa500',
};

/** A colour as lowercase #rrggbb, or undefined when not a literal colour. */
export function normColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  }
  return undefined;
}

/** A font size in whole px (from px or pt), or undefined. */
export function normSize(value: unknown): number | undefined {
  const m = typeof value === 'string' ? value.trim().toLowerCase().match(/^([\d.]+)\s*(px|pt)$/) : null;
  const px = m ? Math.round(Number(m[1]) * (m[2] === 'pt' ? 4 / 3 : 1)) : typeof value === 'number' ? Math.round(value) : NaN;
  return px >= 6 && px <= 96 ? px : undefined;
}

const fontStack = (key: unknown) => (typeof key === 'string' && FONTS[key] ? FONTS[key].stack : undefined);

// ------------------------------------------------------------ layout ---

/** Block-level embeds: each is a block of its own. */
const BLOCK_EMBEDS = ['divider', 'section', 'button'] as const;

/** Column layouts: relative column widths. Columns sit side by side on wide screens and stack on phones. */
export const LAYOUTS = {
  '1-1': [1, 1],
  '1-1-1': [1, 1, 1],
  '1-2': [1, 2],
  '2-1': [2, 1],
} as const;
export type SectionLayout = keyof typeof LAYOUTS;

/** A column section: `{ insert: { section: { layout, columns: [ops, ops] } } }` in the Delta. */
export interface SectionValue {
  layout: SectionLayout;
  /** Each column's content as Delta ops. */
  columns: DeltaOp[][];
}

/** A section value, validated: known layout, one Delta per column. */
export function asSection(value: unknown): SectionValue | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const layout = typeof v.layout === 'string' && v.layout in LAYOUTS ? (v.layout as SectionLayout) : null;
  if (!layout) return null;
  const n = LAYOUTS[layout].length;
  const given = Array.isArray(v.columns) ? v.columns : [];
  const columns = Array.from({ length: n }, (_, i) => (Array.isArray(given[i]) ? (given[i] as DeltaOp[]) : []));
  // Extra columns (never produced by the editor) are kept, in the last column.
  for (let i = n; i < given.length; i++) if (Array.isArray(given[i])) columns[n - 1] = [...columns[n - 1], ...(given[i] as DeltaOp[])];
  return { layout, columns };
}

/** A call-to-action button: `{ insert: { button: { text, href, background?, color?, align? } } }`. */
export interface ButtonValue {
  text: string;
  /** http(s), mailto or tel address, or one starting with a merge field (`{{url}}`). */
  href: string;
  /** Button colour (default: the link colour). */
  background?: string;
  /** Text colour (default white). */
  color?: string;
  align?: 'left' | 'center' | 'right';
}

/** A button value, validated (null without text). */
export function asButton(value: unknown): ButtonValue | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = typeof v.text === 'string' ? v.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!text) return null;
  const out: ButtonValue = { text, href: typeof v.href === 'string' ? v.href.trim() : '' };
  const background = normColor(v.background);
  const color = normColor(v.color);
  if (background) out.background = background;
  if (color) out.color = color;
  if (v.align === 'left' || v.align === 'center' || v.align === 'right') out.align = v.align;
  return out;
}

/** Gap between columns, in px. */
const COLUMN_GAP = 16;

/** Column widths for a layout (unknown layouts count as 2 columns) at a content width: `outer` includes the gap after the column. */
export function columnWidths(layout: string, contentWidth: number): { inner: number[]; outer: number[] } {
  const ratios = LAYOUTS[layout in LAYOUTS ? (layout as SectionLayout) : '1-1'];
  const total = ratios.reduce((a, b) => a + b, 0);
  const available = contentWidth - COLUMN_GAP * (ratios.length - 1);
  const inner = ratios.map((r) => Math.floor((available * r) / total));
  inner[inner.length - 1] = available - inner.slice(0, -1).reduce((a, b) => a + b, 0);
  return { inner, outer: inner.map((w, i) => (i < inner.length - 1 ? w + COLUMN_GAP : w)) };
}

// ------------------------------------------------------------- lines ---

interface Run {
  text?: string;
  embed?: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

interface Line {
  runs: Run[];
  attrs: Record<string, unknown>;
}

/** Split a document Delta into lines; block formats live on each line's "\n". */
function toLines(delta: DeltaLike): Line[] {
  const lines: Line[] = [];
  let runs: Run[] = [];
  const sameAttrs = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);
  // Adjacent text with the same formatting is one run (one <strong>, one <a>…).
  const pushText = (text: string, attrs: Record<string, unknown>) => {
    const last = runs[runs.length - 1];
    if (last && last.text !== undefined && sameAttrs(last.attrs, attrs)) last.text += text;
    else runs.push({ text, attrs });
  };
  for (const op of delta.ops ?? []) {
    if (op.insert === undefined) continue;
    const attrs = (op.attributes ?? {}) as Record<string, unknown>;
    if (typeof op.insert === 'string') {
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (part) pushText(part, attrs);
        if (i < parts.length - 1) {
          lines.push({ runs, attrs });
          runs = [];
        }
      });
    } else if (op.insert && typeof op.insert === 'object') {
      const block = BLOCK_EMBEDS.find((k) => k in (op.insert as object));
      if (block) {
        if (runs.length) lines.push({ runs, attrs: {} });
        runs = [];
        lines.push({ runs: [{ embed: op.insert, attrs }], attrs: { [block]: true } });
      } else if ('token' in op.insert) {
        const token = asToken(op.insert.token);
        if (token) pushText(tokenText(token), attrs);
      } else {
        runs.push({ embed: op.insert, attrs });
      }
    }
  }
  if (runs.length) lines.push({ runs, attrs: {} });
  return lines;
}

// ------------------------------------------------------------ inline ---

function textStyle(style: EmailStyle, size: number, font: string, extra = ''): string {
  return (
    `font-family:${font};font-size:${size}px;line-height:${Math.round(style.lineHeight * 100)}%;` +
    `color:${style.color};${extra}`
  );
}

function renderText(text: string): string {
  // Keep runs of spaces and tabs visible (email clients collapse whitespace).
  return escapeText(text)
    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
    .replace(/ {2,}/g, (m) => ' ' + '&nbsp;'.repeat(m.length - 1));
}

function renderRun(run: Run, style: EmailStyle): string {
  const a = run.attrs;
  if (run.embed) {
    const src = typeof run.embed.image === 'string' ? run.embed.image.trim() : '';
    if (!isImageSource(src)) return '';
    const width = Math.min(Number(a.width) > 0 ? Math.round(Number(a.width)) : style.maxImageWidth, style.maxImageWidth);
    const alt = typeof a.alt === 'string' ? a.alt : '';
    return (
      // Embedded (data:) sources are base64 only: nothing to escape in what may be megabytes.
      `<img src="${IMAGE_PROTOCOL.test(src) ? escapeAttr(src) : src}" alt="${escapeAttr(alt)}" width="${width}" ` +
      `style="width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;vertical-align:middle;">`
    );
  }
  let html = renderText(run.text ?? '');
  if (a.script === 'sub') html = `<sub>${html}</sub>`;
  else if (a.script === 'super') html = `<sup>${html}</sup>`;
  if (a.strike) html = `<s>${html}</s>`;
  if (a.underline) html = `<u>${html}</u>`;
  if (a.italic) html = `<em>${html}</em>`;
  if (a.bold) html = `<strong>${html}</strong>`;
  const css: string[] = [];
  const font = fontStack(a.font);
  if (font) css.push(`font-family:${font};`);
  const size = normSize(a.size);
  if (size) css.push(`font-size:${size}px;line-height:${Math.round(style.lineHeight * 100)}%;`);
  const color = normColor(a.color);
  if (color) css.push(`color:${color};`);
  const bg = normColor(a.background);
  if (bg) css.push(`background-color:${bg};`);
  if (css.length) html = `<span style="${css.join('')}">${html}</span>`;
  return html;
}

function renderRuns(runs: Run[], style: EmailStyle): string {
  let out = '';
  for (let i = 0; i < runs.length; ) {
    const href = typeof runs[i].attrs.link === 'string' ? (runs[i].attrs.link as string).trim() : '';
    if (href && isLink(href)) {
      let inner = '';
      let j = i;
      while (j < runs.length && runs[j].attrs.link === runs[i].attrs.link) inner += renderRun(runs[j++], style);
      out += `<a href="${escapeAttr(href)}" target="_blank" style="color:${style.linkColor};text-decoration:underline;">${inner}</a>`;
      i = j;
    } else {
      out += renderRun(runs[i++], style);
    }
  }
  return out;
}

// ------------------------------------------------------------ blocks ---

const ALIGN = new Set(['center', 'right', 'justify']);

function lineIndent(line: Line): number {
  const n = Number(line.attrs.indent);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 8) : 0;
}

const alignCss = (line: Line) => (typeof line.attrs.align === 'string' && ALIGN.has(line.attrs.align) ? `text-align:${line.attrs.align};` : '');

function blockCss(line: Line, marginBottom: number, marginLeft = 0): string {
  return `margin:0 0 ${px(marginBottom)} ${px(marginLeft)};${alignCss(line)}`;
}

function renderParagraph(line: Line, style: EmailStyle, font: string, marginBottom: number): string {
  const content = renderRuns(line.runs, style) || '&nbsp;';
  const header = Number(line.attrs.header);
  if (HEADING_SCALE[header]) {
    const size = Math.round(style.fontSize * HEADING_SCALE[header]);
    const css = blockCss(line, marginBottom, lineIndent(line) * INDENT_PX) +
      `font-family:${font};font-size:${size}px;line-height:125%;font-weight:bold;color:${style.color};`;
    return `<h${header} style="${css}">${content}</h${header}>`;
  }
  const css = blockCss(line, marginBottom, lineIndent(line) * INDENT_PX) + textStyle(style, style.fontSize, font);
  return `<p style="${css}">${content}</p>`;
}

const TOP_MARGIN = '\u0000TOP\u0000';
/** Per nesting level: numbering (type attribute and CSS) and bullets. */
const LIST_TYPES = ['1', 'a', 'i'];
const LIST_STYLES = { ol: ['decimal', 'lower-alpha', 'lower-roman'], ul: ['disc', 'circle', 'square'] };

function renderList(lines: Line[], style: EmailStyle, font: string, marginBottom: number): string {
  const out: string[] = [];
  const stack: { tag: 'ul' | 'ol'; open: boolean }[] = [];
  const openList = (tag: 'ul' | 'ol', depth: number) => {
    const top = depth === 0;
    const typeAttr = tag === 'ol' ? ` type="${LIST_TYPES[depth % 3]}"` : '';
    const listStyle = `list-style-type:${LIST_STYLES[tag][depth % 3]};`;
    // Top-level lists get their bottom margin once we know whether another list follows.
    out.push(`<${tag}${typeAttr} style="margin:${px(top ? 0 : 4)} 0 ${top ? TOP_MARGIN : '0'} ${INDENT_PX}px;padding:0;${listStyle}">`);
    stack.push({ tag, open: false });
  };
  const closeTop = () => {
    const top = stack.pop()!;
    if (top.open) out.push('</li>');
    out.push(`</${top.tag}>`);
  };

  for (const line of lines) {
    const tag = line.attrs.list === 'ordered' ? 'ol' : 'ul';
    const level = lineIndent(line) + 1;
    while (stack.length > level) closeTop();
    if (stack.length === level && stack[level - 1].tag !== tag) closeTop();
    while (stack.length < level) {
      const parent = stack[stack.length - 1];
      if (parent && !parent.open) {
        out.push(`<li style="margin:0 0 4px 0;${textStyle(style, style.fontSize, font)}">`);
        parent.open = true;
      }
      openList(tag, stack.length);
    }
    const top = stack[level - 1];
    if (top.open) out.push('</li>');
    out.push(`<li style="margin:0 0 4px 0;${alignCss(line)}${textStyle(style, style.fontSize, font)}">${renderRuns(line.runs, style) || '&nbsp;'}`);
    top.open = true;
  }
  while (stack.length) closeTop();
  const html = out.join('');
  const tops = html.split(TOP_MARGIN).length - 1;
  let seen = 0;
  return html.replace(new RegExp(TOP_MARGIN, 'g'), () => px(++seen === tops ? marginBottom : style.blockSpacing));
}

/** A full-width single-cell table: how quotes, dividers and buttons render in every client. */
const blockTable = (marginBottom: number, cell: string, inner: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${px(marginBottom)} 0;border-collapse:collapse;">` +
  `<tr><td ${cell}>${inner}</td></tr></table>`;

function renderQuote(lines: Line[], style: EmailStyle, font: string, marginBottom: number): string {
  const inner = lines.map((l, i) => renderParagraph(l, style, font, i === lines.length - 1 ? 0 : style.blockSpacing)).join('');
  return blockTable(marginBottom, `style="border-left:3px solid ${style.ruleColor};padding:0 0 0 12px;"`, inner);
}

function renderDivider(style: EmailStyle, marginBottom: number): string {
  return blockTable(marginBottom, `style="border-top:1px solid ${style.ruleColor};font-size:1px;line-height:1px;height:1px;"`, '&nbsp;');
}

/**
 * Columns that sit side by side on wide screens and stack on phones, without
 * media queries (Gmail apps drop them): inline-block columns whose max-width
 * becomes 100% below the content width (`max()`/`calc()`; clients without
 * them keep the columns at their desktop width and wrap them). Outlook desktop
 * ignores all of that and gets a fixed-width table from conditional comments.
 */
function renderSection(section: SectionValue, style: EmailStyle, marginBottom: number, depth: number): string {
  const W = style.maxImageWidth;
  const { inner, outer } = columnWidths(section.layout, W);
  const last = section.columns.length - 1;
  let html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;border-collapse:collapse;">` +
    `<tr><td style="padding:0;font-size:0;line-height:0;">` +
    `<!--[if mso]><table role="presentation" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->`;
  section.columns.forEach((ops, i) => {
    const content = renderDelta({ ops }, { ...style, maxImageWidth: inner[i] }, depth + 1);
    // Stacked columns are separated by the block spacing; the last one ends the section.
    const bottom = i === last ? marginBottom : style.blockSpacing;
    html +=
      `<!--[if mso]><td width="${outer[i]}" valign="top"><![endif]-->` +
      `<div style="display:inline-block;vertical-align:top;width:100%;max-width:${outer[i]}px;max-width:max(${outer[i]}px, calc((${W}px - 100%) * ${W}));">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
      `<tr><td valign="top" style="padding:0 ${px(i === last ? 0 : COLUMN_GAP)} ${px(bottom)} 0;">${content}</td></tr></table></div>` +
      `<!--[if mso]></td><![endif]-->`;
  });
  return html + `<!--[if mso]></tr></table><![endif]--></td></tr></table>`;
}

/**
 * A "bulletproof" button: a coloured table cell with a padded link. Outlook
 * desktop ignores padding on links, so the cell's padding applies there
 * (mso-padding-alt); elsewhere the whole padded link is clickable.
 */
function renderButton(button: ButtonValue, style: EmailStyle, font: string, marginBottom: number): string {
  const bg = button.background ?? style.linkColor;
  const color = button.color ?? '#ffffff';
  const align = button.align ?? 'left';
  const label = renderText(button.text);
  const css = `display:inline-block;padding:12px 24px;font-family:${font};font-size:${style.fontSize}px;line-height:120%;font-weight:bold;color:${color};text-decoration:none;border-radius:4px;`;
  const face = isLink(button.href)
    ? `<a href="${escapeAttr(button.href)}" target="_blank" style="${css}">${label}</a>`
    : `<span style="${css}">${label}</span>`;
  return blockTable(
    marginBottom,
    `align="${align}" style="padding:0;"`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">` +
      `<tr><td align="center" bgcolor="${bg}" style="border-radius:4px;background-color:${bg};mso-padding-alt:12px 24px;">${face}</td></tr></table>`,
  );
}

type Group = { kind: 'p' | 'list' | 'quote' | 'divider' | 'section' | 'button'; lines: Line[] };

function groupLines(lines: Line[]): Group[] {
  const groups: Group[] = [];
  for (const line of lines) {
    const kind: Group['kind'] = BLOCK_EMBEDS.find((k) => line.attrs[k]) ?? (line.attrs.list ? 'list' : line.attrs.blockquote ? 'quote' : 'p');
    const last = groups[groups.length - 1];
    if (last && last.kind === kind && (kind === 'list' || kind === 'quote')) last.lines.push(line);
    else groups.push({ kind, lines: [line] });
  }
  return groups;
}

/** Drop trailing empty paragraphs (Quill always ends with an empty line). */
function trimTrailing(lines: Line[]): Line[] {
  const out = [...lines];
  while (out.length && !out[out.length - 1].runs.length && !out[out.length - 1].attrs.list) out.pop();
  return out;
}

/**
 * Render a Delta as an email-safe HTML fragment. Put it in an email as is,
 * or wrap it with {@link wrapEmailDocument}.
 */
export function deltaToEmailHtml(delta: DeltaLike, styleOverrides: Partial<EmailStyle> = {}): string {
  return renderDelta(delta, styleOverrides, 0);
}

function renderDelta(delta: DeltaLike, styleOverrides: Partial<EmailStyle>, depth: number): string {
  const style: EmailStyle = { ...DEFAULT_STYLE, ...styleOverrides };
  style.color = normColor(style.color) ?? DEFAULT_STYLE.color;
  style.linkColor = normColor(style.linkColor) ?? DEFAULT_STYLE.linkColor;
  style.ruleColor = normColor(style.ruleColor) ?? DEFAULT_STYLE.ruleColor;
  style.fontSize = normSize(style.fontSize) ?? DEFAULT_STYLE.fontSize;
  const font = fontStack(style.fontFamily) ?? FONTS[DEFAULT_STYLE.fontFamily].stack;

  const groups = groupLines(trimTrailing(toLines(delta)));
  return groups
    .map((g, i) => {
      const mb = i === groups.length - 1 ? 0 : style.blockSpacing;
      switch (g.kind) {
        case 'list':
          return renderList(g.lines, style, font, mb);
        case 'quote':
          return renderQuote(g.lines, style, font, mb);
        case 'divider':
          return renderDivider(style, mb);
        case 'section': {
          const section = asSection(g.lines[0].runs[0]?.embed?.section);
          if (!section) return '';
          // Columns never nest: a section inside a column is shown as its columns' content.
          if (depth > 0) return renderDelta({ ops: section.columns.flat() }, style, depth);
          return renderSection(section, style, mb, depth);
        }
        case 'button': {
          const button = asButton(g.lines[0].runs[0]?.embed?.button);
          return button ? renderButton(button, style, font, mb) : '';
        }
        default:
          return renderParagraph(g.lines[0], style, font, mb);
      }
    })
    .join('');
}

/** Render a Delta as plain text, for the text/plain part of an email. */
export function deltaToPlainText(delta: DeltaLike): string {
  const lines = trimTrailing(toLines(delta));
  const counters: { type: unknown; n: number }[] = [];
  const out: string[] = [];
  for (const line of lines) {
    if (line.attrs.divider) {
      out.push('----------');
      continue;
    }
    if (line.attrs.section) {
      // Columns one after another, as on a phone.
      const section = asSection(line.runs[0]?.embed?.section);
      const parts = (section?.columns ?? []).map((ops) => deltaToPlainText({ ops })).filter(Boolean);
      if (parts.length) out.push(parts.join('\n\n'));
      continue;
    }
    if (line.attrs.button) {
      const button = asButton(line.runs[0]?.embed?.button);
      if (button) out.push(isLink(button.href) ? `${button.text}: ${button.href.replace(/^mailto:/i, '')}` : button.text);
      continue;
    }
    let text = '';
    for (const run of line.runs) {
      if (run.embed) {
        const alt = typeof run.attrs.alt === 'string' && run.attrs.alt ? run.attrs.alt : 'image';
        text += `[${alt}]`;
        continue;
      }
      const t = run.text ?? '';
      const href = typeof run.attrs.link === 'string' && isLink(run.attrs.link) ? run.attrs.link.replace(/^mailto:/i, '') : '';
      text += href && href !== t ? `${t} (${href})` : t;
    }
    const level = lineIndent(line);
    if (line.attrs.list) {
      counters.length = level + 1;
      const c = counters[level]?.type === line.attrs.list ? counters[level] : { type: line.attrs.list, n: 0 };
      counters[level] = { ...c, n: c.n + 1 };
      const marker = line.attrs.list === 'ordered' ? `${counters[level].n}.` : '•';
      out.push(`${'   '.repeat(level)}${marker} ${text}`);
      continue;
    }
    counters.length = 0;
    if (line.attrs.blockquote) out.push(`> ${text}`);
    else out.push(text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export interface EmbeddedImage {
  /** Content-ID, referenced from the HTML as `cid:<cid>`. */
  cid: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  filename: string;
  /** Image bytes, base64-encoded. */
  base64: string;
}

/** FNV-1a over a string, as 8 hex digits (stable Content-IDs for identical images). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Prepare HTML for sending: every embedded (data:) image becomes a `cid:`
 * reference plus an inline attachment. Send the attachments as
 * multipart/related parts with matching Content-IDs (the .NET
 * `SmtpEmailSender` does this). Outlook desktop, Outlook on the web and Gmail
 * block data: images but display cid: images inline. Identical images are
 * attached once.
 */
export function extractEmbeddedImages(html: string): { html: string; images: EmbeddedImage[] } {
  const images = new Map<string, EmbeddedImage>(); // by image data
  const cids = new Set<string>();
  const out = html.replace(/(\ssrc=")data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})"/g, (_m, pre: string, type: string, base64: string) => {
    let image = images.get(base64);
    if (!image) {
      const base = `img-${hash(base64)}${base64.length.toString(16)}`;
      let cid = `${base}@email-rte`;
      for (let n = 2; cids.has(cid); n++) cid = `${base}-${n}@email-rte`; // hash collision
      cids.add(cid);
      const ext = type === 'jpeg' ? 'jpg' : type;
      image = { cid, contentType: `image/${type}` as EmbeddedImage['contentType'], filename: `image-${images.size + 1}.${ext}`, base64 };
      images.set(base64, image);
    }
    return `${pre}cid:${image.cid}"`;
  });
  return { html: out, images: [...images.values()] };
}

// ------------------------------------------------------------- frame ---

/** Above the message: a logo and/or a title, on its own background. */
export interface FrameHeader {
  logo?: { src: string; alt?: string; width?: number; href?: string };
  title?: string;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  color?: string;
}

/** Below the message: small print (lines separated by `\n`) and links, e.g. `{{unsubscribeUrl}}`. */
export interface FrameFooter {
  text?: string;
  links?: { text: string; href: string }[];
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  color?: string;
  /** Text size in px (default 13). */
  fontSize?: number;
}

/** What surrounds the message in the email: colours, a header and a footer. Merge fields work in both. */
export interface EmailFrame {
  /** Page background. */
  backgroundColor?: string;
  /** Message background. */
  contentBackgroundColor?: string;
  /** Padding around the message, in px. */
  padding?: number;
  header?: FrameHeader;
  footer?: FrameFooter;
}

const alignAttr = (align: unknown) => (align === 'center' || align === 'right' ? { align } : {});

/** The frame's header and footer as Deltas, rendered with the same (validated, escaped) renderer as the message. */
export function frameDeltas(frame: EmailFrame | undefined): { header?: DeltaLike; footer?: DeltaLike } {
  const out: { header?: DeltaLike; footer?: DeltaLike } = {};
  const h = frame?.header;
  if (h && (h.logo?.src || h.title)) {
    const ops: DeltaOp[] = [];
    const color = normColor(h.color);
    if (h.logo?.src) {
      const width = Math.round(Number(h.logo.width) || 160);
      ops.push({ insert: { image: h.logo.src }, attributes: { alt: h.logo.alt ?? '', width: String(width), ...(h.logo.href ? { link: h.logo.href } : {}) } });
      ops.push({ insert: '\n', attributes: alignAttr(h.align) });
    }
    if (h.title) {
      ops.push({ insert: h.title, attributes: color ? { color } : {} });
      ops.push({ insert: '\n', attributes: { header: 2, ...alignAttr(h.align) } });
    }
    out.header = { ops };
  }
  const f = frame?.footer;
  if (f && (f.text || f.links?.length)) {
    const ops: DeltaOp[] = [];
    const color = normColor(f.color) ?? '#57606a';
    const size = `${normSize(f.fontSize) ?? 13}px`;
    for (const line of (f.text ?? '').split('\n').filter((l) => l.trim())) {
      ops.push({ insert: line, attributes: { color, size } }, { insert: '\n', attributes: alignAttr(f.align) });
    }
    const links = (f.links ?? []).filter((l) => l.text && l.href);
    links.forEach((l, i) => {
      if (i) ops.push({ insert: ' · ', attributes: { color, size } });
      ops.push({ insert: l.text, attributes: { color, size, link: l.href } });
    });
    if (links.length) ops.push({ insert: '\n', attributes: alignAttr(f.align) });
    out.footer = { ops };
  }
  return out;
}

export interface RenderEmailOptions extends ReplaceTokensOptions {
  /** Base text style (as in the editor). */
  style?: Partial<EmailStyle>;
  /** Header, footer and colours around the message, used when a `document` is produced (e.g. a template's frame). */
  frame?: EmailFrame;
  /** Turn embedded (data:) pictures into `cid:` attachments (default true; false keeps them inline, e.g. for previews). */
  attachImages?: boolean;
  /**
   * Merge field values. Without them the output keeps `{{key}}` tokens (a
   * template to merge later, e.g. on the server).
   */
  tokens?: TokenValues;
  /** Wrap the fragment in a complete email document. */
  document?: EmailDocumentOptions;
}

export interface EmailParts {
  /** HTML to send: embedded pictures are `cid:` references to `attachments`. */
  html: string;
  /** Plain-text alternative. */
  text: string;
  /** Pictures to attach inline, each with its Content-ID. */
  attachments: EmbeddedImage[];
}

/**
 * Produce the final email from stored content: merge fields replaced,
 * HTML and plain text rendered, embedded pictures turned into inline
 * attachments. Runs in browsers and on servers (Node, workers).
 */
export function renderEmail(delta: DeltaLike, options: RenderEmailOptions = {}): EmailParts {
  const merge = (d: DeltaLike) => (options.tokens ? replaceTokens(d, options.tokens, options) : d);
  const merged = merge(delta);
  const style = { ...DEFAULT_STYLE, ...options.style };
  let html = deltaToEmailHtml(merged, style);
  let text = deltaToPlainText(merged);
  if (options.document) {
    const parts = frameDeltas(options.frame);
    const header = parts.header && merge(parts.header);
    const footer = parts.footer && merge(parts.footer);
    html = wrapEmailDocument(html, {
      ...documentFrameOptions(options.frame, style),
      header: header && { html: deltaToEmailHtml(header, style), backgroundColor: options.frame?.header?.backgroundColor },
      footer: footer && { html: deltaToEmailHtml(footer, style), backgroundColor: options.frame?.footer?.backgroundColor },
      ...options.document,
    });
    // The plain-text header is its title (a logo adds nothing there).
    const headerText = header && deltaToPlainText({ ops: header.ops.filter((op) => typeof op.insert === 'string') }).trim();
    text = [headerText, text, footer && deltaToPlainText(footer)].filter(Boolean).join('\n\n');
  }
  if (options.attachImages === false) return { html, text, attachments: [] };
  const { html: sendable, images } = extractEmbeddedImages(html);
  return { html: sendable, text, attachments: images };
}

/** Document options from a frame and style: width and colours. */
export interface FrameColors {
  /** Around the message. */
  page: string;
  /** Behind the message. */
  content: string;
  header: string;
  footer: string;
}

/**
 * The colours an email is sent with, validated, with their defaults: page
 * #f4f5f7, message #ffffff, header on the message colour, footer on the
 * page colour. The editor's frame preview uses the same rules.
 */
export function frameColors(colors: { page?: unknown; content?: unknown; header?: unknown; footer?: unknown }): FrameColors {
  const page = normColor(colors.page) ?? '#f4f5f7';
  const content = normColor(colors.content) ?? '#ffffff';
  return { page, content, header: normColor(colors.header) ?? content, footer: normColor(colors.footer) ?? page };
}

/** A frame's colours (see {@link frameColors}). */
export const frameColorsOf = (frame: EmailFrame | undefined): FrameColors =>
  frameColors({ page: frame?.backgroundColor, content: frame?.contentBackgroundColor, header: frame?.header?.backgroundColor, footer: frame?.footer?.backgroundColor });

export function documentFrameOptions(frame: EmailFrame | undefined, style: EmailStyle): EmailDocumentOptions {
  const padding = frame?.padding ?? 24;
  return {
    width: style.maxImageWidth + 2 * padding,
    padding,
    ...(frame?.backgroundColor ? { backgroundColor: frame.backgroundColor } : {}),
    ...(frame?.contentBackgroundColor ? { contentBackgroundColor: frame.contentBackgroundColor } : {}),
  };
}

export interface EmailDocumentOptions {
  /** Content width in px (default 600). */
  width?: number;
  /** Page background (default #f4f5f7). */
  backgroundColor?: string;
  /** Content background (default #ffffff). */
  contentBackgroundColor?: string;
  /** Padding around the content in px (default 24). */
  padding?: number;
  /** Hidden preview text shown by inbox lists. */
  preheader?: string;
  title?: string;
  lang?: string;
  /** Above the message: HTML from {@link deltaToEmailHtml} (see {@link frameDeltas}). */
  header?: { html: string; backgroundColor?: string };
  /** Below the message: HTML from {@link deltaToEmailHtml}. */
  footer?: { html: string; backgroundColor?: string };
}

/**
 * Wrap a fragment in a complete, responsive email document: fluid on phones,
 * a fixed-width "ghost" table for Outlook desktop, no external resources.
 */
export function wrapEmailDocument(fragment: string, options: EmailDocumentOptions = {}): string {
  const width = Math.round(options.width ?? 600);
  const colors = frameColors({
    page: options.backgroundColor,
    content: options.contentBackgroundColor,
    header: options.header?.backgroundColor,
    footer: options.footer?.backgroundColor,
  });
  const bg = colors.page;
  const contentBg = colors.content;
  const pad = Math.max(0, Math.round(options.padding ?? 24));
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(options.lang ?? '') ? options.lang! : 'en';
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${bg};opacity:0;">${escapeText(options.preheader)}</div>`
    : '';
  // Frame: header on the message background (or its own), footer on the page background (or its own).
  const header = options.header?.html
    ? `<tr><td style="padding:${pad}px ${pad}px ${options.header.backgroundColor ? pad : 0}px;background-color:${colors.header};">${options.header.html}</td></tr>\n`
    : '';
  const footer = options.footer?.html
    ? `<tr><td style="padding:${pad}px;background-color:${colors.footer};">${options.footer.html}</td></tr>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeText(options.title ?? '')}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${bg};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso | IE]><table role="presentation" align="center" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${width}px;border-collapse:collapse;background-color:${contentBg};">
${header}<tr><td style="padding:${pad}px;">${fragment}</td></tr>
${footer}</table>
<!--[if mso | IE]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

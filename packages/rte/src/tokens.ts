/**
 * Merge fields ("tokens") such as `{{firstName}}` or `{{firstName|there}}`
 * (with a fallback used when the value is empty or missing).
 *
 * In the editor a token is an atomic chip (`{ insert: { token: { key, fallback } } }`
 * in the Delta) so formatting and editing can never split it; typed or pasted
 * `{{…}}` text becomes a chip too. `getHtml()` keeps tokens as `{{…}}` text, so
 * stored templates can be merged later by this module or on the server.
 *
 * Replacement works on the Delta, before HTML is produced: values are then
 * escaped like any other text and take the token's formatting (bold, colour…).
 */
import type { DeltaLike, DeltaOp } from './render';

/** `{{key}}` or `{{key|fallback}}`; keys are letters, digits, `_`, `-` and `.` (nested values). */
export const TOKEN_PATTERN = /\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\|([^{}]*))?\}\}/g;
const LEADING_TOKEN = new RegExp(`^${TOKEN_PATTERN.source}`);
/** A token just typed (at the end of the text); unlike pasted text, its fallback cannot span lines. */
export const TRAILING_TOKEN = /\{\{\s*([A-Za-z_][\w.-]*)\s*(?:\|([^{}\n]*))?\}\}$/;
/** A usable token key: letters, digits, `_`, `-`, `.`, not starting with a digit. */
export const isTokenKey = (key: string) => /^[A-Za-z_][\w.-]*$/.test(key);

export interface Token {
  key: string;
  fallback?: string;
}

/** Values by key (nested objects allowed: `customer.firstName`), or a lookup function. */
export type TokenValues = Record<string, unknown> | ((key: string) => unknown);

export interface ReplaceTokensOptions {
  /**
   * A token with no value and no fallback: `'empty'` (default) removes it,
   * `'keep'` leaves the `{{key}}` text (useful for previews), `'error'` throws
   * a {@link MissingTokenError} listing every such key.
   */
  missing?: 'empty' | 'keep' | 'error';
}

export class MissingTokenError extends Error {
  constructor(readonly keys: string[]) {
    super(`No value for ${keys.map((k) => `{{${k}}}`).join(', ')}`);
    this.name = 'MissingTokenError';
  }
}

/** The text form of a token: `{{key}}` or `{{key|fallback}}`. */
export function tokenText(token: Token): string {
  return token.fallback ? `{{${token.key}|${token.fallback}}}` : `{{${token.key}}}`;
}

/** A token embed's value, validated (null when it is not a usable token). */
export function asToken(value: unknown): Token | null {
  if (!value || typeof value !== 'object') return null;
  const { key, fallback } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !isTokenKey(key)) return null;
  const fb = typeof fallback === 'string' ? fallback.replace(/[{}]/g, '').trim() : '';
  return fb ? { key, fallback: fb } : { key };
}

const toToken = (key: string, fallback?: string): Token => (fallback?.trim() ? { key, fallback: fallback.trim() } : { key });
const matches = (text: string) => [...text.matchAll(TOKEN_PATTERN)].map((m) => ({ m, token: toToken(m[1], m[2]) }));

type Embed = Record<string, unknown>;
const embedOf = (op: DeltaOp, type: 'section' | 'button') => (op.insert && typeof op.insert === 'object' ? (op.insert[type] as Embed | undefined) : undefined);
/** A section op with each column transformed. */
const mapColumns = (op: DeltaOp, section: Embed, fn: (ops: DeltaOp[]) => DeltaOp[]): DeltaOp => ({
  ...op,
  insert: { section: { ...section, columns: (Array.isArray(section.columns) ? section.columns : []).map((c) => fn(Array.isArray(c) ? c : [])) } },
});

/** Split text containing `{{…}}` into text and token-embed ops with the same attributes (also inside columns). */
export function tokensToEmbeds(delta: DeltaLike): DeltaLike {
  const ops: DeltaOp[] = [];
  for (const op of delta.ops ?? []) {
    const section = embedOf(op, 'section');
    if (section) {
      ops.push(mapColumns(op, section, (c) => tokensToEmbeds({ ops: c }).ops));
      continue;
    }
    if (typeof op.insert !== 'string' || !op.insert.includes('{{')) {
      ops.push(op);
      continue;
    }
    let last = 0;
    const attrs = op.attributes ? { attributes: op.attributes } : {};
    for (const { m, token } of matches(op.insert)) {
      if (m.index! > last) ops.push({ insert: op.insert.slice(last, m.index), ...attrs });
      ops.push({ insert: { token }, ...attrs });
      last = m.index! + m[0].length;
    }
    if (last < op.insert.length) ops.push({ insert: op.insert.slice(last), ...attrs });
  }
  return { ops };
}

/** Keys used in the content (chips, `{{…}}` text, links, image descriptions, columns, buttons), in order, once each. */
export function findTokens(delta: DeltaLike): string[] {
  const keys = new Set<string>();
  const scan = (s: unknown) => typeof s === 'string' && matches(s).forEach(({ token }) => keys.add(token.key));
  const visit = (ops: DeltaOp[]) => {
    for (const op of ops) {
      const token = typeof op.insert === 'object' ? asToken(op.insert?.token) : null;
      if (token) keys.add(token.key);
      const section = embedOf(op, 'section');
      if (section && Array.isArray(section.columns)) section.columns.forEach((c) => Array.isArray(c) && visit(c));
      const button = embedOf(op, 'button');
      if (button) {
        scan(button.text);
        scan(button.href);
      }
      scan(op.insert);
      scan(op.attributes?.link);
      scan(op.attributes?.alt);
    }
  };
  visit(delta.ops ?? []);
  return [...keys];
}

function lookup(values: TokenValues, key: string): unknown {
  if (typeof values === 'function') return values(key);
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  let v: unknown = values;
  for (const part of key.split('.')) {
    if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, part)) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

/**
 * Replace tokens with values: chips, `{{…}}` text, and tokens in link
 * addresses (URL-encoded, except a token that starts the address, e.g.
 * `{{unsubscribeUrl}}` or `{{site}}/account`) and image descriptions.
 * Values are plain text (line breaks become spaces); they are escaped when
 * the HTML is rendered, and a link that does not end up as
 * http(s)/mailto/tel is dropped by the renderer.
 */
export function replaceTokens(delta: DeltaLike, values: TokenValues, options: ReplaceTokensOptions = {}): DeltaLike {
  const missingKeys = new Set<string>();
  /** The value to insert, or null to keep the token (missing: 'keep'). */
  const valueOf = (token: Token): string | null => {
    const raw = lookup(values, token.key);
    const text = typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean' ? String(raw) : '';
    const value = (text || token.fallback || '').replace(/\s*[\r\n]+\s*/g, ' ');
    if (value || (raw !== undefined && raw !== null)) return value;
    missingKeys.add(token.key);
    return options.missing === 'keep' ? null : '';
  };
  const inText = (s: string) => s.replace(TOKEN_PATTERN, (whole, key: string, fallback?: string) => valueOf(toToken(key, fallback)) ?? whole);
  // A token that starts the address is its base (`{{unsubscribeUrl}}`, `{{site}}/account`)
  // and is used as is; tokens later in the address are URL-encoded.
  const inLink = (href: string) => {
    let rest = href.trim();
    let base = '';
    const lead = rest.match(LEADING_TOKEN);
    if (lead) {
      const v = valueOf(toToken(lead[1], lead[2]));
      base = v === null ? lead[0] : v.trim();
      rest = rest.slice(lead[0].length);
    }
    return (
      base +
      rest.replace(TOKEN_PATTERN, (whole, key: string, fallback?: string) => {
        const v = valueOf(toToken(key, fallback));
        return v === null ? whole : encodeURIComponent(v);
      })
    );
  };

  /** One op with its tokens replaced; null when a token becomes nothing. */
  const mergeOp = (op: DeltaOp): DeltaOp | null => {
    const section = embedOf(op, 'section');
    if (section) return mapColumns(op, section, merge);
    const button = embedOf(op, 'button');
    if (button) {
      const text = typeof button.text === 'string' ? inText(button.text) : button.text;
      const href = typeof button.href === 'string' ? inLink(button.href) : button.href;
      return { ...op, insert: { button: { ...button, text, href } } };
    }
    let attributes = op.attributes;
    if (attributes && (typeof attributes.link === 'string' || typeof attributes.alt === 'string')) {
      attributes = { ...attributes };
      if (typeof attributes.link === 'string') attributes.link = inLink(attributes.link);
      if (typeof attributes.alt === 'string') attributes.alt = inText(attributes.alt);
    }
    const attrs = attributes ? { attributes } : {};
    const token = op.insert && typeof op.insert === 'object' ? asToken(op.insert.token) : null;
    if (token) {
      const value = valueOf(token) ?? tokenText(token);
      return value ? { insert: value, ...attrs } : null;
    }
    if (typeof op.insert === 'string') return { insert: inText(op.insert), ...attrs };
    return { ...op, ...attrs };
  };
  const merge = (source: DeltaOp[]): DeltaOp[] => source.map(mergeOp).filter((op): op is DeltaOp => op !== null);
  const ops = merge(delta.ops ?? []);
  if (options.missing === 'error' && missingKeys.size) throw new MissingTokenError([...missingKeys]);
  return { ops };
}

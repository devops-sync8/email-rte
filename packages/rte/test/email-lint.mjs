// Email-safety lint: what the editor emits must stay within markup and CSS
// that Outlook desktop (Word renderer), Outlook on the web and Gmail support.
const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's', 'sub', 'sup', 'span', 'a', 'br', 'img', 'table', 'tr', 'td', 'div']);
const ATTRS = {
  '*': new Set(['style']),
  a: new Set(['href', 'target']),
  img: new Set(['src', 'alt', 'width']),
  ol: new Set(['type']),
  table: new Set(['role', 'width', 'cellpadding', 'cellspacing', 'border']),
  td: new Set(['width', 'valign', 'align', 'bgcolor']),
};
const CSS = new Set([
  'margin', 'padding', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
  'text-align', 'text-decoration', 'list-style-type', 'border', 'border-left', 'border-top', 'border-collapse',
  'width', 'max-width', 'height', 'outline', 'vertical-align',
  // Columns (inline-block, stacking on phones) and buttons
  'display', 'border-radius', 'mso-padding-alt',
]);

/**
 * Returns a list of problems (empty when the HTML is email-safe).
 * `{ sending: true }` also rejects data: images (they must be cid: when sent)
 * and merge fields left unreplaced; templates may link to `{{field}}`.
 */
export function lintEmailHtml(html, { sending = false } = {}) {
  const problems = [];
  if (sending && /src="data:/i.test(html)) problems.push('data: image in HTML to be sent');
  if (sending && /\{\{/.test(html)) problems.push('unreplaced merge field');
  if (/<style|<script|<link|<iframe|<svg|\s(class|id|on\w+)="/i.test(html)) problems.push('forbidden construct');
  // Divs only as columns (inline-block); everything else is tables and text blocks.
  for (const m of html.matchAll(/<div(\s[^>]*)?>/gi)) if (!/display:inline-block/.test(m[1] ?? '')) problems.push('div other than a column');
  // Conditional comments only for Outlook (the column ghost table).
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) if (!/^\[if mso\]>|^<!\[endif\]$/.test(m[1])) problems.push(`comment ${m[1].slice(0, 30)}`);
  for (const m of html.matchAll(/<([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/gi)) {
    const tag = m[1].toLowerCase();
    if (!TAGS.has(tag)) problems.push(`tag <${tag}>`);
    for (const a of m[2].matchAll(/([a-z-]+)="([^"]*)"/gi)) {
      const name = a[1].toLowerCase();
      if (!ATTRS['*'].has(name) && !ATTRS[tag]?.has(name)) problems.push(`attribute ${name} on <${tag}>`);
      if (name === 'href' && !(sending ? /^(https?:\/\/|mailto:|tel:)/i : /^(https?:\/\/|mailto:|tel:|\{\{)/i).test(a[2])) problems.push(`href ${a[2]}`);
      // Stored/preview HTML may embed images as data:; sending HTML uses cid: (see extractEmbeddedImages).
      if (name === 'src' && !/^(https?:\/\/|cid:|data:image\/(png|jpeg|gif);base64,)/i.test(a[2])) problems.push(`src ${a[2].slice(0, 40)}`);
      if (name === 'style') {
        for (const decl of a[2].split(';').filter(Boolean)) {
          const prop = decl.split(':')[0].trim().toLowerCase();
          if (!CSS.has(prop)) problems.push(`css ${prop} on <${tag}>`);
          if (/url\(|expression\(|javascript:/i.test(decl)) problems.push(`css value ${decl}`);
        }
      }
    }
  }
  // Every text block states its own font, size and colour (Outlook does not inherit reliably).
  for (const m of html.matchAll(/<(p|li|h[1-3])\s+style="([^"]*)"/g)) {
    for (const prop of ['font-family', 'font-size', 'color', 'margin']) {
      if (!m[2].includes(`${prop}:`)) problems.push(`<${m[1]}> without ${prop}`);
    }
  }
  return problems;
}

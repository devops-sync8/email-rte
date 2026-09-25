// Vite/Rollup plugin that removes hard-coded third-party CDN URLs from
// dependency code (web font stylesheets, placeholder image hosts) so the bundled output never references external hosts.
//
// Repo-only build tool (deliberately not shipped: it has to name the hosts).
// Usage (vite.config.js):
//   import { stripCdnUrls } from '../tools/vite-plugin-strip-cdn.mjs';
//   export default { plugins: [stripCdnUrls()] };

export const BLOCKED_HOSTS = [
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'via.placeholder.com',
  'source.unsplash.com',
  'cloud.githubusercontent.com',
  'app.grapesjs.com',
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches a full URL (optionally protocol-relative) up to the closing quote,
// whitespace or paren, so the surrounding string literal stays valid.
export const BLOCKED_URL_RE = new RegExp(
  `(?:https?:)?//(?:${BLOCKED_HOSTS.map(escape).join('|')})[^"'\`\\s)\\\\]*`,
  'g',
);

export function stripCdnUrls() {
  return {
    name: 'email-rte:strip-cdn-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(m?[jt]sx?|css)$/.test(id.split('?')[0])) return null;
      BLOCKED_URL_RE.lastIndex = 0;
      if (!BLOCKED_URL_RE.test(code)) return null;
      BLOCKED_URL_RE.lastIndex = 0;
      return { code: code.replace(BLOCKED_URL_RE, ''), map: null };
    },
    renderChunk(code) {
      BLOCKED_URL_RE.lastIndex = 0;
      if (!BLOCKED_URL_RE.test(code)) return null;
      BLOCKED_URL_RE.lastIndex = 0;
      return { code: code.replace(BLOCKED_URL_RE, ''), map: null };
    },
  };
}

export default stripCdnUrls;

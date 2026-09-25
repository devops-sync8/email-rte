// Serves the repo root and opens test/harness.html in Chromium (desktop or phone emulation).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium, devices } from 'playwright';

/** A solid-colour PNG of the given size. */
export function png(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function openHarness({ mobile = false, page: pagePath = '/packages/rte/test/harness.html' } = {}) {
  const server = http.createServer(async (req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const context = await browser.newContext(
    mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 900 } },
  );
  const page = await context.newPage();
  const externalRequests = [];
  const pageErrors = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    // *.example.com is answered locally by the route below.
    if (url.protocol.startsWith('http') && url.origin !== origin && !url.hostname.endsWith('.example.com')) externalRequests.push(r.url());
  });
  // Web images used by tests are answered locally so nothing leaves the machine:
  // - images.example.com: an 800x20 PNG the page may show but not download (no CORS);
  // - cors.example.com/<w>x<h>.png: a PNG of that size that may be downloaded (CORS);
  // - tracker.example.com: a 1x1 tracking pixel (CORS allowed, to prove it is still dropped).
  await context.route('https://*.example.com/**', (route) => {
    const url = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.hostname === 'images.example.com') {
      // Playwright's fulfilled responses skip the CORS check, so refuse script downloads the way a browser would.
      if (route.request().resourceType() === 'fetch') return route.abort('accessdenied');
      return route.fulfill({ contentType: 'image/png', body: png(800, 20) });
    }
    if (url.hostname === 'tracker.example.com') return route.fulfill({ contentType: 'image/png', headers: cors, body: png(1, 1) });
    const size = url.hostname === 'cors.example.com' && url.pathname.match(/^\/(\d+)x(\d+)\.png$/);
    if (size) return route.fulfill({ contentType: 'image/png', headers: cors, body: png(Number(size[1]), Number(size[2])) });
    return route.fulfill({ status: 404, body: '' });
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}${pagePath}`);
  await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30_000 });

  return {
    page,
    origin,
    externalRequests,
    pageErrors,
    async close() {
      await browser.close();
      server.close();
    },
  };
}

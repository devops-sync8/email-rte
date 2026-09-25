/**
 * Image helpers for pasting and inserting: read clipboard/device images,
 * pull Word's pictures out of the clipboard's RTF, fetch web images, and
 * make every image email-ready (PNG/JPEG/GIF, sensible pixel width).
 */

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const type = head.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Value of a hex digit's char code (0-9, a-f, A-F). */
const hexDigit = (c: number) => (c <= 57 ? c - 48 : (c | 32) - 87);

/**
 * Pictures in clipboard RTF, in document order, as data: URLs (null for a
 * picture in a format email cannot use, such as EMF, so later pictures stay
 * in step).
 *
 * Word puts each picture in the HTML flavour only as a local file:// path a
 * web page cannot read, but the RTF flavour carries the image data as hex in
 * `{\pict … \pngblip|\jpegblip … <hex>}` groups. Word also adds a WMF copy
 * of each picture for old readers (`{\nonshppict{\pict … \wmetafile …}}`);
 * those are skipped, so the result lines up with the HTML's <img> elements.
 */
export function rtfImages(rtf: string): (string | null)[] {
  if (!rtf || !rtf.includes('\\pict')) return [];
  const out: (string | null)[] = [];
  const word = /\\([a-z]+)(-?\d+)? ?|\\./giy;
  let i = 0;
  while ((i = rtf.indexOf('{\\pict', i)) >= 0) {
    const legacyCopy = /\\nonshppict\s*$/.test(rtf.slice(Math.max(0, i - 24), i));
    // Walk the group: control words and hex data at its own level; nested groups (properties, ids) are skipped.
    const words = new Set<string>();
    const hex: string[] = [];
    let depth = 0;
    let j = i;
    for (; j < rtf.length; j++) {
      const c = rtf[j];
      if (c === '{') depth++;
      else if (c === '}') {
        if (--depth === 0) break;
      } else if (depth === 1) {
        if (c === '\\') {
          word.lastIndex = j;
          const m = word.exec(rtf);
          if (m?.[1]) words.add(m[1]);
          j = (m ? word.lastIndex : j + 1) - 1;
        } else if (/[\da-f]/i.test(c)) {
          const run = /[\da-f\s]+/iy;
          run.lastIndex = j;
          run.exec(rtf);
          hex.push(rtf.slice(j, run.lastIndex));
          j = run.lastIndex - 1;
        }
      }
    }
    i = j + 1;
    if (legacyCopy) continue;
    const type = words.has('pngblip') ? 'png' : words.has('jpegblip') ? 'jpeg' : null;
    const data = hex.join('').replace(/\s+/g, '');
    if (!type || words.has('bin') || data.length < 16 || data.length % 2) {
      out.push(null);
      continue;
    }
    const bytes = new Uint8Array(data.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = (hexDigit(data.charCodeAt(2 * k)) << 4) | hexDigit(data.charCodeAt(2 * k + 1));
    out.push(`data:image/${type};base64,${bytesToBase64(bytes)}`);
  }
  return out;
}

/** Download a web image as a data: URL, when the site allows it (CORS). */
export async function fetchImageAsDataUrl(
  url: string,
  { timeoutMs = 6000, maxBytes = 10 * 1024 * 1024, signal }: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {},
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size > maxBytes) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null; // blocked by CORS, offline, timed out, cancelled…
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * Make an embedded image email-ready: PNG, JPEG or GIF (Outlook cannot show
 * WebP, BMP, SVG…), and at most `maxPixelWidth` wide (big photos and
 * screenshots are scaled down; 2× the display width stays sharp on high-DPI
 * screens). Returns null when the data is not a readable image.
 */
export async function normalizeImage(dataUrl: string, maxPixelWidth: number): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const img = await loadImage(dataUrl);
  if (!img) return null;
  const type = dataUrl.match(/^data:image\/([a-z+.-]+)/i)?.[1]?.toLowerCase() ?? '';
  const supported = type === 'png' || type === 'jpeg' || type === 'jpg' || type === 'gif';
  if (supported && img.naturalWidth <= maxPixelWidth) return { dataUrl: dataUrl.replace(/^data:image\/jpg/, 'data:image/jpeg'), width: img.naturalWidth, height: img.naturalHeight };

  const width = Math.min(img.naturalWidth, maxPixelWidth);
  const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const photo = type === 'jpeg' || type === 'jpg';
  if (photo) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: photo ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png'), width, height };
}

// Images arriving by paste: Word pictures (from the clipboard's RTF), screenshots,
// web images, and how they are embedded, uploaded or sent (cid: attachments).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness, png } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';

let h;
before(async () => {
  h = await openHarness();
  // A second editor without an upload service: images are embedded in the content.
  await h.page.evaluate(() => {
    window.makeEditor = (opts = {}) => {
      window.embedEd?.destroy();
      document.getElementById('embed-host')?.remove();
      const host = document.createElement('div');
      host.id = 'embed-host';
      document.body.appendChild(host);
      window.embedEd = window.rte.createRichTextEditor(host, opts);
      return window.embedEd;
    };
  });
});
after(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.page.evaluate(() => {
    window.ed.setHtml('');
    window.uploads.length = 0;
    window.uploadDelay = 0;
    window.makeEditor();
  });
});

const hex = (buf) => buf.toString('hex').replace(/(.{128})/g, '$1\r\n');
/** RTF the way Word puts pictures on the clipboard: a PNG/JPEG/EMF copy plus a legacy WMF copy. */
function wordRtf(pictures) {
  const pict = ({ type, data }) =>
    `{\\*\\shppict{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}}\\picscalex100\\picscaley100\\picw2117\\pich529\\picwgoal1200\\pichgoal300\\${type}\\bliptag-1293846{\\*\\blipuid b2e2a1f2c3d4e5f60718293a4b5c6d7e}${hex(data)}}}` +
    `{\\nonshppict{\\pict\\picscalex100\\picscaley100\\picw2117\\pich529\\picwgoal1200\\pichgoal300\\wmetafile8\\bliptag-1293846\\blipupi96 010009000003${'00'.repeat(40)}}}`;
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\pard\\plain Before ${pictures.map(pict).join(' Middle ')} After\\par}`;
}
const wordHtml = (count) =>
  `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><p class=MsoNormal>Before ${Array.from(
    { length: count },
    (_, i) =>
      `<!--[if gte vml 1]><v:shape id="Picture_${i}"><v:imagedata src="file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image00${i + 1}.png" o:title=""/></v:shape><![endif]--><![if !vml]><img width=${i === 2 ? 700 : 40} height=10 src="file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image00${i + 1}.png" alt="Picture ${i + 1}" v:shapes="Picture_${i}"><![endif]>`,
  ).join(' Middle ')} After<o:p></o:p></p><!--EndFragment--></body></html>`;

/** Paste into an editor (`ed` has uploadImage, `embedEd` does not) and wait for images to be processed. */
function paste(editor, { html, text, rtf, files = [] }) {
  return h.page.evaluate(
    async ({ editor, html, text, rtf, files }) => {
      const e = window[editor];
      e.focus();
      const data = new DataTransfer();
      if (html) data.setData('text/html', html);
      if (text) data.setData('text/plain', text);
      if (rtf) data.setData('text/rtf', rtf);
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], f.name, { type: f.type }));
      }
      e.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      const busyDuringPaste = e.isBusy();
      await e.whenIdle();
      return { html: e.getHtml(), busyDuringPaste, notice: e.root.querySelector('.erte-notice:not([hidden])')?.textContent ?? '' };
    },
    { editor, html, text, rtf, files },
  );
}
const file = (name, type, buf) => ({ name, type, base64: buf.toString('base64') });
/** Natural sizes of the images in an HTML string, measured in the page. */
const sizes = (html) =>
  h.page.evaluate(async (html) => {
    const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
    return Promise.all(srcs.map((src) => new Promise((r) => {
      const i = new Image();
      i.onload = () => r([i.naturalWidth, i.naturalHeight]);
      i.onerror = () => r(null);
      i.src = src;
    })));
  }, html);

test('Word: pictures come from the clipboard RTF, in order; the legacy WMF copies are ignored', async () => {
  const rtf = wordRtf([
    { type: 'pngblip', data: png(40, 10) },
    { type: 'emfblip', data: Buffer.alloc(64, 1) }, // e.g. a chart: no usable format
    { type: 'pngblip', data: png(1400, 20) },
  ]);
  const { html, notice } = await paste('embedEd', { html: wordHtml(3), text: 'Before Middle Middle After', rtf });
  const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 2, html);
  assert.match(imgs[0], /^<img src="data:image\/png;base64,[^"]+" alt="Picture 1" width="40"/);
  assert.match(imgs[1], /^<img src="data:image\/png;base64,[^"]+" alt="Picture 3" width="600"/, 'Word size 700 capped at the content width');
  assert.deepEqual(await sizes(html), [[40, 10], [1200, 17]], 'big pictures are scaled to 2x the content width');
  assert.ok(!/file:|clip_image|wmetafile/.test(html));
  assert.match(notice, /could not be pasted/i, 'the reader is told a picture was left out');
  assert.deepEqual(lintEmailHtml(html), []);
});

test('Word: with uploadImage the pictures are uploaded and linked', async () => {
  const { html } = await paste('ed', { html: wordHtml(1), rtf: wordRtf([{ type: 'pngblip', data: png(40, 10) }]) });
  assert.deepEqual(await h.page.evaluate(() => window.uploads), ['image.png']);
  assert.ok(html.includes('<img src="https://images.example.com/image.png" alt="Picture 1" width="40"') && !html.includes('data:'), html);
});

test('Word without RTF (e.g. Firefox): pictures are left out with a notice, text is kept', async () => {
  const { html, notice } = await paste('embedEd', { html: wordHtml(1) });
  assert.ok(!html.includes('<img') && html.includes('Before') && html.includes('After'), html);
  assert.match(notice, /could not be pasted/i);
});

test('screenshots: embedded without an upload service, uploaded with one', async () => {
  const shot = file('image.png', 'image/png', png(300, 40));
  const embedded = await paste('embedEd', { files: [shot] });
  assert.ok(embedded.busyDuringPaste, 'isBusy() while the image is processed');
  assert.match(embedded.html, /<img src="data:image\/png;base64,[^"]+" alt="image" width="300"/);
  const uploaded = await paste('ed', { files: [shot] });
  assert.ok(uploaded.html.includes('<img src="https://images.example.com/image.png" alt="image" width="300"'), uploaded.html);
  assert.deepEqual(await h.page.evaluate(() => window.uploads), ['image.png']);
});

test('WebP and other formats are converted to PNG/JPEG, which Outlook can show', async () => {
  const webp = await h.page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 30;
    c.getContext('2d').fillRect(0, 0, 120, 30);
    return c.toDataURL('image/webp');
  });
  assert.ok(webp.startsWith('data:image/webp'));
  const fromFile = await paste('embedEd', { files: [{ name: 'shot.webp', type: 'image/webp', base64: webp.split(',')[1] }] });
  assert.match(fromFile.html, /<img src="data:image\/png;base64,[^"]+" alt="shot" width="120"/);
  const fromHtml = await paste('embedEd', { html: `<p>x <img src="${webp}" alt="w"></p>` });
  assert.equal((fromHtml.html.match(/data:image\/png/g) ?? []).length, 2);
  assert.ok(!fromHtml.html.includes('webp'));
});

test('web images: downloaded and embedded when the site allows it, otherwise kept as links; tracking pixels dropped', async () => {
  const html = [
    '<p>Chart <img src="https://cors.example.com/300x50.png" alt="Chart">',
    ' Photo <img src="https://images.example.com/photo.png" width="320" alt="Photo">',
    ' Wide <img src="https://cors.example.com/2000x100.png" alt="Wide">',
    ' <img src="https://tracker.example.com/open.png">',
    ' <img src="https://cors.example.com/300x50.png" width="1" height="1"></p>',
  ].join('');
  const { html: out } = await paste('embedEd', { html });
  const imgs = [...out.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.equal(imgs.length, 3, out);
  assert.match(imgs[0], /^<img src="data:image\/png;base64,[^"]+" alt="Chart" width="300"/);
  assert.match(imgs[1], /^<img src="https:\/\/images\.example\.com\/photo\.png" alt="Photo" width="320"/, 'no CORS: stays a link');
  assert.match(imgs[2], /^<img src="data:image\/png;base64,[^"]+" alt="Wide" width="600"/);
  assert.deepEqual((await sizes(out))[2], [1200, 60]);
  assert.ok(!out.includes('tracker'));
});

test("pastedImages: 'drop' leaves pictures out of pastes", async () => {
  await h.page.evaluate(() => window.makeEditor({ pastedImages: 'drop' }));
  const word = await paste('embedEd', { html: wordHtml(1), rtf: wordRtf([{ type: 'pngblip', data: png(40, 10) }]) });
  assert.ok(!word.html.includes('<img') && word.html.includes('Before'));
  const shot = await paste('embedEd', { files: [file('image.png', 'image/png', png(30, 30))] });
  assert.ok(!shot.html.includes('<img'));
  const web = await paste('embedEd', { html: '<p>A <img src="https://cors.example.com/300x50.png"></p>' });
  assert.ok(!web.html.includes('<img'));
});

test('getEmail(): embedded pictures are sent as inline attachments referenced by cid:', async () => {
  await paste('embedEd', { files: [file('a.png', 'image/png', png(300, 40)), file('b.png', 'image/png', png(200, 40))] });
  const email = await h.page.evaluate(() => window.embedEd.getEmail());
  const doc = await h.page.evaluate(() => window.embedEd.getEmail({ document: { title: 'Hi' } }));
  assert.ok(doc.html.startsWith('<!DOCTYPE html>') && !doc.html.includes('data:') && doc.attachments.length === 2);
  assert.equal(email.attachments.length, 2);
  for (const a of email.attachments) {
    assert.equal(a.contentType, 'image/png');
    assert.ok(email.html.includes(`src="cid:${a.cid}"`));
    assert.ok(Buffer.from(a.base64, 'base64').subarray(1, 4).toString() === 'PNG');
  }
  assert.deepEqual(lintEmailHtml(email.html, { sending: true }), []);
  assert.equal(typeof email.text, 'string');
  // Content with linked images only: nothing to attach.
  const linked = await h.page.evaluate(() => {
    window.embedEd.setHtml('<p><img src="https://images.example.com/a.png" width="100"></p>');
    return window.embedEd.getEmail();
  });
  assert.deepEqual(linked.attachments, []);
});

test('pasting pictures can be cancelled from the notice: the text is pasted without them', async () => {
  await h.page.evaluate(() => (window.uploadDelay = 5000));
  try {
    const result = await h.page.evaluate(async (html) => {
      const e = window.ed;
      e.focus();
      const data = new DataTransfer();
      data.setData('text/html', html);
      e.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const notice = e.root.querySelector('.erte-notice');
      const shown = [notice.hidden, notice.querySelector('span').textContent, notice.querySelector('button').textContent];
      notice.querySelector('button').click();
      await e.whenIdle();
      return { shown, html: e.getHtml(), aborted: window.uploadSignals.at(-1)?.aborted, after: notice.textContent };
    }, '<p>Text stays <img src="https://cors.example.com/300x50.png" alt="Chart"></p>');
    assert.deepEqual(result.shown, [false, 'Adding images…', 'Cancel']);
    assert.ok(result.html.includes('Text stays') && !result.html.includes('<img'), result.html);
    assert.equal(result.aborted, true);
    assert.match(result.after, /left out/);
  } finally {
    await h.page.evaluate(() => (window.uploadDelay = 0));
  }
});

test('pasted screenshots can be cancelled too', async () => {
  await h.page.evaluate(() => (window.uploadDelay = 5000));
  try {
    const out = await h.page.evaluate(async (base64) => {
      const e = window.ed;
      e.focus();
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'shot.png', { type: 'image/png' }));
      e.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      e.root.querySelector('.erte-notice button').click();
      await e.whenIdle();
      return e.getHtml();
    }, png(30, 30).toString('base64'));
    assert.ok(!out.includes('<img'), out);
  } finally {
    await h.page.evaluate(() => (window.uploadDelay = 0));
  }
});

test('no page errors, and only the test image hosts were contacted', () => {
  assert.deepEqual(h.pageErrors, []);
  assert.deepEqual(h.externalRequests, []);
});

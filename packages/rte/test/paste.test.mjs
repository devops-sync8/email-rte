import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openHarness } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');

let h;
before(async () => {
  h = await openHarness();
});
after(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.page.evaluate(() => {
    window.ed.setHtml('');
    window.ed.focus();
  });
});

/** Deliver a paste event the way a browser does after Ctrl/Cmd+V. */
async function paste({ html, text }) {
  return h.page.evaluate(
    async ({ html, text }) => {
      const data = new DataTransfer();
      if (html) data.setData('text/html', html);
      if (text) data.setData('text/plain', text);
      window.ed.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      await window.ed.whenIdle();
      return window.ed.getHtml();
    },
    { html, text },
  );
}

test('Word (Windows): headings, emphasis, links, colour, size, highlight, alignment and fonts survive', async () => {
  const out = await paste({ html: fixture('word-windows'), text: 'fallback' });
  assert.match(out, /^<h1 style="[^"]*font-size:28px;[^"]*"><span style="color:#2f5496;">Quarterly update<\/span><\/h1>/, 'Word Heading 1 → heading, keeps its colour');
  assert.ok(out.includes('<strong>summary</strong> with <em>notes</em>, <u>underlined</u> text and a <a href="https://example.com/report"'));
  assert.ok(out.includes('<span style="font-size:19px;line-height:150%;color:#c00000;">Big red text</span>'), 'Word 14pt dark red');
  assert.ok(out.includes('<span style="background-color:#ffff00;">highlighted words</span>'), 'Word highlight');
  assert.ok(out.includes(' and explicit default.</p>'), "Word's default size/colour does not override the template");
  assert.match(out, /text-align:center;[^"]*">Centred line in <span style="font-family:Georgia, 'Times New Roman', Times, serif;">Georgia<\/span> and Calibri Light<\/p>/, 'centred; email-safe font kept, Calibri falls back to the base font');
  assert.ok(!/Mso|mso-|o:p|font-family:[^;"]*Calibri|class=|file:|clip_image/.test(out));
  assert.deepEqual(lintEmailHtml(out), []);
});

test('Word (Windows): list paragraphs become real nested bulleted and numbered lists', async () => {
  await paste({ html: fixture('word-windows') });
  const text = await h.page.evaluate(() => window.ed.getText());
  assert.ok(text.includes(['• First bullet', '   • Nested bullet', '• Second bold bullet', '1. Step one', '2. Step two'].join('\n')), text);
  const out = await h.page.evaluate(() => window.ed.getHtml());
  assert.ok(out.includes('<li style="margin:0 0 4px 0;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:150%;color:#1f2328;">Second <strong>bold</strong> bullet</li>'));
});

test('Word (Mac): lettered lists and nested colour', async () => {
  await paste({ html: fixture('word-mac') });
  assert.equal(await h.page.evaluate(() => window.ed.getText()), ['1. Alpha', '   1. Blue roman sub-item', '2. Beta'].join('\n'));
  assert.ok((await h.page.evaluate(() => window.ed.getHtml())).includes('<span style="color:#0070c0;">Blue roman sub-item</span>'));
});

test('Google Docs: its 11pt black Arial defaults are dropped, real formatting kept', async () => {
  const out = await paste({ html: fixture('google-docs') });
  assert.ok(out.includes('Plain docs text with <strong>bold</strong><em> italic </em>'), out);
  assert.ok(out.includes('<span style="font-size:24px;line-height:150%;color:#38761d;background-color:#fff2cc;"><u>green big highlighted underlined</u></span>'));
  assert.equal((await h.page.evaluate(() => window.ed.getText())).split('\n').slice(1).join('\n'), ['• Docs bullet', '   • Docs nested'].join('\n'));
});

test('hostile web page: nothing executable, no tracking pixels, only safe links', async () => {
  const out = await paste({ html: fixture('web-hostile') });
  for (const bad of ['script', 'onclick', 'onerror', 'javascript:', 'iframe', 'svg', 'tracker', '__pwned']) assert.ok(!out.includes(bad), `contains ${bad}`);
  assert.ok(out.includes('href="mailto:hi@example.com"') && out.includes('href="https://example.com"'));
  assert.ok(out.includes('Cell A Cell B'), 'tables become paragraphs');
  assert.match(out, /<h2 [^>]*>(<span[^>]*>)?Web heading/, 'a web page heading stays a heading');
  assert.equal(await h.page.evaluate(() => window.__pwned ?? null), null);
  assert.deepEqual(lintEmailHtml(out), []);
});

// Security review: a pasted link that only starts with a merge field must not hide another scheme.
test('pasted links: a merge field address is kept, one hiding another scheme is not', async () => {
  const out = await paste({
    html: '<p>Read more href="<a href="{{zz}}javascript:alert(document.domain)">here</a> and <a href="{{site}}/account">account</a></p>',
  });
  assert.ok(!/javascript|\{\{zz\}\}/.test(out), out);
  assert.ok(out.includes('href="{{site}}/account"'), out);
  assert.ok(!(await h.page.evaluate(() => JSON.stringify(window.ed.getDelta()))).includes('javascript'), 'not in the stored Delta either');
});

test('plain text keeps line breaks and shows markup as text', async () => {
  const out = await paste({ text: 'Line <b>one</b>\nLine two' });
  assert.ok(out.includes('>Line &lt;b&gt;one&lt;/b&gt;</p>') && out.includes('>Line two</p>'), out);
});

test('pasting this editor’s own output keeps it unchanged', async () => {
  await paste({ html: fixture('word-windows') });
  const first = await h.page.evaluate(() => window.ed.getHtml());
  await h.page.evaluate(() => window.ed.setHtml(''));
  const second = await paste({ html: first });
  assert.equal(second, first);
});

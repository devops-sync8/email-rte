// Merge fields: {{key}} tokens in templates, replaced before the email is produced.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deltaToEmailHtml, deltaToPlainText, replaceTokens, renderEmail, findTokens, tokensToEmbeds, MissingTokenError } from '../dist/render.js';
import { openHarness } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';

const P = 'margin:0 0 0 0;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:150%;color:#1f2328;';
const chip = (key, fallback, attributes) => ({ insert: { token: fallback ? { key, fallback } : { key } }, ...(attributes ? { attributes } : {}) });

// ------------------------------------------------------------ render ---

test('templates keep tokens as {{key}} text, with their formatting', () => {
  const delta = { ops: [{ insert: 'Hi ' }, chip('firstName', 'there', { bold: true }), { insert: ', from ' }, chip('company'), { insert: '\n' }] };
  assert.equal(deltaToEmailHtml(delta), `<p style="${P}">Hi <strong>{{firstName|there}}</strong>, from {{company}}</p>`);
  assert.equal(deltaToPlainText(delta), 'Hi {{firstName|there}}, from {{company}}');
  assert.deepEqual(findTokens({ ops: [...delta.ops, { insert: 'x', attributes: { link: 'https://x.test/{{id}}' } }, { insert: ' {{company}} {{ plan }}\n' }] }), ['firstName', 'company', 'id', 'plan']);
});

test('values are escaped, take the token formatting, and support nesting, numbers and fallbacks', () => {
  const delta = {
    ops: [
      chip('user.name', undefined, { bold: true, color: '#c00000' }),
      { insert: ' / ' },
      chip('nickname', 'friend'),
      { insert: ' / {{count}} / {{ note }} / {{missing}}!\n' },
    ],
  };
  const merged = replaceTokens(delta, { user: { name: '<b>Ann & Co</b>' }, nickname: '', count: 3, note: 'line one\nline two' });
  assert.equal(
    deltaToEmailHtml(merged),
    `<p style="${P}"><span style="color:#c00000;"><strong>&lt;b&gt;Ann &amp; Co&lt;/b&gt;</strong></span> / friend / 3 / line one line two / !</p>`,
  );
  assert.equal(deltaToPlainText(merged), '<b>Ann & Co</b> / friend / 3 / line one line two / !');
});

test("missing values: 'empty' (default) removes, 'keep' leaves the token, 'error' lists every missing key", () => {
  const delta = { ops: [chip('a'), { insert: ' {{b}} {{c|C}}\n' }] };
  assert.equal(deltaToPlainText(replaceTokens(delta, {})), '  C');
  assert.equal(deltaToPlainText(replaceTokens(delta, {}, { missing: 'keep' })), '{{a}} {{b}} C');
  assert.throws(() => replaceTokens(delta, {}, { missing: 'error' }), (e) => e instanceof MissingTokenError && e.keys.join() === 'a,b');
  assert.equal(deltaToPlainText(replaceTokens(delta, (k) => k.toUpperCase(), { missing: 'error' })), 'A B C', 'lookup function');
  assert.equal(deltaToPlainText(replaceTokens({ ops: [{ insert: '{{toString}} {{__proto__}}\n' }] }, {})), ' ', 'no prototype lookups');
});

test('links: a whole-address token takes the value; tokens inside an address are URL-encoded; unsafe results are dropped', () => {
  const delta = {
    ops: [
      { insert: 'Unsubscribe', attributes: { link: '{{unsubscribeUrl}}' } },
      { insert: ' ' },
      { insert: 'Account', attributes: { link: 'https://example.com/a?u={{email}}&n={{name}}' } },
      { insert: ' ' },
      { insert: 'Bad', attributes: { link: '{{evil}}' } },
      { insert: ' ' },
      { insert: 'Site', attributes: { link: '{{site}}/account?ref={{ref}}' } },
      { insert: '\n' },
    ],
  };
  const template = deltaToEmailHtml(delta);
  assert.ok(template.includes('<a href="{{unsubscribeUrl}}"') && template.includes('href="https://example.com/a?u={{email}}&amp;n={{name}}"'));
  assert.deepEqual(lintEmailHtml(template), []);
  const html = deltaToEmailHtml(replaceTokens(delta, { unsubscribeUrl: 'https://example.com/u?t=1&x=2', email: 'ann+1@example.com', name: 'A B', evil: 'javascript:alert(1)', site: 'https://app.example.com', ref: 'a/b' }));
  assert.ok(html.includes('href="https://app.example.com/account?ref=a%2Fb"'), 'a leading token is the base address');
  assert.ok(html.includes('<a href="https://example.com/u?t=1&amp;x=2"'), html);
  assert.ok(html.includes('href="https://example.com/a?u=ann%2B1%40example.com&amp;n=A%20B"'), html);
  assert.ok(!html.includes('javascript:') && html.includes('</a> Bad <a '), 'unsafe link dropped, text kept');
  assert.deepEqual(lintEmailHtml(html, { sending: true }), []);
});

test('invalid token values in a Delta are dropped, never rendered', () => {
  const html = deltaToEmailHtml({ ops: [{ insert: { token: { key: '<script>' } } }, { insert: { token: 'x' } }, { insert: { token: { key: 'ok', fallback: '}}<b>' } } }, { insert: '\n' }] });
  assert.equal(html, `<p style="${P}">{{ok|&lt;b&gt;}}</p>`);
});

test('tokensToEmbeds turns {{…}} text into chips with the text formatting', () => {
  assert.deepEqual(tokensToEmbeds({ ops: [{ insert: 'Hi {{ name | you }}!', attributes: { italic: true } }] }).ops, [
    { insert: 'Hi ', attributes: { italic: true } },
    { insert: { token: { key: 'name', fallback: 'you' } }, attributes: { italic: true } },
    { insert: '!', attributes: { italic: true } },
  ]);
});

test('renderEmail: merge, render, attach pictures; without values the output stays a template', () => {
  const delta = { ops: [{ insert: 'Hi ' }, chip('firstName', 'there'), { insert: { image: 'data:image/png;base64,iVBORw0KGgo=' } }, { insert: '\n' }] };
  const email = renderEmail(delta, { tokens: { firstName: 'Ann' }, document: { title: 'Hello' } });
  assert.ok(email.html.includes('>Hi Ann<img src="cid:') && email.html.startsWith('<!DOCTYPE html>'));
  assert.equal(email.text, 'Hi Ann[image]');
  assert.equal(email.attachments.length, 1);
  assert.ok(renderEmail(delta).html.includes('Hi {{firstName|there}}'));
});

// ------------------------------------------------------------ editor ---

let h;
before(async () => {
  h = await openHarness();
});
after(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.page.evaluate(() => {
    window.fieldEd?.destroy();
    document.getElementById('field-host')?.remove();
    const host = document.createElement('div');
    host.id = 'field-host';
    document.body.prepend(host);
    window.fieldChanges = [];
    window.fieldEd = window.rte.createRichTextEditor(host, {
      toolbar: 'standard',
      fields: [
        { key: 'firstName', label: 'First name' },
        { key: 'company', label: 'Company' },
        { key: 'unsubscribeUrl', label: 'Unsubscribe link' },
      ],
      onChange: (v) => window.fieldChanges.push(v.html),
    });
    window.fieldEd.focus();
  });
});
const ed = (fn, arg) => h.page.evaluate(fn, arg);
const F = '#field-host .erte';

test('"Insert field" menu lists the fields by name and inserts a chip with the current formatting', async () => {
  await h.page.keyboard.press('ControlOrMeta+b');
  await h.page.keyboard.type('Hi ');
  await h.page.click(`${F} .ql-field .ql-picker-label`);
  const items = await h.page.$$eval(`${F} .ql-field .ql-picker-item`, (els) => els.map((e) => e.getAttribute('data-label')));
  assert.deepEqual(items, ['First name', 'Company', 'Unsubscribe link']);
  assert.equal(await h.page.getAttribute(`${F} .ql-field .ql-picker-label`, 'aria-label'), 'Insert field');
  await h.page.click(`${F} .ql-field .ql-picker-item[data-value="firstName"]`);
  await h.page.keyboard.type('!');
  const chip = await h.page.$eval(`${F} .erte-token`, (el) => [el.getAttribute('data-label'), getComputedStyle(el, '::before').content, el.title]);
  assert.deepEqual(chip, ['First name', '"First name"', '{{firstName}}']);
  assert.equal(await ed(() => window.fieldEd.getHtml()), `<p style="${P}"><strong>Hi {{firstName}}!</strong></p>`);
  assert.deepEqual(await ed(() => window.fieldEd.getTokens()), ['firstName']);
  assert.ok((await ed(() => window.fieldChanges.at(-1))).includes('{{firstName}}'), 'onChange reports it');
});

test('typing {{key}} or {{key|fallback}} makes a chip; a chip is deleted as a whole', async () => {
  await h.page.keyboard.type('Hi {{firstName|there}}, from {{ company }}.');
  assert.equal(await h.page.locator(`${F} .erte-token`).count(), 2);
  assert.equal(await ed(() => window.fieldEd.getText()), 'Hi {{firstName|there}}, from {{company}}.');
  await h.page.keyboard.press('Backspace'); // "."
  await h.page.keyboard.press('Backspace'); // the company chip
  assert.equal(await ed(() => window.fieldEd.getText()), 'Hi {{firstName|there}}, from ');
});

test('loaded and pasted {{key}} text becomes chips; unknown keys show the key', async () => {
  await ed(() => window.fieldEd.setHtml('<p>Dear {{firstName}}, your plan: <em>{{plan}}</em></p>'));
  assert.deepEqual(await h.page.$$eval(`${F} .erte-token`, (els) => els.map((e) => [e.dataset.key, e.dataset.label])), [['firstName', 'First name'], ['plan', 'plan']]);
  await ed(() => {
    window.fieldEd.quill.setSelection(window.fieldEd.quill.getLength() - 1, 0);
    const data = new DataTransfer();
    data.setData('text/plain', ' Ref {{ref}}');
    window.fieldEd.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.deepEqual(await ed(() => window.fieldEd.getTokens()), ['firstName', 'plan', 'ref']);
  assert.ok((await ed(() => window.fieldEd.getHtml())).includes('<em>{{plan}}</em> Ref {{ref}}'));
});

test('getEmail({ tokens }) produces the final email; getHtml() stays the template', async () => {
  await ed(() => window.fieldEd.setHtml('<p>Hi {{firstName|there}} at {{company}}. <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>'));
  const email = await ed(() => window.fieldEd.getEmail({ tokens: { firstName: 'Ann <3', company: 'Acme', unsubscribeUrl: 'https://example.com/u?id=1&t=2' } }));
  assert.ok(email.html.includes('Hi Ann &lt;3 at Acme. <a href="https://example.com/u?id=1&amp;t=2"'), email.html);
  assert.equal(email.text, 'Hi Ann <3 at Acme. Unsubscribe (https://example.com/u?id=1&t=2)');
  assert.deepEqual(lintEmailHtml(email.html, { sending: true }), []);
  const fallback = await ed(() => window.fieldEd.getEmail({ tokens: { company: 'Acme' } }));
  assert.ok(fallback.html.includes('Hi there at Acme.') && !fallback.html.includes('href='), 'fallback used; link without an address dropped');
  const error = await ed(() => {
    try {
      window.fieldEd.getEmail({ tokens: {}, missing: 'error' });
    } catch (e) {
      return [e.name, e.keys];
    }
  });
  assert.deepEqual(error, ['MissingTokenError', ['company', 'unsubscribeUrl']]);
  assert.ok((await ed(() => window.fieldEd.getHtml())).includes('Hi {{firstName|there}} at {{company}}. <a href="{{unsubscribeUrl}}"'));
});

test('copying chips copies their {{key}} text, which pastes back as chips', async () => {
  await ed(() => window.fieldEd.setHtml('<p>A {{company}} B</p>'));
  const copied = await ed(() => {
    const q = window.fieldEd.quill;
    q.setSelection(0, q.getLength() - 1);
    const data = new DataTransfer();
    q.root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return [data.getData('text/html'), data.getData('text/plain')];
  });
  assert.ok(copied[0].includes('{{company}}'), copied[0]);
  await ed((html) => {
    const q = window.fieldEd.quill;
    q.setSelection(q.getLength() - 1, 0);
    const data = new DataTransfer();
    data.setData('text/html', html);
    q.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, copied[0]);
  assert.deepEqual(await ed(() => window.fieldEd.getTokens()), ['company']);
  assert.equal(await h.page.locator(`${F} .erte-token`).count(), 2);
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
});

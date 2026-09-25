// Templates in the editor: a frame (header, footer, colours) plus starting content and style.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';

let h;
before(async () => {
  h = await openHarness();
  await h.page.evaluate(() => {
    window.makeTemplateEditor = (opts = {}) => {
      window.te?.destroy();
      document.getElementById('th')?.remove();
      const host = document.createElement('div');
      host.id = 'th';
      document.body.prepend(host);
      window.teChanges = [];
      window.te = window.rte.createRichTextEditor(host, {
        templates: window.rte.TEMPLATES,
        onChange: (v) => window.teChanges.push(v),
        ...opts,
      });
      return true;
    };
  });
});
after(async () => {
  await h?.close();
});

const T = '#th .erte';
const pickTemplate = async (id) => {
  await h.page.click(`${T} .ql-template .ql-picker-label`);
  await h.page.click(`${T} .ql-template .ql-picker-item[data-value="${id}"]`);
};

test('the Template menu lists the templates; a template given at start loads its content and frame', async () => {
  await h.page.evaluate(() => window.makeTemplateEditor({ template: 'newsletter' }));
  const items = await h.page.$$eval(`${T} .ql-template .ql-picker-item`, (els) => els.map((e) => e.getAttribute('data-label')));
  assert.deepEqual(items, ['Plain', 'Newsletter', 'Announcement']);
  assert.equal(await h.page.getAttribute(`${T} .ql-template .ql-picker-label`, 'data-erte-label'), 'Newsletter');
  assert.match(await h.page.textContent(`${T} .erte-frame--header`), /Your company newsletter/, 'merge fields show their fallback');
  assert.match(await h.page.textContent(`${T} .erte-frame--footer`), /Unsubscribe/);
  const value = await h.page.evaluate(() => window.te.getValue());
  assert.equal(value.template, 'newsletter');
  assert.ok(value.delta.ops.some((op) => op.insert?.section), 'starting content with columns');
  assert.ok(value.delta.ops.some((op) => op.insert?.token?.key === 'firstName'), 'merge fields as chips');
});

test('choosing a template in an empty editor loads its content (undoable); with content, it asks first', async () => {
  await h.page.evaluate(() => window.makeTemplateEditor());
  assert.ok(await h.page.isHidden(`${T} .erte-frame--header`));
  await h.page.click(`${T} .ql-editor`);
  await pickTemplate('announcement');
  assert.match(await h.page.textContent(`${T} .ql-editor`), /Something new is here/);
  assert.equal(await h.page.evaluate(() => window.teChanges.at(-1).template), 'announcement');
  await h.page.click(`${T} button.ql-undo`);
  assert.equal(await h.page.evaluate(() => window.te.getText()), '', 'undo removes the starting content');

  await h.page.click(`${T} .ql-editor`);
  await h.page.keyboard.type('My own message');
  await pickTemplate('newsletter');
  assert.equal(await h.page.evaluate(() => window.te.getText()), 'My own message', 'content kept');
  assert.match(await h.page.textContent(`${T} .erte-frame--header`), /newsletter/, 'frame changes at once');
  assert.match(await h.page.textContent(`${T} .erte-notice`), /Replace the message/);
  await h.page.click(`${T} .erte-notice__action`);
  assert.match(await h.page.evaluate(() => window.te.getText()), /What is new this month/);
});

test('getEmail with a document uses the frame: header, footer, colours, merged fields; lint-clean', async () => {
  await h.page.evaluate(() => window.makeTemplateEditor({ template: 'newsletter' }));
  const email = await h.page.evaluate(() =>
    window.te.getEmail({ document: { title: 'News' }, tokens: { firstName: 'Ann', company: 'Acme', unsubscribeUrl: 'https://x.test/u' }, missing: 'error' }),
  );
  assert.ok(email.html.includes('Acme newsletter') && email.html.includes('Hi Ann,') && email.html.includes('updates from Acme.'));
  assert.ok(email.html.includes('<a href="https://x.test/u"'));
  assert.ok(email.html.includes('background-color:#1f3a5f;') && email.html.includes('background-color:#eef1f5;'));
  assert.ok(email.text.startsWith('Acme newsletter\n\nWhat is new this month') && email.text.endsWith('Unsubscribe (https://x.test/u)'));
  const fragment = await h.page.evaluate(() => window.te.getEmail({ tokens: { firstName: 'Ann', company: 'Acme' } }));
  assert.ok(!fragment.html.includes('newsletter</span>'), 'a fragment has no frame');
  assert.deepEqual(lintEmailHtml(fragment.html, { sending: true }), []);
  const preview = await h.page.evaluate(() => window.te.getEmailDocument({ title: 'x' }));
  assert.ok(preview.includes('{{company|Your company}} newsletter'), 'preview document keeps merge fields for later');
});

test('setTemplate: style and content width apply; null removes the frame; custom templates with HTML content', async () => {
  await h.page.evaluate(() =>
    window.makeTemplateEditor({
      templates: [
        {
          id: 'narrow',
          name: 'Narrow',
          style: { maxImageWidth: 480, linkColor: '#c00000' },
          frame: { footer: { text: 'Custom footer' } },
          content: '<p>From <strong>HTML</strong></p>',
        },
      ],
    }),
  );
  await h.page.evaluate(() => window.te.setTemplate('narrow'));
  assert.equal(await h.page.evaluate(() => window.te.getHtml()).then((x) => x.includes('From <strong>HTML</strong>')), true);
  assert.equal(await h.page.evaluate(() => getComputedStyle(window.te.root).getPropertyValue('--erte-link').trim()), '#c00000');
  await h.page.evaluate(() => window.te.insertColumns('1-1'));
  const html = await h.page.evaluate(() => window.te.getHtml());
  assert.ok(html.includes('<table role="presentation" width="480"'), 'columns use the template width');
  const doc = await h.page.evaluate(() => window.te.getEmail({ document: {} }).html);
  assert.ok(doc.includes('max-width:528px') && doc.includes('Custom footer'), 'document width: content + padding');
  await h.page.evaluate(() => window.te.setTemplate(null));
  assert.equal(await h.page.evaluate(() => window.te.getTemplate()), undefined);
  assert.ok(await h.page.isHidden(`${T} .erte-frame--footer`));
  assert.ok(!(await h.page.evaluate(() => window.te.getEmail({ document: {} }).html)).includes('Custom footer'));
  assert.ok((await h.page.evaluate(() => window.te.getHtml())).includes('From <strong>HTML</strong>'), 'content kept');
});

test('the frame preview uses the colours the email is sent with (defaults and invalid values too)', async () => {
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const check = async (id, expected) => {
    await h.page.evaluate((id) => window.te.setTemplate(id, { content: 'keep' }), id);
    const shown = await h.page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('#th .erte-frame--header')).backgroundColor,
      footer: getComputedStyle(document.querySelector('#th .erte-frame--footer')).backgroundColor,
      content: getComputedStyle(document.querySelector('#th .erte > .ql-container')).backgroundColor,
    }));
    assert.deepEqual(shown, { header: rgb(expected.header), footer: rgb(expected.footer), content: rgb(expected.content) }, id);
    const html = await h.page.evaluate(() => window.te.getEmail({ document: {} }).html);
    for (const c of Object.values(expected)) assert.ok(html.includes(`background-color:${c};`), `${id}: ${c} in the email`);
  };
  await h.page.evaluate(() =>
    window.makeTemplateEditor({
      templates: [
        ...window.rte.TEMPLATES,
        { id: 'odd', name: 'Odd', frame: { backgroundColor: 'url(x)', contentBackgroundColor: '#fafafa', header: { title: 'T', backgroundColor: 'nope' }, footer: { text: 'F' } } },
      ],
    }),
  );
  await check('newsletter', { header: '#1f3a5f', footer: '#eef1f5', content: '#ffffff' });
  await check('announcement', { header: '#ffffff', footer: '#f4f5f7', content: '#ffffff' });
  await check('odd', { header: '#fafafa', footer: '#f4f5f7', content: '#fafafa' });
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
});

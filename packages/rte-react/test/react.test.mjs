import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness } from '../../rte/test/harness.mjs';

let h;
before(async () => {
  h = await openHarness({ page: '/packages/rte-react/test/dist/index.html' });
  await h.page.waitForSelector('.erte .ql-editor');
});
after(async () => {
  await h?.close();
});

test('mounts once under StrictMode with the initial value and base style', async () => {
  assert.equal(await h.page.locator('.erte').count(), 1, 'StrictMode double-mount leaves one editor');
  // No onChange on mount (a pristine form stays pristine); the editor normalises what it loaded.
  assert.equal(await h.page.textContent('#html'), '<p>Initial <strong>content</strong></p>');
  const html = await h.page.evaluate(() => window.app.handle.editor.getHtml());
  assert.ok(html.includes("font-family:Georgia, 'Times New Roman', Times, serif;font-size:15px") && html.includes('<strong>content</strong>'));
});

test('typing calls onChange with email HTML (controlled round trip)', async () => {
  await h.page.click('.erte .ql-editor');
  await h.page.keyboard.press('ControlOrMeta+End');
  await h.page.keyboard.type(' more');
  await h.page.waitForFunction(() => document.querySelector('#html').textContent.includes(' more'));
  assert.equal(await h.page.evaluate(() => window.app.handle.editor.getText()), 'Initial content more');
  assert.equal(await h.page.evaluate(() => document.querySelectorAll('.erte').length), 1);
});

test('changing the value prop from outside updates the editor without echoing onChange', async () => {
  const before = await h.page.evaluate(() => window.app.lastChange);
  await h.page.evaluate(() => window.app.setValue('<p>Replaced</p>'));
  await h.page.waitForFunction(() => window.app.handle.editor.getText() === 'Replaced');
  assert.equal(await h.page.evaluate(() => window.app.lastChange), before);
});

test('readOnly prop and ref handle', async () => {
  await h.page.evaluate(() => window.app.setReadOnly(true));
  await h.page.waitForFunction(() => document.querySelector('.erte').classList.contains('erte--readonly'));
  await h.page.evaluate(() => window.app.setReadOnly(false));
  const value = await h.page.evaluate(() => window.app.handle.getValue());
  assert.equal(value.text, 'Replaced');
});

test('merge fields: "Insert field" menu, {{key}} in the value, getEmail({ tokens })', async () => {
  await h.page.evaluate(() => window.app.setValue('<p>Hi</p>'));
  await h.page.waitForFunction(() => window.app.handle.editor.getText() === 'Hi');
  await h.page.click('.erte .ql-editor');
  await h.page.keyboard.press('ControlOrMeta+End');
  await h.page.keyboard.type(' ');
  await h.page.click('.erte .ql-field .ql-picker-label');
  await h.page.click('.erte .ql-field .ql-picker-item[data-value="firstName"]');
  await h.page.waitForFunction(() => document.querySelector('#html').textContent.includes('Hi {{firstName}}'));
  const email = await h.page.evaluate(() => window.app.handle.editor.getEmail({ tokens: { firstName: 'Ann' } }));
  assert.ok(email.html.includes('>Hi Ann</p>'), email.html);
});

test('layouts and templates: Columns menu, Button, Template menu with frame and starting content', async () => {
  assert.equal(await h.page.locator('.erte .ql-picker.ql-layout').count(), 1);
  assert.equal(await h.page.locator('.erte button.ql-button').count(), 1);
  await h.page.evaluate(() => window.app.handle.editor.setTemplate('newsletter', { content: 'replace' }));
  await h.page.waitForFunction(() => window.app.handle.editor.getDelta().ops.some((op) => op.insert?.section));
  assert.match(await h.page.textContent('.erte .erte-frame--header'), /newsletter/);
  const email = await h.page.evaluate(() => window.app.handle.editor.getEmail({ document: {}, tokens: { firstName: 'Ann', company: 'Acme' } }));
  assert.ok(email.html.includes('Acme newsletter') && email.html.includes('display:inline-block'));
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
});

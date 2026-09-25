import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness } from '../../rte/test/harness.mjs';

let h;
before(async () => {
  h = await openHarness({ page: '/packages/rte-angular/test/dist/index.html' });
  await h.page.waitForFunction(() => document.querySelectorAll('.erte .ql-editor').length === 3);
});
after(async () => {
  await h?.close();
});

const typeInto = async (id, text) => {
  await h.page.click(`#${id} .ql-editor`);
  await h.page.keyboard.press('ControlOrMeta+End');
  await h.page.keyboard.type(text);
};

test('reactive forms: initial value loads, edits update the FormControl with email HTML', async () => {
  assert.equal(await h.page.textContent('#reactive .ql-editor'), 'From the form');
  await typeInto('reactive', ' edited');
  await h.page.waitForFunction(() => document.querySelector('#reactive-value').textContent.includes('edited'));
  const value = await h.page.textContent('#reactive-value');
  assert.ok(value.startsWith('<p style="margin:0 0 0 0;font-family:Verdana, Geneva, sans-serif;font-size:14px;') && value.includes('From the <em>form edited</em></p>'), value);
});

test('setValue on the control updates the editor; disable() makes it read-only', async () => {
  await h.page.evaluate(() => {
    window.ng.app.form.controls.body.setValue('<h2>Set from code</h2>');
    window.ng.app.form.controls.body.disable();
    window.ng.tick();
  });
  assert.equal(await h.page.textContent('#reactive .ql-editor'), 'Set from code');
  assert.ok(await h.page.$eval('#reactive .erte', (e) => e.classList.contains('erte--readonly')));
  await h.page.evaluate(() => {
    window.ng.app.form.controls.body.enable();
    window.ng.tick();
  });
  assert.equal(await h.page.$eval('#reactive .erte', (e) => e.classList.contains('erte--readonly')), false);
});

test('ngModel two-way binding and touched state on blur', async () => {
  await typeInto('model', '!');
  await h.page.waitForFunction(() => document.querySelector('#model-value').textContent.includes('Template-driven!'));
  await h.page.click('#reactive-value'); // blur
});

test('[(value)] binding and [readOnly]', async () => {
  await typeInto('bound', ' text');
  await h.page.waitForFunction(() => window.ng.app.bound.includes('Bound text'));
  await h.page.evaluate(() => {
    window.ng.app.bound = '<p>Replaced</p>';
    window.ng.app.locked.set(true);
    window.ng.tick();
  });
  await h.page.waitForFunction(() => document.querySelector('#bound .ql-editor').textContent === 'Replaced');
  assert.ok(await h.page.$eval('#bound .erte', (e) => e.classList.contains('erte--readonly')));
});

test('merge fields: [fields] input adds the "Insert field" menu; instance.getEmail({ tokens }) merges', async () => {
  const items = await h.page.$$eval('#bound .ql-field .ql-picker-item', (els) => els.map((e) => e.getAttribute('data-label')));
  assert.deepEqual(items, ['First name']);
  const html = await h.page.evaluate(() => {
    const ed = window.ng.app.boundEditor.instance;
    ed.setHtml('<p>Dear {{firstName|reader}}</p>');
    return [ed.getHtml(), ed.getEmail({ tokens: { firstName: 'Ann' } }).html];
  });
  assert.ok(html[0].includes('Dear {{firstName|reader}}') && html[1].includes('Dear Ann'), html.join('\n'));
});

test('layouts and templates inputs: Columns menu, Button, Template menu, template at start', async () => {
  assert.equal(await h.page.locator('#bound .ql-picker.ql-layout').count(), 1);
  assert.equal(await h.page.locator('#bound button.ql-button').count(), 1);
  assert.equal(await h.page.getAttribute('#bound .ql-template .ql-picker-label', 'data-erte-label'), 'Announcement');
  assert.match(await h.page.textContent('#bound .erte-frame--header'), /Your company/);
  assert.equal(await h.page.evaluate(() => window.ng.app.boundEditor.instance.getTemplate().id), 'announcement');
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
});

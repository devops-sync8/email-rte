import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness } from './harness.mjs';

// Pixel 7 emulation in Chromium: touch events, 412px viewport, mobile user agent.
let h;
before(async () => {
  h = await openHarness({ mobile: true });
});
after(async () => {
  await h?.close();
});

const visible = (sel) => h.page.isVisible(`.erte .ql-toolbar ${sel}`);

test('fits the phone screen: no sideways scrolling', async () => {
  const [inner, scroll, editorWidth] = await h.page.evaluate(() => [innerWidth, document.documentElement.scrollWidth, document.querySelector('.erte').getBoundingClientRect().right]);
  assert.equal(scroll, inner);
  assert.ok(editorWidth <= inner);
});

test('narrow editors show the essentials plus "More formatting"', async () => {
  for (const sel of ['button.ql-undo', '.ql-header', 'button.ql-bold', 'button.ql-italic', 'button.ql-underline', 'button.ql-list[value="bullet"]', 'button.ql-list[value="ordered"]', 'button.ql-link', 'button.erte-more']) {
    assert.ok(await visible(sel), `${sel} visible`);
  }
  for (const sel of ['.ql-font', '.ql-size', 'button.ql-strike', '.ql-color', 'button.ql-image']) assert.equal(await visible(sel), false, `${sel} hidden`);
  const toolbarHeight = await h.page.$eval('.erte .ql-toolbar', (t) => t.getBoundingClientRect().height);
  assert.ok(toolbarHeight < 110, `compact toolbar is ${toolbarHeight}px tall`);
  await h.page.tap('.erte button.erte-more');
  assert.equal(await h.page.getAttribute('.erte button.erte-more', 'aria-expanded'), 'true');
  for (const sel of ['.ql-font', '.ql-size', 'button.ql-strike', '.ql-color', 'button.ql-image']) assert.ok(await visible(sel), `${sel} shown after More`);
  await h.page.tap('.erte button.erte-more');
});

test('touch targets are at least 36px', async () => {
  const sizes = await h.page.$$eval('.erte .ql-toolbar button', (bs) => bs.filter((b) => b.offsetParent).map((b) => [b.offsetWidth, b.offsetHeight]));
  assert.ok(sizes.length > 5 && sizes.every(([w, hgt]) => w >= 36 && hgt >= 36), JSON.stringify(sizes));
});

test('tap to type and format; the selection survives tapping the toolbar', async () => {
  await h.page.tap('.erte .ql-editor');
  await h.page.keyboard.type('Hello from a phone');
  await h.page.evaluate(() => window.ed.quill.setSelection(11, 7, 'user')); // "a phone"
  await h.page.tap('.erte button.ql-bold');
  await h.page.tap('.erte button.ql-list[value="bullet"]');
  assert.equal(await h.page.evaluate(() => window.ed.getText()), '• Hello from a phone');
  assert.ok((await h.page.evaluate(() => window.ed.getHtml())).includes('<strong>a phone</strong>'));
  assert.equal(await h.page.evaluate(() => document.activeElement?.classList.contains('ql-editor')), true, 'editor keeps focus (keyboard stays open)');
});

test('pickers and the link box stay on screen', async () => {
  await h.page.tap('.erte .ql-header .ql-picker-label');
  const menu = await h.page.$eval('.erte .ql-header .ql-picker-options', (m) => m.getBoundingClientRect().toJSON());
  assert.ok(menu.left >= 0 && menu.right <= 412, JSON.stringify(menu));
  await h.page.tap('.erte .ql-header .ql-picker-item:not([data-value])');
  await h.page.evaluate(() => window.ed.quill.setSelection(0, 5, 'user'));
  await h.page.tap('.erte button.ql-link');
  const box = await h.page.$eval('.erte .ql-tooltip', (t) => t.getBoundingClientRect().toJSON());
  assert.ok(box.left >= 0 && box.right <= 412, `link box ${JSON.stringify(box)}`);
  const fontSize = await h.page.$eval('.erte .ql-tooltip input', (i) => getComputedStyle(i).fontSize);
  assert.equal(fontSize, '16px', 'inputs are 16px so iOS does not zoom');
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
  assert.deepEqual(h.externalRequests, []);
});

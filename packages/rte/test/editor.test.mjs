import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness, png } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';
import { KITCHEN_SINK } from './kitchen-sink.mjs';

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
    window.changes.length = 0;
    window.ed.focus();
  });
});

const tb = (sel) => `.erte .ql-toolbar ${sel}`;
const pick = async (picker, value) => {
  await h.page.click(tb(`.ql-${picker} .ql-picker-label`));
  const item = value ? `[data-value="${value}"]` : ':not([data-value])';
  await h.page.click(tb(`.ql-${picker} .ql-picker-item${item}`));
};
const typeText = (t) => h.page.keyboard.type(t);
const selectAll = () => h.page.keyboard.press('ControlOrMeta+a');
const selectRange = (index, length) => h.page.evaluate(([i, l]) => window.ed.quill.setSelection(i, l, 'user'), [index, length]);
const html = () => h.page.evaluate(() => window.ed.getHtml());

test('toolbar offers the standard formatting controls, each with an accessible name', async () => {
  const labels = await h.page.$$eval('.erte .ql-toolbar button, .erte .ql-toolbar .ql-picker-label', (els) => els.map((e) => e.getAttribute('aria-label')));
  for (const l of ['Undo', 'Redo', 'Paragraph style', 'Font', 'Text size', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Subscript', 'Superscript', 'Text colour', 'Highlight colour', 'Alignment', 'Bulleted list', 'Numbered list', 'Decrease indent', 'Increase indent', 'Quote', 'Link', 'Image', 'Horizontal line', 'Clear formatting']) {
    assert.ok(labels.includes(l), `missing ${l}`);
  }
  assert.equal(await h.page.getAttribute('.erte .ql-toolbar', 'role'), 'toolbar');
  assert.equal(await h.page.getAttribute('.erte .ql-editor', 'role'), 'textbox');
});

test('headings, fonts, sizes, colours and highlight from the toolbar', async () => {
  await typeText('Heading');
  await pick('header', '1');
  await h.page.keyboard.press('End');
  await h.page.keyboard.press('Enter');
  await typeText('Serif big red marked');
  await selectRange(8, 5); // "Serif"
  await pick('font', 'georgia');
  await selectRange(14, 3); // "big"
  await pick('size', '24px');
  await selectRange(18, 3); // "red"
  await pick('color', '#e60000');
  await selectRange(22, 6); // "marked"
  await pick('background', '#ffff00');
  const out = await html();
  assert.match(out, /^<h1 style="[^"]*font-size:28px;[^"]*font-weight:bold;[^"]*">Heading<\/h1>/);
  assert.ok(out.includes("<span style=\"font-family:Georgia, 'Times New Roman', Times, serif;\">Serif</span>"), out);
  assert.ok(out.includes('<span style="font-size:24px;line-height:150%;">big</span>'));
  assert.ok(out.includes('<span style="color:#e60000;">red</span>'));
  assert.ok(out.includes('<span style="background-color:#ffff00;">marked</span>'));
  assert.deepEqual(lintEmailHtml(out), []);
});

test('bold, italic, underline, strikethrough, sub/superscript and clear formatting', async () => {
  await typeText('B I U S x2 y2 plain');
  for (const [index, len, sel] of [[0, 1, 'button.ql-bold'], [2, 1, 'button.ql-italic'], [4, 1, 'button.ql-underline'], [6, 1, 'button.ql-strike'], [9, 1, 'button.ql-script[value="sub"]'], [12, 1, 'button.ql-script[value="super"]']]) {
    await selectRange(index, len);
    await h.page.click(tb(sel));
  }
  let out = await html();
  for (const frag of ['<strong>B</strong>', '<em>I</em>', '<u>U</u>', '<s>S</s>', 'x<sub>2</sub>', 'y<sup>2</sup>']) assert.ok(out.includes(frag), `${frag} in ${out}`);
  await selectAll();
  await h.page.click(tb('button.ql-clean'));
  out = await html();
  assert.ok(!/<strong>|<em>|<u>|<s>|<sub>|<sup>/.test(out), out);
});

test('alignment, quote, divider and paragraph indent', async () => {
  await typeText('Centred');
  await pick('align', 'center');
  await h.page.keyboard.press('Enter');
  await typeText('Justified');
  await pick('align', 'justify');
  await h.page.keyboard.press('Enter');
  await pick('align', '');
  await typeText('A quote');
  await h.page.click(tb('button.ql-blockquote'));
  await h.page.keyboard.press('Enter');
  await h.page.click(tb('button.ql-blockquote'));
  await h.page.click(tb('button.ql-divider'));
  await typeText('Indented');
  await h.page.click(tb('button.ql-indent[value="+1"]'));
  const out = await html();
  assert.ok(out.includes('text-align:center;') && out.includes('text-align:justify;'));
  assert.match(out, /<td style="border-left:3px solid #d0d7de;padding:0 0 0 12px;"><p [^>]*>A quote<\/p><\/td>/);
  assert.ok(out.includes('border-top:1px solid #d0d7de'), 'divider');
  assert.match(out, /<p style="margin:0 0 0 24px;[^"]*">Indented<\/p>$/);
  assert.deepEqual(lintEmailHtml(out), []);
});

test('lists: buttons, Enter, Tab/Shift+Tab and the indent buttons build nested lists', async () => {
  await h.page.click(tb('button.ql-list[value="bullet"]'));
  await typeText('One');
  await h.page.keyboard.press('Enter');
  await typeText('Nested');
  await h.page.keyboard.press('Tab');
  await h.page.keyboard.press('Enter');
  await typeText('Deeper');
  await h.page.click(tb('button.ql-indent[value="+1"]'));
  await h.page.keyboard.press('Enter');
  await h.page.keyboard.press('Shift+Tab');
  await h.page.keyboard.press('Shift+Tab');
  await typeText('Two');
  await h.page.keyboard.press('Enter');
  await h.page.keyboard.press('Enter'); // empty item ends the list
  await h.page.click(tb('button.ql-list[value="ordered"]'));
  await typeText('Step');
  const text = await h.page.evaluate(() => window.ed.getText());
  assert.equal(text, ['• One', '   • Nested', '      • Deeper', '• Two', '1. Step'].join('\n'));
  const out = await html();
  assert.match(out, /^<ul [^>]*list-style-type:disc;"><li [^>]*>One<ul [^>]*circle;"><li [^>]*>Nested<ul [^>]*square;"><li [^>]*>Deeper<\/li><\/ul><\/li><\/ul><\/li><li [^>]*>Two<\/li><\/ul><ol type="1"/);
});

test('links: add through the link box; unsafe protocols are neutralised', async () => {
  await typeText('Read the report');
  await selectRange(9, 6);
  await h.page.click(tb('button.ql-link'));
  await h.page.fill('.erte .ql-tooltip[data-mode="link"] input', 'https://example.com/report');
  await h.page.keyboard.press('Enter');
  await h.page.evaluate(() => {
    window.ed.quill.formatText(0, 4, 'link', 'javascript:alert(1)', 'user');
  });
  const out = await html();
  assert.ok(out.includes('<a href="https://example.com/report" target="_blank" style="color:#0b57d0;text-decoration:underline;">report</a>'), out);
  assert.ok(!out.includes('javascript:'));
});

test('images: insert by address or from the device; width comes from the image, capped at 600px', async () => {
  await typeText('Logo: ');
  await h.page.click(tb('button.ql-image'));
  await h.page.fill('.erte-dialog input[name="url"]', 'data:image/png;base64,AAAA');
  await h.page.click('.erte-dialog .erte-dialog__insert');
  assert.match(await h.page.textContent('.erte-dialog__error'), /https:\/\//, 'data: addresses are refused');
  await h.page.fill('.erte-dialog input[name="url"]', 'https://images.example.com/logo.png');
  await h.page.fill('.erte-dialog input[name="alt"]', 'Company logo');
  await h.page.click('.erte-dialog .erte-dialog__insert');
  await h.page.evaluate(() => window.ed.whenIdle());
  // Choosing a file shows it first; Insert adds it (uploaded here, as uploadImage is set).
  await h.page.click(tb('button.ql-image'));
  await h.page.setInputFiles('.erte-dialog input[type="file"]', { name: 'photo.png', mimeType: 'image/png', buffer: png(800, 20) });
  assert.equal(await h.page.textContent('.erte-dialog__file-name'), 'photo.png');
  assert.ok(await h.page.isHidden('.erte-dialog input[name="url"]'), 'the file replaces the address field');
  await h.page.click('.erte-dialog .erte-dialog__insert');
  await h.page.waitForFunction(() => (window.ed.getHtml().match(/<img/g) ?? []).length === 2);
  assert.ok(await h.page.isHidden('.erte-dialog'), 'dialog closes');
  const out = await html();
  assert.ok(out.includes('<img src="https://images.example.com/logo.png" alt="Company logo" width="600" style="width:600px;max-width:100%;height:auto;'), out);
  assert.ok(out.includes('src="https://images.example.com/photo.png" alt="photo" width="600"'), out);
  assert.deepEqual(await h.page.evaluate(() => window.uploads.slice(-1)), ['photo.png']);
});

test('image dialog: Cancel, Escape and a click outside close it without inserting, and return to the text', async () => {
  await typeText('Before');
  const imgCount = () => h.page.evaluate(() => (window.ed.getHtml().match(/<img/g) ?? []).length);
  const uploadsBefore = await h.page.evaluate(() => window.uploads.length);
  // Cancel after choosing a file: nothing is uploaded or inserted.
  await h.page.click(tb('button.ql-image'));
  await h.page.setInputFiles('.erte-dialog input[type="file"]', { name: 'nope.png', mimeType: 'image/png', buffer: png(40, 20) });
  await h.page.click('.erte-dialog .erte-dialog__cancel');
  assert.ok(await h.page.isHidden('.erte-dialog'));
  // Escape
  await h.page.click(tb('button.ql-image'));
  await h.page.fill('.erte-dialog input[name="url"]', 'https://images.example.com/x.png');
  await h.page.keyboard.press('Escape');
  assert.ok(await h.page.isHidden('.erte-dialog'));
  // Click outside
  await h.page.click(tb('button.ql-image'));
  await h.page.click('#subject');
  assert.ok(await h.page.isHidden('.erte-dialog'));
  assert.equal(await h.page.evaluate(() => document.activeElement.id), 'subject', 'focus stays where the user clicked');
  assert.equal(await imgCount(), 0);
  assert.equal(await h.page.evaluate(() => window.uploads.length), uploadsBefore);
  // Reopening starts clean; after cancelling, typing continues where it was.
  await h.page.click(tb('button.ql-image'));
  assert.equal(await h.page.inputValue('.erte-dialog input[name="url"]'), '');
  assert.ok(await h.page.isHidden('.erte-dialog__file'));
  await h.page.click('.erte-dialog .erte-dialog__cancel');
  assert.equal(await h.page.evaluate(() => document.activeElement === window.ed.quill.root), true, 'focus returns to the text');
  await typeText(' after');
  assert.equal(await h.page.evaluate(() => window.ed.getText()), 'Before after');
});

test('image dialog: cancelling during a slow upload stops it and inserts nothing', async () => {
  await h.page.evaluate(() => (window.uploadDelay = 5000));
  try {
    await h.page.click(tb('button.ql-image'));
    await h.page.setInputFiles('.erte-dialog input[type="file"]', { name: 'slow.png', mimeType: 'image/png', buffer: png(40, 20) });
    await h.page.click('.erte-dialog .erte-dialog__insert');
    await h.page.waitForFunction(() => window.uploads.at(-1) === 'slow.png');
    assert.equal(await h.page.textContent('.erte-dialog__insert'), 'Adding…');
    assert.ok(await h.page.isDisabled('.erte-dialog__insert'));
    assert.ok(await h.page.isEnabled('.erte-dialog__cancel'), 'Cancel stays available while adding');
    await h.page.click('.erte-dialog .erte-dialog__cancel');
    assert.ok(await h.page.isHidden('.erte-dialog'));
    assert.equal(await h.page.evaluate(() => window.uploadSignals.at(-1).aborted), true, 'the upload is told to stop');
    await h.page.evaluate(() => window.ed.whenIdle());
    await h.page.waitForTimeout(100);
    assert.ok(!(await html()).includes('<img'));
  } finally {
    await h.page.evaluate(() => (window.uploadDelay = 0));
  }
});

test('undo and redo buttons', async () => {
  await typeText('Keep');
  await h.page.waitForTimeout(700); // separate history steps
  await typeText(' drop');
  await h.page.click(tb('button.ql-undo'));
  assert.equal(await h.page.evaluate(() => window.ed.getText()), 'Keep');
  await h.page.click(tb('button.ql-redo'));
  assert.equal(await h.page.evaluate(() => window.ed.getText()), 'Keep drop');
});

test('onChange reports user edits with html, text and delta; setHtml does not', async () => {
  await typeText('Hi');
  const last = await h.page.evaluate(() => window.changes.at(-1));
  assert.equal(last.text, 'Hi');
  assert.ok(last.html.startsWith('<p ') && Array.isArray(last.delta.ops));
  const before = await h.page.evaluate(() => window.changes.length);
  await h.page.evaluate(() => window.ed.setHtml('<p>Loaded</p>'));
  assert.equal(await h.page.evaluate(() => window.changes.length), before);
});

test('output reloads without changes (setHtml(getHtml()) round-trips)', async () => {
  const [first, second] = await h.page.evaluate((ops) => {
    window.ed.setDelta({ ops });
    const a = window.ed.getHtml();
    window.ed.setHtml(a);
    return [a, window.ed.getHtml()];
  }, KITCHEN_SINK);
  assert.equal(second, first);
});

test('read-only hides the toolbar and blocks typing', async () => {
  await h.page.evaluate(() => {
    window.ed.setHtml('<p>Fixed</p>');
    window.ed.setReadOnly(true);
  });
  assert.equal(await h.page.isVisible('.erte .ql-toolbar'), false);
  await h.page.click('.erte .ql-editor');
  await typeText('x');
  assert.equal(await h.page.evaluate(() => window.ed.getText()), 'Fixed');
  await h.page.evaluate(() => window.ed.setReadOnly(false));
});

test('host page styles do not leak into the editor', async () => {
  await typeText('Styled by the editor');
  const style = await h.page.$eval('.erte .ql-editor p', (p) => {
    const cs = getComputedStyle(p);
    return [cs.color, cs.marginTop, cs.fontFamily.split(',')[0]];
  });
  assert.deepEqual(style, ['rgb(31, 35, 40)', '0px', 'Arial']);
});

test('host page button and input styles do not reshape the toolbar or link box', async () => {
  const sizes = await h.page.$$eval('.erte .ql-toolbar button', (bs) => bs.filter((b) => b.offsetParent).map((b) => [b.offsetWidth, b.offsetHeight, getComputedStyle(b).marginLeft]));
  assert.ok(sizes.every(([w, hgt, m]) => w === 28 && hgt === 24 && m === '0px'), JSON.stringify(sizes.slice(0, 3)));
  await typeText('x');
  await selectRange(0, 1);
  await h.page.click(tb('button.ql-link'));
  const input = await h.page.$eval('.erte .ql-tooltip input', (i) => [i.offsetHeight, getComputedStyle(i).fontSize]);
  assert.deepEqual(input, [26, '13px']);
  await h.page.keyboard.press('Escape');
});

test('no external requests or page errors', () => {
  assert.deepEqual(h.externalRequests, []);
  assert.deepEqual(h.pageErrors, []);
});

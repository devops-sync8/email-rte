// Layouts in the editor: column sections (each column an editor of its own) and buttons.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openHarness, png } from './harness.mjs';
import { lintEmailHtml } from './email-lint.mjs';

let h;
before(async () => {
  h = await openHarness();
  await h.page.evaluate(() => {
    window.makeLayoutEditor = (opts = {}) => {
      window.le?.destroy();
      document.getElementById('lh')?.remove();
      const host = document.createElement('div');
      host.id = 'lh';
      document.body.prepend(host);
      window.leChanges = [];
      window.le = window.rte.createRichTextEditor(host, {
        layouts: true,
        fields: [{ key: 'firstName', label: 'First name' }],
        onChange: (v) => window.leChanges.push(v),
        ...opts,
      });
      return true;
    };
  });
});
after(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.page.evaluate(() => {
    window.makeLayoutEditor();
    window.le.focus();
  });
});

const L = '#lh .erte';
const col = (i) => `${L} .erte-column >> nth=${i}`;
const colEditor = (i) => `${L} .erte-column:nth-child(${i + 1}) .ql-editor`;
const delta = () => h.page.evaluate(() => window.le.getDelta());
const sectionValue = async () => (await delta()).ops.find((op) => op.insert?.section)?.insert.section;
const columnText = async (i) => ((await sectionValue())?.columns[i] ?? []).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
const insertColumns = async (value = '1-1') => {
  await h.page.click(`${L} .ql-layout .ql-picker-label`);
  await h.page.click(`${L} .ql-layout .ql-picker-item[data-value="${value}"]`);
};

test('the Columns menu and Button are offered only with layouts: true', async () => {
  const items = await h.page.$$eval(`${L} .ql-layout .ql-picker-item`, (els) => els.map((e) => e.getAttribute('data-label')));
  assert.deepEqual(items, ['2 columns', '3 columns', 'Narrow + wide', 'Wide + narrow']);
  assert.equal(await h.page.getAttribute(`${L} button.ql-button`, 'aria-label'), 'Button');
  await h.page.evaluate(() => window.makeLayoutEditor({ layouts: false }));
  assert.equal(await h.page.locator(`${L} .ql-layout, ${L} button.ql-button`).count(), 0);
});

test('inserting columns moves the cursor into the first column; each column is edited on its own', async () => {
  await h.page.keyboard.type('Intro');
  await insertColumns('1-1');
  assert.equal(await h.page.evaluate(() => !!document.activeElement.closest('.erte-column')), true);
  await h.page.keyboard.type('Left');
  await h.page.click(col(1));
  await h.page.keyboard.type('Right');
  const value = await sectionValue();
  assert.equal(value.layout, '1-1');
  assert.deepEqual([await columnText(0), await columnText(1)], ['Left\n', 'Right\n']);
  assert.equal((await delta()).ops[0].insert, 'Intro\n');
  const last = await h.page.evaluate(() => window.leChanges.at(-1));
  assert.ok(last.html.includes('>Right</p>') && last.text.includes('Left\n\nRight'), 'onChange reports column edits');
  assert.deepEqual(lintEmailHtml(last.html), []);
});

test('toolbar formatting applies to the column in use, and shows its state', async () => {
  await h.page.keyboard.type('Main');
  await insertColumns('1-1');
  await h.page.keyboard.type('Heading here');
  await h.page.click(`${L} .ql-header .ql-picker-label`);
  await h.page.click(`${L} .ql-header .ql-picker-item[data-value="2"]`);
  await h.page.keyboard.press('Enter');
  await h.page.click(`${L} button.ql-bold`);
  await h.page.keyboard.type('Bold text');
  assert.ok(await h.page.$eval(`${L} button.ql-bold`, (b) => b.classList.contains('ql-active')), 'bold shows as active in the column');
  await h.page.click(`${L} button.ql-list[value="bullet"]`);
  await h.page.keyboard.press('ControlOrMeta+a');
  await h.page.click(`${L} button.ql-italic`);
  const column = (await sectionValue()).columns[0];
  assert.deepEqual(column, [
    { insert: 'Heading here', attributes: { italic: true } },
    { insert: '\n', attributes: { header: 2 } },
    { insert: 'Bold text', attributes: { bold: true, italic: true } },
    { insert: '\n', attributes: { list: 'bullet' } },
  ]);
  assert.equal((await delta()).ops[0].insert, 'Main\n', 'the main text is untouched (select all stays in the column)');
});

test('undo in a column (keyboard and toolbar), and undo of removing a section', async () => {
  await insertColumns('1-1');
  await h.page.keyboard.type('One');
  await h.page.waitForTimeout(700);
  await h.page.keyboard.type(' two');
  await h.page.keyboard.press('ControlOrMeta+z');
  assert.equal(await columnText(0), 'One\n');
  await h.page.click(`${L} button.ql-redo`);
  assert.equal(await columnText(0), 'One two\n');
  await h.page.waitForTimeout(700); // separate undo steps
  await h.page.click(`${L} .erte-section__remove`);
  assert.equal(await h.page.locator(`${L} .erte-section`).count(), 0);
  await h.page.click(`${L} button.ql-undo`);
  assert.equal(await columnText(0), 'One two\n', 'the section comes back with its content');
});

test('saved HTML reloads with its columns; copying a section and pasting it makes a section; inside a column it is flattened', async () => {
  await h.page.evaluate(() =>
    window.le.setDelta({
      ops: [
        { insert: 'Before\n' },
        { insert: { section: { layout: '1-2', columns: [[{ insert: 'Narrow', attributes: { italic: true } }, { insert: '\n' }], [{ insert: 'Wide\n' }, { insert: { button: { text: 'Go', href: 'https://x.test', align: 'center' } } }]] } } },
        { insert: 'After\n' },
      ],
    }),
  );
  const first = await h.page.evaluate(() => window.le.getHtml());
  const second = await h.page.evaluate(() => {
    window.le.setHtml(window.le.getHtml());
    return window.le.getHtml();
  });
  assert.equal(second, first, 'round trip');
  assert.equal((await sectionValue()).layout, '1-2');
  // Copy the whole main text (section included), paste it at the end.
  const copied = await h.page.evaluate(() => {
    const q = window.le.quill;
    q.setSelection(0, q.getLength() - 1);
    const data = new DataTransfer();
    q.root.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/html');
  });
  await h.page.evaluate(async (html) => {
    const q = window.le.quill;
    q.setSelection(q.getLength() - 1, 0);
    const data = new DataTransfer();
    data.setData('text/html', html);
    q.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await window.le.whenIdle();
  }, copied);
  assert.equal(await h.page.locator(`${L} .erte-section`).count(), 2);
  // The same HTML pasted into a column: its columns' content, one after the other.
  await h.page.click(colEditor(0));
  await h.page.evaluate(async (html) => {
    const target = document.querySelector('#lh .erte-column .ql-editor');
    const data = new DataTransfer();
    data.setData('text/html', html);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await window.le.whenIdle();
  }, copied);
  const column = (await sectionValue()).columns[0];
  assert.ok(!column.some((op) => op.insert?.section), 'no columns inside columns');
  assert.ok(column.some((op) => op.insert?.includes?.('Wide')) && column.some((op) => op.insert?.button), JSON.stringify(column));
  assert.equal(await h.page.locator(`${L} .erte-section`).count(), 2);
});

test('pasting into a column: cleaned like the main text; pictures sized to the column; merge fields become chips', async () => {
  await insertColumns('1-1');
  const html = `<p class=MsoNormal style='mso-line-height-alt:12pt'><b>Word</b> text</p><p><img src="data:image/png;base64,${png(800, 20).toString('base64')}" alt="Wide"></p><p>Hi {{firstName}}</p>`;
  await h.page.evaluate(async (html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await window.le.whenIdle();
  }, html);
  const column = (await sectionValue()).columns[0];
  const image = column.find((op) => op.insert?.image);
  assert.equal(image.attributes.width, '292', 'capped at the column width');
  assert.ok(column.some((op) => op.insert?.token?.key === 'firstName'));
  assert.equal((await delta()).ops.filter((op) => op.insert?.image).length, 0, 'nothing pasted into the main text');
  const email = await h.page.evaluate(() => window.le.getEmail({ tokens: { firstName: 'Ann' } }));
  assert.ok(email.html.includes('Hi Ann') && email.html.includes('<strong>Word</strong> text'));
  assert.ok(email.html.includes('width="292"'));
});

test('typing a merge field in a column makes a chip; Insert field works there too', async () => {
  await insertColumns('1-1');
  await h.page.keyboard.type('Dear {{firstName|reader}} and ');
  await h.page.click(`${L} .ql-field .ql-picker-label`);
  await h.page.click(`${L} .ql-field .ql-picker-item[data-value="firstName"]`);
  const tokens = (await sectionValue()).columns[0].filter((op) => op.insert?.token).map((op) => op.insert.token);
  assert.deepEqual(tokens, [{ key: 'firstName', fallback: 'reader' }, { key: 'firstName' }]);
  assert.deepEqual(await h.page.evaluate(() => window.le.getTokens()), ['firstName']);
});

test('buttons: insert, edit in the dialog, click to edit again, remove; Cancel changes nothing', async () => {
  await h.page.keyboard.type('Text');
  await h.page.click(`${L} button.ql-button`);
  assert.ok(await h.page.isVisible(`${L} .erte-button-dialog`));
  assert.equal(await h.page.inputValue(`${L} .erte-button-dialog input[name="text"]`), 'Click here');
  await h.page.fill(`${L} .erte-button-dialog input[name="text"]`, 'Book a demo');
  await h.page.fill(`${L} .erte-button-dialog input[name="href"]`, 'javascript:alert(1)');
  await h.page.click(`${L} .erte-button-dialog .erte-dialog__insert`);
  assert.match(await h.page.textContent(`${L} .erte-button-dialog .erte-dialog__error`), /https:/);
  await h.page.fill(`${L} .erte-button-dialog input[name="href"]`, '{{bookingUrl}}');
  await h.page.click(`${L} .erte-button-dialog .erte-swatch[data-colour="#0b7a3b"]`);
  await h.page.selectOption(`${L} .erte-button-dialog select[name="align"]`, 'center');
  await h.page.click(`${L} .erte-button-dialog .erte-dialog__insert`);
  const button = () => h.page.evaluate(() => window.le.getDelta().ops.find((op) => op.insert?.button)?.insert.button);
  assert.deepEqual(await button(), { text: 'Book a demo', href: '{{bookingUrl}}', background: '#0b7a3b', color: '#ffffff', align: 'center' });
  const email = await h.page.evaluate(() => window.le.getEmail({ tokens: { bookingUrl: 'https://x.test/book' } }));
  assert.ok(email.html.includes('bgcolor="#0b7a3b"') && email.html.includes('<a href="https://x.test/book"') && email.html.includes('>Book a demo</a>'));
  assert.deepEqual(lintEmailHtml(email.html, { sending: true }), []);
  // Click to edit; Cancel keeps it; Remove deletes it.
  await h.page.click(`${L} .ql-editor .erte-button`);
  assert.equal(await h.page.inputValue(`${L} .erte-button-dialog input[name="text"]`), 'Book a demo');
  await h.page.fill(`${L} .erte-button-dialog input[name="text"]`, 'Changed');
  await h.page.keyboard.press('Escape');
  assert.equal((await button()).text, 'Book a demo');
  await h.page.click(`${L} .ql-editor .erte-button`);
  await h.page.click(`${L} .erte-button-dialog .erte-dialog__remove-button`);
  assert.equal(await button(), undefined);
});

test('buttons inside a column', async () => {
  await insertColumns('1-1-1');
  await h.page.click(col(2));
  await h.page.click(`${L} button.ql-button`);
  await h.page.fill(`${L} .erte-button-dialog input[name="href"]`, 'https://x.test');
  await h.page.click(`${L} .erte-button-dialog .erte-dialog__insert`);
  const value = await sectionValue();
  assert.equal(value.layout, '1-1-1');
  assert.deepEqual(value.columns[2].find((op) => op.insert?.button)?.insert.button, { text: 'Click here', href: 'https://x.test', color: '#ffffff', align: 'left' });
});

test('read-only: columns cannot be edited and their controls are hidden', async () => {
  await insertColumns('1-1');
  await h.page.keyboard.type('Locked');
  await h.page.evaluate(() => window.le.setReadOnly(true));
  assert.deepEqual(await h.page.$$eval(`${L} .erte-column .ql-editor`, (els) => els.map((e) => e.getAttribute('contenteditable'))), ['false', 'false']);
  assert.ok(await h.page.isHidden(`${L} .erte-section__bar`));
  await h.page.evaluate(() => window.le.setReadOnly(false));
  assert.equal(await h.page.getAttribute(colEditor(0), 'contenteditable'), 'true');
});

test('columns stack when the editor is narrow, as the email does on phones', async () => {
  await insertColumns('1-1');
  const layout = () => h.page.$$eval(`${L} .erte-column`, (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const [a, b] = await layout();
  assert.equal(a, b, 'side by side');
  await h.page.evaluate(() => (document.getElementById('lh').style.width = '380px'));
  const [c, d] = await layout();
  assert.ok(d > c, 'stacked');
});

test('no page errors', () => {
  assert.deepEqual(h.pageErrors, []);
});

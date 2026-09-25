import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../dist/render.js';
import { deltaToEmailHtml, deltaToPlainText, wrapEmailDocument, FONTS } from '../dist/render.js';
import { lintEmailHtml } from './email-lint.mjs';
import { KITCHEN_SINK } from './kitchen-sink.mjs';

const P = 'margin:0 0 12px 0;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:150%;color:#1f2328;';
const PLAST = P.replace('margin:0 0 12px 0;', 'margin:0 0 0 0;');
const html = (ops, style) => deltaToEmailHtml({ ops }, style);


test('paragraphs carry font, size, line height and colour inline; the last has no bottom margin', () => {
  assert.equal(html([{ insert: 'A\nB\n' }]), `<p style="${P}">A</p><p style="${PLAST}">B</p>`);
});

test('headings use the base font at a fixed scale, bold, with explicit colour', () => {
  assert.equal(
    html([{ insert: 'H' }, { insert: '\n', attributes: { header: 2 } }]),
    '<h2 style="margin:0 0 0 0;font-family:Arial, Helvetica, sans-serif;font-size:24px;line-height:125%;font-weight:bold;color:#1f2328;">H</h2>',
  );
});

test('inline formats nest predictably and link groups share one <a>', () => {
  const out = html([
    { insert: 'x', attributes: { bold: true, italic: true, underline: true, strike: true, script: 'super', color: '#E60000', background: 'yellow', size: '13.5pt', font: 'courier', link: 'mailto:a@b.co' } },
    { insert: 'y', attributes: { link: 'mailto:a@b.co' } },
    { insert: '\n' },
  ]);
  assert.ok(
    out.includes(
      '<a href="mailto:a@b.co" target="_blank" style="color:#0b57d0;text-decoration:underline;"><span style="font-family:\'Courier New\', Courier, monospace;font-size:18px;line-height:150%;color:#e60000;background-color:#ffff00;"><strong><em><u><s><sup>x</sup></s></u></em></strong></span>y</a>',
    ),
    out,
  );
});

test('nested lists: margins indent (Outlook), types cycle per level, no padding', () => {
  const out = html([
    { insert: 'A' }, { insert: '\n', attributes: { list: 'ordered' } },
    { insert: 'B' }, { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
    { insert: 'C' }, { insert: '\n', attributes: { list: 'bullet' } },
  ]);
  assert.match(out, /^<ol type="1" style="margin:0 0 12px 24px;padding:0;list-style-type:decimal;"><li [^>]*>A<ol type="a" style="margin:4px 0 0 24px;padding:0;list-style-type:lower-alpha;"><li [^>]*>B<\/li><\/ol><\/li><\/ol><ul style="margin:0 0 0 24px;padding:0;list-style-type:disc;"><li [^>]*>C<\/li><\/ul>$/);
});

test('quotes and dividers are single-cell tables', () => {
  const out = html([{ insert: 'Q' }, { insert: '\n', attributes: { blockquote: true } }, { insert: { divider: true } }, { insert: 'After\n' }]);
  assert.ok(out.startsWith('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;border-collapse:collapse;"><tr><td style="border-left:3px solid #d0d7de;padding:0 0 0 12px;"><p'));
  assert.ok(out.includes('<td style="border-top:1px solid #d0d7de;font-size:1px;line-height:1px;height:1px;">&nbsp;</td>'));
});

test('images: width attribute capped at the content width, responsive CSS, http(s) or embedded PNG/JPEG/GIF only', () => {
  const out = html([
    { insert: { image: 'https://x.test/a.png' }, attributes: { width: '1200', alt: 'A' } },
    { insert: { image: 'data:image/png;base64,iVBORw0KGgo=' }, attributes: { width: '40' } },
    { insert: { image: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    { insert: { image: 'data:image/png;base64,AA"onerror="x' } },
    { insert: { image: 'data:text/html;base64,PHA+' } },
    { insert: { image: 'javascript:alert(1)' } },
    { insert: '\n' },
  ]);
  assert.ok(out.includes('<img src="https://x.test/a.png" alt="A" width="600" style="width:600px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;vertical-align:middle;">'));
  assert.ok(out.includes('<img src="data:image/png;base64,iVBORw0KGgo=" alt="" width="40"'));
  assert.equal(out.match(/<img/g).length, 2, out);
  assert.ok(!/svg|text\/html|onerror|javascript:/.test(out));
});

test('extractEmbeddedImages: embedded images become cid: references plus attachments, deduplicated', () => {
  const a = 'data:image/png;base64,iVBORw0KGgo=';
  const b = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const out = html([{ insert: { image: a } }, { insert: { image: b } }, { insert: { image: a } }, { insert: { image: 'https://x.test/a.png' } }, { insert: '\n' }]);
  const { html: sendable, images } = render.extractEmbeddedImages(out);
  assert.equal(images.length, 2);
  assert.deepEqual(images.map((i) => i.contentType), ['image/png', 'image/jpeg']);
  assert.deepEqual(images.map((i) => i.base64), ['iVBORw0KGgo=', '/9j/4AAQSkZJRg==']);
  assert.match(images[0].filename, /^image-1\.png$/);
  assert.match(images[1].filename, /^image-2\.jpg$/);
  for (const i of images) assert.match(i.cid, /^img-[0-9a-f]+(-\d+)?@email-rte$/);
  assert.equal(sendable.split(`src="cid:${images[0].cid}"`).length - 1, 2, 'the same picture is attached once');
  assert.ok(sendable.includes('src="https://x.test/a.png"') && !sendable.includes('data:'));
  assert.deepEqual(lintEmailHtml(sendable, { sending: true }), []);
  assert.deepEqual(render.extractEmbeddedImages('<p>none</p>'), { html: '<p>none</p>', images: [] });
});

test('untrusted values are escaped or dropped', () => {
  const out = html([
    { insert: '<script>alert(1)</script> & "q"', attributes: { color: 'red;background:url(x)', size: '999px', font: 'comic', background: 'expression(x)' } },
    { insert: 'l', attributes: { link: 'javascript:alert(1)' } },
    { insert: 'm', attributes: { link: 'https://ok.test/"onmouseover="x' } },
    { insert: '\n', attributes: { align: 'center;color:red', header: 7, indent: 'x' } },
  ]);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
  assert.ok(!/javascript:|url\(|expression|comic|999px|onmouseover="/.test(out), out);
  assert.ok(out.includes('href="https://ok.test/&quot;onmouseover=&quot;x"'));
  assert.deepEqual(lintEmailHtml(out), []);
});

// Security review: text must never look like markup to code that post-processes the HTML.
test('quotes in text are escaped, so text cannot pose as an attribute', () => {
  const out = html([{ insert: `Details at href=" and src="data:image/png;base64,AAAA" it's\n` }]);
  assert.ok(out.includes('href=&quot; and src=&quot;data:image/png;base64,AAAA&quot; it&#39;s'), out);
  const { html: sent, images } = render.extractEmbeddedImages(out);
  assert.equal(sent, out, 'text is not rewritten as an image');
  assert.equal(images.length, 0);
});

test('a merge field only starts a link when a path, query, fragment or nothing follows it', () => {
  const link = (href) => html([{ insert: 'x', attributes: { link: href } }, { insert: '\n' }]);
  for (const ok of ['{{site}}', '{{site}}/account', '{{u}}?a=1', '{{u}}#top', '{{ u | https://x.test }}/p']) {
    assert.ok(link(ok).includes('<a href='), ok);
  }
  for (const bad of ['{{zz}}javascript:alert(1)', '{{zz}}  javascript:alert(1)', '{{zz}}data:text/html,x', '{{a}}{{b}}']) {
    assert.ok(!link(bad).includes('<a '), bad);
  }
  const out = html([{ insert: 'Details at href="' }, { insert: 'our site', attributes: { link: '{{zz}}javascript:alert(document.domain)' } }, { insert: '\n' }]);
  assert.ok(!/javascript|<a /.test(out), out);
});

test('style overrides are numbers within limits', () => {
  const out = html([{ insert: 'a\n' }, { insert: { section: { layout: '1-1', columns: [[{ insert: 'b\n' }], [{ insert: 'c\n' }]] } } }, { insert: 'd\n' }], {
    blockSpacing: '0" onmouseover="alert(1)',
    maxImageWidth: '600"><img src=x onerror=alert(1)>',
    lineHeight: '1;color:red',
  });
  assert.ok(!/onmouseover|onerror|color:red/.test(out), out);
  assert.ok(out.includes('margin:0 0 12px 0;') && out.includes('width="600"') && out.includes('line-height:150%'));
  const clamped = html([{ insert: 'a\nb\n' }], { blockSpacing: 1e9, lineHeight: -3 });
  assert.ok(clamped.includes('margin:0 0 100px 0;') && clamped.includes('line-height:50%'), clamped);
});

test('hostile structures render in bounded time and depth', () => {
  const columns = Array.from({ length: 40000 }, () => [{ insert: 'a' }]);
  let t = Date.now();
  render.renderEmail({ ops: [{ insert: { section: { layout: '1-1', columns } } }, { insert: '\n' }] });
  assert.ok(Date.now() - t < 2000, `extra columns took ${Date.now() - t} ms`);

  let nested = [{ insert: 'deep\n' }];
  for (let i = 0; i < 5000; i++) nested = [{ insert: { section: { layout: '1-1', columns: [nested, []] } } }, { insert: '\n' }];
  t = Date.now();
  const out = render.renderEmail({ ops: nested });
  assert.ok(Date.now() - t < 2000);
  assert.ok(!out.html.includes('deep') && !out.text.includes('deep'), 'sections nested more than once are dropped');
  const twice = [{ insert: { section: { layout: '1-1', columns: [[{ insert: { section: { layout: '1-1', columns: [[{ insert: 'inner\n' }], []] } } }], []] } } }, { insert: '\n' }];
  assert.ok(render.renderEmail({ ops: twice }).html.includes('inner'), 'a section in a column shows its content');
});

test('whitespace, blank lines, alignment and paragraph indents survive', () => {
  const out = html([{ insert: 'a   b\tc\n\n' }, { insert: 'x' }, { insert: '\n', attributes: { align: 'right', indent: 2 } }]);
  assert.ok(out.includes('a &nbsp;&nbsp;b&nbsp;&nbsp;&nbsp;&nbsp;c'));
  assert.ok(out.includes('>&nbsp;</p>'), 'blank line kept');
  assert.ok(out.includes('margin:0 0 0 48px;text-align:right;'));
});

test('base style options apply everywhere', () => {
  const out = html([{ insert: 'x' }, { insert: '\n', attributes: { header: 1 } }, { insert: 'y\n' }], { fontFamily: 'georgia', fontSize: 18, color: '#333', blockSpacing: 20 });
  assert.ok(out.includes(`font-family:${FONTS.georgia.stack};font-size:32px`));
  assert.ok(out.includes('margin:0 0 20px 0;') && out.includes('font-size:18px;line-height:150%;color:#333333;'));
});

test('the kitchen sink passes the email-safety lint', () => {
  const out = html(KITCHEN_SINK);
  assert.deepEqual(lintEmailHtml(out), []);
});

test('plain text: lists numbered and indented, links spelled out, images by alt text', () => {
  assert.equal(
    deltaToPlainText({ ops: KITCHEN_SINK }),
    ['Title', 'Sub', 'Bold italic under strike H2O x2', 'Red marked big serif link (https://example.com/?a=1&b=2)', '• One', '   • Nested', '• Two', '1. First', '   1. Sub a', '> Quoted', '----------', 'Indented', '[Logo "A"]', '', 'End'].join('\n'),
  );
});

test('wrapEmailDocument: responsive, Outlook ghost table, no external resources', () => {
  const doc = wrapEmailDocument('<p>x</p>', { preheader: 'Preview <text>', title: 'T', width: 640 });
  assert.match(doc, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(doc, /<!--\[if mso \| IE\]><table role="presentation" align="center" width="640"/);
  assert.match(doc, /style="max-width:640px;/);
  assert.match(doc, /<o:PixelsPerInch>96<\/o:PixelsPerInch>/);
  assert.ok(doc.includes('Preview &lt;text&gt;'));
  assert.ok(!/<link|<script|src="|@import/.test(doc));
});

test("the editor never uses Quill's HTML export (GHSA-v3m3-f69x-jf25); output always comes from the Delta renderer", async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(new URL(f, dir), 'utf8').includes('getSemanticHTML'), f);
});

// ------------------------------------------------------ layouts ---

const section = (layout, ...columns) => ({ insert: { section: { layout, columns } } });

test('column sections: side by side on wide screens, stacked on phones, a fixed table for Outlook', () => {
  const out = html([
    section('1-1', [{ insert: 'Left\n' }], [{ insert: 'Right\n' }]),
    { insert: 'After\n' },
  ]);
  // Outlook desktop: a 600px table with 308 + 292 px cells (292 + 16px gap, 292).
  assert.ok(out.includes('<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->'));
  assert.ok(out.includes('<!--[if mso]><td width="308" valign="top"><![endif]-->') && out.includes('<!--[if mso]><td width="292" valign="top"><![endif]-->'));
  // Everyone else: inline-block columns, 100% wide below the content width.
  assert.ok(out.includes('<div style="display:inline-block;vertical-align:top;width:100%;max-width:308px;max-width:max(308px, calc((600px - 100%) * 600));">'));
  assert.ok(out.includes(`<td valign="top" style="padding:0 16px 12px 0;"><p style="${PLAST}">Left</p></td>`), 'gap after the first column; stacked spacing below it');
  assert.ok(out.includes(`<td valign="top" style="padding:0 0 12px 0;"><p style="${PLAST}">Right</p></td>`));
  assert.ok(out.endsWith(`<p style="${PLAST}">After</p>`));
  assert.deepEqual(lintEmailHtml(out), []);
});

test('column widths follow the layout; images in a column are capped at its width', () => {
  assert.deepEqual(render.columnWidths('1-1-1', 600), { inner: [189, 189, 190], outer: [205, 205, 190] });
  assert.deepEqual(render.columnWidths('1-2', 600), { inner: [194, 390], outer: [210, 390] });
  const out = html([section('2-1', [{ insert: { image: 'https://x.test/a.png' }, attributes: { width: '600' } }, { insert: '\n' }], [{ insert: 'Side\n' }])]);
  assert.ok(out.includes('<td width="405" valign="top">') && out.includes('<td width="195" valign="top">'), 'wide column first');
  assert.ok(out.includes('<img src="https://x.test/a.png" alt="" width="389" style="width:389px;'), out);
});

test('sections: invalid layouts are dropped, missing columns are empty, nested sections are flattened', () => {
  assert.equal(html([{ insert: { section: { layout: '9-9', columns: [[{ insert: 'x\n' }]] } } }]), '');
  const missing = html([{ insert: { section: { layout: '1-1-1', columns: [[{ insert: 'Only\n' }]] } } }]);
  assert.equal(missing.match(/display:inline-block/g).length, 3);
  const nested = html([section('1-1', [section('1-1', [{ insert: 'Inner A\n' }], [{ insert: 'Inner B\n' }])], [{ insert: 'B\n' }])]);
  assert.equal(nested.match(/display:inline-block/g).length, 2, 'no columns inside columns');
  assert.ok(nested.includes('>Inner A</p>') && nested.includes('>Inner B</p>'));
});

test('buttons: a coloured cell with a padded link, Outlook padding, validated values', () => {
  const out = html([{ insert: { button: { text: 'Buy <now>', href: 'https://x.test/?a=1&b=2', background: '#c00000', color: 'white', align: 'center' } } }]);
  assert.equal(
    out,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 0 0;border-collapse:collapse;"><tr><td align="center" style="padding:0;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" bgcolor="#c00000" style="border-radius:4px;background-color:#c00000;mso-padding-alt:12px 24px;">' +
      '<a href="https://x.test/?a=1&amp;b=2" target="_blank" style="display:inline-block;padding:12px 24px;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:120%;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:4px;">Buy &lt;now&gt;</a>' +
      '</td></tr></table></td></tr></table>',
  );
  assert.deepEqual(lintEmailHtml(out), []);
  const unsafe = html([{ insert: { button: { text: 'X', href: 'javascript:alert(1)', background: 'url(x)', align: 'middle' } } }]);
  assert.ok(!/javascript|url\(|middle/.test(unsafe) && unsafe.includes('<span style="display:inline-block;') && unsafe.includes('bgcolor="#0b57d0"'), unsafe);
  assert.equal(html([{ insert: { button: { text: '  ', href: 'https://x.test' } } }]), '', 'no text, no button');
  assert.equal(deltaToPlainText({ ops: [{ insert: { button: { text: 'Go', href: 'https://x.test' } } }, section('1-1', [{ insert: 'A\n' }], [{ insert: 'B\n' }])] }), 'Go: https://x.test\nA\n\nB');
});

test('merge fields inside columns and buttons', () => {
  const delta = { ops: [section('1-1', [{ insert: { token: { key: 'name' } } }, { insert: '\n' }], [{ insert: 'Hi {{name}}\n' }]), { insert: { button: { text: 'For {{name}}', href: '{{url}}' } } }] };
  assert.deepEqual(render.findTokens(delta), ['name', 'url']);
  const out = html(render.replaceTokens(delta, { name: 'Ann <3', url: 'https://x.test/u' }).ops);
  assert.equal(out.match(/Ann &lt;3/g).length, 3, out);
  assert.ok(out.includes('href="https://x.test/u"'));
  const chips = render.tokensToEmbeds({ ops: [section('1-1', [{ insert: 'Hi {{name}}\n' }], [])] });
  assert.deepEqual(chips.ops[0].insert.section.columns[0][1], { insert: { token: { key: 'name' } } });
});

// ------------------------------------------------------ templates ---

test('frames: header and footer around the message, merge fields in both, footer in the plain text', () => {
  const email = render.renderEmail({ ops: [{ insert: 'Body\n' }] }, {
    tokens: { company: 'Acme', unsubscribeUrl: 'https://x.test/u' },
    frame: {
      backgroundColor: '#eeeeee',
      header: { title: '{{company}} news', backgroundColor: '#1f3a5f', color: '#ffffff', logo: { src: 'https://x.test/logo.png', alt: 'Logo', width: 120 } },
      footer: { text: 'Sent by {{company}}\nLine two', links: [{ text: 'Unsubscribe', href: '{{unsubscribeUrl}}' }], align: 'center' },
    },
    document: { title: 'T' },
  });
  assert.ok(/background-color:#1f3a5f;"><p [^>]*><img src="https:\/\/x\.test\/logo\.png" alt="Logo" width="120"/.test(email.html), 'header row with logo');
  assert.ok(email.html.includes('<span style="color:#ffffff;">Acme news</span></h2>'));
  assert.ok(email.html.includes('Sent by Acme') && email.html.includes('<a href="https://x.test/u"'));
  assert.ok(email.html.includes('background-color:#eeeeee;"><p'), 'footer on the page background');
  assert.equal(email.text, 'Acme news\n\nBody\n\nSent by Acme\nLine two\nUnsubscribe (https://x.test/u)');
  assert.ok(!render.renderEmail({ ops: [{ insert: 'Body\n' }] }, { frame: { footer: { text: 'x' } } }).html.includes('x</p>'), 'frames apply to documents only');
});

test('built-in templates render to lint-clean email, with columns and buttons', () => {
  assert.deepEqual(render.TEMPLATES.map((t) => t.id), ['plain', 'newsletter', 'announcement']);
  for (const t of render.TEMPLATES) {
    const email = render.renderEmail(t.content ?? { ops: [] }, { tokens: { firstName: 'Ann', company: 'Acme', unsubscribeUrl: 'https://x.test/u' }, frame: t.frame, style: t.style });
    assert.deepEqual(lintEmailHtml(email.html, { sending: true }), [], t.id);
  }
  const news = html(render.TEMPLATES[1].content.ops);
  assert.equal(news.match(/display:inline-block;vertical-align:top/g).length, 2);
  assert.equal(news.match(/mso-padding-alt/g).length, 2);
});

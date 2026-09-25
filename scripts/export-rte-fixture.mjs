// Exports the rich text editor's email output (every format, plus a Word
// paste) for the .NET test that compiles it with Mjml.Net under strict
// validation. Requires `npm run build -w @sync8/email-rte` first.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHarness } from '../packages/rte/test/harness.mjs';
import { KITCHEN_SINK } from '../packages/rte/test/kitchen-sink.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'packages/dotnet/tests/Sync8.EmailRte.Tests/Fixtures/rte-output.html');
const word = readFileSync(path.join(root, 'packages/rte/test/fixtures/word-windows.html'), 'utf8');

const h = await openHarness();
try {
  const html = await h.page.evaluate(
    ({ ops, word }) => {
      window.ed.setDelta({ ops });
      window.ed.quill.setSelection(window.ed.quill.getLength() - 1, 0);
      const data = new DataTransfer();
      data.setData('text/html', word);
      window.ed.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      // Merge fields: a formatted chip, a fallback, and a link whose address is a field.
      const q = window.ed.quill;
      q.updateContents({
        ops: [
          { retain: q.getLength() - 1 },
          { insert: '\nHi ' },
          { insert: { token: { key: 'firstName' } }, attributes: { bold: true } },
          { insert: ' from ' },
          { insert: { token: { key: 'company', fallback: 'the team' } } },
          { insert: '. ' },
          { insert: 'Unsubscribe', attributes: { link: '{{unsubscribeUrl}}' } },
          { insert: '\n' },
          // Layouts: two columns (stacking on phones) and a button whose link is a merge field.
          {
            insert: {
              section: {
                layout: '1-1',
                columns: [
                  [{ insert: 'Left column' }, { insert: '\n', attributes: { header: 3 } }, { insert: 'Text on the left.\n' }],
                  [{ insert: 'Right column\n' }, { insert: { button: { text: 'Open', href: '{{accountUrl}}', align: 'center' } } }],
                ],
              },
            },
          },
          { insert: { button: { text: 'Book a demo', href: 'https://example.com/demo', background: '#0b7a3b' } } },
        ],
      });
      return window.ed.getHtml();
    },
    { ops: KITCHEN_SINK, word },
  );
  writeFileSync(out, html + '\n');
  console.log(`Wrote ${path.relative(root, out)} (${html.length} chars)`);
} finally {
  await h.close();
}

# @sync8/email-rte

An inline rich text editor for web pages (plain JavaScript, React or Angular)
whose output is **email-safe HTML** that renders consistently in **Outlook
desktop, Outlook on the web and Gmail**. Paste from Word or Google Docs and
the formatting comes with it. Works with a mouse, a keyboard or touch, on
desktop and mobile browsers. Built on [Quill](https://github.com/slab/quill).

- Lives inside your page (no iframe, no separate page), sized by its container.
- A TinyMCE-style toolbar: undo/redo, paragraph style (normal, heading 1–3),
  font, size, bold, italic, underline, strikethrough, sub/superscript, text
  colour, highlight, alignment, bulleted and numbered lists, indent/outdent,
  quote, link, image, horizontal line, clear formatting. Presets:
  `full`, `standard`, `minimal`, or your own.
- On narrow editors (phones, sidebars) the toolbar shows the essentials and a
  **More formatting** button, with 38px touch targets on touch screens.
- Paste from Word (Windows and Mac) and Google Docs keeps headings, bold,
  italic, underline, links, colours, sizes, highlighting, alignment, fonts
  that email clients have, and bulleted/numbered lists with their nesting.
  Word's markup, unsupported fonts and scripts are dropped.
- **Pictures come with the paste**: pictures from Word, screenshots and
  images copied from web pages are embedded (or uploaded, if you provide an
  upload function), converted to formats Outlook can show and sized for email.
  `getEmail()` hands them over as inline `cid:` attachments ready to send.
- **Optional responsive layouts**: column sections (2 or 3 columns, or
  narrow + wide) that sit side by side on desktop and stack on phones, and
  buttons that render in Outlook too.
- **Optional templates**: a branded frame (header with logo or title,
  footer with an unsubscribe link, colours) plus starting content, from a
  Template menu. Three built-ins, or your own.
- **Merge fields** (`{{firstName}}`, `{{firstName|there}}` with a fallback):
  an "Insert field" menu, chips that can't be split by editing, and
  replacement before the final email is produced, in the browser, in Node or
  in .NET.
- No external resources, no CDN, no telemetry. No CSP exceptions needed.

New here? The [quick start guide](../../docs/email-editor-quick-start.md) has
recipes for the common scenarios.

```bash
npm install @sync8/email-rte
```

## Usage

```ts
import { createRichTextEditor } from '@sync8/email-rte';
import '@sync8/email-rte/style.css';

const editor = createRichTextEditor(document.getElementById('message')!, {
  value: savedHtml,                 // HTML from a previous save, Word, anywhere
  placeholder: 'Write your message…',
  toolbar: 'full',                  // 'full' | 'standard' | 'minimal' | custom groups
  style: { fontFamily: 'arial', fontSize: 16, color: '#1f2328', linkColor: '#0b57d0' },
  uploadImage: async (file) => (await upload(file)).url, // optional: link images instead of embedding them
  fields: [{ key: 'firstName', label: 'First name' }, { key: 'company', label: 'Company' }],
  onChange: ({ html, text, delta }) => save(html),
});

editor.getHtml();            // email-safe HTML fragment
editor.getText();            // plain-text version (for the text/plain part)
editor.getDelta();           // Quill Delta, for lossless storage
editor.getEmailDocument();   // complete responsive email document
await editor.whenIdle();     // wait for pasted pictures to be processed
editor.getEmail({ document: { title }, tokens: { firstName: 'Ann' } }); // { html, text, attachments }: ready to send
editor.getTokens();          // merge field keys used, e.g. ['firstName']
editor.insertColumns('1-1'); editor.insertButton({ text: 'Book a demo', href: 'https://…' });
editor.setTemplate('newsletter'); editor.getTemplate();
editor.setHtml(html);        // load HTML (does not fire onChange)
editor.setReadOnly(true);
editor.destroy();
```

| Option | Description |
| --- | --- |
| `value` / `delta` | Initial content (HTML, or a Delta which takes precedence) |
| `placeholder`, `ariaLabel` | Placeholder text and accessible name of the editing area |
| `toolbar` | `'full'` (default), `'standard'`, `'minimal'`, or Quill toolbar groups |
| `style` | Base text style used in the editor **and** the email: `fontFamily` (a key of `FONTS`), `fontSize` (px), `color`, `lineHeight`, `linkColor`, `blockSpacing` (px), `ruleColor`, `maxImageWidth` (px, default 600) |
| `uploadImage(file, { signal })` | Upload an image and resolve with its https URL (`signal` aborts when the user cancels): pasted, dropped and chosen pictures are then linked. Without it they are embedded in the content (see [Pictures](#pictures)) |
| `fields` | Merge fields for the "Insert field" menu: `{ key, label }[]` (see [Merge fields](#merge-fields)) |
| `layouts` | `true` adds the Columns menu and the Button control (default `false`; see [Layouts](#layouts)) |
| `templates`, `template` | Templates for the Template menu (e.g. `TEMPLATES`), and the one in use at start (see [Templates](#templates)) |
| `pastedImages` | `'embed'` (default) keeps pictures in pastes; `'drop'` leaves them out |
| `onChange`, `onFocus`, `onBlur` | Callbacks; `onChange` fires for user edits only |
| `stickyToolbar` | Keep the toolbar visible while scrolling (`true` or a top offset in px) |
| `minHeight`, `maxHeight` | Editing area height (CSS lengths) |
| `readOnly` | Start read-only (the toolbar is hidden) |
| `labels` | Override toolbar labels, e.g. for translation |

Keyboard: the usual shortcuts (Ctrl/Cmd+B, I, U, Z, Shift+Z), Tab and
Shift+Tab indent and outdent list items, Enter on an empty list item ends the
list.

## Layouts

Opt in with `layouts: true`. The toolbar gets:

- **Columns**: 2 columns, 3 columns, narrow + wide (1:2) or wide + narrow
  (2:1). Each column is edited like the main text: formatting, lists,
  pictures (sized to the column), merge fields, buttons, pasting from Word.
  The toolbar acts on the column you are in. A section is removed with its
  **Remove columns** control, or selected and deleted like a picture.
- **Button**: a call to action with its text, link (https, mailto, tel or a
  merge field such as `{{bookingUrl}}`), colour and position. Click a button
  to edit or remove it.

In the email:

- **Columns sit side by side at the full content width and stack at 100%
  width on phones**, without media queries (which the Gmail apps drop). The
  columns are inline blocks whose `max-width` becomes 100% below the content
  width. Clients without CSS `max()` keep them at their desktop width and
  wrap them. **Outlook desktop** gets a fixed-width table from Outlook-only
  conditional comments.
- **Buttons** are a coloured table cell holding a padded link: the whole
  button is clickable, and Outlook desktop gets its padding from
  `mso-padding-alt`.
- The plain-text version lists the columns one after the other, and each
  button as "Text: link".

In the Delta, a section is `{ insert: { section: { layout: '1-1', columns:
[ops, ops] } } }` and a button `{ insert: { button: { text, href, background,
color, align } } }`. Both are validated when rendered.

## Templates

A template is a **frame** (page and message background colours, a header
with a logo and/or title, and a footer with small print and links), plus
optional **starting content** and **text style** (fonts, colours, content
width):

```ts
import { createRichTextEditor, TEMPLATES } from '@sync8/email-rte';

const editor = createRichTextEditor(el, {
  templates: [...TEMPLATES, {
    id: 'acme',
    name: 'Acme',
    style: { fontFamily: 'georgia', linkColor: '#c00000', maxImageWidth: 600 },
    frame: {
      backgroundColor: '#f4f5f7',
      header: { logo: { src: 'https://cdn.acme.test/logo.png', alt: 'Acme', width: 140 }, align: 'center' },
      footer: { text: 'Acme Ltd, 1 Main St.', links: [{ text: 'Unsubscribe', href: '{{unsubscribeUrl}}' }], align: 'center' },
    },
    content: '<h1>Hello {{firstName|there}}</h1><p>…</p>', // HTML or a Delta
  }],
  template: 'acme',
});
```

- The **Template** menu switches templates. The frame changes at once. The
  starting content loads straight away into an empty editor (undo removes
  it); otherwise the editor asks before replacing the message.
- The editor shows the header and footer around the text (merge fields show
  their fallback), and `getValue().template` / `onChange` report the
  template's id: store it with the content.
- The frame is used when a document is produced:
  `getEmail({ document: {…}, tokens })` merges fields in the header and
  footer too (e.g. the unsubscribe link), and adds the header title and
  footer to the plain text. On a server:
  `renderEmail(delta, { frame: template.frame, style: template.style, document: {…}, tokens })`.
- `TEMPLATES` has three starting points: **Plain**, **Newsletter** (header,
  two stories in columns with buttons, footer) and **Announcement**
  (centred, one button). Their colours and texts are placeholders: copy and
  adapt them.

## Merge fields

Put recipient-specific values in the email with tokens: `{{firstName}}`, or
`{{firstName|there}}` to use "there" when the value is empty or missing.
Keys may contain letters, digits, `_`, `-` and `.` (`{{customer.name}}` reads
nested values).

- **In the editor**: pick a field from **Insert field** (shown when `fields`
  is set), or type or paste `{{key}}`. A field is a chip showing its label.
  It is edited and deleted as a whole, and takes the formatting around it
  (bold, colour, size…). A link's address can be or start with a field:
  `{{unsubscribeUrl}}`, `{{site}}/account`.
- **The template**: `getHtml()`, `getText()` and `onChange` keep the fields as
  `{{key}}` text, so what you store is a template. `getDelta()` stores them as
  `{ token: { key, fallback } }` embeds.
- **The final email**: replacement happens on the content model, before any
  HTML is produced:

```ts
// In the browser
const email = editor.getEmail({ tokens: { firstName: 'Ann', company: 'Acme' }, document: { title } });

// On a server (Node, workers), from the stored Delta
import { renderEmail } from '@sync8/email-rte/render';
const email = renderEmail(storedDelta, { tokens: recipient, style, document: { title } });
// email: { html, text, attachments }
```

Values are plain text: they are HTML-escaped like typed text, so a value can
never add markup. Line breaks in a value become spaces. In link addresses, a field
that starts the address is used as is and must produce an http(s), mailto or
tel address (otherwise the link is dropped and its text kept). Fields later in
the address are URL-encoded (`?email={{email}}`). `tokens` may also be a
function (`(key) => value`).

A field with no value and no fallback is removed by default. Pass
`missing: 'keep'` to leave `{{key}}` visible (previews), or `missing: 'error'`
to throw a `MissingTokenError` whose `keys` lists every missing field, so you
can refuse to send. `replaceTokens(delta, values, options)` and
`findTokens(delta)` are exported for custom pipelines.

**.NET**: `EmailTokens` merges templates saved as HTML (from `getHtml()`,
or any other HTML) with the same rules. Use it to send one template to many
recipients:

```csharp
var message = EmailTokens.Apply(
    new EmailMessage([recipient.Email], "Hi {{firstName|there}}", templateHtml, templateText),
    new Dictionary<string, string?> { ["firstName"] = recipient.FirstName },
    MissingTokenBehavior.Error);
await sender.SendAsync(message);
```

`EmailTokens.ReplaceInHtml`, `ReplaceInText` and `Find` are also available.

## Pictures

Pictures can be pasted (from Word, screenshots, web pages), dropped on the
editor, or added with the Image button (by address, or chosen from the device,
which opens the camera or photo library on phones; the chosen picture is shown
before it is added).

Adding a picture can always be cancelled: the dialog's **Cancel**, Escape
or a click outside closes it, even while the picture is being processed or
uploaded, and nothing is inserted. While pasted or dropped pictures are
processed, the editor shows "Adding images…" with a **Cancel** button; a
cancelled paste keeps its text and leaves the pictures out. `uploadImage`
receives an `AbortSignal` (`uploadImage(file, { signal })`); pass it to
`fetch` so a cancelled upload stops.

- **Word**: Word's HTML only points at local files a web page cannot read; the
  pictures themselves are taken from the RTF copy Word puts on the clipboard.
  This works in Chrome and Edge (Windows and Mac). Safari and Firefox do not
  give web pages that RTF, so there the pictures are left out and the editor
  says so; the text still pastes with its formatting.
- **Web pages**: images are downloaded when the site allows it (CORS) and
  embedded; otherwise they stay linked to the site. Tracking pixels are dropped.
- Every picture is converted to **PNG or JPEG** (WebP, BMP and AVIF are not
  shown by Outlook), scaled down to at most **2x the content width** (1200px by
  default, sharp on high-DPI screens) and shown at up to the content width.

**Embedded or uploaded.** Without `uploadImage`, pictures are stored in the
content as `data:` URIs, so the value (`getHtml()`, `getDelta()`, `onChange`)
is self-contained, with no storage service needed. Mail clients do not show
`data:` images in received mail, so send with `getEmail()`:

```ts
await editor.whenIdle(); // pictures still being processed
const { html, text, attachments } = editor.getEmail({ document: { title: subject } });
// attachments: [{ cid, contentType, filename, base64 }], referenced in html as src="cid:…"
```

Attach each one inline with its Content-ID (Nodemailer: `{ cid, content,
encoding: 'base64', contentType }`; MailKit: `LinkedResources`). The .NET
package's `SmtpEmailSender` does this for you and also converts any `data:`
images left in the HTML (`EmbeddedImages.Extract`). For HTML produced
elsewhere, `extractEmbeddedImages(html)` (also in `@sync8/email-rte/render`)
does the same conversion.

With `uploadImage`, pictures are uploaded as they arrive and the content only
holds their https addresses, which keeps stored values and emails small. Note
that many mail clients block remote images until the reader allows them,
while inline attachments show straight away.

## The email output

`getHtml()` returns a fragment built from the editor's content model (the
Delta), not from the editing DOM:

- **Inline styles only**: no classes, ids or `<style>` blocks (Gmail and
  Outlook on the web strip or rewrite them).
- Every paragraph, heading and list item states its **font family, size,
  line height and colour**, because Outlook desktop (Word's renderer) does
  not reliably inherit them.
- Explicit margins on paragraphs, headings and lists; lists indent by
  **margin** (which Outlook honours), bullets and numbering change per level.
- **Quotes and horizontal lines are single-cell tables**: borders on
  `<blockquote>` and `<hr>` render inconsistently in Outlook.
- Images carry a **`width` attribute** capped at `maxImageWidth` (Outlook
  ignores CSS `max-width`) plus `max-width:100%;height:auto` for phones.
  Sources are https addresses or embedded PNG/JPEG/GIF only.
- Only **web-safe font stacks** (Arial, Helvetica, Verdana, Tahoma, Trebuchet
  MS, Georgia, Times New Roman, Courier New).
- Every value is validated: colours, pixel sizes, the font list, and
  http/https/mailto/tel links, image sources. Rendering an untrusted Delta
  is safe.

`wrapEmailDocument(fragment, options)` (or `editor.getEmailDocument()`)
produces a complete document: fluid width on phones, a fixed-width "ghost
table" for Outlook desktop, Office DPI settings, optional preheader text.

### Server-side rendering

`@sync8/email-rte/render` has no browser dependencies. Store the Delta and
render on the server (Node, workers) so the email never contains HTML that
came straight from a browser:

```ts
import { deltaToEmailHtml, deltaToPlainText, wrapEmailDocument } from '@sync8/email-rte/render';
const html = wrapEmailDocument(deltaToEmailHtml(storedDelta, style));
```

## Frameworks

- React: [`@sync8/email-rte-react`](../rte-react)
- Angular (20+, with forms support): [`@sync8/email-rte-angular`](../rte-angular)

## Browser support and testing

Tested automatically in Chromium on desktop and with phone emulation (touch,
412px wide). Quill supports current Chrome, Edge, Firefox and Safari
(including iOS); those browsers are not in the automated tests yet.

The email markup is checked by an allow-list lint and checked to pass Mjml.Net
strict validation when placed in an MJML template. It follows established Outlook/Gmail practices but
has not been run through a rendering service such as Litmus or Email on Acid.

## Security

- Output is rendered from the Delta by this package's renderer, which escapes
  text and validates every attribute value. Quill's own HTML export
  (`getSemanticHTML`, advisory GHSA-v3m3-f69x-jf25, affecting Quill 2.0.3)
  is not used.
- Pasted and loaded HTML is parsed in an inert document and rebuilt from an
  allow-list; scripts, event handlers and unsafe links never reach the editor.

## Limits

- No tables and no HTML source view. The colour pickers offer a fixed
  palette; other colours arrive only by pasting.
- Content is converted to the formats above when loaded or pasted; other HTML
  (custom fonts, layouts, scripts) is simplified or dropped.
- Word pictures paste in Chrome and Edge only (see [Pictures](#pictures)).
  Pictures copied from sites that need a login (e.g. another webmail) stay
  linked and may not show for recipients.
- Columns do not nest, and a section's layout is chosen when it is inserted
  (to change it, insert a new section and move the content).
- Merge fields insert plain text only (no formatted or multi-line values),
  and the subject line is not part of the editor: merge it with
  `EmailTokens.ReplaceInText` or your own code.
- Embedded pictures make the value large (a screenshot is often 100–500 KB).
  Use `uploadImage` if values are stored in size-limited fields.

License: BSD-3-Clause. Third-party notices: `THIRD_PARTY_NOTICES.md`.

# Email editor quick start

Recipes for the common ways to use the inline email editor
(`@sync8/email-rte`, with its React and Angular components) and the .NET
library that sends what it produces. Each recipe is self-contained; pick the
ones that match your app.

| I want to… | Recipe |
| --- | --- |
| Put the editor in a page (plain JavaScript) | [1](#1-add-the-editor-to-a-page) |
| Use it in React or Angular | [2](#2-react), [3](#3-angular) |
| Save a message and load it again | [4](#4-save-and-reload) |
| Send one email from the browser's content | [5](#5-send-an-email-from-your-api) |
| Send one template to many recipients | [6](#6-one-template-many-recipients) |
| Handle pictures (upload or embed) | [7](#7-pictures) |
| Offer merge fields such as a first name | [8](#8-merge-fields) |
| Offer templates, columns and buttons | [9](#9-templates-columns-and-buttons) |
| Try everything locally | [10](#10-try-it-locally) |

**Installing.** The packages are `@sync8/email-rte`, `@sync8/email-rte-react`
and `@sync8/email-rte-angular` (npm), and `Sync8.EmailRte` (.NET). Until they are
published, use them from this repository's workspaces, or install the
tarballs that `npm pack` produces (the CI "Pack" step builds them).

---

## 1. Add the editor to a page

```ts
import { createRichTextEditor } from '@sync8/email-rte';
import '@sync8/email-rte/style.css';

const editor = createRichTextEditor('#message', {
  value: savedHtml,                   // optional: HTML saved earlier (or from anywhere)
  placeholder: 'Write your message…',
  onChange: ({ html }) => saveDraft(html),
});
```

```html
<div id="message"></div>
```

- The editor lives in the page (no iframe) and takes the width of its
  container. On narrow screens the toolbar collapses to the essentials plus
  **More formatting**.
- `toolbar: 'standard'` or `'minimal'` gives a shorter toolbar; `style`
  sets the base font, size and colours used in the editor **and** the email.
- Pasting from Word or Google Docs keeps formatting and lists; nothing to set up.

## 2. React

```tsx
import { useRef, useState } from 'react';
import { EmailRichTextEditor, type EmailRichTextEditorHandle } from '@sync8/email-rte-react';
import '@sync8/email-rte/style.css';

export function Compose() {
  const [html, setHtml] = useState('');
  const ref = useRef<EmailRichTextEditorHandle>(null);
  const send = async () => {
    const editor = ref.current!.editor!;
    await editor.whenIdle();                      // pictures still being processed
    await sendEmail(editor.getEmail({ document: { title: 'Hello' } })); // see recipe 5
  };
  return (
    <>
      <EmailRichTextEditor ref={ref} value={html} onChange={setHtml} placeholder="Write your message…" />
      <button onClick={send}>Send</button>
    </>
  );
}
```

`value`/`onChange` hold the email HTML. Options other than `value` and
`readOnly` are read when the component mounts.

## 3. Angular

```ts
import { Component, ViewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EmailRichTextEditorComponent } from '@sync8/email-rte-angular';

@Component({
  selector: 'app-compose',
  imports: [ReactiveFormsModule, EmailRichTextEditorComponent],
  template: `
    <email-rich-text-editor #editor [formControl]="body" placeholder="Write your message…"></email-rich-text-editor>
    <button (click)="send()">Send</button>
  `,
})
export class ComposeComponent {
  @ViewChild('editor') editor!: EmailRichTextEditorComponent;
  body = new FormControl('');

  async send() {
    const e = this.editor.instance!;
    await e.whenIdle();
    await sendEmail(e.getEmail({ document: { title: 'Hello' } })); // see recipe 5
  }
}
```

Add `node_modules/@sync8/email-rte/dist/style.css` to `styles` in
`angular.json`. Works with reactive forms, `[(ngModel)]` or `[(value)]`, and
in zoneless apps.

## 4. Save and reload

Store what `getValue()` (or `onChange`) gives you:

```ts
const { html, text, delta, template } = editor.getValue();
await api.saveDraft({ html, delta, template });

// Later
editor.setHtml(draft.html);          // or: createRichTextEditor(el, { value: draft.html })
editor.setTemplate(draft.template);  // if you use templates
```

- **HTML** is enough to reload: the editor reads its own output back
  unchanged, including columns, buttons and merge fields.
- **The Delta** (`delta`) is the lossless content model. Store it if a
  server will render the email itself (recipe 6).
- Without `uploadImage`, pictures are inside the value as `data:` URLs, so
  a value with a screenshot can be hundreds of KB. Use `uploadImage`
  (recipe 7) if you store values in size-limited fields.

## 5. Send an email from your API

In the browser, produce the finished email and post it to your server:

```ts
await editor.whenIdle();
const email = editor.getEmail({
  document: { title: subject },          // a complete email document (with the template's frame, if any)
  tokens: { firstName: 'Ann' },          // merge field values (recipe 8)
  missing: 'error',                      // refuse to build it if a field has no value
});
// email = { html, text, attachments: [{ cid, contentType, filename, base64 }] }
await fetch('/api/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to, subject, ...email }),
});
```

On an ASP.NET Core server, send it with `SmtpEmailSender`. Embedded pictures
travel as inline attachments, referenced by `cid:`:

```csharp
builder.Services.AddSingleton(builder.Configuration.GetSection("Smtp").Get<SmtpOptions>()!);
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();

app.MapPost("/api/send", async (SendRequest r, IEmailSender sender, CancellationToken ct) =>
{
    var pictures = r.Attachments
        .Select(a => new InlineImage(a.Cid, a.ContentType, Convert.FromBase64String(a.Base64), a.Filename))
        .ToList();
    await sender.SendAsync(new EmailMessage([r.To], r.Subject, r.Html, r.Text, pictures), ct);
    return Results.Ok();
});

record SendRequest(string To, string Subject, string Html, string Text, List<Attachment> Attachments);
record Attachment(string Cid, string ContentType, string Filename, string Base64);
```

Validate the input before sending (recipients, subject, sizes, picture
types). `samples/host/Endpoints/ComposeEndpoints.cs` is a complete example.
SMTP settings come from configuration. Keep the password out of source
control: use an environment variable such as `Smtp__Password`, or user secrets.

## 6. One template, many recipients

Save the message once with its merge fields still in it, then fill them per
recipient on the server.

**.NET.** Save the document HTML (merge fields stay as `{{…}}`; pictures stay
embedded):

```ts
const { html, text } = editor.getEmail({ document: { title: subject }, attachImages: false });
await api.saveTemplate({ subject, html, text });
```

Then for each recipient:

```csharp
var message = EmailTokens.Apply(
    new EmailMessage([recipient.Email], template.Subject, template.Html, template.Text),
    new Dictionary<string, string?> { ["firstName"] = recipient.FirstName, ["unsubscribeUrl"] = recipient.UnsubscribeUrl },
    MissingTokenBehavior.Error);                  // throws, listing every field without a value
await sender.SendAsync(message, ct);              // embedded pictures become inline attachments
```

Values are HTML-encoded, and a link that *is* a field (such as
`{{unsubscribeUrl}}`) must resolve to an https, mailto or tel address. The
subject can contain merge fields too.

**Node.** Save the Delta and template id (recipe 4), then render on the server
with the DOM-free renderer:

```ts
import { renderEmail, TEMPLATES } from '@sync8/email-rte/render';

const template = TEMPLATES.find((t) => t.id === saved.template);
const email = renderEmail(saved.delta, {
  tokens: recipient,
  missing: 'error',
  frame: template?.frame,
  style: template?.style,
  document: { title: subject },
});
// email = { html, text, attachments }: send it with your mail library (Nodemailer: attachments with cid)
```

## 7. Pictures

People can paste pictures (from Word in Chrome and Edge, screenshots, web
pages), drop them, or use the Image button. They are converted to PNG or
JPEG and sized for email. Every step can be cancelled.

**Embed (default).** Nothing to set up. Pictures are stored in the content
and sent as inline attachments (`getEmail().attachments`, or automatically
by `SmtpEmailSender`).

**Upload.** Give the editor an upload function that returns a public https
URL. The content then only holds links:

```ts
createRichTextEditor(el, {
  uploadImage: async (file, { signal }) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/images', { method: 'POST', body, signal }); // signal: the user cancelled
    if (!res.ok) throw new Error('Upload failed');
    return (await res.json()).url;
  },
});
```

To leave pictures out of pastes altogether, use `pastedImages: 'drop'`.
Note that many mail clients hold back linked (uploaded) images until the
reader allows them; embedded pictures show straight away.

## 8. Merge fields

```ts
createRichTextEditor(el, {
  fields: [
    { key: 'firstName', label: 'First name' },
    { key: 'company', label: 'Company' },
    { key: 'unsubscribeUrl', label: 'Unsubscribe link' },
  ],
});
```

- Writers pick fields from **Insert field**, or type `{{firstName}}`. Each
  field shows as a chip. `{{firstName|there}}` uses "there" when the value
  is empty.
- The saved HTML keeps `{{firstName}}`. Fill the fields when sending:
  `getEmail({ tokens })` in the browser, `renderEmail` in Node, or
  `EmailTokens.Apply` in .NET (recipes 5 and 6).
- `editor.getTokens()` lists the fields a message uses, so you can check
  your data has them before sending.

## 9. Templates, columns and buttons

```ts
import { createRichTextEditor, TEMPLATES } from '@sync8/email-rte';

createRichTextEditor(el, {
  layouts: true,          // Columns menu (2 or 3 columns, 1:2, 2:1) and Button
  templates: TEMPLATES,   // Template menu: Plain, Newsletter, Announcement
  template: 'newsletter', // starting template (loads its content into an empty editor)
});
```

A template of your own:

```ts
const brand = {
  id: 'acme',
  name: 'Acme',
  style: { fontFamily: 'georgia', linkColor: '#c00000' },
  frame: {
    backgroundColor: '#f4f5f7',
    header: { logo: { src: 'https://cdn.acme.example/logo.png', alt: 'Acme', width: 140 }, align: 'center' },
    footer: { text: 'Acme Ltd, 1 Main St.', links: [{ text: 'Unsubscribe', href: '{{unsubscribeUrl}}' }], align: 'center' },
  },
  content: '<h1>Hello {{firstName|there}}</h1><p>…</p>',
};
createRichTextEditor(el, { layouts: true, templates: [brand, ...TEMPLATES], template: 'acme' });
```

- Columns sit side by side on desktop and stack on phones. Outlook desktop
  gets a fixed-width fallback.
- The header and footer are added when you ask for a document
  (`getEmail({ document: … })`). Store `getValue().template` with the
  message.
- Logos must be public https URLs (email clients do not show SVG or `data:`
  logos reliably).

## 10. Try it locally

```bash
npm ci
npm run build
cd samples/host && dotnet run      # then open http://localhost:5139
```

The compose page has templates, columns, merge fields (filled from a sample
recipient) and a desktop/phone preview. **Send test email** sends through
the `Smtp` settings. By default that's `localhost:1025`, which suits a local
catcher such as smtp4dev or Mailpit. For a real server, set
`Smtp__Host`, `Smtp__Port`, `Smtp__Security`, `Smtp__Username`,
`Smtp__Password` and `Smtp__FromAddress` as environment variables.

Without .NET: `npm run dev -w email-rte-demo` runs the same page with preview
only.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Pictures from Word are missing after pasting | Word only exposes the picture data to Chrome and Edge. In Safari and Firefox the text pastes and a notice explains; add the pictures with the Image button. |
| Pictures don't show in received mail | You sent HTML with `data:` pictures yourself. Send `getEmail()` output with its `attachments`, or use `SmtpEmailSender`, which converts them. |
| A pasted web image stayed a link | The site doesn't allow downloading it (CORS). It's kept as a link; upload a copy if it must be embedded. |
| `{{firstName}}` appears in the sent email | No values were given. Pass `tokens` (browser/Node) or use `EmailTokens.Apply` (.NET); use `missing: 'error'` / `MissingTokenBehavior.Error` to catch it. |
| An unsubscribe or button link disappeared | Its merge field didn't resolve to an https, mailto or tel address, so the link was dropped and its text kept. |
| Columns are side by side on a phone | That client doesn't support the CSS used for stacking; the columns keep their desktop width and wrap. Content stays readable. |
| The email is sent before a pasted picture is ready | Call `await editor.whenIdle()` before `getEmail()`. |
| Host page CSS changes the editor's look | The editor pins its own text and control styles. If a rule still leaks in, scope it away from `.erte`. |

More detail: [`packages/rte/README.md`](../packages/rte/README.md) (all
options, the email output, security), and the React and Angular READMEs.

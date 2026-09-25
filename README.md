# email-rte

**The rich text field for apps that send email: pastes from Word, renders in
Outlook, safe on the server. React, Angular, .NET. BSD-3.**

`email-rte` is an inline rich text editor for any web form whose content ends up
in an email: CRM and support replies, case notes, notifications, HR and
customer letters. People write and paste as they are used to; your app gets HTML
that holds up in Outlook desktop, Outlook on the web and Gmail, plus a plain-text
part and inline pictures, ready to send.

> **Status: 0.1, pre-release.** Not yet published to npm or NuGet. Output is
> checked by automated tests (an email-safety allow-list and MJML strict
> validation) but **has not yet been verified in real mail clients**. A
> published compatibility matrix with screenshots is the next milestone.

## Why use it

- **Paste from Word and Google Docs keeps its formatting**, including Word
  pictures (read from the clipboard's RTF in Chrome and Edge). Web pastes are
  cleaned; tracking pixels are dropped.
- **Email-safe output by construction**: inline styles only, every text block
  states its font, size and colour (Outlook does not inherit them), lists and
  quotes built the way Outlook renders them, images sized with `width`
  attributes, optional stacking columns with Outlook "ghost tables".
- **Safe on the server.** Store the content model (a Quill Delta) and re-render
  it on the server with the DOM-free renderer (`@sync8/email-rte/render`, about
  10 KB gzip). It escapes all text and drops any link, image source, colour or
  font it cannot validate, so your backend never has to trust HTML posted by a
  browser.
- **Ready to send**: `getEmail()` returns `{ html, text, attachments }` with
  pictures as `cid:` inline attachments. Merge fields (`{{firstName}}`) are
  filled on the model before any HTML exists, with defined behaviour for
  missing values.
- **Fits enterprise stacks**: plain JS, React and Angular (with forms support)
  components, and a .NET 10 library for merge fields, inline images and SMTP.
- **Self-hosted, no third-party calls**: no CDNs, web fonts or telemetry,
  enforced in CI. Permissive **BSD-3-Clause** licence, with a licence gate on
  every dependency.

## Packages

| Package | What it is |
| --- | --- |
| [`@sync8/email-rte`](packages/rte) | The editor (framework-agnostic) and the DOM-free Delta → email renderer (`/render`) |
| [`@sync8/email-rte-react`](packages/rte-react) | React component |
| [`@sync8/email-rte-angular`](packages/rte-angular) | Angular component with `ngModel` / reactive forms support |
| [`Sync8.EmailRte`](packages/dotnet/src/Sync8.EmailRte) (NuGet) | .NET 10: `EmailTokens` (merge fields), `EmbeddedImages` (`data:` → `cid:`), `SmtpEmailSender` (MailKit) |

## Quick look

```ts
import { createRichTextEditor } from '@sync8/email-rte';
import '@sync8/email-rte/style.css';

const editor = createRichTextEditor('#message', {
  placeholder: 'Write your message…',
  fields: [{ key: 'firstName', label: 'First name' }],
  onChange: ({ delta }) => saveDraft(delta),
});

// When sending:
await editor.whenIdle(); // pasted pictures still being processed
const { html, text, attachments } = editor.getEmail({
  document: { title: subject },
  tokens: { firstName: 'Ann' },
});
```

Or on the server, from the stored Delta:

```ts
import { renderEmail } from '@sync8/email-rte/render';
const { html, text, attachments } = renderEmail(storedDelta, { tokens: recipient });
```

**[Quick start guide](docs/email-editor-quick-start.md)**: recipes for plain
JS, React and Angular, saving, sending (Node and .NET), one template for many
recipients, pictures, merge fields, templates and columns. The full API is in
the [`@sync8/email-rte` README](packages/rte/README.md).

## Try it

Prerequisites: Node.js 20+; for sending, the .NET 10 SDK (pinned in `global.json`).

```bash
npm ci
npm run build
npm run dev -w email-rte-demo      # the demo with preview, no sending
```

To send what you write as a real email, run the sample host, which serves the
same demo and sends through SMTP:

```bash
cd samples/host
dotnet run                         # http://localhost:5139
```

The defaults (`localhost:1025`, no TLS, no auth) suit a local catch-all SMTP
server such as smtp4dev or Mailpit. For a real server use environment
variables, user secrets or a git-ignored `samples/host/appsettings.json`;
never put credentials in `appsettings.example.json`:

```bash
export Smtp__Host=smtp.example.com Smtp__Port=587 Smtp__Security=StartTls
export Smtp__Username=apikey Smtp__Password='…' Smtp__FromAddress=noreply@example.com
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/compose/status` | Whether the page can send, and the sender address |
| `POST` | `/api/compose/send` | `{ to, subject, html, text, attachments }` from `getEmail()`: validate and send via SMTP with inline pictures |

The sample has no authentication; see [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What it is |
| --- | --- |
| [`packages/rte`](packages/rte) | `@sync8/email-rte` |
| [`packages/rte-react`](packages/rte-react) | `@sync8/email-rte-react` |
| [`packages/rte-angular`](packages/rte-angular) | `@sync8/email-rte-angular` |
| [`packages/dotnet`](packages/dotnet) | `Sync8.EmailRte` NuGet package and its tests |
| [`samples/rte-demo`](samples/rte-demo) | Demo page: templates, columns, merge fields, desktop/phone preview |
| [`samples/host`](samples/host) | ASP.NET Core minimal API that serves the demo and sends its emails |
| [`scripts`](scripts) | Licence gate, notices generator, CDN check, fixture export |
| [`tools`](tools) | Build-time Vite plugin that strips hard-coded CDN URLs from dependency code |

## Development

```bash
npm ci
npm run build && npm run typecheck
npm test                     # editor tests in headless Chromium + licence policy tests
npm run export-fixture       # re-export editor output for the .NET MJML compatibility test
dotnet test EmailRte.sln     # merge fields, inline images, SMTP message and MJML compatibility tests
npm run license:check        # fails on GPL/LGPL/AGPL/SSPL/unknown licences
npm run license:notices      # regenerate THIRD_PARTY_NOTICES.md
npm run cdn:check            # fails if shipped files reference CDNs/third-party hosts
```

Editor tests need Chromium for Playwright (`npx playwright install chromium`).

Versioning uses [Changesets](https://github.com/changesets/changesets): run
`npx changeset` for each change; `npm run version-packages` bumps the npm
packages and the NuGet package. Nothing is published automatically.

See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

BSD 3-Clause. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Built on [Quill](https://github.com/slab/quill) (BSD-3-Clause).

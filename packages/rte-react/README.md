# @sync8/email-rte-react

React component for [`@sync8/email-rte`](../rte): an inline rich text editor
whose value is email-safe HTML for Outlook desktop, Outlook on the web and
Gmail, with Word/Google Docs paste. React 18 and 19.

```bash
npm install @sync8/email-rte-react
```

```tsx
import { useRef, useState } from 'react';
import { EmailRichTextEditor, type EmailRichTextEditorHandle } from '@sync8/email-rte-react';
import '@sync8/email-rte/style.css';

export function Compose() {
  const [html, setHtml] = useState('<p>Hello</p>');
  const editor = useRef<EmailRichTextEditorHandle>(null);
  return (
    <EmailRichTextEditor
      ref={editor}
      value={html}
      onChange={(next, { text }) => setHtml(next)}
      placeholder="Write your message…"
      toolbar="full"
      editorStyle={{ fontFamily: 'arial', fontSize: 16 }}
      uploadImage={async (file) => (await upload(file)).url}
      fields={[{ key: 'firstName', label: 'First name' }]}
    />
  );
}
```

- `value` / `onChange(html, { html, text, delta })` for controlled use, or
  `defaultValue` for uncontrolled use. `onChange` does not fire on mount.
- `readOnly` can change at any time. Other options (`toolbar`, `placeholder`,
  `editorStyle`, `uploadImage`, `stickyToolbar`, …) are read on mount; change
  the component's `key` to apply new ones.
- `className`, `style` and `id` apply to the wrapper element.
- The ref exposes `editor` (the core API), `getValue()` and `focus()`.
- Merge fields: `fields` adds the "Insert field" menu; the value keeps
  `{{key}}` tokens, and `ref.current.editor.getEmail({ tokens })` fills them
  (see the [core README](../rte/README.md#merge-fields)).
- Layouts and templates: `layouts` adds the Columns menu and Button;
  `templates={TEMPLATES}` (exported here too) adds the Template menu (see
  the [core README](../rte/README.md#layouts)).
- Pasted pictures are embedded unless `uploadImage` is set. To send, use
  `await ref.current.editor.whenIdle()` then `ref.current.editor.getEmail()`,
  which returns the HTML with pictures as inline `cid:` attachments (see the
  [core README](../rte/README.md#pictures)).

License: BSD-3-Clause.

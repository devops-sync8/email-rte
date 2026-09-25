# @sync8/email-rte-angular

Angular component for [`@sync8/email-rte`](../rte): an inline rich text
editor whose value is email-safe HTML for Outlook desktop, Outlook on the web
and Gmail, with Word/Google Docs paste. Standalone component for Angular 20
and later; works with reactive forms, template-driven forms and zoneless apps.

```bash
npm install @sync8/email-rte-angular
```

Add the editor's stylesheet to your application's styles (`angular.json`):

```json
"styles": ["node_modules/@sync8/email-rte/dist/style.css", "src/styles.css"]
```

```ts
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EmailRichTextEditorComponent } from '@sync8/email-rte-angular';

@Component({
  selector: 'app-compose',
  imports: [ReactiveFormsModule, EmailRichTextEditorComponent],
  template: `
    <email-rich-text-editor
      [formControl]="body"
      toolbar="full"
      placeholder="Write your message…"
      [editorStyle]="{ fontFamily: 'arial', fontSize: 16 }"
      [uploadImage]="upload"
      [fields]="fields"
      (contentChange)="plainText = $event.text">
    </email-rich-text-editor>
  `,
})
export class ComposeComponent {
  body = new FormControl('<p>Hello</p>');
  plainText = '';
  fields = [{ key: 'firstName', label: 'First name' }];
  upload = async (file: File) => (await this.api.upload(file)).url;
}
```

- Forms: `formControlName`, `[formControl]` or `[(ngModel)]`; the value is the
  email HTML. Disabling the control makes the editor read-only; blur marks it
  touched.
- Without forms: `[(value)]`, `(contentChange)` for `{ html, text, delta }`,
  `(editorFocus)`, `(editorBlur)`.
- `readOnly` and `value` can change at any time; other inputs are read at
  initialisation.
- `instance` gives the core editor API (`getText()`, `getDelta()`,
  `getEmailDocument()`, …).
- Merge fields: `[fields]` adds the "Insert field" menu; the value keeps
  `{{key}}` tokens, and `editor.instance.getEmail({ tokens })` fills them
  (see the [core README](../rte/README.md#merge-fields)).
- Layouts and templates: `layouts` adds the Columns menu and Button;
  `[templates]="templates"` (e.g. `TEMPLATES`, exported here too) and
  `template="newsletter"` add the Template menu (see the
  [core README](../rte/README.md#layouts)).
- Pasted pictures are embedded unless `[uploadImage]` is set
  (`pastedImages="drop"` leaves them out). To send, use
  `await editor.instance.whenIdle()` then `editor.instance.getEmail()`, which
  returns the HTML with pictures as inline `cid:` attachments (see the
  [core README](../rte/README.md#pictures)).

License: BSD-3-Clause.

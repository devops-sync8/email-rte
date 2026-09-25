import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@sync8/email-rte/style.css';
import { EmailRichTextEditor, TEMPLATES, type EmailRichTextEditorHandle } from '../src/index';

declare global {
  interface Window {
    app: { setValue(html: string): void; setReadOnly(v: boolean): void; handle: EmailRichTextEditorHandle | null; renders: number; lastChange?: string };
    harnessReady: boolean;
  }
}

function App() {
  const [html, setHtml] = useState('<p>Initial <strong>content</strong></p>');
  const [readOnly, setReadOnly] = useState(false);
  const ref = useRef<EmailRichTextEditorHandle>(null);
  window.app = { ...window.app, setValue: setHtml, setReadOnly, handle: ref.current, renders: (window.app?.renders ?? 0) + 1 };
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <EmailRichTextEditor
        ref={(r) => {
          ref.current = r;
          if (window.app) window.app.handle = r;
        }}
        value={html}
        readOnly={readOnly}
        placeholder="Write here"
        toolbar="standard"
        fields={[{ key: 'firstName', label: 'First name' }]}
        layouts
        templates={TEMPLATES}
        editorStyle={{ fontFamily: 'georgia', fontSize: 15 }}
        onChange={(next) => {
          window.app.lastChange = next;
          setHtml(next);
        }}
      />
      <output id="html">{html}</output>
    </form>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
window.harnessReady = true;

import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import {
  createRichTextEditor,
  type EditorValue,
  type EmailTemplate,
  type MergeField,
  type RichTextEditor,
  type RichTextEditorOptions,
} from '@sync8/email-rte';

export type { EditorValue, EmailTemplate, MergeField, RichTextEditor, RichTextEditorOptions };
export { TEMPLATES } from '@sync8/email-rte';

export interface EmailRichTextEditorProps
  extends Omit<RichTextEditorOptions, 'value' | 'delta' | 'onChange' | 'readOnly' | 'style'> {
  /** Controlled content as HTML. Update it from `onChange`. */
  value?: string;
  /** Uncontrolled initial content as HTML. */
  defaultValue?: string;
  /** Called on every user edit with the email-safe HTML and the full value. */
  onChange?: (html: string, value: EditorValue) => void;
  readOnly?: boolean;
  /** Base text style of the editor and the email output (font, size, colours, spacing). */
  editorStyle?: RichTextEditorOptions['style'];
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export interface EmailRichTextEditorHandle {
  /** The underlying editor (null before mount). */
  readonly editor: RichTextEditor | null;
  getValue(): EditorValue | null;
  focus(): void;
}

/**
 * Inline email rich text editor. Other options (toolbar, placeholder, style,
 * uploadImage, …) are read when the component mounts; change its `key` to
 * apply new ones.
 */
export const EmailRichTextEditor = forwardRef<EmailRichTextEditorHandle, EmailRichTextEditorProps>(function EmailRichTextEditor(
  { value, defaultValue, onChange, readOnly, editorStyle, id, className, style: cssStyle, onFocus, onBlur, ...options },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditor | null>(null);
  const lastHtml = useRef<string | undefined>(undefined);
  const callbacks = useRef({ onChange, onFocus, onBlur });
  callbacks.current = { onChange, onFocus, onBlur };
  const initial = useRef({ options: { ...options, style: editorStyle }, html: value ?? defaultValue, readOnly });

  useEffect(() => {
    const { options: opts, html, readOnly: ro } = initial.current;
    const editor = createRichTextEditor(hostRef.current!, {
      ...opts,
      value: html,
      readOnly: ro,
      onChange: (v) => {
        lastHtml.current = v.html;
        callbacks.current.onChange?.(v.html, v);
      },
      onFocus: () => callbacks.current.onFocus?.(),
      onBlur: () => callbacks.current.onBlur?.(),
    });
    lastHtml.current = editor.getHtml();
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Controlled value: load it unless it is what the editor just produced.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === undefined || value === lastHtml.current) return;
    editor.setHtml(value);
    lastHtml.current = editor.getHtml();
  }, [value]);

  useEffect(() => {
    editorRef.current?.setReadOnly(!!readOnly);
  }, [readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      get editor() {
        return editorRef.current;
      },
      getValue: () => editorRef.current?.getValue() ?? null,
      focus: () => editorRef.current?.focus(),
    }),
    [],
  );

  return <div ref={hostRef} id={id} className={className} style={cssStyle} />;
});

import Quill from 'quill';
import { FONTS, escapeText } from './render';
import { asToken, tokenText, type Token } from './tokens';
import { registerLayoutFormats } from './layout';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Formats the editor allows. Anything else is dropped on paste, load and API calls. */
export const FORMATS = [
  'header', 'blockquote', 'list', 'indent', 'align',
  'font', 'size', 'bold', 'italic', 'underline', 'strike', 'script', 'color', 'background',
  'link', 'image', 'divider', 'token', 'section', 'button',
];

/** Formats inside a column: everything but columns (sections never nest). */
export const COLUMN_FORMATS = FORMATS.filter((f) => f !== 'section');

export const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px'];

const svg = (body: string) => `<svg viewBox="0 0 18 18"><g class="ql-fill">${body}</g></svg>`;

const ICONS = {
  undo: svg('<path d="M4.5 3.5 1 7l3.5 3.5V8h6a3.5 3.5 0 0 1 0 7H6v1.5h4.5a5 5 0 0 0 0-10h-6z"/>'),
  redo: svg('<path d="M13.5 3.5 17 7l-3.5 3.5V8h-6a3.5 3.5 0 0 0 0 7H12v1.5H7.5a5 5 0 0 1 0-10h6z"/>'),
  button: '<svg viewBox="0 0 18 18"><rect class="ql-stroke" x="2" y="5" width="14" height="8" rx="2.5"/><rect class="ql-fill" x="5.5" y="8.25" width="7" height="1.5" rx=".75"/></svg>',
  divider: svg('<rect x="1" y="8" width="16" height="2" rx="1"/><rect x="4" y="3" width="10" height="1.5" rx=".75" opacity=".5"/><rect x="4" y="13.5" width="10" height="1.5" rx=".75" opacity=".5"/>'),
};

let registered = false;

/** Register the editor's formats on the (bundled, private) Quill instance. */
export function registerFormats() {
  if (registered) return;
  registered = true;
  const { StyleAttributor, ClassAttributor, Scope } = Quill.import('parchment') as any;

  Quill.register(
    {
      // Any pixel size, so sizes pasted from Word survive.
      'formats/size': new StyleAttributor('size', 'font-size', { scope: Scope.INLINE }),
      // Only fonts email clients have; the editor shows them through CSS classes.
      'formats/font': new ClassAttributor('font', 'erte-font', { scope: Scope.INLINE, whitelist: Object.keys(FONTS) }),
    },
    true,
  );

  const BlockEmbed = Quill.import('blots/block/embed') as any;
  class Divider extends BlockEmbed {
    static blotName = 'divider';
    static tagName = 'hr';
  }
  Quill.register(Divider, true);

  // Merge field chip: atomic, so editing and formatting can never split `{{key}}`.
  const Embed = Quill.import('blots/embed') as any;
  class TokenBlot extends Embed {
    static blotName = 'token';
    static tagName = 'span';
    static className = 'erte-token';
    static create(value: unknown) {
      const token = asToken(value) ?? { key: 'field' };
      const node = super.create(token) as HTMLElement;
      node.setAttribute('data-key', token.key);
      if (token.fallback) node.setAttribute('data-fallback', token.fallback);
      return node;
    }
    static value(node: HTMLElement): Token | null {
      return asToken({ key: node.getAttribute('data-key'), fallback: node.getAttribute('data-fallback') ?? undefined });
    }
    // Copying a chip copies its text form, which pastes back as a chip.
    html() {
      return escapeText(tokenText(TokenBlot.value(this.domNode) ?? { key: 'field' }));
    }
  }
  Quill.register(TokenBlot, true);
  registerLayoutFormats();

  const Link = Quill.import('formats/link') as any;
  Link.PROTOCOL_WHITELIST = ['http', 'https', 'mailto', 'tel'];

  const icons = Quill.import('ui/icons') as Record<string, string>;
  Object.assign(icons, ICONS);
}

/** CSS generated from the font list: editor classes and picker labels. */
export function fontCss(): string {
  return Object.entries(FONTS)
    .map(
      ([key, f]) =>
        `.erte .erte-font-${key}{font-family:${f.stack}}` +
        `.erte .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="${key}"]::before,` +
        `.erte .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${key}"]::before{content:"${f.label}";font-family:${f.stack}}`,
    )
    .join('\n');
}

export function sizeCss(): string {
  return SIZES.map(
    (s) =>
      `.erte .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${s}"]::before,` +
      `.erte .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${s}"]::before{content:"${s.replace('px', '')}"}`,
  ).join('\n');
}

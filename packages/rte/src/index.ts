import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import './styles.css';
import { COLUMN_FORMATS, FORMATS, SIZES, fontCss, registerFormats, sizeCss } from './formats';
import { normalizeColumn, sectionEditors, setLayoutHost } from './layout';
import { cleanHtml, cleanHtmlDetailed } from './paste';
import { blobToDataUrl, dataUrlToBlob, fetchImageAsDataUrl, normalizeImage, rtfImages } from './images';
import {
  DEFAULT_STYLE,
  findTokens,
  renderEmail,
  tokensToEmbeds,
  FONTS,
  deltaToEmailHtml,
  deltaToPlainText,
  normColor,
  type DeltaLike,
  type EmailDocumentOptions,
  type EmailStyle,
  type EmailParts,
  type ReplaceTokensOptions,
  type TokenValues,
  LAYOUTS,
  TRAILING_TOKEN,
  asToken,
  isTokenKey,
  tokenText,
  asButton,
  isLink,
  columnWidths,
  frameColorsOf,
  frameDeltas,
  replaceTokens,
  type ButtonValue,
  type EmailTemplate,
  type SectionLayout,
} from './render';

export { SIZES, cleanHtml, rtfImages };
export {
  DEFAULT_STYLE,
  FONTS,
  LAYOUTS,
  MissingTokenError,
  TEMPLATES,
  TOKEN_PATTERN,
  deltaToEmailHtml,
  deltaToPlainText,
  extractEmbeddedImages,
  findTokens,
  frameColors,
  frameColorsOf,
  frameDeltas,
  renderEmail,
  replaceTokens,
  wrapEmailDocument,
} from './render';
export type {
  ButtonValue,
  DeltaLike,
  EmailDocumentOptions,
  EmailFrame,
  EmailParts,
  EmailStyle,
  EmailTemplate,
  EmbeddedImage,
  FrameColors,
  FrameFooter,
  FrameHeader,
  RenderEmailOptions,
  ReplaceTokensOptions,
  SectionLayout,
  SectionValue,
  Token,
  TokenValues,
} from './render';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ToolbarPreset = 'full' | 'standard' | 'minimal';
/** Quill toolbar groups, e.g. `[['bold', 'italic'], [{ list: 'bullet' }]]`. */
export type ToolbarGroups = (string | Record<string, unknown>)[][];

export const TOOLBARS: Record<ToolbarPreset, ToolbarGroups> = {
  full: [
    ['undo', 'redo'],
    [{ header: [false, 1, 2, 3] }],
    [{ font: [false, ...Object.keys(FONTS)] }, { size: [false, ...SIZES] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ script: 'sub' }, { script: 'super' }],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'bullet' }, { list: 'ordered' }, { indent: '-1' }, { indent: '+1' }],
    ['blockquote', 'link', 'image', 'divider'],
    ['clean'],
  ],
  standard: [
    ['undo', 'redo'],
    [{ header: [false, 1, 2, 3] }],
    ['bold', 'italic', 'underline'],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'bullet' }, { list: 'ordered' }, { indent: '-1' }, { indent: '+1' }],
    ['link', 'image'],
    ['clean'],
  ],
  minimal: [['bold', 'italic', 'underline'], [{ list: 'bullet' }, { list: 'ordered' }], ['link'], ['clean']],
};

export const LABELS: Record<string, string> = {
  undo: 'Undo',
  redo: 'Redo',
  header: 'Paragraph style',
  font: 'Font',
  size: 'Text size',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  'script:sub': 'Subscript',
  'script:super': 'Superscript',
  color: 'Text colour',
  background: 'Highlight colour',
  align: 'Alignment',
  'list:bullet': 'Bulleted list',
  'list:ordered': 'Numbered list',
  'indent:-1': 'Decrease indent',
  'indent:+1': 'Increase indent',
  blockquote: 'Quote',
  link: 'Link',
  image: 'Image',
  divider: 'Horizontal line',
  clean: 'Clear formatting',
  more: 'More formatting',
  toolbar: 'Formatting',
  addingImages: 'Adding images…',
  imagesSkipped: 'Some pictures from Word could not be pasted in this browser. Add them with the Image button, or paste in Chrome or Edge.',
  imageFailed: 'The image could not be added.',
  imagesCancelled: 'Pictures were left out.',
  imageDialog: 'Insert image',
  imageAddress: 'Image address',
  imageAddressInvalid: 'Enter an image address starting with https://',
  imageAlt: 'Description (alt text)',
  imageChoose: 'Choose from device…',
  imageRemove: 'Remove',
  adding: 'Adding…',
  insert: 'Insert',
  cancel: 'Cancel',
  field: 'Insert field',
  layout: 'Columns',
  'layout:1-1': '2 columns',
  'layout:1-1-1': '3 columns',
  'layout:1-2': 'Narrow + wide',
  'layout:2-1': 'Wide + narrow',
  removeColumns: 'Remove columns',
  columnPlaceholder: 'Column text…',
  button: 'Button',
  buttonDialog: 'Button',
  buttonDefault: 'Click here',
  buttonText: 'Button text',
  buttonLink: 'Link (https://…, mailto:… or {{field}})',
  buttonLinkInvalid: 'Enter a link starting with https://, mailto: or tel:, or a merge field such as {{url}}.',
  buttonColor: 'Button colour',
  buttonTextColor: 'Text colour',
  buttonAlign: 'Position',
  alignLeft: 'Left',
  alignCenter: 'Centre',
  alignRight: 'Right',
  remove: 'Remove',
  save: 'Save',
  template: 'Template',
  templateContent: 'Replace the message with this template’s starting content?',
  templateContentAction: 'Replace',
};

/** A merge field offered by the "Insert field" menu. */
export interface MergeField {
  /** Token key: letters, digits, `_`, `-`, `.` (e.g. `firstName`, `customer.name`). */
  key: string;
  /** Name shown in the menu and on the chip (default: the key). */
  label?: string;
}

export interface EditorValue {
  /** Email-safe HTML fragment (inline styles only). */
  html: string;
  /** Plain-text version, for the text/plain part of an email. */
  text: string;
  /** Editor content as a Quill Delta, for storage. */
  delta: DeltaLike;
  /** Id of the selected template, if any (store it with the content). */
  template?: string;
}

export interface RichTextEditorOptions {
  /** Initial content as HTML (this editor's output, Word/Docs HTML or any HTML). */
  value?: string;
  /** Initial content as a Delta (takes precedence over `value`). */
  delta?: DeltaLike;
  placeholder?: string;
  /** Toolbar preset or custom groups (default `'full'`). */
  toolbar?: ToolbarPreset | ToolbarGroups;
  /** Base text style; also used for the email output. */
  style?: Partial<EmailStyle>;
  readOnly?: boolean;
  /**
   * Upload an image and resolve with its public http(s) URL. When given,
   * images from the device, pastes and drops are uploaded and linked;
   * otherwise they are embedded in the content (sent as inline attachments,
   * see {@link RichTextEditor.getEmail}). `signal` aborts when the user
   * cancels; pass it to `fetch` to stop the upload (the result is ignored
   * either way).
   */
  uploadImage?: (file: File, options: { signal: AbortSignal }) => Promise<string>;
  /**
   * Images in pasted content (default `'embed'`): screenshots and copied
   * images, pictures from Word (read from the clipboard's RTF, in Chromium
   * browsers), embedded images from web pages and Google Docs, and web
   * images (downloaded when the site allows it, otherwise kept as a link)
   * are added to the content — uploaded through `uploadImage` when given,
   * embedded otherwise. `'drop'` leaves pasted images out.
   */
  pastedImages?: 'embed' | 'drop';
  /**
   * Merge fields offered by an "Insert field" menu. Fields appear in the text
   * as chips and in the HTML as `{{key}}` (`{{key|fallback}}` when typed with
   * a fallback); they are replaced by `getEmail({ tokens })`, `renderEmail`
   * or on the server. Typing or pasting `{{key}}` also makes a chip.
   */
  fields?: MergeField[];
  /**
   * Layout blocks (default `false`): a "Columns" menu for sections of 2 or 3
   * columns (side by side on wide screens, stacked on phones) and a "Button"
   * for calls to action. Content that already has them loads either way.
   */
  layouts?: boolean;
  /**
   * Templates offered by a "Template" menu: a frame (header, footer,
   * colours) plus starting content and style. Pass `TEMPLATES` for the
   * built-in ones, or your own.
   */
  templates?: EmailTemplate[];
  /** The template in use at start (an id from `templates`, or a template). */
  template?: string | EmailTemplate;
  /** Called after every change made by the user. */
  onChange?: (value: EditorValue) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Keep the toolbar visible while scrolling long content (value = top offset in px). */
  stickyToolbar?: boolean | number;
  minHeight?: string;
  maxHeight?: string;
  /** Accessible name of the editing area. */
  ariaLabel?: string;
  /** Override toolbar labels (for translation). */
  labels?: Partial<Record<string, string>>;
}

export interface RichTextEditor {
  /** The underlying Quill instance (advanced use). */
  readonly quill: Quill;
  /** The editor's root element (inside the host element). */
  readonly root: HTMLElement;
  getValue(): EditorValue;
  /** Email-safe HTML fragment. */
  getHtml(): string;
  getText(): string;
  getDelta(): DeltaLike;
  /**
   * A complete, responsive email document containing the content. Embedded
   * images stay inline (data:), which is right for previews; use
   * {@link getEmail} for sending.
   */
  getEmailDocument(options?: EmailDocumentOptions): string;
  /**
   * Everything needed to send the content: HTML (a fragment, or a complete
   * document with `{ document: {…} }`) in which embedded images are `cid:`
   * references, their inline attachments, and the plain-text part.
   */
  getEmail(options?: {
    document?: EmailDocumentOptions;
    tokens?: TokenValues;
    missing?: ReplaceTokensOptions['missing'];
    /** false keeps embedded pictures inline (data:), e.g. for a preview; default true. */
    attachImages?: boolean;
  }): EmailParts;
  /** Merge field keys used in the content, in order. */
  getTokens(): string[];
  /** Insert a merge field chip at the cursor. */
  insertField(key: string, fallback?: string): void;
  /** Insert a column section at the cursor (after the current section when in a column). */
  insertColumns(layout: SectionLayout): void;
  /** Insert a button at the cursor. */
  insertButton(button: ButtonValue): void;
  /** The template in use, if any. */
  getTemplate(): EmailTemplate | undefined;
  /**
   * Use a template (an id from `templates`, a template, or null for none).
   * `content`: `'if-empty'` (default) loads its starting content only into
   * an empty editor, `'replace'` always, `'keep'` never.
   */
  setTemplate(template: string | EmailTemplate | null, options?: { content?: 'if-empty' | 'replace' | 'keep' }): void;
  /**
   * Resolves once pasted, dropped or chosen images have been processed
   * (converted, embedded or uploaded). Await it before reading the value to
   * send, e.g. `await editor.whenIdle(); send(editor.getEmail())`.
   */
  whenIdle(): Promise<void>;
  /** True while images are being processed. */
  isBusy(): boolean;
  /** Replace the content with HTML. Does not trigger `onChange`. */
  setHtml(html: string): void;
  /** Replace the content with a Delta. Does not trigger `onChange`. */
  setDelta(delta: DeltaLike): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  /** Remove the editor from the page. */
  destroy(): void;
}

const STYLE_ID = 'erte-generated-css';

function injectGeneratedCss(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = fontCss() + '\n' + sizeCss();
  doc.head.appendChild(style);
}

function applyCssVariables(root: HTMLElement, style: EmailStyle, opts: RichTextEditorOptions) {
  const vars: Record<string, string> = {
    '--erte-font': (FONTS[style.fontFamily] ?? FONTS[DEFAULT_STYLE.fontFamily]).stack,
    '--erte-size': `${style.fontSize}px`,
    '--erte-color': normColor(style.color) ?? DEFAULT_STYLE.color,
    '--erte-line-height': String(style.lineHeight),
    '--erte-link': normColor(style.linkColor) ?? DEFAULT_STYLE.linkColor,
    '--erte-space': `${style.blockSpacing}px`,
    '--erte-rule': normColor(style.ruleColor) ?? DEFAULT_STYLE.ruleColor,
    '--erte-image-max': `${style.maxImageWidth}px`,
  };
  if (opts.minHeight) vars['--erte-min-height'] = opts.minHeight;
  if (opts.maxHeight) vars['--erte-max-height'] = opts.maxHeight;
  if (typeof opts.stickyToolbar === 'number') vars['--erte-sticky-top'] = `${opts.stickyToolbar}px`;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Controls kept visible when the editor is narrow; the rest sit behind "More formatting". */
const PRIMARY = new Set(['undo', 'redo', 'header', 'bold', 'italic', 'underline', 'list:bullet', 'list:ordered', 'link', 'template']);
const COMPACT_BELOW = 600;

const controlKey = (el: HTMLElement) => {
  const name = Array.from(el.classList).find((c) => c.startsWith('ql-') && c !== 'ql-picker' && c !== 'ql-active' && c !== 'ql-expanded')?.slice(3);
  const value = el.getAttribute('value');
  return name ? (value ? `${name}:${value}` : name) : '';
};

/** TinyMCE-style "sliding" toolbar for narrow editors (phones, sidebars). Returns a function that stops it. */
function setupCompactToolbar(root: HTMLElement, toolbar: HTMLElement, labels: Record<string, string>): () => void {
  const doc = root.ownerDocument;
  let secondary = 0;
  toolbar.querySelectorAll<HTMLElement>(':scope > .ql-formats').forEach((group) => {
    const controls = Array.from(group.children) as HTMLElement[];
    for (const c of controls) {
      if (!PRIMARY.has(controlKey(c))) {
        c.classList.add('erte-secondary');
        secondary++;
      }
    }
    if (controls.every((c) => c.classList.contains('erte-secondary'))) group.classList.add('erte-secondary');
  });
  if (!secondary) return () => {};

  const group = doc.createElement('span');
  group.className = 'ql-formats erte-more-group';
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'erte-more';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', labels.more ?? 'More formatting');
  more.title = labels.more ?? 'More formatting';
  more.innerHTML = '<svg viewBox="0 0 18 18"><g class="ql-fill"><circle cx="4" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="14" cy="9" r="1.6"/></g></svg>';
  more.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('click', () => {
    const open = root.classList.toggle('erte--more');
    more.setAttribute('aria-expanded', String(open));
  });
  group.appendChild(more);
  toolbar.appendChild(group);

  const update = () => root.classList.toggle('erte--compact', root.clientWidth > 0 && root.clientWidth < COMPACT_BELOW);
  update();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(update);
  observer.observe(root);
  return () => observer.disconnect();
}

function labelToolbar(toolbar: HTMLElement, labels: Record<string, string>) {
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', labels.toolbar ?? 'Formatting');
  toolbar.querySelectorAll<HTMLElement>('button, .ql-picker').forEach((el) => {
    const key = controlKey(el);
    if (!key) return;
    const label = labels[key] ?? labels[key.split(':')[0]];
    if (!label) return;
    el.setAttribute('title', label);
    el.setAttribute('aria-label', label);
    el.querySelector('.ql-picker-label')?.setAttribute('aria-label', label);
  });
}

/** Natural size of a web image (undefined when it cannot be loaded in time). */
function imageSize(url: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(undefined), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : undefined);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(undefined);
    };
    img.src = url;
  });
}

const isPixel = (size: { width: number; height: number }) => size.width <= 2 && size.height <= 2;

// ------------------------------------------------------ image dialog ---

/**
 * What the dialogs share: the element, an error line, and closing by Cancel,
 * Escape or a click outside (except on `ignore`, e.g. the control that opens it).
 */
function createDialogShell(
  root: HTMLElement,
  options: { className: string; label: string; html: string; ignore?: string; onClose(done: boolean, outside: boolean): void },
) {
  const doc = root.ownerDocument;
  const dialog = doc.createElement('div');
  dialog.className = options.className;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', options.label);
  dialog.hidden = true;
  dialog.innerHTML = options.html;
  const $ = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
  const form = $<HTMLFormElement>('form');
  const error = $('.erte-dialog__error');
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = !message;
  };
  const onOutside = (e: Event) => {
    const target = e.target as Element | null;
    if (target && !dialog.contains(target) && !(options.ignore && target.closest?.(options.ignore))) close(false, true);
  };
  function close(done: boolean, outside = false) {
    if (dialog.hidden) return;
    dialog.hidden = true;
    doc.removeEventListener('pointerdown', onOutside, true);
    options.onClose(done, outside);
  }
  const open = () => {
    showError('');
    dialog.hidden = false;
    doc.addEventListener('pointerdown', onOutside, true);
  };
  $('.erte-dialog__cancel').addEventListener('click', () => close(false));
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    }
  });
  root.appendChild(dialog);
  return { dialog, form, $, showError, open, close };
}

interface ImageDialogHandlers {
  /** Insert an image by address. */
  onUrl(url: string, alt: string): void;
  /** Add a chosen file; stop and insert nothing when `signal` aborts. */
  onFile(file: File, alt: string, signal: AbortSignal): Promise<void>;
  /** The dialog closed; `inserted` is false when it was cancelled, `outside` when by a click elsewhere. */
  onClose(inserted: boolean, outside: boolean): void;
}

const altFromName = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * The image dialog: an address, or a file from the device (previewed before
 * it is added), plus alt text. Cancel, Escape or a click outside closes it at
 * any point, including while a chosen file is being processed or uploaded;
 * nothing is inserted then.
 */
function createImageDialog(root: HTMLElement, labels: Record<string, string>, handlers: ImageDialogHandlers) {
  const { dialog, form, $, showError, open, close } = createDialogShell(root, {
    className: 'erte-dialog',
    label: labels.imageDialog,
    ignore: '.ql-image',
    onClose(inserted, outside) {
      work?.abort(); // stop an upload in progress; its image is not inserted
      work = null;
      setBusy(false);
      choose(null);
      handlers.onClose(inserted, outside);
    },
    html: `
    <form class="erte-dialog__form">
      <label class="erte-dialog__field erte-dialog__url"><span></span><input type="url" name="url" placeholder="https://" inputmode="url" autocomplete="off"></label>
      <div class="erte-dialog__file" hidden>
        <img class="erte-dialog__thumb" alt="">
        <span class="erte-dialog__file-name"></span>
        <button type="button" class="erte-dialog__remove"></button>
      </div>
      <label class="erte-dialog__field"><span></span><input type="text" name="alt" autocomplete="off"></label>
      <p class="erte-dialog__error" role="alert" hidden></p>
      <div class="erte-dialog__actions">
        <button type="button" class="erte-dialog__upload"></button>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
        <span class="erte-dialog__spacer"></span>
        <button type="button" class="erte-dialog__cancel"></button>
        <button type="submit" class="erte-dialog__insert"></button>
      </div>
    </form>`,
  });
  const url = form.elements.namedItem('url') as HTMLInputElement;
  const alt = form.elements.namedItem('alt') as HTMLInputElement;
  const urlField = $('.erte-dialog__url');
  const fileBlock = $('.erte-dialog__file');
  const thumb = $<HTMLImageElement>('.erte-dialog__thumb');
  const fileName = $('.erte-dialog__file-name');
  const removeBtn = $<HTMLButtonElement>('.erte-dialog__remove');
  const uploadBtn = $<HTMLButtonElement>('.erte-dialog__upload');
  const insertBtn = $<HTMLButtonElement>('.erte-dialog__insert');
  const fileInput = $<HTMLInputElement>('input[type=file]');
  urlField.querySelector('span')!.textContent = labels.imageAddress;
  alt.closest('label')!.querySelector('span')!.textContent = labels.imageAlt;
  removeBtn.textContent = labels.imageRemove;
  uploadBtn.textContent = labels.imageChoose;
  $('.erte-dialog__cancel').textContent = labels.cancel;
  insertBtn.textContent = labels.insert;

  let chosen: File | null = null;
  let previewUrl = '';
  let work: AbortController | null = null;

  const setBusy = (busy: boolean) => {
    for (const el of [insertBtn, uploadBtn, removeBtn, url, alt]) el.disabled = busy;
    insertBtn.textContent = busy ? labels.adding : labels.insert;
    dialog.setAttribute('aria-busy', String(busy));
  };
  const choose = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : '';
    chosen = file;
    thumb.src = previewUrl;
    fileName.textContent = file?.name ?? '';
    fileBlock.hidden = !file;
    urlField.hidden = !!file;
    uploadBtn.hidden = !!file;
    showError('');
  };

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    choose(f);
    alt.focus();
  });
  removeBtn.addEventListener('click', () => {
    choose(null);
    url.focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (work) return;
    if (chosen) {
      const w = (work = new AbortController());
      setBusy(true);
      try {
        await handlers.onFile(chosen, alt.value.trim() || altFromName(chosen.name), w.signal);
        if (w.signal.aborted) return;
        work = null;
        close(true);
      } catch (err) {
        if (w.signal.aborted) return; // cancelled: the dialog is already closed
        work = null;
        setBusy(false);
        showError(`${labels.imageFailed} ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    const value = url.value.trim();
    if (!/^https?:\/\//i.test(value)) return showError(labels.imageAddressInvalid);
    handlers.onUrl(value, alt.value.trim());
    close(true);
  });
  return {
    open() {
      url.value = '';
      alt.value = '';
      choose(null);
      setBusy(false);
      open();
      url.focus();
    },
    close: () => close(false),
  };
}

/** A short status message inside the editor, optionally with an action (e.g. Cancel). */
function createNotice(root: HTMLElement) {
  const doc = root.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'erte-notice';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  const text = doc.createElement('span');
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'erte-notice__action';
  el.append(text, button);
  root.appendChild(el);
  let timer = 0;
  let onAction: (() => void) | null = null;
  button.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
  button.addEventListener('click', () => onAction?.());
  return (message: string, ms = 0, action?: { label: string; run: () => void }) => {
    clearTimeout(timer);
    text.textContent = message;
    el.hidden = !message;
    onAction = action?.run ?? null;
    button.hidden = !action;
    button.textContent = action?.label ?? '';
    el.classList.toggle('erte-notice--action', !!action);
    if (message && ms) timer = window.setTimeout(() => (el.hidden = true), ms);
  };
}

/** Colours offered for buttons (any colour can be typed). */
const BUTTON_COLOURS = ['#0b57d0', '#1f3a5f', '#0b7a3b', '#c00000', '#e36c09', '#6b3fa0', '#1f2328'];

interface ButtonDialogHandlers {
  onSave(value: ButtonValue): void;
  onRemove(): void;
  /** The dialog closed; `outside` when by a click elsewhere. */
  onClose(saved: boolean, outside: boolean): void;
}

/** Edit a button: text, link, colours, position. Cancel, Escape or a click outside close it unchanged. */
function createButtonDialog(root: HTMLElement, labels: Record<string, string>, handlers: ButtonDialogHandlers) {
  const swatches = BUTTON_COLOURS.map((c) => `<button type="button" class="erte-swatch" data-colour="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  const { dialog, form, $, showError, open, close } = createDialogShell(root, {
    className: 'erte-dialog erte-button-dialog',
    label: labels.buttonDialog,
    onClose: (saved, outside) => handlers.onClose(saved, outside),
    html: `
    <form class="erte-dialog__form">
      <label class="erte-dialog__field"><span></span><input type="text" name="text" autocomplete="off" maxlength="200"></label>
      <label class="erte-dialog__field"><span></span><input type="text" name="href" inputmode="url" autocomplete="off" spellcheck="false"></label>
      <div class="erte-dialog__field"><span class="erte-dialog__label"></span><div class="erte-swatches">${swatches}<input type="text" name="background" aria-label="" maxlength="7" spellcheck="false"></div></div>
      <div class="erte-dialog__row">
        <label class="erte-dialog__field"><span></span><select name="align"><option value="left"></option><option value="center"></option><option value="right"></option></select></label>
        <label class="erte-dialog__field"><span></span><select name="color"><option value="#ffffff"></option><option value="#1f2328"></option></select></label>
      </div>
      <p class="erte-dialog__error" role="alert" hidden></p>
      <div class="erte-dialog__actions">
        <button type="button" class="erte-dialog__remove-button"></button>
        <span class="erte-dialog__spacer"></span>
        <button type="button" class="erte-dialog__cancel"></button>
        <button type="submit" class="erte-dialog__insert"></button>
      </div>
    </form>`,
  });
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement & HTMLSelectElement;
  const [text, href, background, align, color] = ['text', 'href', 'background', 'align', 'color'].map(field);
  const labelOf = (el: Element) => el.closest('.erte-dialog__field')!.querySelector('span')!;
  labelOf(text).textContent = labels.buttonText;
  labelOf(href).textContent = labels.buttonLink;
  labelOf(background).textContent = labels.buttonColor;
  background.setAttribute('aria-label', labels.buttonColor);
  labelOf(align).textContent = labels.buttonAlign;
  labelOf(color).textContent = labels.buttonTextColor;
  const alignNames = [labels.alignLeft, labels.alignCenter, labels.alignRight];
  Array.from(align.options).forEach((o, i) => (o.textContent = alignNames[i]));
  color.options[0].textContent = 'White';
  color.options[1].textContent = 'Dark';
  const removeBtn = $<HTMLButtonElement>('.erte-dialog__remove-button');
  removeBtn.textContent = labels.remove;
  $('.erte-dialog__cancel').textContent = labels.cancel;
  $('.erte-dialog__insert').textContent = labels.save;

  const swatchButtons = dialog.querySelectorAll<HTMLElement>('.erte-swatch');
  const markSwatch = () => swatchButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.colour === background.value.toLowerCase())));
  swatchButtons.forEach((b) =>
    b.addEventListener('click', () => {
      background.value = b.dataset.colour!;
      markSwatch();
    }),
  );
  background.addEventListener('input', markSwatch);
  removeBtn.addEventListener('click', () => {
    handlers.onRemove();
    close(true);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const link = href.value.trim();
    if (link && !isLink(link)) return showError(labels.buttonLinkInvalid);
    const value = asButton({ text: text.value, href: link, background: background.value, color: color.value, align: align.value });
    if (!value) return text.focus();
    handlers.onSave(value);
    close(true);
  });
  return {
    open(value: ButtonValue) {
      text.value = value.text;
      href.value = value.href;
      background.value = value.background ?? '';
      align.value = value.align ?? 'left';
      color.value = value.color === '#1f2328' ? '#1f2328' : '#ffffff';
      markSwatch();
      open();
      text.focus();
      text.select();
    },
  };
}

// ------------------------------------------------------------ editor ---

/**
 * Create an inline rich text editor inside `host`. The editor is part of
 * the page (no iframe), sized by its container, and works with touch.
 */
export function createRichTextEditor(host: HTMLElement | string, opts: RichTextEditorOptions = {}): RichTextEditor {
  const target = typeof host === 'string' ? document.querySelector<HTMLElement>(host) : host;
  if (!target) throw new Error(`createRichTextEditor: element ${String(host)} not found`);
  registerFormats();
  injectGeneratedCss(target.ownerDocument);
  const doc = target.ownerDocument;
  const Delta = Quill.import('delta') as any;
  const Toolbar = Quill.import('modules/toolbar') as any;
  const snowLink = (Quill.import('themes/snow') as any).DEFAULTS.modules.toolbar.handlers.link;

  const templates = opts.templates ?? [];
  const findTemplate = (t: string | EmailTemplate | null | undefined) => (typeof t === 'string' ? templates.find((x) => x.id === t) : t ?? undefined);
  let template = findTemplate(opts.template);
  const styleFor = (t: EmailTemplate | undefined): EmailStyle => ({ ...DEFAULT_STYLE, ...opts.style, ...t?.style });
  let style = styleFor(template);
  const labels = { ...LABELS, ...opts.labels } as Record<string, string>;
  const root = doc.createElement('div');
  root.className = 'erte';
  if (opts.stickyToolbar) root.classList.add('erte--sticky');
  applyCssVariables(root, style, opts);
  const container = doc.createElement('div');
  root.appendChild(container);
  target.appendChild(root);

  const baseClean = () => ({ baseFont: style.fontFamily, baseSize: style.fontSize, baseColor: style.color });
  const embedPasted = (opts.pastedImages ?? 'embed') === 'embed';
  const fields = (opts.fields ?? []).filter((f) => isTokenKey(f.key));
  const fieldLabel = (key: string) => fields.find((f) => f.key === key)?.label ?? key;

  // Toolbar: the preset plus the optional menus.
  let toolbar = typeof opts.toolbar === 'object' ? opts.toolbar : TOOLBARS[opts.toolbar ?? 'full'];
  const hasControl = (name: string) => JSON.stringify(toolbar).includes(`"${name}"`);
  if (templates.length && !hasControl('template')) toolbar = [[{ template: templates.map((t) => t.id) }], ...toolbar];
  if (opts.layouts && !hasControl('layout')) toolbar = [...toolbar, [{ layout: Object.keys(LAYOUTS) }, 'button']];
  if (fields.length && !hasControl('field')) toolbar = [...toolbar, [{ field: fields.map((f) => f.key) }]];

  const notice = createNotice(root);
  const busy = new Set<Promise<unknown>>();
  const track = <T,>(work: Promise<T>): Promise<T> => {
    busy.add(work);
    root.classList.add('erte--busy');
    const done = () => {
      busy.delete(work);
      if (!busy.size) root.classList.remove('erte--busy');
    };
    work.then(done, done);
    return work;
  };

  // ------------------------------------------------ editors and focus ---
  // The main editor plus one editor per column; the toolbar acts on the one in use.
  const columnQuills = new WeakMap<Element, Quill>();
  let quill: Quill; // the main editor (assigned below)
  let active: Quill;
  const editorOf = (el: EventTarget | null): Quill => {
    const col = (el as Element | null)?.closest?.('.erte-column');
    return (col && columnQuills.get(col)) || quill;
  };
  const current = (): Quill => (active && active.root.isConnected ? active : quill);
  const isColumn = (q: Quill) => q !== quill;
  /** Replace `length` characters at `index` with `content` (a Delta), as the user. */
  const replace = (q: Quill, index: number, length: number, content: any = new Delta()) =>
    q.updateContents(new Delta().retain(index).delete(length).concat(content), 'user');
  /** The editor holding a block (button, section) and the block's position in it; null once it is gone. */
  const locate = (node: Element | null): { q: Quill; index: number } | null => {
    const blot = node && (Quill.find(node) as any);
    if (!blot) return null;
    const q = editorOf(node);
    return { q, index: blot.offset(q.scroll) };
  };
  /** The editor's selection, focusing it; the end of its text if it has none yet. */
  const selectionIn = (q: Quill): { index: number; length: number } => q.getSelection(true) ?? { index: Math.max(0, q.getLength() - 1), length: 0 };
  /** Content width available to images in an editor (a column is narrower). */
  const widthFor = (q: Quill): number => {
    const col = q.container.closest('.erte-column');
    const section = col?.closest<HTMLElement>('.erte-section');
    if (!col || !section) return style.maxImageWidth;
    const index = Array.from(col.parentElement!.children).indexOf(col);
    return columnWidths(section.dataset.layout ?? '', style.maxImageWidth).inner[index] ?? style.maxImageWidth;
  };

  // ------------------------------------------------------------ images ---
  let imageDialog: ReturnType<typeof createImageDialog>;
  let imageTarget: { q: Quill; range: { index: number; length: number } } | null = null;
  const cancelled = () => new DOMException('Cancelled', 'AbortError');
  /** Rejects when `signal` aborts: raced with work that may ignore the signal, it ends the wait at once. */
  const whenAborted = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(cancelled())));
  const stopIfCancelled = (signal?: AbortSignal) => {
    if (signal?.aborted) throw cancelled();
  };
  /** Image work the user can cancel from the notice ("Adding images… Cancel"). */
  const cancellableWork = () => {
    const controller = new AbortController();
    notice(labels.addingImages, 0, { label: labels.cancel, run: () => controller.abort() });
    return controller;
  };

  /**
   * Make an image source email-ready: embedded data is converted/downscaled
   * and uploaded when `uploadImage` is set; web images are downloaded and
   * treated the same when the site allows it, otherwise kept as links.
   */
  async function prepareImage(src: string, maxWidth: number, name = 'image', signal?: AbortSignal): Promise<{ src: string; width?: number } | null> {
    let data = src.startsWith('data:') ? src : null;
    if (!data && /^https?:\/\//i.test(src)) data = await fetchImageAsDataUrl(src, { signal });
    stopIfCancelled(signal);
    if (!data) {
      // The site does not allow downloading it: keep it as a link.
      if (!/^https?:\/\//i.test(src)) return null;
      const size = await imageSize(src);
      stopIfCancelled(signal);
      if (size && isPixel(size)) return null; // tracking pixel
      return { src, width: size && Math.min(size.width, maxWidth) };
    }
    // 2x the display width stays sharp on high-DPI screens.
    const image = await normalizeImage(data, style.maxImageWidth * 2);
    stopIfCancelled(signal);
    if (!image || isPixel(image)) return null;
    const width = Math.min(image.width, maxWidth);
    if (opts.uploadImage) {
      const blob = dataUrlToBlob(image.dataUrl);
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      const file = new File([blob], `${altFromName(name)}.${ext}`, { type: blob.type });
      const url = await opts.uploadImage(file, { signal: signal ?? new AbortController().signal });
      stopIfCancelled(signal); // cancelled while uploading: do not insert it
      return { src: url, width };
    }
    return { src: image.dataUrl, width };
  }

  async function insertImageFile(q: Quill, file: File, alt: string, index?: number, signal?: AbortSignal) {
    if (!/^image\//.test(file.type)) return;
    const prepared = await prepareImage(await blobToDataUrl(file), widthFor(q), file.name, signal);
    stopIfCancelled(signal);
    if (!prepared) throw new Error('not a readable image');
    insertPrepared(q, prepared, alt, index);
  }

  function insertPrepared(q: Quill, image: { src: string; width?: number }, alt: string, index?: number) {
    if (!q.root.isConnected) return; // its column was removed meanwhile
    const at = Math.min(index ?? q.getLength() - 1, q.getLength() - 1);
    q.insertEmbed(at, 'image', image.src, 'user');
    q.formatText(at, 1, { alt, ...(image.width ? { width: String(image.width) } : {}) }, 'user');
    q.setSelection(at + 1, 0, 'user');
  }

  /** Pasted or dropped files; the user can cancel (images added so far stay). */
  async function insertImageFiles(q: Quill, files: File[], index: number) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const work = cancellableWork();
    for (const f of images) {
      try {
        await insertImageFile(q, f, altFromName(f.name), index++, work.signal);
      } catch (e) {
        if (work.signal.aborted) return notice(labels.imagesCancelled, 4000);
        console.error('Image could not be added', e);
        notice(labels.imageFailed, 6000);
        return;
      }
    }
    notice('');
  }

  /** Prepare every image in a pasted Delta (also inside columns); unreadable or cancelled ones are left out. */
  async function prepareDeltaImages(ops: any[], maxWidth: number, signal: AbortSignal): Promise<any[]> {
    const out = await Promise.all(
      ops.map(async (op: any) => {
        const section = op.insert?.section;
        if (section && Array.isArray(section.columns)) {
          const { inner } = columnWidths(section.layout, maxWidth);
          const columns = await Promise.all(section.columns.map((c: any[], i: number) => prepareDeltaImages(c ?? [], inner[i] ?? maxWidth, signal)));
          return { ...op, insert: { section: { ...section, columns } } };
        }
        const src = op.insert?.image;
        if (typeof src !== 'string') return op;
        try {
          const prepared = await prepareImage(src, maxWidth, 'image', signal);
          if (!prepared) return null;
          const declared = Number(op.attributes?.width);
          const width = declared > 0 ? Math.min(declared, maxWidth) : prepared.width;
          return { insert: { image: prepared.src }, attributes: { ...op.attributes, ...(width ? { width: String(width) } : {}) } };
        } catch (e) {
          if (!signal.aborted) console.error('Pasted image could not be added', e);
          return null;
        }
      }),
    );
    return out.filter(Boolean);
  }
  const hasImages = (ops: any[]): boolean => ops.some((op) => op.insert?.image || (Array.isArray(op.insert?.section?.columns) && op.insert.section.columns.some((c: any[]) => hasImages(c ?? []))));
  const withoutImages = (ops: any[]): any[] =>
    ops
      .filter((op) => !op.insert?.image)
      .map((op) => (op.insert?.section ? { ...op, insert: { section: { ...op.insert.section, columns: op.insert.section.columns.map((c: any[]) => withoutImages(c ?? [])) } } } : op));

  // ------------------------------------------------------ merge fields ---
  const withTokens = (delta: DeltaLike) => new Delta(tokensToEmbeds(delta).ops);
  const INLINE = ['bold', 'italic', 'underline', 'strike', 'script', 'color', 'background', 'font', 'size', 'link'];
  /** The text formatting at a position, for a chip inserted there. */
  const inlineFormat = (q: Quill, index: number, length = 0) =>
    Object.fromEntries(Object.entries(q.getFormat(index, length)).filter(([k]) => INLINE.includes(k)));

  function insertField(key: string, fallback?: string) {
    const q = current();
    const range = selectionIn(q);
    const format = inlineFormat(q, range.index, range.length);
    const token = fallback ? { key, fallback } : { key };
    replace(q, range.index, range.length, new Delta().insert({ token }, format));
    q.setSelection(range.index + 1, 0, 'user');
  }

  /** `{{key}}` just typed before the cursor becomes a chip. */
  function chipTypedToken(q: Quill): boolean {
    const range = q.getSelection();
    if (!range || range.length) return false;
    const start = Math.max(0, range.index - 120);
    let text = '';
    let from = start;
    for (const op of (q.getContents(start, range.index - start) as any).ops) {
      if (typeof op.insert === 'string') text += op.insert;
      else {
        from += text.length + 1;
        text = '';
      }
    }
    const m = text.match(TRAILING_TOKEN);
    if (!m) return false;
    const at = from + text.length - m[0].length;
    const format = inlineFormat(q, at, m[0].length);
    replace(q, at, m[0].length, new Delta().insert({ token: asToken({ key: m[1], fallback: m[2] }) }, format));
    q.setSelection(at + 1, 0, 'silent');
    return true;
  }
  const typedClosingBrace = (change: any) => change.ops.some((op: any) => typeof op.insert === 'string' && op.insert.endsWith('}'));

  // ------------------------------------------------------------- paste ---
  async function pasteHtml(q: Quill, html: string, rtf: string, index: number, length: number) {
    const { html: cleaned, skippedImages } = cleanHtmlDetailed(html, {
      ...baseClean(),
      keepImages: embedPasted,
      localImages: embedPasted ? rtfImages(rtf) : [],
    });
    let delta = withTokens(q.clipboard.convert({ html: cleaned }));
    let picturesCancelled = false;
    if (hasImages(delta.ops)) {
      // Cancelling leaves the pictures out; the text is still pasted.
      const work = cancellableWork();
      const ops = await Promise.race([prepareDeltaImages(delta.ops, widthFor(q), work.signal), whenAborted(work.signal).catch(() => null)]);
      delta = new Delta(ops ?? withoutImages(delta.ops));
      picturesCancelled = work.signal.aborted;
      notice('');
    }
    if (!q.root.isConnected) return;
    // The content may have changed while images were processed.
    index = Math.min(index, q.getLength() - 1);
    length = Math.min(length, q.getLength() - 1 - index);
    replace(q, index, length, delta);
    q.setSelection(index + delta.length(), 0, 'silent');
    q.scrollSelectionIntoView();
    if (picturesCancelled) notice(labels.imagesCancelled, 4000);
    else if (skippedImages) notice(labels.imagesSkipped, 10000);
  }

  /** What every editor (main and columns) does: cleaned paste, chips, font markers, column conversion. */
  function wire(q: Quill) {
    // Font keys travel as data attributes through the paste cleaner.
    q.clipboard.addMatcher(Node.ELEMENT_NODE, (node: Node, delta: any) => {
      const key = (node as Element).getAttribute?.('data-erte-font');
      return key && FONTS[key] ? delta.compose(new Delta().retain(delta.length(), { font: key })) : delta;
    });
    // Column sections (from this editor's own HTML): each column converted on its own; inside a column, flattened.
    q.clipboard.addMatcher('div.erte-section', (node: Node) => {
      const el = node as HTMLElement;
      const columns = Array.from(el.children)
        .filter((c) => c.classList.contains('erte-column'))
        .map((c) => normalizeColumn(q.clipboard.convert({ html: c.innerHTML }).ops));
      if (isColumn(q)) return columns.reduce((d: any, c) => d.concat(new Delta(c)), new Delta());
      return new Delta().insert({ section: { layout: (el.dataset.layout ?? '') in LAYOUTS ? el.dataset.layout : '1-1', columns } });
    });

    // Paste: Word, Google Docs and web HTML are cleaned first; images are embedded or uploaded.
    q.root.addEventListener(
      'paste',
      (e: ClipboardEvent) => {
        const data = e.clipboardData;
        if (!data || !q.isEnabled() || editorOf(e.target) !== q) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // Clipboard data is only readable during the event: take it all now.
        const range = selectionIn(q);
        const html = data.getData('text/html');
        const text = data.getData('text/plain');
        const rtf = data.getData('text/rtf');
        const files = Array.from(data.files ?? []);
        if (!html && !text && files.length) {
          if (!embedPasted) return;
          q.deleteText(range.index, range.length, 'user');
          return void track(insertImageFiles(q, files, range.index));
        }
        if (html) return void track(pasteHtml(q, html, rtf, range.index, range.length));
        const delta = withTokens(new Delta().insert(text));
        replace(q, range.index, range.length, delta);
        q.setSelection(range.index + delta.length(), 0, 'silent');
        q.scrollSelectionIntoView();
      },
      true,
    );

    // Chips show the field's name; the key is in the tooltip.
    q.on('editor-change', () =>
      q.root.querySelectorAll<HTMLElement>('.erte-token:not([data-label])').forEach((chip) => {
        const key = chip.getAttribute('data-key') ?? '';
        const fallback = chip.getAttribute('data-fallback');
        chip.setAttribute('data-label', fieldLabel(key));
        chip.title = fallback ? `${tokenText({ key })}, or “${fallback}” when empty` : tokenText({ key });
      }),
    );
  }

  const HISTORY = { delay: 600, maxStack: 200, userOnly: true };
  /** Dropped image files: uploaded when `uploadImage` is set, embedded otherwise. */
  const droppedFiles = (editor: () => Quill) => ({
    handler: (range: { index: number }, files: File[]) => void track(insertImageFiles(editor(), files, range.index)),
  });

  const keyboardBindings = {
    // Tab anywhere in a list item indents it; elsewhere it inserts a tab.
    tab: {
      key: 'Tab',
      handler(this: { quill: Quill }, range: { index: number; length: number }, context: { format: Record<string, unknown> }) {
        if (context.format.list) {
          this.quill.format('indent', '+1', 'user');
          return false;
        }
        this.quill.deleteText(range.index, range.length, 'user');
        this.quill.insertText(range.index, '\t', 'user');
        this.quill.setSelection(range.index + 1, 0, 'silent');
        return false;
      },
    },
  };

  // ------------------------------------------------------- the editors ---
  quill = new Quill(container, {
    theme: 'snow',
    bounds: root,
    placeholder: opts.placeholder,
    readOnly: !!opts.readOnly,
    formats: FORMATS,
    modules: {
      toolbar: {
        container: toolbar,
        handlers: {
          undo: () => current().history.undo(),
          redo: () => current().history.redo(),
          field: (key: string) => {
            if (key) insertField(key);
          },
          divider: () => {
            const q = current();
            const range = selectionIn(q);
            q.insertEmbed(range.index, 'divider', true, 'user');
            q.setSelection(range.index + 1, 0, 'user');
          },
          image: () => {
            const q = current();
            imageTarget = { q, range: selectionIn(q) };
            imageDialog.open();
          },
          layout: (layout: string) => {
            if (layout in LAYOUTS) insertColumns(layout as SectionLayout);
          },
          button: () => {
            const value = { text: labels.buttonDefault, href: '' };
            const node = insertButton(value);
            if (node) openButtonDialog(node);
          },
          template: (id: string) => {
            if (id) chooseTemplate(id);
          },
        },
      },
      history: HISTORY,
      uploader: droppedFiles(() => quill),
      keyboard: { bindings: keyboardBindings },
    },
  });
  active = quill;
  wire(quill);

  // Column editors live inside the main editor's DOM; keep the main editor out of their business.
  const inColumn = (node: Node | null) => !!(node && (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('.erte-columns'));
  const scroll = quill.scroll as any;
  const takeRecords = scroll.observer.takeRecords.bind(scroll.observer);
  scroll.observer.takeRecords = () => takeRecords().filter((m: MutationRecord) => !inColumn(m.target));
  const scrollUpdate = scroll.update.bind(scroll);
  scroll.update = (mutations?: unknown, context?: unknown) =>
    scrollUpdate(Array.isArray(mutations) ? mutations.filter((m: MutationRecord) => !inColumn(m.target)) : mutations, context);
  const selection = (quill as any).selection;
  const normalizeNative = selection.normalizeNative.bind(selection);
  selection.normalizeNative = (range: Range) => (inColumn(range.startContainer) || inColumn(range.endContainer) ? null : normalizeNative(range));

  setLayoutHost(quill.root, {
    labels,
    readOnly: () => !quill.isEnabled(),
    removeSection(node) {
      const blot = Quill.find(node) as any;
      if (!blot || blot.scroll !== quill.scroll) return;
      const index = blot.offset(quill.scroll);
      replace(quill, index, 1);
      active = quill;
      quill.setSelection(Math.min(index, quill.getLength() - 1), 0, 'user');
    },
    mountColumn(el, ops, onUserChange) {
      // Snow theme for the link tooltip; its toolbar is a hidden stub (the main toolbar is shared).
      const q: Quill = new Quill(el, {
        theme: 'snow',
        bounds: root,
        placeholder: labels.columnPlaceholder,
        formats: COLUMN_FORMATS,
        modules: {
          toolbar: { container: doc.createElement('div') },
          history: HISTORY,
          uploader: droppedFiles(() => q),
          keyboard: {
            bindings: {
              ...keyboardBindings,
              link: { key: 'k', shortKey: true, handler: (_r: unknown, ctx: { format: Record<string, unknown> }) => snowLink.call({ quill: q }, !ctx.format.link) },
              // Select all selects the column (browsers would select the whole editor).
              selectAll: {
                key: 'a',
                shortKey: true,
                handler: () => {
                  q.setSelection(0, q.getLength(), 'user');
                  return false;
                },
              },
            },
          },
        },
      });
      columnQuills.set(el, q);
      el.querySelector('.ql-editor')?.setAttribute('aria-label', labels.columnPlaceholder.replace(/…$/, ''));
      wire(q);
      q.setContents(new Delta(ops), 'silent');
      q.history.clear();
      q.on('text-change', (change: any, _old: unknown, source: string) => {
        if (source !== 'user') return;
        onUserChange(change.ops); // every edit, in order, before any chip conversion below
        if (typedClosingBrace(change)) chipTypedToken(q);
      });
      q.on('editor-change', () => {
        if (active === q) tbModule.update();
      });
      return q;
    },
  });

  // ----------------------------------------------------------- toolbar ---
  const tbModule = quill.getModule('toolbar') as any;
  const toolbarEl = tbModule.container as HTMLElement;
  // The toolbar acts on the editor in use: the main one or a column. Its handlers, focus
  // handling and state all go through `this.quill`, so that points at the current editor.
  Object.defineProperty(tbModule, 'quill', { get: current, configurable: true });
  tbModule.update = (range?: unknown) => {
    const q = current();
    // The column's last known selection: asking it for the selection now could move its caret.
    return Toolbar.prototype.update.call(tbModule, q === quill ? range : (q as any).selection.lastRange);
  };
  labelToolbar(toolbarEl, labels);
  const actionPicker = (name: string, label: string, itemLabel: (value: string) => string) => {
    const picker = toolbarEl.querySelector<HTMLElement>(`.ql-${name}`);
    if (!picker) return;
    picker.classList.add('erte-action-picker');
    picker.querySelector('.ql-picker-label')?.setAttribute('data-erte-label', label);
    picker.querySelectorAll<HTMLElement>('.ql-picker-item').forEach((item) => item.setAttribute('data-label', itemLabel(item.getAttribute('data-value') ?? '')));
  };
  actionPicker('field', labels.field, fieldLabel);
  actionPicker('layout', labels.layout, (v) => labels[`layout:${v}`] ?? v);
  actionPicker('template', labels.template, (v) => templates.find((t) => t.id === v)?.name ?? v);
  const stopCompactToolbar = setupCompactToolbar(root, toolbarEl, labels);
  // Keep the text selection when tapping toolbar buttons (mobile keyboards stay open).
  toolbarEl.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });

  // Accessibility
  quill.root.setAttribute('role', 'textbox');
  quill.root.setAttribute('aria-multiline', 'true');
  quill.root.setAttribute('aria-label', opts.ariaLabel ?? 'Message');

  // ------------------------------------------------------ image dialog ---
  imageDialog = createImageDialog(root, labels, {
    onUrl: (url, alt) => {
      const t = imageTarget;
      if (!t) return;
      const max = widthFor(t.q);
      void track(imageSize(url).then((size) => insertPrepared(t.q, { src: url, width: size && Math.min(size.width, max) }, alt, t.range.index)));
    },
    onFile: (file, alt, signal) => track(Promise.race([insertImageFile(imageTarget?.q ?? quill, file, alt, imageTarget?.range.index, signal), whenAborted(signal)])),
    onClose: (inserted, outside) => {
      if (inserted || outside || !imageTarget) return; // a click elsewhere keeps focus where it went
      // Cancelled: back to where the user was.
      imageTarget.q.focus();
      imageTarget.q.setSelection(imageTarget.range, 'silent');
    },
  });

  // ----------------------------------------------------------- layouts ---
  /** Where a new block goes in the main editor: at the cursor, or after the section being edited. */
  function mainInsertIndex(): number {
    const q = current();
    const section = q !== quill && locate(q.container.closest('.erte-section'));
    if (section) return section.index + 1;
    const range = selectionIn(quill);
    if (range.length) quill.deleteText(range.index, range.length, 'user');
    return range.index;
  }

  function insertColumns(layout: SectionLayout) {
    if (!(layout in LAYOUTS)) return;
    const index = mainInsertIndex();
    const columns = LAYOUTS[layout].map(() => [{ insert: '\n' }]);
    const before = new Set(quill.root.querySelectorAll('.erte-section'));
    replace(quill, index, 0, new Delta().insert({ section: { layout, columns } }));
    // Continue in the new section's first column.
    const added = Array.from(quill.root.querySelectorAll('.erte-section')).find((n) => !before.has(n));
    const first = added && sectionEditors(added)[0];
    if (first) {
      first.focus();
      first.setSelection(0, 0, 'silent');
      active = first;
    } else quill.setSelection(index + 1, 0, 'user');
  }

  function insertButton(value: ButtonValue): HTMLElement | null {
    const button = asButton(value);
    if (!button) return null;
    const q = current();
    const range = selectionIn(q);
    const before = new Set(q.root.querySelectorAll('.erte-button'));
    replace(q, range.index, range.length, new Delta().insert({ button }));
    q.setSelection(Math.min(range.index + 2, q.getLength() - 1), 0, 'silent');
    return Array.from(q.root.querySelectorAll<HTMLElement>('.erte-button')).find((n) => !before.has(n)) ?? null;
  }

  let editingButton: HTMLElement | null = null;
  const buttonDialog = createButtonDialog(root, labels, {
    onSave(value) {
      const at = locate(editingButton);
      if (!at) return;
      replace(at.q, at.index, 1, new Delta().insert({ button: value }));
      at.q.setSelection(at.index + 1, 0, 'silent');
    },
    onRemove() {
      const at = locate(editingButton);
      if (at) replace(at.q, at.index, 1);
    },
    onClose(_saved, outside) {
      const node = editingButton;
      editingButton = null;
      if (outside) return; // a click elsewhere keeps focus where it went
      const q = node?.isConnected ? editorOf(node) : current();
      q.focus();
    },
  });
  function openButtonDialog(node: HTMLElement) {
    editingButton = node;
    buttonDialog.open((Quill.import('formats/button') as any).value(node));
  }
  // Click (or Enter on) a button to edit it.
  root.addEventListener('click', (e) => {
    const node = (e.target as Element).closest?.<HTMLElement>('.ql-editor .erte-button');
    if (node && quill.isEnabled()) openButtonDialog(node);
  });

  // --------------------------------------------------------- templates ---
  const frameHeader = doc.createElement('div');
  frameHeader.className = 'erte-frame erte-frame--header';
  const frameFooter = doc.createElement('div');
  frameFooter.className = 'erte-frame erte-frame--footer';
  container.before(frameHeader);
  container.after(frameFooter);

  /** Show the template's header and footer around the editing area (merge fields show their fallback or name). */
  function showFrame() {
    const frame = template?.frame;
    const parts = frameDeltas(frame);
    const preview = (d: DeltaLike | undefined) => (d ? deltaToEmailHtml(replaceTokens(d, {}, { missing: 'keep' }), style) : '');
    // The renderer escapes and validates everything, so its HTML is safe to show.
    frameHeader.innerHTML = preview(parts.header);
    frameFooter.innerHTML = preview(parts.footer);
    frameHeader.hidden = !parts.header;
    frameFooter.hidden = !parts.footer;
    // The same colours the email is sent with.
    const colors = frameColorsOf(frame);
    root.style.setProperty('--erte-frame-header-bg', colors.header);
    root.style.setProperty('--erte-frame-footer-bg', colors.footer);
    root.style.setProperty('--erte-content-bg', colors.content);
    root.classList.toggle('erte--framed', !!(parts.header || parts.footer));
    toolbarEl.querySelector('.ql-template .ql-picker-label')?.setAttribute('data-erte-label', template ? template.name : labels.template);
  }

  const isEmpty = () => quill.getLength() <= 1; // any embed (chip, picture, columns…) adds to the length
  const templateContent = (t: EmailTemplate) => (typeof t.content === 'string' ? toDelta(t.content) : t.content ? withTokens(t.content) : new Delta().insert('\n'));

  function setTemplate(t: string | EmailTemplate | null, options: { content?: 'if-empty' | 'replace' | 'keep' } = {}, source: 'user' | 'silent' = 'silent') {
    template = findTemplate(t);
    style = styleFor(template);
    applyCssVariables(root, style, opts);
    showFrame();
    const mode = options.content ?? 'if-empty';
    if (template?.content && (mode === 'replace' || (mode === 'if-empty' && isEmpty()))) {
      quill.setContents(templateContent(template), source);
      if (source === 'silent') quill.history.clear();
    }
  }

  /** From the Template menu: a new frame at once; starting content straight away into an empty editor, else on request. */
  function chooseTemplate(id: string) {
    const empty = isEmpty();
    setTemplate(id, { content: empty ? 'replace' : 'keep' }, 'user');
    if (!empty && template?.content) {
      const chosen = template;
      notice(labels.templateContent, 12000, {
        label: labels.templateContentAction,
        run: () => {
          notice('');
          if (template === chosen) quill.setContents(templateContent(chosen), 'user');
        },
      });
    }
    opts.onChange?.(getValue());
  }

  // ------------------------------------------------------------- value ---
  function toDelta(html: string) {
    return withTokens(quill.clipboard.convert({ html: cleanHtml(html, { ...baseClean(), keepImages: true }) }));
  }
  const getDelta = () => quill.getContents() as unknown as DeltaLike;
  const getValue = (): EditorValue => {
    const delta = getDelta();
    return { html: deltaToEmailHtml(delta, style), text: deltaToPlainText(delta), delta, ...(template ? { template: template.id } : {}) };
  };
  const allEditors = () => [quill, ...Array.from(quill.root.querySelectorAll('.erte-section')).flatMap(sectionEditors)];

  const setDelta = (delta: DeltaLike) => {
    quill.setContents(withTokens(delta), 'silent');
    quill.history.clear();
    active = quill;
  };
  showFrame();
  if (opts.delta) setDelta(opts.delta);
  else if (opts.value) setDelta(toDelta(opts.value));
  else if (template?.content) setDelta(templateContent(template));

  quill.on('text-change', (change: any, _old: unknown, source: string) => {
    if (source !== 'user') return;
    // A typed `{{key}}` becomes a chip; that change reports itself.
    if (typedClosingBrace(change) && chipTypedToken(quill)) return;
    opts.onChange?.(getValue());
  });

  // Focus: anywhere in the editor (main text, columns, its dialogs) counts.
  let focused = false;
  root.addEventListener('focusin', (e) => {
    if ((e.target as Element).closest('.ql-editor')) active = editorOf(e.target);
    if (focused) return;
    focused = true;
    root.classList.add('erte--focused');
    opts.onFocus?.();
  });
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!focused || root.contains(doc.activeElement)) return;
      focused = false;
      root.classList.remove('erte--focused');
      opts.onBlur?.();
    });
  });

  const setReadOnly = (readOnly: boolean) => {
    allEditors().forEach((q) => q.enable(!readOnly));
    root.classList.toggle('erte--readonly', readOnly);
  };
  setReadOnly(!!opts.readOnly);

  const emailOptions = () => ({ style, frame: template?.frame });

  return {
    quill,
    root,
    getValue,
    getHtml: () => deltaToEmailHtml(getDelta(), style),
    getText: () => deltaToPlainText(getDelta()),
    getDelta,
    getEmailDocument: (o) => renderEmail(getDelta(), { ...emailOptions(), attachImages: false, document: o ?? {} }).html,
    whenIdle: async () => {
      while (busy.size) await Promise.allSettled([...busy]);
    },
    isBusy: () => busy.size > 0,
    getEmail: (o) => renderEmail(getDelta(), { ...o, ...emailOptions() }),
    getTokens: () => findTokens(getDelta()),
    insertField,
    insertColumns,
    insertButton: (value) => void insertButton(value),
    getTemplate: () => template,
    setTemplate: (t, o) => setTemplate(t, o),
    setHtml: (html) => setDelta(toDelta(html)),
    setDelta,
    setReadOnly,
    focus: () => quill.focus(),
    destroy: () => {
      stopCompactToolbar();
      imageDialog.close(); // removes its document listener if open
      root.remove();
    },
  };
}

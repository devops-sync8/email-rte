/**
 * Layout blocks inside the editor: column sections and buttons.
 *
 * A section is a block embed whose columns are editors of their own (Quill
 * instances inside the main one). Quill 2 supports embeds with inner content:
 * a column edit is reported to the main editor as a change to the embed
 * (`emitEmbedUpdate`), composed with the Delta handler below, so the main
 * editor's value, onChange and undo history stay complete.
 */
import Quill from 'quill';
import { LAYOUTS, asButton, asSection, deltaToEmailHtml, type ButtonValue, type DeltaOp, type SectionValue } from './render';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What a section needs from the editor it lives in (the blot class is shared by all editors). */
export interface LayoutHost {
  /** Create the editor for one column. `onUserChange` reports the user's edits. */
  mountColumn(el: HTMLElement, ops: DeltaOp[], onUserChange: (change: DeltaOp[]) => void): Quill;
  /** Remove a section (from its "Remove" control). */
  removeSection(node: HTMLElement): void;
  labels: Record<string, string>;
  readOnly(): boolean;
}

const hosts = new WeakMap<Element, LayoutHost>();
/** Register the editor owning `scrollRoot` (its .ql-editor element). */
export const setLayoutHost = (scrollRoot: Element, host: LayoutHost) => hosts.set(scrollRoot, host);

const columnEditors = new WeakMap<Element, Quill[]>();
const initialValue = new WeakMap<Element, SectionValue>();

/** The editors of a section's columns (after it is mounted). */
export const sectionEditors = (node: Element): Quill[] => columnEditors.get(node) ?? [];

let Delta: any;

/** Ops as a column editor holds them: merged, ending with a newline. */
export function normalizeColumn(ops: DeltaOp[]): DeltaOp[] {
  const delta = new Delta().compose(new Delta(ops));
  const last = delta.ops[delta.ops.length - 1];
  if (!last || typeof last.insert !== 'string' || !last.insert.endsWith('\n')) delta.insert('\n');
  return delta.ops;
}

/**
 * Delta operations on section values. Values hold `columns` as an array;
 * changes as `{ columns: { "<index>": ops } }`.
 */
const sectionHandler = {
  compose(a: any, b: any) {
    const columns = Array.isArray(a.columns) ? [...a.columns] : { ...(a.columns ?? {}) };
    for (const [i, ops] of Object.entries(b.columns ?? {})) {
      (columns as any)[i] = new Delta((columns as any)[i] ?? []).compose(new Delta(ops as DeltaOp[])).ops;
    }
    return { ...a, columns };
  },
  transform(a: any, b: any, priority: boolean) {
    const columns: Record<string, DeltaOp[]> = {};
    for (const [i, ops] of Object.entries(b.columns ?? {})) {
      const other = a.columns?.[i];
      columns[i] = other ? new Delta(other).transform(new Delta(ops as DeltaOp[]), priority).ops : (ops as DeltaOp[]);
    }
    return { ...b, columns };
  },
  invert(change: any, base: any) {
    const columns: Record<string, DeltaOp[]> = {};
    for (const [i, ops] of Object.entries(change.columns ?? {})) {
      columns[i] = new Delta(ops as DeltaOp[]).invert(new Delta(base.columns?.[i] ?? [])).ops;
    }
    return { columns };
  },
};

/** Events inside a column belong to the column's editor, not the main one. */
const ISOLATED = ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'copy', 'cut', 'drop', 'dragover'];

export function registerLayoutFormats() {
  Delta = Quill.import('delta') as any;
  Delta.registerEmbed('section', sectionHandler);
  const BlockEmbed = Quill.import('blots/block/embed') as any;

  class SectionBlot extends BlockEmbed {
    static blotName = 'section';
    static tagName = 'DIV';
    static className = 'erte-section';

    static create(value: unknown) {
      const section = asSection(value) ?? { layout: '1-1' as const, columns: [[], []] };
      const node = super.create() as HTMLElement;
      node.setAttribute('contenteditable', 'false');
      node.dataset.layout = section.layout;
      initialValue.set(node, { layout: section.layout, columns: section.columns.map(normalizeColumn) });
      for (const type of ISOLATED) node.addEventListener(type, (e) => e.stopPropagation());
      return node;
    }

    static value(node: HTMLElement): SectionValue {
      const base = initialValue.get(node) ?? { layout: (node.dataset.layout as SectionValue['layout']) ?? '1-1', columns: [] };
      const editors = columnEditors.get(node);
      return { layout: base.layout, columns: editors ? editors.map((q) => q.getContents().ops as DeltaOp[]) : base.columns };
    }

    attach() {
      super.attach();
      this.mount();
    }

    mount() {
      const node = this.domNode as HTMLElement;
      if (columnEditors.has(node)) return;
      const host = hosts.get(this.scroll.domNode);
      if (!host) return;
      const value = SectionBlot.value(node);
      const doc = node.ownerDocument;
      const bar = doc.createElement('div');
      bar.className = 'erte-section__bar';
      const name = doc.createElement('span');
      name.textContent = host.labels[`layout:${value.layout}`] ?? host.labels.layout;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'erte-section__remove';
      remove.textContent = host.labels.removeColumns;
      remove.addEventListener('mousedown', (e) => e.preventDefault());
      remove.addEventListener('click', () => host.removeSection(node));
      bar.append(name, remove);
      const row = doc.createElement('div');
      row.className = 'erte-columns';
      node.append(bar, row);
      const editors = value.columns.map((ops, i) => {
        const el = doc.createElement('div');
        el.className = 'erte-column';
        el.style.flexGrow = String(LAYOUTS[value.layout]?.[i] ?? 1);
        row.appendChild(el);
        return host.mountColumn(el, ops, (change) => this.scroll.emitEmbedUpdate(this, { columns: { [i]: change } }));
      });
      columnEditors.set(node, editors);
      if (host.readOnly()) editors.forEach((q) => q.enable(false));
    }

    // Changes applied from the main editor (undo/redo, API): update the columns quietly.
    updateContent(change: { columns?: Record<string, DeltaOp[]> }) {
      const editors = columnEditors.get(this.domNode);
      for (const [i, ops] of Object.entries(change.columns ?? {})) editors?.[Number(i)]?.updateContents(new Delta(ops), 'silent');
    }

    // Copying a section copies its email HTML, which pastes back as a section.
    html() {
      return deltaToEmailHtml({ ops: [{ insert: { section: SectionBlot.value(this.domNode) } }] });
    }
  }

  class ButtonBlot extends BlockEmbed {
    static blotName = 'button';
    static tagName = 'DIV';
    static className = 'erte-button';

    static create(value: unknown) {
      const button = asButton(value) ?? { text: 'Button', href: '' };
      const node = super.create() as HTMLElement;
      node.setAttribute('contenteditable', 'false');
      setButton(node, button);
      return node;
    }

    static value(node: HTMLElement): ButtonValue {
      const d = node.dataset;
      return asButton({ text: d.text, href: d.href, background: d.background, color: d.color, align: d.align }) ?? { text: 'Button', href: '' };
    }

    html() {
      return deltaToEmailHtml({ ops: [{ insert: { button: ButtonBlot.value(this.domNode) } }] });
    }
  }

  Quill.register({ 'formats/section': SectionBlot, 'formats/button': ButtonBlot }, true);
}

/** Show a button's value on its element (data attributes hold the value). */
function setButton(node: HTMLElement, button: ButtonValue) {
  const d = node.dataset;
  d.text = button.text;
  d.href = button.href;
  for (const key of ['background', 'color', 'align'] as const) {
    if (button[key]) d[key] = button[key];
    else delete d[key];
  }
  node.style.textAlign = button.align ?? 'left';
  const face = node.ownerDocument.createElement('span');
  face.className = 'erte-button__face';
  face.textContent = button.text;
  if (button.background) face.style.backgroundColor = button.background;
  if (button.color) face.style.color = button.color;
  node.title = button.href;
  node.replaceChildren(face);
}

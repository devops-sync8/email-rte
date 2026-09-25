import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  booleanAttribute,
  forwardRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  createRichTextEditor,
  type EditorValue,
  type RichTextEditor,
  type RichTextEditorOptions,
  type ToolbarGroups,
  type ToolbarPreset,
} from '@sync8/email-rte';

/**
 * Inline email rich text editor.
 *
 * Works with `[(ngModel)]`, `formControlName`/`[formControl]`, or
 * `[(value)]`; the value is email-safe HTML. Include
 * `@sync8/email-rte/style.css` in the application's styles. Options other
 * than `value` and `readOnly` are read when the component initialises.
 */
@Component({
  selector: 'email-rich-text-editor',
  standalone: true,
  template: '',
  host: { class: 'email-rich-text-editor', style: 'display:block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => EmailRichTextEditorComponent), multi: true }],
})
export class EmailRichTextEditorComponent implements ControlValueAccessor, AfterViewInit, OnChanges, OnDestroy {
  /** Content as HTML (for `[(value)]`; forms use the control value). */
  @Input() value?: string;
  @Input() placeholder?: string;
  @Input() toolbar?: ToolbarPreset | ToolbarGroups;
  /** Base text style of the editor and the email output. */
  @Input() editorStyle?: RichTextEditorOptions['style'];
  @Input({ transform: booleanAttribute }) readOnly = false;
  @Input() uploadImage?: RichTextEditorOptions['uploadImage'];
  /** Pictures in pastes: 'embed' (default) or 'drop'. */
  @Input() pastedImages: RichTextEditorOptions['pastedImages'] = 'embed';
  /** Merge fields offered by the "Insert field" menu (`{{key}}` tokens). */
  @Input() fields?: RichTextEditorOptions['fields'];
  /** Columns menu and Button (layout blocks). */
  @Input({ transform: booleanAttribute }) layouts = false;
  /** Templates offered by the Template menu (e.g. `TEMPLATES`). */
  @Input() templates?: RichTextEditorOptions['templates'];
  /** Template in use at start (an id or a template). */
  @Input() template?: RichTextEditorOptions['template'];
  @Input() stickyToolbar?: boolean | number;
  @Input() minHeight?: string;
  @Input() maxHeight?: string;
  @Input() ariaLabel?: string;
  @Input() labels?: RichTextEditorOptions['labels'];

  /** Email-safe HTML after every user edit. */
  @Output() readonly valueChange = new EventEmitter<string>();
  /** HTML, plain text and Delta after every user edit. */
  @Output() readonly contentChange = new EventEmitter<EditorValue>();
  @Output() readonly editorFocus = new EventEmitter<void>();
  @Output() readonly editorBlur = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  // Like Angular's own form controls, schedule change detection after edits
  // (zoneless apps would otherwise not re-render for reactive-form updates).
  private readonly cdr = inject(ChangeDetectorRef);
  private editor?: RichTextEditor;
  private lastHtml?: string;
  private pending?: string;
  private disabled = false;
  private onChange: (html: string) => void = () => {};
  private onTouched: () => void = () => {};

  /** Read-only by input or because the form control is disabled. */
  private get locked(): boolean {
    return this.readOnly || this.disabled;
  }

  /** The underlying editor (after view init). */
  get instance(): RichTextEditor | undefined {
    return this.editor;
  }

  ngAfterViewInit(): void {
    this.editor = createRichTextEditor(this.host.nativeElement, {
      value: this.pending ?? this.value,
      placeholder: this.placeholder,
      toolbar: this.toolbar,
      style: this.editorStyle,
      readOnly: this.locked,
      uploadImage: this.uploadImage,
      pastedImages: this.pastedImages,
      fields: this.fields,
      layouts: this.layouts,
      templates: this.templates,
      template: this.template,
      stickyToolbar: this.stickyToolbar,
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
      ariaLabel: this.ariaLabel,
      labels: this.labels,
      onChange: (v) =>
        this.zone.run(() => {
          this.lastHtml = v.html;
          this.onChange(v.html);
          this.valueChange.emit(v.html);
          this.contentChange.emit(v);
          this.cdr.markForCheck();
        }),
      onFocus: () => this.zone.run(() => this.editorFocus.emit()),
      onBlur: () =>
        this.zone.run(() => {
          this.onTouched();
          this.editorBlur.emit();
          this.cdr.markForCheck();
        }),
    });
    this.lastHtml = this.editor.getHtml();
    this.pending = undefined;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && !changes['value'].firstChange) this.load(this.value ?? '');
    if (changes['readOnly']) this.editor?.setReadOnly(this.locked);
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  writeValue(html: string | null | undefined): void {
    if (this.editor) this.load(html ?? '');
    else this.pending = html ?? '';
  }

  registerOnChange(fn: (html: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    this.editor?.setReadOnly(this.locked);
  }

  focus(): void {
    this.editor?.focus();
  }

  private load(html: string): void {
    if (!this.editor || html === this.lastHtml) return;
    this.editor.setHtml(html);
    this.lastHtml = this.editor.getHtml();
  }
}

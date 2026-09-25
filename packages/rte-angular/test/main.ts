import '@angular/compiler'; // JIT: the test app compiles its own template in the browser
import { Component, ViewChild, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import '@sync8/email-rte/style.css';
import { EmailRichTextEditorComponent, TEMPLATES } from '../dist/fesm2022/sync8-email-rte-angular.mjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EmailRichTextEditorComponent, ReactiveFormsModule, FormsModule],
  template: `
    <form [formGroup]="form">
      <email-rich-text-editor id="reactive" formControlName="body" toolbar="standard" placeholder="Write"
        [editorStyle]="{ fontFamily: 'verdana', fontSize: 14 }"></email-rich-text-editor>
    </form>
    <output id="reactive-value">{{ form.value.body }}</output>
    <email-rich-text-editor id="model" [(ngModel)]="note" toolbar="minimal"></email-rich-text-editor>
    <output id="model-value">{{ note }}</output>
    <email-rich-text-editor #boundEditor id="bound" [(value)]="bound" [readOnly]="locked()" [fields]="fields" layouts [templates]="templates" template="announcement"></email-rich-text-editor>
  `,
})
class AppComponent {
  form = new FormGroup({ body: new FormControl('<p>From the <em>form</em></p>') });
  note = '<p>Template-driven</p>';
  bound = '<p>Bound</p>';
  fields = [{ key: 'firstName', label: 'First name' }];
  templates = TEMPLATES;
  locked = signal(false);
  @ViewChild('boundEditor') boundEditor?: EmailRichTextEditorComponent;
}

bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection()] }).then((ref) => {
  const app = ref.components[0].instance as AppComponent;
  (window as unknown as Record<string, unknown>).ng = { app, tick: () => ref.tick() };
  (window as unknown as Record<string, unknown>).harnessReady = true;
});

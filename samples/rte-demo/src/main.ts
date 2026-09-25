import { TEMPLATES, createRichTextEditor } from '@sync8/email-rte';
import '@sync8/email-rte/style.css';
import './demo.css';
import wordSample from './word-sample.html?raw';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SAMPLE = `
<h1>Quarterly update</h1>
<p>Hi {{firstName|there}}, here is where {{company}} landed this quarter. <strong>Revenue grew 12%</strong>, driven by <span style="color:#0b7a3b">renewals</span> and the new <em>self-serve</em> plan.</p>
<h3>Highlights</h3>
<ul><li>Shipped the new onboarding flow<ul><li>Activation up 18%</li></ul></li><li>Closed <span style="background-color:#fff2cc">three enterprise deals</span></li></ul>
<ol><li>Finish the pricing review</li><li>Hire two support engineers</li></ol>
<blockquote>“The fastest setup we have seen.” – a customer</blockquote>
<hr>
<p style="text-align:center">Questions? <a href="mailto:ops@example.com">Email the ops team</a> · <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`;

const editor = createRichTextEditor($('editor'), {
  // Starts with the newsletter template: a header and footer, two columns, buttons.
  templates: TEMPLATES,
  template: 'newsletter',
  layouts: true,
  placeholder: 'Write your message, or paste from Word…',
  ariaLabel: 'Message',
  fields: [
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'company', label: 'Company' },
    { key: 'unsubscribeUrl', label: 'Unsubscribe link' },
  ],
  stickyToolbar: true,
  minHeight: '260px',
  onChange: scheduleRender,
});

let timer = 0;
function scheduleRender() {
  clearTimeout(timer);
  timer = window.setTimeout(render, 150);
}

/** Merge field values for the sample recipient. */
function sampleValues(): Record<string, string> {
  const values: Record<string, string> = { unsubscribeUrl: 'https://example.com/unsubscribe?r=123' };
  document.querySelectorAll<HTMLInputElement>('[data-token]').forEach((i) => (values[i.dataset.token!] = i.value));
  return values;
}

function render() {
  // The email as sent to the sample recipient: merge fields filled, pictures as
  // inline attachments referenced by cid: (editor.getEmail()).
  const tokens = sampleValues();
  const document = { title: $<HTMLInputElement>('subject').value };
  const email = editor.getEmail({ tokens, document });
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const pictures = email.attachments.length
    ? ` · ${email.attachments.length} inline picture${email.attachments.length > 1 ? 's' : ''} (${kb(email.attachments.reduce((n, i) => n + (i.base64.length * 3) / 4, 0))})`
    : '';
  $('html-out').textContent = email.html;
  $('text-out').textContent = email.text;
  $('html-size').textContent = `${kb(new Blob([email.html]).size)} email · inline styles only${pictures}`;
  // The preview shows embedded pictures directly (a browser cannot resolve cid:).
  $<HTMLIFrameElement>('preview').srcdoc = editor.getEmail({ tokens, attachImages: false, document: { ...document, preheader: email.text.slice(0, 90) } }).html;
}
render();
$('subject').addEventListener('input', scheduleRender);
document.querySelectorAll('[data-token]').forEach((i) => i.addEventListener('input', scheduleRender));

/**
 * Word's clipboard RTF for the sample's picture (a small chart). Word's HTML only
 * points at a local file; the picture itself travels in the RTF, as here.
 */
async function wordSampleRtf(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 480, 160);
  ctx.fillStyle = '#1f2328';
  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.fillText('Revenue by quarter', 16, 26);
  [52, 70, 64, 96].forEach((h, i) => {
    ctx.fillStyle = i === 3 ? '#2f5496' : '#8eaadb';
    ctx.fillRect(40 + i * 110, 146 - h, 70, h);
    ctx.fillStyle = '#57606a';
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(`Q${i + 1}`, 66 + i * 110, 158);
  });
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const hex = [...new Uint8Array(await blob.arrayBuffer())].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `{\\rtf1\\ansi{\\*\\shppict{\\pict\\picw12700\\pich4233\\picwgoal7200\\pichgoal2400\\pngblip\\bliptag1 ${hex}}}}`;
}

// Real paste pipeline, with the clipboard contents of a Word document.
$('load-word').addEventListener('click', async () => {
  editor.setHtml('');
  editor.focus();
  const data = new DataTransfer();
  data.setData('text/html', wordSample);
  data.setData('text/rtf', await wordSampleRtf());
  editor.quill.root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await editor.whenIdle();
  render();
});
$('load-sample').addEventListener('click', () => {
  editor.setTemplate('plain');
  editor.setHtml(SAMPLE);
  render();
});
$('clear').addEventListener('click', () => {
  editor.setHtml('');
  editor.focus();
  render();
});

// Tabs
const tabs = ['preview', 'html', 'text'];
for (const name of tabs) {
  $(`tab-${name}`).addEventListener('click', () => {
    for (const other of tabs) {
      $(`tab-${other}`).setAttribute('aria-selected', String(other === name));
      $(`panel-${other}`).hidden = other !== name;
    }
  });
}

// Preview width. "Desktop" renders at a desktop mail window's width (so columns sit side by
// side, as recipients see them), "Phone" at 375px; either is scaled down to fit this panel.
const PREVIEW_WIDTHS: Record<string, number> = { desktop: 700, '375px': 375 };
let previewWidth = 'desktop';
function fitPreview() {
  const frame = $<HTMLIFrameElement>('preview');
  const wrap = frame.parentElement!;
  const width = PREVIEW_WIDTHS[previewWidth];
  const scale = Math.min(1, (wrap.clientWidth - 16) / width);
  frame.style.width = `${width}px`;
  frame.style.transform = scale < 1 ? `scale(${scale})` : '';
  wrap.style.height = scale < 1 ? `${Math.round(640 * scale) + 16}px` : '';
}
document.querySelectorAll<HTMLButtonElement>('.widths button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.widths button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    previewWidth = b.dataset.width!;
    fitPreview();
  }),
);
new ResizeObserver(fitPreview).observe($<HTMLIFrameElement>('preview').parentElement!);
fitPreview();

$('copy-html').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('copy-html');
  try {
    await navigator.clipboard.writeText($('html-out').textContent ?? '');
    btn.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('html-out'));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    btn.textContent = 'Selected — press Ctrl+C';
  }
  setTimeout(() => (btn.textContent = 'Copy HTML'), 2000);
});

// Sending: available when this page is served by the sample host (samples/host),
// which sends through its SMTP settings. The static preview has no server, so the button stays hidden.
const sendButton = $<HTMLButtonElement>('send');
const sendStatus = $('send-status');
const showStatus = (message: string, error = false) => {
  sendStatus.textContent = message;
  sendStatus.hidden = !message;
  sendStatus.classList.toggle('error', error);
};
fetch('/api/compose/status')
  .then((r) => (r.ok ? r.json() : null))
  .then((status) => {
    if (status?.canSend) sendButton.hidden = false;
  })
  .catch(() => {});
sendButton.addEventListener('click', async () => {
  sendButton.disabled = true;
  showStatus('Sending…');
  try {
    await editor.whenIdle(); // pictures still being processed
    const subject = $<HTMLInputElement>('subject').value;
    const email = editor.getEmail({ tokens: sampleValues(), document: { title: subject } });
    const res = await fetch('/api/compose/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: $<HTMLInputElement>('to').value, subject, html: email.html, text: email.text, attachments: email.attachments }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail ?? (Object.values(body.errors ?? {}).flat().join(' ') || res.statusText));
    showStatus(body.message ?? 'Sent.');
  } catch (e) {
    showStatus(`Not sent: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    sendButton.disabled = false;
  }
});

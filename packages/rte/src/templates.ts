/**
 * Email templates: a frame (header, footer, colours) plus starting content
 * and text style. Templates are optional: pass `templates` to the editor to
 * offer a Template menu, or use a template's frame with `renderEmail`.
 */
import type { DeltaLike, DeltaOp, EmailFrame, EmailStyle } from './render';

export interface EmailTemplate {
  /** Stable id, stored alongside the message (e.g. `newsletter`). */
  id: string;
  /** Name shown in the Template menu. */
  name: string;
  description?: string;
  /** Text style and content width (`maxImageWidth`) for this template. */
  style?: Partial<EmailStyle>;
  /** Header, footer and colours around the message. */
  frame?: EmailFrame;
  /** Starting content: HTML (as stored by the editor) or a Delta. */
  content?: string | DeltaLike;
}

const p = (text: string, attributes?: Record<string, unknown>): DeltaOp[] => [{ insert: text }, { insert: '\n', ...(attributes ? { attributes } : {}) }];
const h = (level: 1 | 2 | 3, text: string, align?: string): DeltaOp[] => p(text, { header: level, ...(align ? { align } : {}) });
const button = (text: string, href: string, align?: 'left' | 'center' | 'right'): DeltaOp => ({ insert: { button: { text, href, ...(align ? { align } : {}) } } });
const story = (title: string): DeltaOp[] => [
  ...h(3, title),
  ...p('A short summary of the story: two or three sentences that make people want to read on. Replace it with your own.'),
  button('Read more', 'https://example.com'),
];

const FOOTER: EmailFrame['footer'] = {
  text: 'You are receiving this email because you signed up for updates from {{company|us}}.',
  links: [{ text: 'Unsubscribe', href: '{{unsubscribeUrl}}' }],
  align: 'center',
};

/**
 * Built-in templates, all opt-in (`templates: TEMPLATES`). Replace their
 * colours, titles and footer to match your brand, or define your own.
 */
export const TEMPLATES: EmailTemplate[] = [
  {
    id: 'plain',
    name: 'Plain',
    description: 'Just the message.',
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    description: 'A header, an introduction, two stories side by side (stacked on phones) and a footer.',
    frame: {
      backgroundColor: '#eef1f5',
      header: { title: '{{company|Your company}} newsletter', backgroundColor: '#1f3a5f', color: '#ffffff' },
      footer: FOOTER,
    },
    style: { linkColor: '#1f5fbf' },
    content: {
      ops: [
        ...h(1, 'What is new this month'),
        ...p('Hi {{firstName|there}}, here is a quick look at what we have been working on.'),
        { insert: { section: { layout: '1-1', columns: [story('First story'), story('Second story')] } } },
        ...p('Thanks for reading. Reply to this email if you have any questions.'),
      ],
    },
  },
  {
    id: 'announcement',
    name: 'Announcement',
    description: 'One message, centred, with a call to action.',
    frame: {
      backgroundColor: '#f4f5f7',
      header: { title: '{{company|Your company}}', align: 'center', color: '#1f2328' },
      footer: FOOTER,
    },
    content: {
      ops: [
        ...h(1, 'Something new is here', 'center'),
        ...p('Hi {{firstName|there}}, describe the news in a sentence or two, and what the reader can do next.', { align: 'center' }),
        button('Find out more', 'https://example.com', 'center'),
        ...p('Questions? Just reply to this email.', { align: 'center' }),
      ],
    },
  },
];

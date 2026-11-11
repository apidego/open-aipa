import { z } from 'zod';
import { randomUUID } from 'node:crypto';
const header = z
  .string()
  .max(250)
  .refine((s) => !/[\r\n\0]/.test(s), 'Ungültige Kopfzeile');
export const address = z.string().trim().email().max(254);
export const mailInput = z
  .object({
    kind: z.enum(['compose', 'reply', 'forward', 'trash']),
    to: z.array(address).max(20),
    cc: z.array(address).max(20),
    bcc: z.array(address).max(20),
    subject: header,
    body: z.string().max(20000),
    sourceId: z
      .string()
      .regex(/^[a-fA-F0-9]{1,100}$/)
      .nullable(),
    sendAt: z.string().datetime({ offset: true }).nullable(),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export type MailInput = z.infer<typeof mailInput>;
export interface MailPayload extends MailInput {
  from: string;
  sourceSubject?: string;
  sourceFrom?: string;
  originalText?: string;
  originalAttached?: boolean;
  raw?: string;
  threadId?: string;
}
// No address display names from model input; source Reply-To/From must be one mailbox.
export function mailbox(value: string) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid sender');
  const match = value.match(/^[^<>]*<([^<>]+)>$/);
  return address.parse(match ? match[1] : value);
}
function encodedHeader(value: string) {
  const chunks: string[] = [];
  let chunk = '';
  for (const c of value) {
    if (Buffer.byteLength(chunk + c) > 36) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += c;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c).toString('base64')}?=`).join('\r\n ');
}
const base64 = (value: Buffer) =>
  value
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') || '';
export function buildMessage(
  payload: MailPayload,
  reply?: { id: string; references: string },
  original?: Buffer,
) {
  const headers = [
    `From: ${address.parse(payload.from)}`,
    ...(payload.to.length ? [`To: ${payload.to.join(',\r\n ')}`] : []),
    ...(payload.cc.length ? [`Cc: ${payload.cc.join(',\r\n ')}`] : []),
    ...(payload.bcc.length ? [`Bcc: ${payload.bcc.join(',\r\n ')}`] : []),
    `Subject: ${encodedHeader(header.parse(payload.subject))}`,
    `Date: ${new Date(payload.sendAt || Date.now()).toUTCString()}`,
    `Message-ID: <${randomUUID()}@open-aipa.local>`,
    'MIME-Version: 1.0',
  ];
  if (reply) {
    if (!/^<[^<>\s]+>$/.test(reply.id)) throw new Error('Invalid Message-ID');
    const refs = reply.references.match(/<[^<>\s]+>/g) || [];
    headers.push(
      `In-Reply-To: ${reply.id}`,
      `References: ${[...refs.slice(-10), reply.id].join('\r\n ')}`,
    );
  }
  const text = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(Buffer.from(payload.body)),
  ].join('\r\n');
  let mime: string;
  if (original) {
    const boundary = 'aipa_' + randomUUID();
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    mime = `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\n${text}\r\n--${boundary}\r\nContent-Type: application/octet-stream; name="Original.eml"\r\nContent-Disposition: attachment; filename="Original.eml"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(original)}\r\n--${boundary}--\r\n`;
  } else mime = `${headers.join('\r\n')}\r\n${text}\r\n`;
  return Buffer.from(mime).toString('base64url');
}
// Only an explicit imperative in the current user's instruction can bypass review.
// Ambiguity/negation falls back to review. Quoted body/tool content is never authorization.
function instructionPrefix(request: string) {
  return request
    .trim()
    .split(/[\n:"“„`]/, 1)[0]
    .split(/\b(?:mit (?:dem )?(?:text|inhalt)|betreff)\b/i, 1)[0];
}
export function directInstruction(request: string, kind: MailInput['kind']) {
  const command = instructionPrefix(request).replace(/[\w.+-]+@[\w.-]+/g, '');
  if (/\b(nicht|kein\w*|never|not|don't|prüfe|prüfen|entwurf|draft|vorschau)\b/i.test(command))
    return false;
  const verb =
    kind === 'trash'
      ? '(?:lösche|loesche|entferne|delete|trash)'
      : kind === 'reply'
        ? '(?:antworte|beantworte|reply)'
        : kind === 'forward'
          ? '(?:leite|forward)'
          : '(?:sende|schicke|versende|send|email)';
  if (!new RegExp(`^(?:bitte\\s+|please\\s+)?${verb}\\b`, 'i').test(command)) return false;
  return (
    /\b(?:direkt|directly)\b/i.test(command) ||
    /\bohne (?:vorherige )?(?:prüfung|pruefung|freigabe|bestätigung|bestaetigung|rückfrage|rueckfrage)\b/i.test(
      command,
    ) ||
    /\bwithout (?:review|confirmation)\b/i.test(command)
  );
}

export function directMailAuthorization(request: string, input: MailInput) {
  if (!directInstruction(request, input.kind)) return false;
  if (input.kind === 'trash') return true;
  const explicit: string[] =
    instructionPrefix(request)
      .toLowerCase()
      .match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
  // No inferred recipients in a direct compose/forward. Replies may use the source Reply-To.
  const recipients = [...input.to, ...input.cc, ...input.bcc];
  return recipients.every((recipient) =>
    explicit.some((value) => value.replace(/[.,;!?]+$/, '') === recipient.toLowerCase()),
  );
}

// Forward the original message/attachments, but never disclose its blind-copy recipients.
export function forwardOriginal(original: Buffer) {
  const raw = original.toString('latin1');
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) throw new Error('Invalid original message');
  const fields = raw.slice(0, split).split(/\r?\n(?=[^ \t])/);
  return Buffer.from(
    fields.filter((line) => !/^(?:bcc|resent-bcc):/i.test(line)).join('\r\n') + raw.slice(split),
    'latin1',
  );
}

/**
 * A draft is stored as one text: optional `To:` and `Subject:` header lines, a blank line, then
 * the body. The composer edits the three parts separately and joins them back on save.
 */

export interface EmailParts {
  to: string;
  subject: string;
  body: string;
}

export function splitEmail(text: string): EmailParts {
  const parts: EmailParts = { to: '', subject: '', body: '' };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  for (; i < lines.length; i += 1) {
    const header = /^(To|Subject):\s*(.*)$/i.exec(lines[i]);
    if (!header) break;
    if (header[1].toLowerCase() === 'to') parts.to = header[2].trim();
    else parts.subject = header[2].trim();
  }
  if (i > 0) while (i < lines.length && !lines[i].trim()) i += 1;
  parts.body = lines.slice(i).join('\n').trimEnd();
  return parts;
}

export function joinEmail(parts: EmailParts): string {
  const head = [parts.to.trim() && `To: ${parts.to.trim()}`, parts.subject.trim() && `Subject: ${parts.subject.trim()}`].filter(Boolean);
  return head.length ? `${head.join('\n')}\n\n${parts.body.trimEnd()}` : parts.body.trimEnd();
}

export const isEmailAddress = (value: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(value.trim());

/** Opens the owner's own mail app with the draft filled in; the app itself never sends mail. */
export function mailtoHref(parts: EmailParts): string {
  const q = `subject=${encodeURIComponent(parts.subject)}&body=${encodeURIComponent(parts.body)}`;
  return `mailto:${encodeURIComponent(parts.to.trim()).replace(/%40/g, '@')}?${q}`;
}

import { describe, expect, it } from 'vitest';
import { isEmailAddress, joinEmail, mailtoHref, splitEmail } from '../src/shared/email';

describe('email drafts', () => {
  it('splits the stored subject line from the body', () => {
    const parts = splitEmail('Subject: Hello there\n\nHi Thomas,\n\nAlex');
    expect(parts).toEqual({ to: '', subject: 'Hello there', body: 'Hi Thomas,\n\nAlex' });
  });

  it('round-trips To, Subject and body', () => {
    const text = joinEmail({ to: 'tom@example.com', subject: 'Hi', body: 'Body\n\nline' });
    expect(text).toBe('To: tom@example.com\nSubject: Hi\n\nBody\n\nline');
    expect(splitEmail(text)).toEqual({ to: 'tom@example.com', subject: 'Hi', body: 'Body\n\nline' });
  });

  it('keeps a draft with no headers as all body', () => {
    expect(splitEmail('Hi,\nSubject: not a header')).toEqual({ to: '', subject: '', body: 'Hi,\nSubject: not a header' });
  });

  it('checks addresses and builds a mailto link', () => {
    expect(isEmailAddress('tom@example.com')).toBe(true);
    expect(isEmailAddress('founder or CEO')).toBe(false);
    expect(mailtoHref({ to: 'tom@example.com', subject: 'A & B', body: 'x\ny' })).toBe('mailto:tom@example.com?subject=A%20%26%20B&body=x%0Ay');
  });
});

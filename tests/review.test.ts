import { describe, expect, it } from 'vitest';
import { quoteOnPage, settleReview, type RawCheck } from '../src/worker/engine/logic';
import { verifierPrompt, verifierSchema } from '../src/worker/engine/prompts';

const html = '<html><body><h1>About us</h1><p>Jane Doe is our Commercial&nbsp;Director, leading partnerships since 2023.</p></body></html>';

describe('quoteOnPage', () => {
  it('finds a passage word for word, ignoring case, spacing and curly quotes', () => {
    expect(quoteOnPage('jane doe is our commercial director, leading partnerships', html)).toBe(true);
    expect(quoteOnPage('“Jane Doe is our  Commercial Director”', html)).toBe(true);
  });
  it('refuses a paraphrase, a joined passage or a fragment too short to mean anything', () => {
    expect(quoteOnPage('Jane Doe leads commercial partnerships', html)).toBe(false);
    expect(quoteOnPage('About us Jane Doe heads sales', html)).toBe(false);
    expect(quoteOnPage('Jane Doe', html)).toBe(false);
  });
});

describe('settleReview', () => {
  const check = (key: RawCheck['key'], answer: RawCheck['answer'], quote = 'a passage on the page'): RawCheck => ({ key, answer, note: 'why', url: `https://x.co.uk/${key}`, quote });
  const all = (found: 'on_page' | 'not_on_page' | 'unreadable') =>
    new Map(['publisher', 'contact', 'page'].map((k) => [`https://x.co.uk/${k}\na passage on the page`, found] as const));

  it('passes only when every check is yes with a quote code found', () => {
    const r = settleReview([check('publisher', 'yes'), check('contact', 'yes'), check('page', 'yes')], all('on_page'), 't');
    expect(r.decision).toBe('pass');
  });
  it('turns an answer whose quote is not on the page into unsure, so the agent cannot pass or reject on its own word', () => {
    const r = settleReview([check('publisher', 'no'), check('contact', 'yes'), check('page', 'yes')], all('not_on_page'), 't');
    expect(r.decision).toBe('unsure');
    expect(r.checks.every((c) => c.answer === 'unsure')).toBe(true);
  });
  it('rejects on a no backed by a found quote', () => {
    const r = settleReview([check('publisher', 'no'), check('contact', 'yes'), check('page', 'yes')], all('on_page'), 't');
    expect(r.decision).toBe('reject');
  });
  it('lets the reading stand when the page blocked code, and leaves a missing answer unsure', () => {
    const r = settleReview([check('publisher', 'yes'), check('contact', 'yes')], all('unreadable'), 't');
    expect(r.checks.find((c) => c.key === 'publisher')?.answer).toBe('yes');
    expect(r.checks.find((c) => c.key === 'page')?.answer).toBe('unsure');
    expect(r.decision).toBe('unsure');
  });
  it('does not count a yes with no quote', () => {
    const r = settleReview([{ ...check('publisher', 'yes'), quote: null }, check('contact', 'yes'), check('page', 'yes')], all('on_page'), 't');
    expect(r.decision).toBe('unsure');
  });
});

describe('verifier prompt and reply', () => {
  it('lists each lead with what code found', () => {
    const text = verifierPrompt([
      { domain: 'a.co.uk', owner: 'A Ltd', companyType: 'large group', monetisation: 'ads', contactRole: 'head of partnerships', contactName: null, contactSourceUrl: null, contactCheck: 'no person was named', facts: 'ads.txt 40 lines', page: 'https://a.co.uk/best', questions: ['best x'] },
    ]);
    expect(text).toContain('a.co.uk');
    expect(text).toContain('no person was named');
    expect(text).toContain('"best x"');
  });
  it('reads a reply, treating an odd answer as unsure', () => {
    const parsed = verifierSchema.parse({
      sites: [{ domain: 'a.co.uk', checks: [{ key: 'publisher', answer: 'Probably', note: 'x' }, { key: 'page', answer: 'YES', url: 'https://a.co.uk/best', quote: 'q' }], better_contact: { name: 'Jane Doe', source_url: 'https://a.co.uk/team' } }],
    });
    expect(parsed.sites[0].checks.map((c) => c.answer)).toEqual(['unsure', 'yes']);
    expect(parsed.sites[0].better_contact?.name).toBe('Jane Doe');
  });
});

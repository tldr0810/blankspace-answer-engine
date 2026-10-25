import { describe, expect, it } from 'vitest';
import {
  emailOnPage,
  pageEmails,
  pickAddress,
  acceptAnswers,
  foreignSite,
  onePerSite,
  judgePage,
  missReason,
  pageCovers,
  queryKeywords,
  siteVerified,
  withoutDropped,
  cleanUrls,
  draftEmail,
  isPublisher,
  nameOnPage,
  normalizeDomain,
  pageText,
  robotsAllows,
  score,
  tally,
} from '../src/worker/engine/logic';

describe('acceptAnswers', () => {
  it('keeps only questions we asked and drops cited URLs the search never returned', () => {
    const { answers, dropped } = acceptAnswers('claude', ['best carry on luggage'], [
      { query: 'Best carry on luggage ', cited: ['https://a.com/x', 'https://made-up.com/y'], seen: ['https://a.com/x', 'https://b.com/z'] },
      { query: 'something we never asked', cited: ['https://c.com'], seen: ['https://c.com'] },
    ]);
    expect(answers).toHaveLength(1);
    expect(answers[0].cited).toEqual(['https://a.com/x']);
    expect(dropped).toBe(1);
  });

  it('rejects Google redirect wrappers and non-http URLs', () => {
    expect(cleanUrls(['javascript:alert(1)', 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', 'https://ok.com/#frag'], 10)).toEqual([
      'https://ok.com/',
    ]);
  });
});

describe('tally', () => {
  it('counts an answer once per domain however many pages it cites', () => {
    const rows = tally([
      { engine: 'claude', query: 'q1', cited: ['https://www.a.com/1', 'https://a.com/2'], seen: [] },
      { engine: 'gemini', query: 'q1', cited: ['https://a.com/3', 'https://b.com/'], seen: [] },
    ]);
    expect(rows[0]).toMatchObject({ domain: 'a.com', answers: 2, citations: 3, byEngine: { claude: 1, gemini: 1 } });
    expect(rows[1]).toMatchObject({ domain: 'b.com', answers: 1 });
  });
});

describe('scoring', () => {
  const facts = { domain: 'x.com', reachable: true, cdn: 'Cloudflare', affiliate: true, adsTxtLines: 40, robots: {}, checkedAt: '' };
  it('gives 60 for share and 40 for money and edge signals', () => {
    expect(score(15, 30, facts)).toBe(70);
    expect(score(0, 30, { ...facts, cdn: 'nginx', affiliate: false, adsTxtLines: 0 })).toBe(0);
  });
  it('drops marketplaces and sites that show no sign of ads or affiliate', () => {
    expect(isPublisher('reddit.com', null)).toBe(false);
    expect(isPublisher('vendor.com', { ...facts, affiliate: false, adsTxtLines: 0 })).toBe(false);
    expect(isPublisher('blocked.com', { ...facts, reachable: false, affiliate: null, adsTxtLines: null })).toBe(true);
  });
});

describe('robotsAllows', () => {
  const robots = 'User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nUser-agent: ChatGPT-User\nDisallow: /\n';
  it('applies the most specific group', () => {
    expect(robotsAllows(robots, 'ChatGPT-User')).toBe(false);
    expect(robotsAllows(robots, 'GPTBot')).toBe(false);
    expect(robotsAllows(robots, 'Claude-User')).toBe(true);
  });
  it('lets an explicit Allow win a tie', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /\n', 'PerplexityBot')).toBe(true);
  });
});

describe('nameOnPage', () => {
  const text = pageText('<p>Our team: <b>Jens&nbsp;Jakob Andersen</b>, Founder. Contact kate.hannam@haymarket.com</p><p>Cédric Demers</p>');
  it('finds a full name, with a middle name and accents', () => {
    expect(nameOnPage('Jens Andersen', text)).toBe(true);
    expect(nameOnPage('Cedric Demers', text)).toBe(true);
  });
  it('does not accept a name that only appears in an email address', () => {
    expect(nameOnPage('Kate Hannam', text)).toBe(false);
  });
});

describe('normalizeDomain', () => {
  it('accepts what people type', () => {
    expect(normalizeDomain('https://www.WhatCar.com/reviews')).toBe('whatcar.com');
    expect(normalizeDomain('not a site')).toBe('');
  });
});

describe('draftEmail', () => {
  it('uses only counted facts and the verified name', () => {
    const email = draftEmail({
      domain: 'runrepeat.com',
      vertical: 'running',
      answers: 13,
      total: 30,
      questions: 15,
      engines: ['claude', 'gemini'],
      rivals: [{ domain: 'runweekly.com', answers: 8 }],
      pages: ['https://runrepeat.com/guides/best-running-shoes'],
      robots: { 'ChatGPT-User': false },
      contactRole: 'founder or CEO',
      contactName: 'Jens Jakob Andersen',
      reportUrl: 'https://example.workers.dev/#report/run_1/runrepeat.com',
    });
    expect(email).toMatch(/^Subject: runrepeat.com was cited in 13 of 30 AI answers on running/);
    expect(email).toContain('Hi Jens,');
    expect(email).toContain('blocks ChatGPT-User');
    expect(email.split(/\s+/).length).toBeLessThan(170);
  });
});

describe('cited-page checks', () => {
  const q = 'best noise cancelling headphones under £200';

  it('keeps the words a page has to use', () => {
    expect(queryKeywords(q)).toEqual(['noise', 'cancelling', 'headphones']);
  });

  it('a page covers a question when half its keywords appear', () => {
    expect(pageCovers('our pick of noise cancelling headphone deals', [q])).toBe(true);
    expect(pageCovers('the best running shoes of the year', [q])).toBe(false);
    expect(pageCovers('anything', ['best of 2026'])).toBe(true);
  });

  const page = (status: number, text: string, finalUrl = 'https://site.com/review') => ({ status, text, finalUrl });

  it('judges a live, on-topic page ok', () => {
    expect(judgePage('https://site.com/review', page(200, '<h1>Noise cancelling headphones tested</h1>'), [q]).verdict).toBe('ok');
  });

  it('drops gone pages, soft 404s and off-topic pages', () => {
    expect(judgePage('https://site.com/review', page(404, ''), [q]).verdict).toBe('dead');
    expect(judgePage('https://site.com/review', page(200, 'headphones noise cancelling', 'https://site.com/'), [q]).verdict).toBe('dead');
    expect(judgePage('https://site.com/review', page(200, '<p>Garden furniture sale</p>'), [q]).verdict).toBe('off_topic');
  });

  it('keeps pages a site refused to show us as blocked, not dead', () => {
    expect(judgePage('https://site.com/review', page(403, ''), [q]).verdict).toBe('blocked');
    expect(judgePage('https://site.com/review', page(503, ''), [q]).verdict).toBe('blocked');
    expect(judgePage('https://site.com/review', null, [q]).verdict).toBe('blocked');
  });

  it('leaves dropped pages out of the counts but keeps the answer in the total', () => {
    const answers = [{ engine: 'claude' as const, query: q, cited: ['https://a.com/x', 'https://b.com/y'], seen: [] }];
    const verdicts = new Map([['https://a.com/x', 'dead' as const]]);
    const rows = tally(withoutDropped(answers, verdicts));
    expect(rows.map((r) => r.domain)).toEqual(['b.com']);
    expect(siteVerified(['https://b.com/y'], new Map([['https://b.com/y', 'ok' as const]]))).toBe(true);
    expect(siteVerified(['https://b.com/y'], new Map([['https://b.com/y', 'blocked' as const]]))).toBe(false);
    expect(siteVerified(['https://b.com/y'], new Map())).toBe(null);
  });
});

describe('missReason', () => {
  const res = (status: number, text = '', headers: Record<string, string> = {}) => ({ status, text, header: (n: string) => headers[n] ?? null });
  it('names bot protection instead of a bare failure', () => {
    expect(missReason(res(403, '', { 'cf-mitigated': 'challenge' }))).toBe('bot_check');
    expect(missReason(res(403, '<html>', { 'cf-ray': 'abc' }))).toBe('bot_check');
    expect(missReason(res(503, '<title>Just a moment...</title>'))).toBe('bot_check');
  });
  it('tells refusals, timeouts and web pages apart', () => {
    expect(missReason(null)).toBe('no_answer');
    expect(missReason(res(429))).toBe('refused');
    expect(missReason(res(500))).toBe('error');
    expect(missReason(res(200, '<html><body>Home</body></html>'))).toBe('not_a_file');
  });
  it('does not flag a normal page that loads a Cloudflare script', () => {
    expect(missReason(res(200, '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>', { 'cf-ray': 'abc' }))).toBe('not_a_file');
  });
});

describe('foreignSite', () => {
  it('drops other countries but keeps UK and generic endings', () => {
    expect(foreignSite('autohled.cz')).toBe(true);
    expect(foreignSite('idealo.de')).toBe(true);
    expect(foreignSite('whatcar.com')).toBe(false);
    expect(foreignSite('carwow.co.uk')).toBe(false);
    expect(foreignSite('stuff.tv')).toBe(false);
  });
});

describe('onePerSite', () => {
  const lead = (domain: string, verdict: string, runAt: string, score: number) => ({ domain, verdict, runAt, score });
  it('prefers a checked contact, then the newest run, then the score', () => {
    const out = onePerSite([
      lead('carwow.co.uk', 'not_found', '2026-10-21', 63),
      lead('carwow.co.uk', 'verified', '2026-10-21T15', 33),
      lead('runrepeat.com', 'verified', '2026-10-21', 41),
      lead('runrepeat.com', 'verified', '2026-10-25', 42),
      lead('expertreviews.co.uk', 'verified', '2026-10-21', 60),
      lead('expertreviews.co.uk', 'no_person', '2026-10-22', 48),
    ]);
    expect(out.map((l) => [l.domain, l.verdict, l.runAt])).toEqual([
      ['expertreviews.co.uk', 'verified', '2026-10-21'],
      ['runrepeat.com', 'verified', '2026-10-25'],
      ['carwow.co.uk', 'verified', '2026-10-21T15'],
    ]);
  });
});

describe('published addresses', () => {
  const html = `<p>Advertising: <a href="mailto:Advertising@ExpertReviews.co.uk">email us</a></p>
    <p>Privacy: privacy@expertreviews.co.uk · press &#64; expertreviews.co.uk is not one</p>
    <p>Charlie: charlie.milligan [at] expertreviews.co.uk</p><img src="logo@2x.png">
    <p>Agency: sales@otheragency.com</p>`;

  it('reads mailto links, entities and [at] spellings, and skips asset names', () => {
    const emails = pageEmails(html);
    expect(emails).toContain('advertising@expertreviews.co.uk');
    expect(emails).toContain('charlie.milligan@expertreviews.co.uk');
    expect(emails).not.toContain('logo@2x.png');
  });

  it('prefers the named contact, then a commercial inbox on the site’s own domain', () => {
    const emails = pageEmails(html);
    expect(pickAddress(emails, 'expertreviews.co.uk', 'Charlie Milligan')).toEqual({ email: 'charlie.milligan@expertreviews.co.uk', kind: 'person' });
    expect(pickAddress(emails, 'www.expertreviews.co.uk', null)).toEqual({ email: 'advertising@expertreviews.co.uk', kind: 'inbox' });
  });

  it('never picks support or privacy inboxes, or another company’s address', () => {
    expect(pickAddress(['privacy@site.com', 'support@site.com', 'sales@agency.com'], 'site.com', null)).toBeNull();
    expect(pickAddress(['hello@site.com', 'privacy@site.com'], 'site.com', null)).toEqual({ email: 'hello@site.com', kind: 'inbox' });
  });

  it('checks an address word for word on the page', () => {
    expect(emailOnPage('advertising@expertreviews.co.uk', html)).toBe(true);
    expect(emailOnPage('first.last@expertreviews.co.uk', html)).toBe(false);
  });
});

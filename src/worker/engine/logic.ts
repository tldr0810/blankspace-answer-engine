/**
 * The engine's pure logic: counting, scoring, filtering, robots parsing, name checks and
 * the email template. No I/O here, so every number the dashboard shows can be unit tested.
 *
 * The split follows one rule: agents judge, code counts. Agents answer questions and suggest
 * contacts. Code decides what a citation is, who ranks where, and whether a name stands.
 */

import { AI_AGENTS, DROPPED_VERDICTS, ENGINE_LABEL, VERTICAL_LABEL, type BoardRow, type CheckMiss, type Engine, type PageVerdict, type SiteFacts, type Vertical, scoreParts, REVIEW_CHECKS, type LeadReview, type ReviewCheck, type ReviewCheckKey, type ReviewDecision, type SiteRule, EDGE_CDNS, finalDecision, type Lead, type Learning, type SignalStat } from '../../shared/engine';

/** Cited often, but not ad- or affiliate-funded publishers. */
export const NOT_PUBLISHERS = [
  'amazon.', 'ebay.', 'reddit.com', 'youtube.com', 'wikipedia.org', 'facebook.com', 'instagram.com',
  'tiktok.com', 'x.com', 'twitter.com', 'quora.com', 'apple.com', 'google.com', 'gov.uk', 'linkedin.com',
  'microsoft.com', 'g2.com', 'capterra.', 'trustpilot.com', 'idealo.', 'pricespy.', 'tripadvisor.',
  'booking.com', 'expedia.', 'britishairways.com', 'easyjet.com', 'ryanair.com', 'nhs.uk',
];

export const AFFILIATE_MARKERS = [
  'amzn.to', 'amazon.co.uk/dp', 'amazon.com/dp', 'tag=', 'skimlinks', 'sovrn', 'viglink', 'awin1.com',
  'impact.com', 'prf.hn', 'rakuten', 'anrdoezrs', 'go.redirectingat.com', 'howl.me', 'shareasale',
  'pjtra.com', 'tkqlhce.com', 'dpbolvw.net', 'avantlink', 'partnerize',
];

export interface Answer {
  engine: Engine;
  query: string;
  cited: string[];
  seen: string[];
}

export function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

/** A domain a person typed: strips scheme, path and www. Returns '' when it isn't one. */
export function normalizeDomain(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  const host = domainOf(value.includes('://') ? value : `https://${value}`);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

/** Only real http(s) URLs, no Google redirect wrappers, de-duplicated, capped. */
export function cleanUrls(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (/(^|\.)vertexaisearch\.cloud\.google\.com$|(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname.includes('redirect')) continue;
    url.hash = '';
    const clean = url.toString();
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * A scout's answers, checked by code: only questions we asked, only real URLs, and a cited
 * page must be one the search actually returned. A model that "cites" a page it never saw
 * has invented it.
 */
export function acceptAnswers(engine: Engine, asked: string[], raw: unknown): { answers: Answer[]; dropped: number } {
  const rows = Array.isArray(raw) ? raw : [];
  const byQuery = new Map<string, Answer>();
  let dropped = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const query = asked.find((q) => q.toLowerCase() === String(r.query ?? '').trim().toLowerCase());
    if (!query || byQuery.has(query)) continue;
    const seen = cleanUrls(r.seen, 40);
    const citedRaw = cleanUrls(r.cited, 12);
    const seenSet = new Set(seen);
    const cited = citedRaw.filter((u) => seenSet.has(u));
    dropped += citedRaw.length - cited.length;
    byQuery.set(query, { engine, query, cited, seen });
  }
  return { answers: asked.filter((q) => byQuery.has(q)).map((q) => byQuery.get(q)!), dropped };
}

/**
 * The answers that count. An engine that cited nothing across a whole run had no working search
 * (ChatGPT's scout scraping a search page and getting a bot check, say). Its empty answers are not
 * answers that cited no one, so they stay out of the totals and the engine is reported as silent.
 */
export function countedAnswers(answers: Answer[]): { answers: Answer[]; engines: Engine[]; silent: Engine[] } {
  const asked = [...new Set(answers.map((a) => a.engine))];
  const engines = asked.filter((e) => answers.some((a) => a.engine === e && a.cited.length > 0));
  return { answers: answers.filter((a) => engines.includes(a.engine)), engines, silent: asked.filter((e) => !engines.includes(e)) };
}

/** What a scout said before its JSON block, cut to one short line: why its search came back empty. */
export function searchExcuse(text: string): string {
  // The reason is at the end; the opening sentence is usually the scout restating the task.
  const sentences = text.split('```')[0].replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const reason = sentences.slice(-2).join(' ');
  if (!reason) return 'it gave no reason.';
  return reason.length > 200 ? `${reason.slice(0, 199).trimEnd()}…` : reason;
}

/** Citations per domain: how many answers cited it (any page), by engine, and which pages. */
export function tally(answers: Answer[]): (BoardRow & { pages: string[]; queries: string[] })[] {
  const stats = new Map<string, BoardRow & { pages: string[]; queries: string[] }>();
  for (const answer of answers) {
    const domains = new Set<string>();
    for (const url of answer.cited) {
      const d = domainOf(url);
      if (!d) continue;
      const row = stats.get(d) ?? { domain: d, answers: 0, citations: 0, byEngine: {}, publisher: null, pages: [], queries: [] };
      row.citations += 1;
      if (!row.pages.includes(url)) row.pages.push(url);
      stats.set(d, row);
      domains.add(d);
    }
    for (const d of domains) {
      const row = stats.get(d)!;
      row.answers += 1;
      row.byEngine[answer.engine] = (row.byEngine[answer.engine] ?? 0) + 1;
      if (!row.queries.includes(answer.query)) row.queries.push(answer.query);
    }
  }
  return [...stats.values()].sort((a, b) => b.answers - a.answers || b.citations - a.citations || a.domain.localeCompare(b.domain));
}

export const listedNonPublisher = (domain: string): boolean => NOT_PUBLISHERS.some((m) => domain.includes(m));

/** Country-code endings that read as generic names, so they say nothing about the audience. */
const GENERIC_CCTLDS = ['uk', 'io', 'co', 'ai', 'tv', 'me', 'fm', 'gg', 'so', 'ly'];

/** A site under another country's domain (autohled.cz, idealo.de). Blankspace sells to UK publishers first. */
export const foreignSite = (domain: string): boolean => {
  const tld = domain.split('.').pop() ?? '';
  return tld.length === 2 && !GENERIC_CCTLDS.includes(tld);
};

/**
 * One lead per site across every run: a contact code confirmed beats one it couldn't, then
 * the newest run, then the higher score. `runAt` is when the lead's run started.
 */
export function onePerSite<T extends { domain: string; verdict: string; score: number; runAt: string }>(leads: T[]): T[] {
  const best = new Map<string, T>();
  const rank = (l: T) => [l.verdict === 'verified' ? 1 : 0, l.runAt, l.score] as const;
  for (const lead of leads) {
    const held = best.get(lead.domain);
    if (!held) {
      best.set(lead.domain, lead);
      continue;
    }
    const [a, b] = [rank(lead), rank(held)];
    if (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]) best.set(lead.domain, lead);
  }
  return [...best.values()].sort((x, y) => y.score - x.score);
}

export function isPublisher(domain: string, facts: SiteFacts | null, rule?: SiteRule['rule']): boolean {
  // What a person or the verifier decided before wins over the guesses below.
  if (rule) return rule === 'publisher';
  if (listedNonPublisher(domain)) return false;
  if (!facts) return true;
  // Unreachable sites stay in for a person to check; reachable ones need a sign they sell ads or affiliate.
  return !facts.reachable || Boolean(facts.adsTxtLines) || Boolean(facts.affiliate);
}

/** 60 points for answer share, 15 for ads.txt, 15 for affiliate links, 10 for an edge CDN. */
export function score(answers: number, total: number, facts: SiteFacts | null): number {
  return scoreParts(answers, total, facts).total;
}

export function cdnFromHeaders(get: (name: string) => string | null): string {
  if (get('cf-ray')) return 'Cloudflare';
  const via = (get('via') ?? '').toLowerCase();
  if (get('x-fastly-request-id') || via.includes('fastly') || (get('x-served-by') ?? '').startsWith('cache-')) return 'Fastly';
  if (get('x-amz-cf-id')) return 'CloudFront';
  if (get('x-akamai-request-id') || (get('server') ?? '').toLowerCase().includes('akamai')) return 'Akamai';
  return get('server') || 'unknown';
}

/**
 * Why a fetch gave us nothing usable. A Cloudflare challenge or a "just a moment" page is bot
 * protection, which says nothing about whether the file exists.
 */
export function missReason(fetched: { status: number; text: string; header: (name: string) => string | null } | null): CheckMiss {
  if (!fetched) return 'no_answer';
  const head = fetched.text.slice(0, 3000).toLowerCase();
  const behindCloudflare = Boolean(fetched.header('cf-ray'));
  if (fetched.header('cf-mitigated') === 'challenge') return 'bot_check';
  if (/<title>\s*(just a moment|attention required|access denied|verifying you are human)|_cf_chl_opt/.test(head)) return 'bot_check';
  if (fetched.status === 403 && behindCloudflare) return 'bot_check';
  if (fetched.status === 401 || fetched.status === 403 || fetched.status === 429) return 'refused';
  if (fetched.status >= 400) return 'error';
  return 'not_a_file';
}

export function countAdsTxt(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.includes(',') && !line.trimStart().startsWith('#')).length;
}

export const hasAffiliate = (html: string): boolean => {
  const body = html.toLowerCase();
  return AFFILIATE_MARKERS.some((m) => body.includes(m));
};

/**
 * Can `agent` fetch "/"? Groups are matched the way crawlers do: the most specific user-agent
 * group wins, otherwise `*`. Within a group the longest matching rule wins, Allow on a tie.
 */
export function robotsAllows(robots: string, agent: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (key === 'disallow' && !value) continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const name = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && name.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  let best: { allow: boolean; path: string } | null = null;
  for (const rule of rules) {
    const path = rule.path.replace(/\*$/, '').replace(/\$$/, '');
    if (!'/'.startsWith(path) && path !== '/') continue;
    if (!best || path.length > best.path.length || (path.length === best.path.length && rule.allow)) best = { ...rule, path };
  }
  return best ? best.allow : true;
}

export function robotsReport(robots: string): Record<string, boolean> {
  return Object.fromEntries(Object.keys(AI_AGENTS).map((agent) => [agent, robotsAllows(robots, agent)]));
}

/** Visible text of an HTML page, lowercased, whitespace collapsed. For the name check. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Does the page show this person's full name? Accents and case are ignored, and a
 * middle name in between is tolerated. "Kate" alone, or a name inside an email address, is not.
 */
export function nameOnPage(name: string, text: string): boolean {
  const parts = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 1);
  if (parts.length < 2) return false;
  const first = parts[0].replace(/[^a-z'-]/g, '');
  const last = parts[parts.length - 1].replace(/[^a-z'-]/g, '');
  const re = new RegExp(`(^|[^a-z@.])${first}(\\s+[a-z.'-]+){0,2}\\s+${last}([^a-z@]|$)`);
  return re.test(text);
}

/* ───────── published email addresses ───────── */

/** Inboxes that never reach a commercial conversation. */
const DEAD_INBOXES = /^(no-?reply|do-?not-?reply|privacy|gdpr|dpo|data|legal|abuse|postmaster|webmaster|jobs|careers|recruit\w*|hr|unsubscribe|subscriptions?|billing|accounts|complaints?|support|help|customerservice|returns|orders)$/;
/** Shared inboxes worth a first commercial email, best first. */
const INBOX_RANK: RegExp[] = [
  /partner|commercial|advertis|^ads?$|adsales|sales|business|brand|sponsor|media/,
  /^(hello|hi|info|contact|enquir|inquir|team|office|mail)/,
  /editor|editorial|news|press|tips/,
];

/** The site's own name for matching addresses: example.co.uk → example.co.uk and example. */
const siteRoot = (domain: string) => domain.replace(/^www\./, '').toLowerCase();

/**
 * Every email address a page shows: mailto links and plain text, with the common HTML-entity
 * and "[at]" spellings undone. Asset names like logo@2x.png are not addresses.
 */
export function pageEmails(html: string): string[] {
  const text = html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.')
    .replace(/%40/g, '@');
  const found = new Set<string>();
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) {
    const email = m[0].toLowerCase().replace(/\.+$/, '');
    if (/\.(png|jpe?g|gif|svg|webp|avif|css|js)$/.test(email)) continue;
    if (/@(example|sentry|wixpress|domain|email)\./.test(email)) continue;
    found.add(email);
  }
  return [...found];
}

/** Is this exact address shown on the page? */
export const emailOnPage = (email: string, html: string): boolean => pageEmails(html).includes(email.trim().toLowerCase());

/**
 * The best address on the site's own domain for a first commercial email: the named contact's
 * own address first, then a partnerships or advertising inbox, then a general one. Null when the
 * site publishes nothing better than support or privacy inboxes.
 */
export function pickAddress(emails: string[], domain: string, contactName: string | null): { email: string; kind: 'person' | 'inbox' } | null {
  const root = siteRoot(domain);
  const own = emails.filter((e) => {
    const host = e.split('@')[1];
    return host === root || host.endsWith(`.${root}`) || root.endsWith(`.${host}`);
  });
  const parts = (contactName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z]/g, ''))
    .filter((p) => p.length > 1);
  if (parts.length >= 2) {
    const [first, last] = [parts[0], parts[parts.length - 1]];
    const person = own.find((e) => {
      const local = e.split('@')[0];
      return local.includes(last) || local === first || local === `${first[0]}${last}`;
    });
    if (person) return { email: person, kind: 'person' };
  }
  for (const rank of INBOX_RANK) {
    const inbox = own.find((e) => {
      const local = e.split('@')[0];
      return !DEAD_INBOXES.test(local) && rank.test(local);
    });
    if (inbox) return { email: inbox, kind: 'inbox' };
  }
  return null;
}

/** Text for a word-for-word comparison: page text rules, plus curly quotes and dashes made plain. */
const plainText = (text: string) =>
  pageText(text)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/…/g, '...')
    .trim();

/** Is this passage on the page word for word? Case, accents, spacing and quote marks are ignored; nothing else is. */
export function quoteOnPage(quote: string, html: string): boolean {
  const q = plainText(quote).replace(/^["'.\s]+|["'.\s]+$/g, '');
  if (q.length < 12) return false;
  return plainText(html).includes(q);
}

export interface RawCheck {
  key: ReviewCheckKey;
  answer: 'yes' | 'no' | 'unsure';
  note: string;
  url: string | null;
  quote: string | null;
}

/**
 * Code's ruling on the verifier's review. An answer needs a quote, and a quote code could read
 * but not find makes the answer unsure: the agent never gets past code. A page that blocks code
 * leaves the agent's reading standing, as a person would have to open it anyway. The decision
 * comes from the checks, not from the agent: any no rejects, all yes passes, else a person decides.
 */
export function settleReview(raw: RawCheck[], quoteChecks: Map<string, ReviewCheck['quoteCheck']>, at: string): Omit<LeadReview, 'change'> {
  const checks: ReviewCheck[] = REVIEW_CHECKS.map((key) => {
    const r = raw.find((c) => c.key === key);
    if (!r) return { key, answer: 'unsure', note: 'The verifier did not answer this.', url: null, quote: null, quoteCheck: null };
    if (r.answer === 'unsure') return { ...r, quoteCheck: null };
    if (!r.url || !r.quote) return { ...r, answer: 'unsure', note: `${r.note} (No quote given, so it does not count.)`.trim(), quoteCheck: null };
    const found = quoteChecks.get(`${r.url}\n${r.quote}`) ?? 'unreadable';
    if (found === 'not_on_page') return { ...r, answer: 'unsure', note: `${r.note} (The verification layer opened the page and the quote is not on it.)`.trim(), quoteCheck: found };
    return { ...r, quoteCheck: found };
  });
  const decision: ReviewDecision = checks.some((c) => c.answer === 'no') ? 'reject' : checks.every((c) => c.answer === 'yes') ? 'pass' : 'unsure';
  return { decision, checks, reviewedAt: at };
}

const QUERY_STOPWORDS = new Set([
  'best', 'top', 'under', 'over', 'for', 'the', 'and', 'with', 'which', 'what', 'how', 'should', 'good', 'cheap', 'cheapest',
  'most', 'worth', 'buy', 'buying', 'right', 'now', 'this', 'year', 'from', 'that', 'are', 'can', 'get', 'you', 'your', 'need',
  'between', 'compared', 'versus', 'review', 'reviews', 'budget', 'money', 'value',
]);

/** The words a page about this question has to use. Short words, numbers and filler drop out. */
export function queryKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !QUERY_STOPWORDS.has(w) && w !== 'uk');
  return [...new Set(words)];
}

/**
 * Does the page cover at least one of the questions it was cited for? Half of a question's
 * keywords must appear (a keyword matches on its first five letters, so "headphones" also
 * finds "headphone"). A question with no keywords left counts as covered.
 */
export function pageCovers(text: string, queries: string[]): boolean {
  if (!queries.length) return true;
  return queries.some((query) => {
    const keywords = queryKeywords(query);
    if (!keywords.length) return true;
    const hits = keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${k.slice(0, 5)}`).test(text)).length;
    return hits >= Math.ceil(keywords.length / 2);
  });
}

export interface PageFetch {
  status: number;
  /** The URL after redirects. */
  finalUrl: string;
  text: string;
}

/**
 * Code's verdict on one cited page. null fetch = no answer in time. A deep link that lands on
 * the home page is a soft 404. 401, 403, 429 and 5xx mean the site refused us, not that the page
 * is gone, so those stay in as unchecked rather than being dropped.
 */
export function judgePage(url: string, fetched: PageFetch | null, queries: string[]): { verdict: PageVerdict; note: string } {
  if (!fetched) return { verdict: 'blocked', note: 'No answer in time.' };
  const { status } = fetched;
  if (status === 401 || status === 403 || status === 429 || status >= 500) return { verdict: 'blocked', note: `HTTP ${status}: the site refused our check.` };
  if (status >= 400) return { verdict: 'dead', note: `HTTP ${status}.` };
  try {
    const asked = new URL(url);
    const landed = new URL(fetched.finalUrl || url);
    if (asked.pathname.length > 1 && landed.pathname === '/' && !landed.search) return { verdict: 'dead', note: 'Redirects to the home page.' };
  } catch {
    /* keep going on the text */
  }
  const text = pageText(fetched.text);
  if (text.length < 200 && /captcha|access denied|enable javascript|just a moment/.test(text)) return { verdict: 'blocked', note: 'A bot check stood in front of the page.' };
  if (!pageCovers(text, queries)) return { verdict: 'off_topic', note: 'The page loads but does not cover the question it was cited for.' };
  return { verdict: 'ok', note: 'Loads and covers the question.' };
}

/** Answers with dropped pages (dead or off topic) taken out. An answer left with none still counts toward the total. */
export function withoutDropped(answers: Answer[], verdicts: Map<string, PageVerdict>): Answer[] {
  return answers.map((a) => ({ ...a, cited: a.cited.filter((u) => !DROPPED_VERDICTS.includes(verdicts.get(u) as PageVerdict)) }));
}

/** true when one of the site's cited pages checked out, false when every check was blocked, null before any check. */
export function siteVerified(pages: string[], verdicts: Map<string, PageVerdict>): boolean | null {
  const seen = pages.map((u) => verdicts.get(u)).filter(Boolean);
  if (!seen.length) return null;
  return seen.includes('ok') ? true : false;
}

export interface DraftInput {
  domain: string;
  vertical: Vertical;
  answers: number;
  total: number;
  questions: number;
  engines: Engine[];
  rivals: { domain: string; answers: number }[];
  pages: string[];
  robots: Record<string, boolean>;
  contactRole: string | null;
  contactName: string | null;
  reportUrl: string;
}

/**
 * The first email, built from counted facts only, so no number in it can be made up.
 * Under 120 words, opens with their number, asks them to look at the report, not for a call.
 */
export function draftEmail(input: DraftInput): string {
  const label = VERTICAL_LABEL[input.vertical].toLowerCase();
  const engines = input.engines.map((e) => ENGINE_LABEL[e]).join(' and ');
  const greeting = input.contactName ? `Hi ${input.contactName.split(/\s+/)[0]},` : 'Hi,';
  const blocked = ['ChatGPT-User', 'Perplexity-User', 'Claude-User'].filter((a) => input.robots[a] === false);
  const rivals = input.rivals.slice(0, 3).map((r) => `${r.domain} (${r.answers})`).join(', ');
  const lines = [
    `Subject: ${input.domain} was cited in ${input.answers} of ${input.total} AI answers on ${label}`,
    '',
    greeting,
    '',
    `We asked ${engines} ${input.questions} buying questions UK shoppers ask about ${label}. ${input.answers} of the ${input.total} answers cited ${input.domain}.`,
    rivals ? `The sites cited most in the same answers: ${rivals}.` : '',
    input.pages[0] ? `One page they leaned on: ${input.pages[0]}` : '',
    blocked.length ? `Your robots.txt blocks ${blocked.join(', ')}, so those answers are built from other sites.` : '',
    '',
    `Each of those citations is an AI agent reading your page for someone about to buy, and it doesn't show in your analytics. Blankspace shows you that traffic and can earn from it without changing what readers see.`,
    '',
    `Your free report: ${input.reportUrl}`,
    '',
    'Alex',
    '',
    'Not the right person? Reply and I won’t write again.',
  ];
  return lines.filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
}

/* ───────── learning from decisions ───────── */

/** Decisions needed before a signal's approval rate is worth reading. */
export const DECISIONS_NEEDED = 10;

/**
 * What a decided lead says: approved or called a good fit is a yes; skipped or called not a fit
 * is a no. Leads nobody decided on teach nothing.
 */
export function leadOutcome(lead: Pick<Lead, 'status' | 'review'>): boolean | null {
  const call = lead.review?.person?.call;
  if (call) return call === 'fit';
  if (lead.status === 'approved') return true;
  if (lead.status === 'skipped') return false;
  return null;
}

/**
 * How the score's signals line up with what people decided. Shown next to the weights so a
 * person can change them; the weights are never changed by this.
 */
export function signalStats(leads: Pick<Lead, 'status' | 'review' | 'answers' | 'total' | 'facts'>[]): { decided: number; signals: SignalStat[] } {
  const decided = leads.flatMap((l) => {
    const yes = leadOutcome(l);
    return yes === null ? [] : [{ l, yes }];
  });
  const has: [SignalStat['key'], string, number, (l: (typeof decided)[number]['l']) => boolean][] = [
    ['share', 'Cited in at least 1 in 4 answers', 60, (l) => l.total > 0 && l.answers / l.total >= 0.25],
    ['adsTxt', 'Runs ads (ads.txt)', 15, (l) => Boolean(l.facts?.adsTxtLines)],
    ['affiliate', 'Uses affiliate links', 15, (l) => Boolean(l.facts?.affiliate)],
    ['cdn', 'On an edge CDN', 10, (l) => Boolean(l.facts && EDGE_CDNS.includes(l.facts.cdn))],
  ];
  const signals = has.map(([key, label, points, test]) => {
    const withIt = decided.filter((d) => test(d.l));
    const without = decided.filter((d) => !test(d.l));
    return {
      key,
      label,
      points,
      withYes: withIt.filter((d) => d.yes).length,
      withN: withIt.length,
      withoutYes: without.filter((d) => d.yes).length,
      withoutN: without.length,
    };
  });
  return { decided: decided.length, signals };
}

/** How often the verifier's decision held up, counting only leads a person also called. */
export function verifierRecord(reviews: LeadReview[]): Learning['verifier'] {
  const agent = reviews.filter((r) => r.checks.length > 0);
  const called = agent.filter((r) => r.person && r.decision !== 'unsure');
  return {
    reviewed: agent.length,
    pass: agent.filter((r) => r.decision === 'pass').length,
    reject: agent.filter((r) => r.decision === 'reject').length,
    unsure: agent.filter((r) => r.decision === 'unsure').length,
    called: called.length,
    overturned: called.filter((r) => finalDecision(r) !== r.decision).length,
  };
}

/**
 * The checks code runs itself, from the Worker: ads.txt, a cited page (affiliate links and
 * CDN headers), robots.txt, and the contact's source page. Each fetch has its own timeout and
 * a failure only blanks that one fact and records why; it never fails the run. A blocked ads.txt
 * is retried on the www/apex twin, a blocked cited page falls back to the home page.
 */

import { cdnFromHeaders, countAdsTxt, emailOnPage, hasAffiliate, judgePage, missReason, nameOnPage, pageEmails, pageText, pickAddress, robotsReport } from './logic';
import type { CheckMiss, LeadAddress, PageVerdict, SiteFacts } from '../../shared/engine';
import { now } from '../db';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BlankspaceAnswerShare/1.0';
const TIMEOUT_MS = 9_000;
const MAX_BODY = 600_000;

async function get(url: string): Promise<{ status: number; headers: Headers; text: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, MAX_BODY);
    return { status: response.status, headers: response.headers, text, finalUrl: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Fetched = NonNullable<Awaited<ReturnType<typeof get>>>;

const readable = (f: Fetched | null) => (f ? { status: f.status, text: f.text, header: (n: string) => f.headers.get(n) } : null);

/** The same host with "www." added or taken off: many sites only answer on one of the two. */
function otherHost(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;
}

async function readAdsTxt(domain: string): Promise<{ lines: number | null; miss?: CheckMiss }> {
  let miss: CheckMiss = 'no_answer';
  for (const host of [domain, otherHost(domain)]) {
    const ads = await get(`https://${host}/ads.txt`);
    if (ads?.status === 404) return { lines: 0 };
    const type = ads?.headers.get('content-type') ?? '';
    if (ads && ads.status === 200 && type.includes('text/plain')) return { lines: countAdsTxt(ads.text) };
    miss = missReason(readable(ads));
  }
  return { lines: null, miss };
}

export async function checkSite(domain: string, samplePage: string | null): Promise<SiteFacts> {
  const facts: SiteFacts = { domain, reachable: false, cdn: 'unknown', affiliate: null, adsTxtLines: null, robots: {}, checkedAt: now() };
  const [page, ads, robots] = await Promise.all([
    get(samplePage ?? `https://${domain}/`),
    readAdsTxt(domain),
    get(`https://${domain}/robots.txt`),
  ]);
  if (page) facts.cdn = cdnFromHeaders((name) => page.headers.get(name));
  facts.reachable = Boolean(page && page.status < 400);
  if (page && facts.reachable && missReason(readable(page)) !== 'bot_check') {
    facts.affiliate = hasAffiliate(page.text);
    facts.affiliateFrom = 'cited page';
  } else {
    // The cited page was blocked: the home page often is not, and carries the same affiliate scripts.
    const home = samplePage ? await get(`https://${domain}/`) : null;
    if (home && facts.cdn === 'unknown') facts.cdn = cdnFromHeaders((name) => home.headers.get(name));
    if (home && home.status < 400 && missReason(readable(home)) !== 'bot_check') {
      facts.reachable = true;
      facts.affiliate = hasAffiliate(home.text);
      facts.affiliateFrom = 'home page';
    } else {
      facts.pageMiss = missReason(readable(page));
    }
  }
  facts.adsTxtLines = ads.lines;
  if (ads.miss) facts.adsTxtMiss = ads.miss;
  if (robots && robots.status === 200 && !/<html/i.test(robots.text.slice(0, 500))) {
    facts.robots = robotsReport(robots.text);
  }
  return facts;
}

export interface VerifyResult {
  verdict: 'verified' | 'not_found' | 'fetch_blocked';
  note: string;
}

/**
 * A page's HTML, for checking the verifier's quotes. null when the site refused us or did not
 * answer (the quote stays unchecked); empty when the page is gone (no quote can be on it).
 */
export async function fetchText(url: string): Promise<string | null> {
  const page = await get(url);
  if (!page || page.status === 401 || page.status === 403 || page.status === 429 || page.status >= 500) return null;
  return page.status >= 400 ? '' : page.text;
}

/** Opens the page the profiler cited and checks the person's full name is really on it. */
export async function verifyContact(name: string, sourceUrl: string): Promise<VerifyResult> {
  const page = await get(sourceUrl);
  if (!page) return { verdict: 'fetch_blocked', note: 'The source page did not answer in time.' };
  if (page.status >= 400) {
    return { verdict: page.status === 403 ? 'fetch_blocked' : 'not_found', note: `The source page returned HTTP ${page.status}.` };
  }
  return nameOnPage(name, pageText(page.text))
    ? { verdict: 'verified', note: `${name} is named on the source page.` }
    : { verdict: 'not_found', note: `The source page loaded but does not show ${name}. Use the role until a person confirms a name.` };
}

/** The site's own pages most likely to publish a commercial address, in the order we open them. */
const CONTACT_PATHS = ['/contact', '/contact-us', '/advertise', '/advertising', '/about', '/about-us', '/'];
const ADDRESS_PAGE_CAP = 6;

/**
 * Finds a published address to write to. The profiler's suggestion counts only if its exact
 * address is on the page it cited; otherwise the verification layer reads the site's own
 * contact, advertise and about pages and keeps the best address on the site's domain. Nothing is
 * guessed or built from a name pattern: no address on any page means none.
 */
export async function findAddress(
  domain: string,
  contactName: string | null,
  suggested: { email: string | null; url: string | null },
  extraPages: string[] = [],
): Promise<LeadAddress> {
  const checkedAt = now();
  const base = `https://${domain.replace(/^www\./, '')}`;
  let agentNote = '';
  if (suggested.email && suggested.url) {
    const page = await get(suggested.url);
    if (page && page.status < 400 && emailOnPage(suggested.email, page.text)) {
      const named = pickAddress([suggested.email.toLowerCase()], domain, contactName);
      return { email: suggested.email.toLowerCase(), sourceUrl: suggested.url, kind: named?.kind ?? 'inbox', foundBy: 'agent', note: 'The profiler’s address is on the page it cited.', checkedAt };
    }
    agentNote = `The profiler suggested ${suggested.email}, but it is not on the page it cited. `;
  }
  // Some sites only answer on www (or only without it): if the first site page does not answer at all, use the twin.
  let host = base;
  const urls = [...new Set([...extraPages, ...CONTACT_PATHS])].slice(0, ADDRESS_PAGE_CAP);
  const seen = new Map<string, string>();
  let read = 0;
  let tried = 0;
  for (const path of urls) {
    const url = path.startsWith('/') ? `${host}${path}` : path;
    let page = await get(url);
    if (path.startsWith('/') && tried++ === 0 && !page) {
      host = `https://${otherHost(new URL(base).hostname)}`;
      page = await get(`${host}${path}`);
    }
    if (!page || page.status >= 400) continue;
    read += 1;
    for (const email of pageEmails(page.text)) if (!seen.has(email)) seen.set(email, page.finalUrl || url);
    const best = pickAddress([...seen.keys()], domain, contactName);
    // A named person's address, or a partnerships or advertising inbox, is as good as it gets.
    if (best && (best.kind === 'person' || /partner|commercial|advertis|^ads?@|sales|business|brand|sponsor|media/.test(best.email))) break;
  }
  const best = pickAddress([...seen.keys()], domain, contactName);
  if (best) {
    return { email: best.email, sourceUrl: seen.get(best.email)!, kind: best.kind, foundBy: 'scan', note: `${agentNote}Read on the site’s own page.`, checkedAt };
  }
  return {
    email: null,
    sourceUrl: null,
    kind: null,
    foundBy: null,
    note: read ? `${agentNote}No usable address on ${read} of the site’s contact and about pages.` : `${agentNote}The site’s contact pages did not load.`,
    checkedAt,
  };
}

/** Opens a cited page and judges it: live and on topic, off topic, dead, or blocked by the site. */
export async function checkPage(url: string, queries: string[]): Promise<{ url: string; status: number | null; verdict: PageVerdict; note: string }> {
  const page = await get(url);
  return { url, status: page?.status ?? null, ...judgePage(url, page, queries) };
}

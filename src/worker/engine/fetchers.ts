/**
 * The checks code runs itself, from the Worker: ads.txt, a cited page (affiliate links and
 * CDN headers), robots.txt, and the contact's source page. Each fetch has its own timeout and
 * a failure only blanks that one fact; it never fails the run.
 */

import type { SiteFacts } from '../../shared/engine';
import { cdnFromHeaders, countAdsTxt, hasAffiliate, judgePage, nameOnPage, pageText, robotsReport } from './logic';
import type { PageVerdict } from '../../shared/engine';
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

export async function checkSite(domain: string, samplePage: string | null): Promise<SiteFacts> {
  const facts: SiteFacts = { domain, reachable: false, cdn: 'unknown', affiliate: null, adsTxtLines: null, robots: {}, checkedAt: now() };
  const [page, ads, robots] = await Promise.all([
    get(samplePage ?? `https://${domain}/`),
    get(`https://${domain}/ads.txt`),
    get(`https://${domain}/robots.txt`),
  ]);
  if (page) {
    facts.cdn = cdnFromHeaders((name) => page.headers.get(name));
    facts.reachable = page.status < 400;
    if (facts.reachable) facts.affiliate = hasAffiliate(page.text);
  }
  if (ads) {
    const type = ads.headers.get('content-type') ?? '';
    if (ads.status === 200 && type.includes('text/plain')) facts.adsTxtLines = countAdsTxt(ads.text);
    else if (ads.status === 404) facts.adsTxtLines = 0;
  }
  if (robots && robots.status === 200 && !/<html/i.test(robots.text.slice(0, 500))) {
    facts.robots = robotsReport(robots.text);
  }
  return facts;
}

export interface VerifyResult {
  verdict: 'verified' | 'not_found' | 'fetch_blocked';
  note: string;
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

/** Opens a cited page and judges it: live and on topic, off topic, dead, or blocked by the site. */
export async function checkPage(url: string, queries: string[]): Promise<{ url: string; status: number | null; verdict: PageVerdict; note: string }> {
  const page = await get(url);
  return { url, status: page?.status ?? null, ...judgePage(url, page, queries) };
}

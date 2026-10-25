/**
 * What the engine asks its agents, and the shape it accepts back. Every reply ends with one
 * ```json block; code validates it with zod and then checks the content itself.
 */

import { z } from 'zod';

export function scoutPrompt(questions: string[]): string {
  return [
    'You are a scout for an AI Answer Share study. A UK shopper asks an AI assistant each question below.',
    'For EACH question:',
    '1. Run a live web search for the question with "UK" added, as a UK shopper would type it. Prefer UK pages and UK editions (uk.pcmag.com over pcmag.com).',
    '2. In "seen", list every result URL the search returned. If a result is a redirect link (for example vertexaisearch.cloud.google.com/grounding-api-redirect), resolve it to the real page URL first.',
    '3. In "cited", list the 3 to 8 URLs you would actually rely on and cite in a helpful shopping answer. Every cited URL must also be in "seen". Never invent a URL.',
    '4. Leave forums, video sites and marketplaces (Reddit, YouTube, Amazon, eBay) out of "cited"; they can stay in "seen". Leave pages written for another country (US prices in dollars, US-only dealers or stores) out of "cited" too.',
    'Work fast: one search per question, resolve redirects with a single HEAD request each, and do not open or read the pages themselves.',
    'Do not write the shopping answers themselves. Do not contact anyone.',
    '',
    'Questions:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'End your reply with exactly one fenced JSON block in this shape, one entry per question, with the question text copied exactly:',
    '```json',
    '{"answers":[{"query":"<question>","cited":["https://..."],"seen":["https://..."]}]}',
    '```',
  ].join('\n');
}

export const scoutSchema = z.object({
  answers: z.array(
    z.object({
      query: z.string(),
      cited: z.array(z.string()).default([]),
      seen: z.array(z.string()).default([]),
    }),
  ),
});

export const COMPANY_TYPES = [
  'founder-run independent',
  'mid-size media company',
  'SEO-led affiliate site',
  'site with ad ops team',
  'large group',
  'unknown',
] as const;

export function profilePrompt(domains: string[]): string {
  return [
    'I work in partnerships at Blankspace, which helps publishers see and earn from the AI agents (ChatGPT, Perplexity and others) that read their pages when answering questions. For each website below I want one first conversation with the right person.',
    '',
    'For each site, research with web search and by opening the site’s own about, contact, advertise and team pages:',
    '- who owns it (founder-run independent, or part of a group, and which group)',
    '- roughly how it makes money (display ads, affiliate, subscriptions)',
    '- whether it has announced an AI content deal (OpenAI, Perplexity, Amazon, TollBit, ProRata, Cloudflare pay per crawl, or others)',
    '- the single best first contact, by these rules: founder-run independent → founder or CEO; mid-size media company → head of revenue or commercial director; SEO-led affiliate site → head of SEO or audience; site with an ad ops team → head of programmatic; large group → head of partnerships or AI partnerships.',
    '',
    'Give a person’s name ONLY if a public page shows that name in that role, and give that exact page URL. Code will open the URL and check the name is on it; a name that is not there is thrown away.',
    'If a public page shows an email address for that person, or a shared inbox for advertising, partnerships or commercial enquiries, give it exactly as written with that page URL. Code checks the address is on that page. Never guess an email address or build one from a name pattern; leave it null instead.',
    '',
    'Sites:',
    ...domains.map((d) => `- ${d}`),
    '',
    'End your reply with exactly one fenced JSON block:',
    '```json',
    `{"sites":[{"domain":"example.co.uk","owner":"...","company_type":"${COMPANY_TYPES.join('|')}","monetisation":"...","ai_deal":null,"contact_role":"...","contact_name":null,"contact_source_url":null,"contact_email":null,"email_source_url":null,"why":"one sentence"}]}`,
    '```',
  ].join('\n');
}

const nullableText = z.union([z.string(), z.null()]).optional().transform((v) => (v && v.trim() ? v.trim() : null));

export const profileSchema = z.object({
  sites: z.array(
    z.object({
      domain: z.string(),
      owner: nullableText,
      company_type: z.string().optional().transform((v) => (COMPANY_TYPES as readonly string[]).includes(v ?? '') ? v! : 'unknown'),
      monetisation: nullableText,
      ai_deal: nullableText,
      contact_role: nullableText,
      contact_name: nullableText,
      contact_source_url: nullableText,
      contact_email: nullableText,
      email_source_url: nullableText,
      why: nullableText,
    }),
  ),
});

export interface ReviewInput {
  domain: string;
  owner: string | null;
  companyType: string | null;
  monetisation: string | null;
  contactRole: string | null;
  contactName: string | null;
  contactSourceUrl: string | null;
  /** What code found when it opened the contact's source page. */
  contactCheck: string;
  facts: string;
  page: string | null;
  /** The questions the site was cited for; the page answers at least one of them. */
  questions: string[];
}

/**
 * The verifier reviews another agent's leads, the way a maintainer reviews a collector's records:
 * a fixed checklist, a source and a word-for-word quote for every answer, and unsure over a guess.
 */
export function verifierPrompt(leads: ReviewInput[], pastCalls: { domain: string; call: string; note: string | null }[] = []): string {
  return [
    'You are the verifier for Blankspace, which helps publishers see and earn from the AI agents that read their pages. Another agent found the leads below and suggested who to contact. You did not make them; your job is to check them before a person writes to anyone.',
    '',
    'For EACH site answer three questions with yes, no or unsure:',
    '1. publisher: is this an independent publisher or media site that earns from its own traffic (display ads, affiliate links, subscriptions)? A brand selling its own products, a retailer, a marketplace, a price comparison or lead-gen business, a forum or a public body is "no".',
    '2. contact: is the suggested role the right first contact for a commercial partnership at this company, and if a person is named, does a page dated within the last two years show them in that role now? A person who has left, or a role that is editorial rather than commercial, is "no".',
    '3. page: does the cited page actually answer one of the buying questions it was cited for (a review, a comparison or a guide), rather than a home page, a category list or an unrelated article?',
    '',
    'Rules, as for any reviewer:',
    '- Every yes or no needs the page URL you read and a quote of one to three sentences copied word for word from that page. Code will open the URL and look for the quote; an answer whose quote is not on the page becomes unsure.',
    '- If you cannot open a page or the evidence is mixed, answer unsure and say why. Never answer no just because a page would not load.',
    '- If you answer contact "no", or no person is named, and a public page names the right person (for example on an advertise or team page), you MUST give them in "better_contact" with that page URL. Code will check their name is on it. Never guess a name or an email address.',
    '- Work fast: use web search and open at most four pages per site.',
    '',
    ...(pastCalls.length
      ? [
          'Calls the Blankspace team made on earlier leads. Judge the same way:',
          ...pastCalls.map((c) => `- ${c.domain}: ${c.call.replace('_', ' ')}${c.note ? ` (${c.note})` : ''}`),
          '',
        ]
      : []),
    'Leads:',
    ...leads.map((l, i) =>
      [
        `${i + 1}. ${l.domain}`,
        `   owner: ${l.owner ?? 'unknown'} (${l.companyType ?? 'unknown'}); money: ${l.monetisation ?? 'unknown'}`,
        `   site checks by code: ${l.facts}`,
        `   suggested contact: ${l.contactName ? `${l.contactName}, ` : ''}${l.contactRole ?? 'none'}${l.contactSourceUrl ? ` (source ${l.contactSourceUrl})` : ''}; ${l.contactCheck}`,
        l.page ? `   cited page: ${l.page}, cited for one of: ${l.questions.map((q) => `"${q}"`).join(', ')}` : '   cited page: none',
      ].join('\n'),
    ),
    '',
    'End your reply with exactly one fenced JSON block:',
    '```json',
    '{"sites":[{"domain":"example.co.uk","checks":[{"key":"publisher|contact|page","answer":"yes|no|unsure","note":"one sentence","url":"https://...","quote":"copied word for word"}],"better_contact":null}]}',
    '```',
    'better_contact, when you have one: {"name":"First Last","role":"...","source_url":"https://..."}',
  ].join('\n');
}

const answer = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['yes', 'no', 'unsure']).catch('unsure'));

export const verifierSchema = z.object({
  sites: z.array(
    z.object({
      domain: z.string(),
      checks: z
        .array(
          z.object({
            key: z.string(),
            answer: answer,
            note: z.string().optional().default(''),
            url: nullableText,
            quote: nullableText,
          }),
        )
        .default([]),
      better_contact: z
        .object({ name: z.string(), role: nullableText, source_url: z.string() })
        .nullable()
        .optional()
        .catch(null),
    }),
  ),
});

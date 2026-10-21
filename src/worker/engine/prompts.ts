/**
 * What the engine asks its agents, and the shape it accepts back. Every reply ends with one
 * ```json block; code validates it with zod and then checks the content itself.
 */

import { z } from 'zod';

export function scoutPrompt(questions: string[]): string {
  return [
    'You are a scout for an AI Answer Share study. A UK shopper asks an AI assistant each question below.',
    'For EACH question:',
    '1. Run a live web search with the question as a UK shopper would type it.',
    '2. In "seen", list every result URL the search returned. If a result is a redirect link (for example vertexaisearch.cloud.google.com/grounding-api-redirect), resolve it to the real page URL first.',
    '3. In "cited", list the 3 to 8 URLs you would actually rely on and cite in a helpful shopping answer. Every cited URL must also be in "seen". Never invent a URL.',
    '4. Leave forums, video sites and marketplaces (Reddit, YouTube, Amazon, eBay) out of "cited"; they can stay in "seen".',
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
    'Give a person’s name ONLY if a public page shows that name in that role, and give that exact page URL. Code will open the URL and check the name is on it; a name that is not there is thrown away. Never guess an email address.',
    '',
    'Sites:',
    ...domains.map((d) => `- ${d}`),
    '',
    'End your reply with exactly one fenced JSON block:',
    '```json',
    `{"sites":[{"domain":"example.co.uk","owner":"...","company_type":"${COMPANY_TYPES.join('|')}","monetisation":"...","ai_deal":null,"contact_role":"...","contact_name":null,"contact_source_url":null,"why":"one sentence"}]}`,
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
      why: nullableText,
    }),
  ),
});

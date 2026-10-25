/**
 * The Answer Share engine's API surface, shared by the Worker and the browser.
 * Plain data only: no runtime imports from either side.
 */

export const VERTICALS = ['automotive', 'consumer_tech', 'running', 'b2b_software', 'travel'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_LABEL: Record<Vertical, string> = {
  automotive: 'Automotive',
  consumer_tech: 'Consumer tech',
  running: 'Running',
  b2b_software: 'B2B software',
  travel: 'Travel',
};

/** The buying questions each vertical is measured on. Edit to change what the engine asks. */
export const QUESTIONS: Record<Vertical, string[]> = {
  automotive: [
    'best family SUV to buy in 2026',
    'best electric car under £40,000',
    'Kia EV3 vs Volvo EX30 which should I buy',
    'most reliable used cars to buy',
    'best hybrid car for long motorway commutes',
    'Tesla Model Y vs Hyundai Ioniq 5',
    'best small car for new drivers insurance',
    'best 7 seater car for families',
    'is leasing or PCP better for a new car',
    'best electric SUV range for road trips',
    'best estate car for dog owners',
    'cheapest cars to run in the UK',
    'best pickup truck to buy',
    'best car for towing a caravan',
    'BMW iX1 vs Audi Q4 e-tron review',
  ],
  consumer_tech: [
    'best TV for gaming 2026',
    'best noise cancelling headphones',
    'best laptop for students',
    'best budget phone with a good camera',
    'OLED vs mini LED TV which is better',
    'best robot vacuum for pet hair',
    'best monitor for working from home',
    'best wireless earbuds for running',
    'iPhone vs Pixel which should I buy',
    'best soundbar under £500',
    'best smartwatch for fitness tracking',
    'best gaming headset',
    'best tablet for drawing',
    'best mesh wifi system for a large house',
    'best 4K projector for home cinema',
  ],
  running: [
    'best running shoes for flat feet',
    'best marathon racing shoes 2026',
    'best trail running shoes for muddy terrain',
    'best cushioned running shoes for beginners',
    'Nike Pegasus vs Brooks Ghost',
    'best running shoes for overpronation',
    'best carbon plate running shoes',
    'best running jacket for rain',
    'best running watch for marathon training',
    'best hiking boots for wide feet',
    'best running shorts with pockets',
    'best gym shoes for lifting',
    'best walking shoes for standing all day',
    'best running socks to prevent blisters',
    'Hoka Clifton vs Asics Novablast',
  ],
  b2b_software: [
    'best CRM for a small business',
    'best project management software for agencies',
    'HubSpot vs Salesforce for a startup',
    'best accounting software for UK small businesses',
    'best email marketing software',
    'best HR software for a 50 person company',
    'best help desk software',
    'best password manager for teams',
    'Notion vs Confluence for internal docs',
    'best website builder for small business',
    'best payroll software UK',
    'best video conferencing software for business',
    'best e-signature software',
    'best VPN for business',
    'best customer data platform for ecommerce',
  ],
  travel: [
    'best travel credit card for airport lounges',
    'best things to do in Lisbon',
    'best all inclusive resorts in the Caribbean',
    'best carry on luggage',
    'how to get airline upgrades with points',
    'best time to visit Japan',
    'best hotels in Barcelona for families',
    'best travel insurance for frequent travellers',
    'best Avios redemptions',
    'best Greek islands for couples',
    'best ski resorts in Europe for beginners',
    'best travel backpack',
    'is premium economy worth it on long haul',
    'best city break destinations in Europe',
    'best cruise lines for families',
  ],
};

/** The engines a run can ask. Each is a connected Manyfold agent with live web search. */
export const ENGINES = ['claude', 'gemini', 'gpt'] as const;
export type Engine = (typeof ENGINES)[number];
export const ENGINE_LABEL: Record<Engine, string> = { claude: 'Claude', gemini: 'Gemini', gpt: 'ChatGPT' };

export const ROLES = ['scout_claude', 'scout_gemini', 'scout_gpt', 'profiler', 'verifier'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  scout_claude: 'Claude scout',
  scout_gemini: 'Gemini scout',
  scout_gpt: 'ChatGPT scout',
  profiler: 'Profiler',
  verifier: 'Verifier',
};
export const ROLE_HELP: Record<Role, string> = {
  scout_claude: 'A Claude agent with web search. Answers the buying questions and lists the pages it relied on.',
  scout_gemini: 'A Gemini agent with Google search. Same job, second engine, so share is not one model’s taste.',
  scout_gpt: 'Optional. An OpenAI agent with live web search.',
  profiler: 'Researches who owns each site and who to talk to. Its names are verified by automated checks before you see them.',
  verifier: 'Optional. Reviews each lead the way an editor would: is it a publisher, is the contact right and current, does the cited page answer the question. Must be a different agent from the profiler, ideally another model family.',
};
export const scoutRole = (engine: Engine): Role => `scout_${engine}` as Role;

export type RunKind = 'vertical' | 'site' | 'question';
export type RunStatus = 'running' | 'done' | 'failed';

/** The steps a run walks through, in order. A question run stops after `enrich`. */
export const STEPS = ['ask', 'score', 'enrich', 'profile', 'verify', 'review', 'draft'] as const;
export type Step = (typeof STEPS)[number] | 'done';
export const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  ask: 'Ask the AI engines',
  score: 'Count citations',
  enrich: 'Check ads.txt, affiliate links, CDN, robots.txt',
  profile: 'Find owner and contact',
  verify: 'Fact-check contact on its source page',
  review: 'Second agent reviews each lead',
  draft: 'Draft first email',
};

export interface Run {
  id: string;
  kind: RunKind;
  vertical: Vertical | null;
  domain: string | null;
  questions: string[];
  engines: Engine[];
  status: RunStatus;
  step: Step;
  stepDetail: string | null;
  seed: boolean;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  text: string;
  createdAt: string;
}

/** CDNs that sit at the network edge, where an AI-bot paywall can be switched on. */
export const EDGE_CDNS = ['Cloudflare', 'Fastly', 'CloudFront', 'Akamai'];

export interface ScoreParts {
  share: number;
  adsTxt: number;
  affiliate: number;
  cdn: number;
  total: number;
}

/** 60 points for answer share, 15 for ads.txt, 15 for affiliate links, 10 for an edge CDN. */
export function scoreParts(answers: number, total: number, facts: SiteFacts | null): ScoreParts {
  const share = total ? (60 * answers) / total : 0;
  const adsTxt = facts?.adsTxtLines ? 15 : 0;
  const affiliate = facts?.affiliate ? 15 : 0;
  const cdn = facts && EDGE_CDNS.includes(facts.cdn) ? 10 : 0;
  return { share: Math.round(share), adsTxt, affiliate, cdn, total: Math.round(share + adsTxt + affiliate + cdn) };
}

/** One site's checks, run by code from the Worker. */
export interface SiteFacts {
  domain: string;
  reachable: boolean;
  cdn: string;
  affiliate: boolean | null;
  adsTxtLines: number | null;
  /** agent name → allowed at "/" */
  robots: Record<string, boolean>;
  checkedAt: string;
  /** Why adsTxtLines is null. Missing on facts saved before reasons were kept. */
  adsTxtMiss?: CheckMiss;
  /** Why affiliate is null. */
  pageMiss?: CheckMiss;
  /** Which page the affiliate check read: a cited page, or the home page when that was blocked. */
  affiliateFrom?: 'cited page' | 'home page';
}

/** Why a check came back empty, so a report can say so instead of a bare "not readable". */
export type CheckMiss = 'bot_check' | 'refused' | 'no_answer' | 'not_a_file' | 'error';

/** A site in a leaderboard: how many answers per engine cited it. */
export interface BoardRow {
  domain: string;
  answers: number;
  citations: number;
  byEngine: Partial<Record<Engine, number>>;
  publisher: boolean | null;
  /** true: a cited page opened and is on topic. false: the site blocked every check. null: not checked yet. */
  verified?: boolean | null;
}

/**
 * Code's check of one cited page. ok: it loads and covers the question. off_topic and dead
 * pages are dropped from every count. blocked: the site refused our fetch, so it stays in,
 * marked unchecked.
 */
export type PageVerdict = 'ok' | 'off_topic' | 'dead' | 'blocked';
export const DROPPED_VERDICTS: readonly PageVerdict[] = ['off_topic', 'dead'];

/**
 * Automatic vertical refreshes. A Manyfold automation calls POST /api/engine/autopilot on its
 * schedule; the app starts the next vertical in rotation, at most once per AUTOPILOT_MIN_GAP_HOURS.
 */
export interface Autopilot {
  enabled: boolean;
  /** Index into VERTICALS of the next vertical to refresh. */
  next: number;
  lastAt: string | null;
  lastRunId: string | null;
  /** When the Manyfold automation last called, whether or not that call started a run. */
  lastPingAt: string | null;
  /** What that call did: 'started', or why it skipped. */
  lastPingResult: 'started' | 'paused' | 'no_engines' | 'running' | 'too_soon' | null;
}
export const AUTOPILOT_MIN_GAP_HOURS = 2;
/** The automation runs every 6 hours; past this, the panel says it has stopped calling. */
export const AUTOPILOT_STALE_HOURS = 8;

export type Verdict = 'verified' | 'not_found' | 'fetch_blocked' | 'no_person' | 'pending';

export interface Lead {
  id: string;
  runId: string;
  vertical: Vertical;
  domain: string;
  score: number;
  answers: number;
  total: number;
  citations: number;
  pages: string[];
  queries: string[];
  facts: SiteFacts | null;
  owner: string | null;
  companyType: string | null;
  monetisation: string | null;
  aiDeal: string | null;
  contactRole: string | null;
  contactName: string | null;
  contactSourceUrl: string | null;
  why: string | null;
  verdict: Verdict;
  verifyNote: string | null;
  email: string | null;
  status: 'draft' | 'approved' | 'skipped';
  /** The verifier agent's review, after code checked its quotes. Null when no verifier ran. */
  review: LeadReview | null;
}

export const REVIEW_CHECKS = ['publisher', 'contact', 'page'] as const;
export type ReviewCheckKey = (typeof REVIEW_CHECKS)[number];
export const REVIEW_CHECK_LABEL: Record<ReviewCheckKey, string> = {
  publisher: 'A publisher that earns from its traffic',
  contact: 'Right contact, still in the role',
  page: 'Cited page answers the question',
};

/** One question the verifier answered, and what code found when it opened the quoted page. */
export interface ReviewCheck {
  key: ReviewCheckKey;
  answer: 'yes' | 'no' | 'unsure';
  note: string;
  url: string | null;
  quote: string | null;
  /** on_page: code found the quote word for word. not_on_page: it did not, so the answer became unsure. unreadable: the page blocked code, so the verifier's reading stands. */
  quoteCheck: 'on_page' | 'not_on_page' | 'unreadable' | null;
}

/** pass: every check is yes. reject: a check is no, backed by a quote. unsure: a person decides. Code sets this from the checks, not the agent. */
export type ReviewDecision = 'pass' | 'reject' | 'unsure';

export interface LeadReview {
  decision: ReviewDecision;
  checks: ReviewCheck[];
  /** What the verifier changed, already checked by code: a contact it found, or a name it showed is out of date. */
  change: string | null;
  reviewedAt: string;
  /** A person's call on the lead. It overrides the verifier and teaches the next runs. */
  person?: { call: PersonCall; note: string | null; at: string };
}

export const PERSON_CALLS = ['fit', 'not_publisher', 'wrong_contact'] as const;
export type PersonCall = (typeof PERSON_CALLS)[number];
export const PERSON_CALL_LABEL: Record<PersonCall, string> = { fit: 'Good fit', not_publisher: 'Not a publisher', wrong_contact: 'Wrong contact' };

/** The decision that counts: a person's call when there is one, else the verifier's. */
export const finalDecision = (review: LeadReview | null): ReviewDecision | null =>
  !review ? null : review.person ? (review.person.call === 'fit' ? 'pass' : 'reject') : review.decision;

/** What the flow remembers about a site between runs. A person's rule beats the verifier's. */
export interface SiteRule {
  domain: string;
  rule: 'publisher' | 'not_publisher';
  by: 'verifier' | 'person';
  reason: string;
  at: string;
}

/** One signal the score uses, and how often leads with and without it were approved. */
export interface SignalStat {
  key: 'share' | 'adsTxt' | 'affiliate' | 'cdn';
  label: string;
  points: number;
  withYes: number;
  withN: number;
  withoutYes: number;
  withoutN: number;
}

/** What the flow has learned from its own checks and from people's decisions. */
export interface Learning {
  rules: SiteRule[];
  profiler: { suggested: number; confirmed: number };
  verifier: { reviewed: number; pass: number; reject: number; unsure: number; called: number; overturned: number };
  decided: number;
  /** Decisions needed before the signal rates mean anything. */
  needed: number;
  signals: SignalStat[];
}

export interface VerticalBoard {
  vertical: Vertical;
  runId: string;
  runAt: string;
  seed: boolean;
  total: number;
  engines: Engine[];
  questions: number;
  rows: BoardRow[];
}

export interface EngineState {
  roles: Partial<Record<Role, string>>;
  engines: Engine[];
  canProfile: boolean;
  runs: Run[];
  boards: VerticalBoard[];
  limits: { runsToday: number; dailyLimit: number; active: number };
  autopilot: Autopilot & { nextVertical: Vertical };
  sources: { ok: number; dropped: number; blocked: number };
}

export interface RunDetail {
  run: Run;
  events: RunEvent[];
  board: BoardRow[];
  total: number;
  leads: Lead[];
  calls: { role: string; label: string; state: string; error: string | null }[];
}

/** A site's report: the hook a publisher would receive. */
export interface SiteReport {
  domain: string;
  vertical: Vertical;
  runId: string;
  runAt: string;
  total: number;
  engines: Engine[];
  rank: number | null;
  row: BoardRow | null;
  board: BoardRow[];
  pages: string[];
  pageVerdicts: Record<string, PageVerdict>;
  queries: string[];
  facts: SiteFacts | null;
  lead: Lead | null;
}

/** AI agents whose robots.txt rules matter. Live fetchers are the traffic Blankspace monetises. */
export const AI_AGENTS: Record<string, string> = {
  'ChatGPT-User': 'live answers',
  'Perplexity-User': 'live answers',
  'Claude-User': 'live answers',
  'OAI-SearchBot': 'search index',
  PerplexityBot: 'search index',
  GPTBot: 'model training',
};

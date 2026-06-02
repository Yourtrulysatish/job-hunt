/**
 * scorer.ts — Local keyword-based job fit scorer
 *
 * No AI tokens. Scores each job against the candidate's profile using
 * weighted keyword matching on title, company, location, and portal.
 *
 * Score breakdown (max 5.0):
 *   Title relevance      0–2.5   (most important)
 *   Domain relevance     0–1.0   (Web3 / AI / crypto context)
 *   Remote compatibility 0–0.5
 *   Seniority match      0–0.5
 *   Bonus signals        0–0.5
 */

export interface ScoredJob {
  score: number;           // 0.0 – 5.0
  label: 'Strong Match' | 'Good Match' | 'Partial Match' | 'Weak Match';
  reasons: string[];       // short human-readable explanations
  skipReason?: string;     // if it's a clear skip, why
}

// ── Keyword sets ──────────────────────────────────────────────────────

// Core role keywords — title must match at least one for a meaningful score
const ROLE_TIER1 = [
  /partnership[s]?\s*(manager|lead|director|head|specialist)/i,
  /business\s*development\s*(manager|lead|director|head|rep|bd)/i,
  /\bbdm?\b/i,
  /ecosystem\s*(growth|manager|lead|partnerships)/i,
  /affiliate\s*(manager|lead|director|program)/i,
  /growth\s*(marketing|manager|lead|director|hacker)/i,
  /head\s*of\s*(partnerships|growth|marketing|business\s*development)/i,
  /director\s*of\s*(partnerships|growth|marketing|bd)/i,
  /partner\s*(manager|success|development|relations)/i,
];

const ROLE_TIER2 = [
  /partnership[s]?/i,
  /business\s*dev(elopment)?/i,
  /ecosystem/i,
  /affiliate/i,
  /growth\s*market/i,
  /performance\s*market/i,
  /marketing\s*(manager|lead|director|head)/i,
  /marketing\s*partner/i,
  /strategic\s*(alliance|partner)/i,
  /\bcommunity\s*(manager|lead|growth)\b/i,
  /go.?to.?market|gtm/i,
  /revenue\s*(growth|partner|alliance)/i,
  /channel\s*(partner|sales|market)/i,
];

// Domain bonuses — Web3 / AI / Crypto context
const DOMAIN_WEB3 = [
  /\bweb3\b|\bweb 3\b/i,
  /\bcrypto\b|\bcryptocurrency\b/i,
  /\bblockchain\b/i,
  /\bdefi\b/i,
  /\bnft\b/i,
  /\bprotocol\b/i,
  /\btoken\b/i,
  /\bdao\b/i,
  /\bsolana\b|\bethereum\b|\bbitcoin\b|\bpolygon\b|\bripple\b|\bchainlink\b/i,
];

const DOMAIN_AI = [
  /\bai\b|artificial intelligence/i,
  /\bllm\b|large language model/i,
  /\bmachine learning\b|\bml\b/i,
  /\bgpt\b|\bclaude\b|\bgemini\b/i,
];

// Seniority signals
const SENIOR_SIGNALS  = [/\b(senior|sr\.?|lead|director|head|principal|staff|vp|vice\s*pres)\b/i];
const JUNIOR_SIGNALS  = [/\b(junior|jr\.?|associate(?!\s*(partner|director|vp))|entry.level|graduate|intern)\b/i];

// Remote signals
const REMOTE_POSITIVE = [/\bremote\b/i, /\bdistributed\b/i, /\bwfh\b/i, /\banywhere\b/i];
const REMOTE_NEGATIVE = [/\bon.?site\b/i, /\bin.?office\b/i, /\breloc/i];

// Hard exclusions — not relevant for Satish
const EXCLUSIONS = [
  /\bengineer\b|\bdeveloper\b|\bprogrammer\b/i,
  /\bsoftware\b|\bbackend\b|\bfrontend\b|\bfullstack\b|\bfull.stack\b/i,
  /\bdata\s*scientist\b|\bml\s*engineer\b|\bresearch\s*scientist\b/i,
  /\bdevops\b|\bsre\b|\bplatform\s*engineer\b/i,
  /\bquantitative\b|\bquant\b/i,
];

// ── Scorer ────────────────────────────────────────────────────────────

export function scoreJob(job: {
  role: string;
  company: string;
  location?: string;
  remote?: boolean;
  portal?: string;
}): ScoredJob {
  const reasons: string[] = [];
  let score = 0;

  const title = job.role;
  const location = job.location ?? '';

  // ── Hard exclusion check ──
  for (const ex of EXCLUSIONS) {
    if (ex.test(title)) {
      return {
        score: 0.5,
        label: 'Weak Match',
        reasons: [],
        skipReason: `Engineering/technical role — not relevant to your BD/partnership background`,
      };
    }
  }

  // ── Title relevance (0–2.5) ──
  const tierMatch = ROLE_TIER1.some(r => r.test(title));
  const tier2Match = ROLE_TIER2.some(r => r.test(title));

  if (tierMatch) {
    score += 2.5;
    reasons.push('Role title directly matches your target (partnership/BD/growth/affiliate)');
  } else if (tier2Match) {
    score += 1.5;
    reasons.push('Role title partially matches (marketing/growth/community)');
  } else {
    score += 0.5;
    reasons.push('Role title is a weak match for your profile');
  }

  // ── Domain relevance (0–1.0) ──
  const web3Match = DOMAIN_WEB3.some(r => r.test(title) || r.test(job.company));
  const aiMatch   = DOMAIN_AI.some(r => r.test(title) || r.test(job.company));

  if (web3Match) {
    score += 1.0;
    reasons.push('Web3/crypto domain — directly in your 4+ year expertise zone');
  } else if (aiMatch) {
    score += 0.7;
    reasons.push('AI company — your AI-assisted BD workflow is a differentiator here');
  } else {
    score += 0.3;
    reasons.push('Domain context not explicitly Web3/AI — may still be relevant');
  }

  // ── Remote compatibility (0–0.5) ──
  const isRemote = job.remote === true || REMOTE_POSITIVE.some(r => r.test(location));
  const isOnsite = REMOTE_NEGATIVE.some(r => r.test(location));

  if (isRemote) {
    score += 0.5;
    reasons.push('Remote — compatible with your Italy-based setup');
  } else if (isOnsite) {
    score -= 0.5;
    reasons.push('On-site signals detected — may conflict with your remote requirement');
  } else {
    score += 0.2;
    reasons.push('Remote status unclear — verify before applying');
  }

  // ── Seniority match (0–0.5) ──
  const isSenior = SENIOR_SIGNALS.some(r => r.test(title));
  const isJunior = JUNIOR_SIGNALS.some(r => r.test(title));

  if (isSenior) {
    score += 0.5;
    reasons.push('Seniority level matches your mid-senior profile');
  } else if (isJunior) {
    score -= 0.3;
    reasons.push('Junior/associate level — below your experience');
  } else {
    score += 0.2;
    reasons.push('Seniority not specified — assume mid-level');
  }

  // ── Portal bonus (0–0.2) ──
  // Web3-specific portals are higher signal
  if (['rss', 'remoteok', 'linkedin', 'wellfound'].includes(job.portal ?? '')) {
    score += 0.1;
  }

  // Clamp to 0–5
  score = Math.min(5, Math.max(0, Math.round(score * 10) / 10));

  return {
    score,
    label: score >= 4.0 ? 'Strong Match'
         : score >= 3.0 ? 'Good Match'
         : score >= 2.0 ? 'Partial Match'
         : 'Weak Match',
    reasons,
  };
}

export function labelColor(label: ScoredJob['label']): string {
  return {
    'Strong Match':  '#3fb950',
    'Good Match':    '#d29922',
    'Partial Match': '#ffa657',
    'Weak Match':    '#8b949e',
  }[label];
}

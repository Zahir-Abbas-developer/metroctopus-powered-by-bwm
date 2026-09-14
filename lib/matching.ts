/**
 * Turning free text into comparable terms.
 *
 * Routing work to the right person is a text-matching problem before it is
 * anything else: a lead says "shopify-development", a member's title says
 * "Shopify Developer", and nothing connects the two unless both sides are
 * reduced to the same tokens first.
 *
 * Four rules, and the first one is inherited rather than invented:
 *
 * 1. **Whole words, never substrings.** `lib/assignment.ts` already documented
 *    why: "cam" is a substring of "campaign", and Culture Plus's "Cam" category
 *    matching a campaign skill is exactly the conflation CLAUDE.md names. Every
 *    comparison here is between complete tokens.
 * 2. **Collapse multi-word names first.** "Google Ads" is one thing with a space
 *    in it. Split into words before anything else it becomes "google" and
 *    "ads" — and that stray "ads" then matches every other advertising skill,
 *    so a Facebook brief scores against a Google Ads specialist.
 * 3. **Stem before comparing.** "developer" and "development" are the same
 *    signal spelled for different parts of speech. Nothing is stripped unless
 *    at least four characters survive, which keeps short words ("ads", "seo",
 *    "cam") exactly as they were.
 * 4. **Aliases are a short, deliberate list.** Expanding "fb" to "meta" is a
 *    judgement about this business, not a linguistic fact, so the table stays
 *    small and only holds pairs nobody would argue with. Short guesses that
 *    could mean something else ("back", "front") are deliberately absent.
 *
 * Every table below is written in the canonical form this pipeline produces,
 * and `tests/matching.test.ts` holds that invariant down: an entry whose key or
 * value does not survive its own stemmer would silently match nothing.
 */

/**
 * Words that carry no routing signal.
 *
 * Kept short on purpose. Every entry here is a term that can never usefully
 * distinguish one member from another, so removing it costs nothing — anything
 * borderline is left in, because a spurious match is visible in the UI while a
 * silently dropped one is not.
 */
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "into",
  "new",
  "our",
  "their",
  "this",
  "that",
  "they",
  "need",
  "want",
  "please",
  "asap",
  "llc",
  "inc",
  "ltd",
  "pvt",
]);

/**
 * Multi-word names collapsed to one token, applied to the raw text before it is
 * split into words.
 *
 * The alias table cannot do this. It maps one token to one token, so "google
 * ads" arrives as two words and never becomes the thing a brief saying "PPC" is
 * looking for. Worse, the leftover "ads" then matches *any* advertising skill:
 * a Facebook brief scored against a Google Ads specialist, and the reason shown
 * on the record read "google ads" — true of the token, false about the work.
 *
 * So platform names are normalised whole, and what survives is the platform
 * rather than the medium. Each rule tolerates a space, a hyphen or an
 * underscore between the words, because a service slug, a skills box and a
 * typed note each pick a different one.
 */
const PHRASES: [RegExp, string][] = [
  // Paid search
  [/\bgoogle[\s\-_]*ads?\b/g, " googlead "],
  [/\badwords?\b/g, " googlead "],
  [/\bpaid[\s\-_]*search\b/g, " googlead "],
  // Paid social, all of it Meta
  [/\bfacebook[\s\-_]*ads?\b/g, " meta "],
  [/\bmeta[\s\-_]*ads?\b/g, " meta "],
  [/\binstagram[\s\-_]*ads?\b/g, " meta "],
  [/\bpaid[\s\-_]*social\b/g, " meta "],
  // Other platforms, kept distinct from each other
  [/\btiktok[\s\-_]*ads?\b/g, " tiktok "],
  [/\blinkedin[\s\-_]*ads?\b/g, " linkedin "],
];

/** Apply every phrase rule to one piece of already-lowercased text. */
function normalisePhrases(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PHRASES) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Deliberate equivalences, applied after stemming.
 *
 * Keys are compared against the *stem*, so "adwords" is reached through
 * "adword" and the table never has to list every inflection. Values are written
 * in canonical form for the same reason: "googleads" as a value would stem to
 * "googlead" everywhere else and so match none of its own aliases.
 */
const ALIASES: Record<string, string> = {
  // Storefront platforms
  woo: "woocommerce",
  wp: "wordpress",
  // Paid social. One canonical token, because a "Meta Ads" specialist and a
  // brief that says "facebook" describe the same person's day.
  fb: "meta",
  facebook: "meta",
  instagram: "meta",
  ig: "meta",
  // Paid search
  adword: "googlead",
  ppc: "googlead",
  sem: "googlead",
  // Craft
  ui: "design",
  ux: "design",
  graphic: "design",
  copy: "copywriting",
  copywrit: "copywriting",
  content: "copywriting",
  // Motion
  reel: "video",
  motion: "video",
};

/**
 * Suffixes stripped to reach a stem, longest first.
 *
 * Order matters: "development" must lose "ment" rather than "t". Plurals are
 * deliberately absent — they are handled first, by `depluralise`, because
 * English plurals are not a suffix you can strip by length alone.
 */
const SUFFIXES = ["ment", "tion", "sion", "ing", "er", "or"];

/** The shortest stem worth keeping. Below this, the word is left alone. */
const MIN_STEM_LENGTH = 4;

/**
 * A plural reduced to its singular, or the word unchanged.
 *
 * Three rules rather than "strip an s", because a single rule gets the common
 * cases wrong in a way that is worse than not stemming at all. Stripping "es"
 * from "insurances" gives "insuranc", which matches nothing — not even
 * "insurance", the very word it came from. A stemmer that maps a word and its
 * own plural to two different tokens is not conservative; it is broken, and
 * silently, because the only symptom is work that fails to route.
 *
 * "business" keeps its double s for the same reason: it is not a plural.
 */
function depluralise(word: string): string {
  const keepIfLongEnough = (root: string) =>
    root.length >= MIN_STEM_LENGTH ? root : word;

  if (word.endsWith("ies")) return keepIfLongEnough(`${word.slice(0, -3)}y`);
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return keepIfLongEnough(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) {
    return keepIfLongEnough(word.slice(0, -1));
  }
  return word;
}

/**
 * A word reduced to its stem.
 *
 * Conservative by construction: nothing is removed unless at least
 * `MIN_STEM_LENGTH` characters remain, so "ads" stays "ads" and "cam" stays
 * "cam" rather than colliding with something longer.
 */
export function stem(word: string): string {
  const singular = depluralise(word);

  for (const suffix of SUFFIXES) {
    if (!singular.endsWith(suffix)) continue;
    if (singular.length - suffix.length < MIN_STEM_LENGTH) continue;
    return singular.slice(0, singular.length - suffix.length);
  }

  return singular;
}

/** Stem, then apply the alias table. The canonical form of one word. */
export function canonical(word: string): string {
  const stemmed = stem(word.toLowerCase());
  return ALIASES[stemmed] ?? stemmed;
}

/**
 * Free text to a de-duplicated set of canonical terms.
 *
 * The length floor is applied to the *canonical* form rather than the raw word,
 * and that ordering is load-bearing: filtering first would throw away "fb",
 * "wp", "ui" and "ux" before the alias table ever saw them, quietly disabling
 * half of it. What the floor is actually for is stopping a two-letter fragment
 * from matching everybody — and "meta" is not a two-letter fragment, however
 * short the word that produced it.
 */
export function tokenise(...parts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();

  for (const part of parts) {
    if (!part) continue;
    for (const raw of normalisePhrases(part.toLowerCase()).split(/[^a-z0-9]+/)) {
      if (!raw) continue;
      if (STOP_WORDS.has(raw)) continue;

      const term = canonical(raw);
      if (term.length <= 2) continue;
      if (STOP_WORDS.has(term)) continue;

      seen.add(term);
    }
  }

  return [...seen];
}

/**
 * Does this phrase share a whole word with the context?
 *
 * The phrase is a skill or a job title; `terms` is the work being routed. Both
 * sides go through `tokenise`, so "Shopify Developer" and "shopify-development"
 * meet at the token "shopify" without either side knowing about the other's
 * spelling.
 */
export function phraseMatches(phrase: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const set = new Set(terms);
  return tokenise(phrase).some((word) => set.has(word));
}

/** The terms a phrase and a context actually have in common. */
export function sharedTerms(phrase: string, terms: readonly string[]): string[] {
  const set = new Set(terms);
  return tokenise(phrase).filter((word) => set.has(word));
}

/**
 * The alias table and the phrase outputs, exposed so a test can hold both to
 * their own rules. Neither is read at runtime.
 *
 * The rule they have to satisfy: anything this module *produces* must survive
 * being fed back through it. A value that stems to something else is a table
 * entry that can never match, and nothing at runtime would say so.
 */
export const ALIAS_ENTRIES: readonly [string, string][] = Object.entries(ALIASES);

export const PHRASE_OUTPUTS: readonly string[] = PHRASES.map(([, out]) => out.trim());

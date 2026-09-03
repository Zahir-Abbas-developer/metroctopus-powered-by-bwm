/**
 * @mention parsing.
 *
 * Pure and dependency-free so it can be unit tested and reused on both sides:
 * the composer highlights as you type, the API resolves the same text into the
 * user ids it notifies.
 *
 * Names contain spaces ("Ayesha Khan"), so a naive `@\w+` would only ever
 * match the first word. Matching is done against the known roster instead,
 * longest name first, which also means an unknown `@someone` is left as plain
 * text rather than becoming a broken link.
 */

export type MentionCandidate = {
  id: string;
  name: string;
};

export type MentionMatch = {
  id: string;
  name: string;
  /** Index of the "@" in the source string. */
  start: number;
  /** Index just past the matched name. */
  end: number;
};

/**
 * Every mention in `body`, in the order they appear.
 *
 * A candidate matches if the text after "@" starts with their full name, or
 * with their first name when that first name is unique across the roster.
 */
export function findMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): MentionMatch[] {
  const aliases = buildAliases(candidates);
  const matches: MentionMatch[] = [];

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "@") continue;

    // "email@bwm.local" is an address, not a mention.
    if (index > 0 && /[\w.]/.test(body[index - 1])) continue;

    const rest = body.slice(index + 1);
    const alias = aliases.find((entry) => startsWithAlias(rest, entry.alias));
    if (!alias) continue;

    matches.push({
      id: alias.id,
      name: alias.alias,
      start: index,
      end: index + 1 + alias.alias.length,
    });

    // Skip past what was just consumed.
    index += alias.alias.length;
  }

  return matches;
}

/** The distinct user ids mentioned in `body`. */
export function mentionedUserIds(
  body: string,
  candidates: readonly MentionCandidate[],
): string[] {
  return [...new Set(findMentions(body, candidates).map((match) => match.id))];
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; id: string };

/** Splits a comment into plain text and mention segments, for rendering. */
export function segmentMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): MentionSegment[] {
  const matches = findMentions(body, candidates);
  if (matches.length === 0) return [{ kind: "text", text: body }];

  const segments: MentionSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, match.start) });
    }
    segments.push({ kind: "mention", text: `@${match.name}`, id: match.id });
    cursor = match.end;
  }

  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }

  return segments;
}

type Alias = { id: string; alias: string };

function buildAliases(candidates: readonly MentionCandidate[]): Alias[] {
  const aliases: Alias[] = candidates.map((candidate) => ({
    id: candidate.id,
    alias: candidate.name,
  }));

  // First names are only offered when they identify exactly one person —
  // otherwise "@Ayesha" with two Ayeshas would notify an arbitrary one.
  const firstNames = new Map<string, string[]>();
  for (const candidate of candidates) {
    const first = candidate.name.trim().split(/\s+/)[0];
    if (!first) continue;
    const list = firstNames.get(first.toLowerCase()) ?? [];
    list.push(candidate.id);
    firstNames.set(first.toLowerCase(), list);
  }

  for (const candidate of candidates) {
    const first = candidate.name.trim().split(/\s+/)[0];
    if (!first || first === candidate.name) continue;
    if ((firstNames.get(first.toLowerCase()) ?? []).length === 1) {
      aliases.push({ id: candidate.id, alias: first });
    }
  }

  // Longest first, so "@Ayesha Khan" wins over "@Ayesha".
  return aliases.sort((a, b) => b.alias.length - a.alias.length);
}

function startsWithAlias(rest: string, alias: string): boolean {
  if (rest.length < alias.length) return false;
  if (rest.slice(0, alias.length).toLowerCase() !== alias.toLowerCase()) return false;

  // The next character must not continue the word, or "@Ali" would match
  // inside "@Alison".
  const next = rest[alias.length];
  return next === undefined || !/[\w']/.test(next);
}

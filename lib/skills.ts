/**
 * Skills on a department membership.
 *
 * Stored comma-separated rather than as `String[]`: SQLite has no array column
 * and the schema is deliberately kept Postgres-portable, so this follows the
 * same convention as `Lead.interestedServices`. Every read and write goes
 * through here, so the trimming, de-duplication and empty handling live in one
 * place instead of being re-derived at each call site.
 *
 * Skills are free text on purpose — a department can need a speciality nobody
 * anticipated, and an enum would put that behind a deploy.
 */

/** "sales, dispatch ,, sales" -> ["sales", "dispatch"] */
export function parseSkills(stored: string | null | undefined): string[] {
  if (!stored) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of stored.split(",")) {
    const skill = raw.trim();
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

/** ["Sales", " dispatch", "sales"] -> "Sales,dispatch" */
export function serializeSkills(skills: readonly string[]): string {
  return parseSkills(skills.join(",")).join(",");
}

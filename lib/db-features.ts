/**
 * The few places the two supported databases genuinely differ.
 *
 * The schema is written to be portable, but `contains` is not: SQLite's LIKE
 * is case-insensitive for ASCII, while Postgres is case-sensitive and needs an
 * explicit `mode: "insensitive"`. Left unhandled, searching "lumen" would find
 * "Lumen Skincare" in development and nothing at all in production — the worst
 * kind of difference, because every local test passes.
 */

export const isPostgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");

/**
 * A case-insensitive `contains` filter for either database.
 *
 * The `mode` key only exists on the Postgres client's generated types, so the
 * result is cast: it is the right shape for whichever client is generated, and
 * the cast keeps the code compiling against both.
 */
export function containsInsensitive(value: string): { contains: string } {
  return (
    isPostgres ? { contains: value, mode: "insensitive" } : { contains: value }
  ) as { contains: string };
}

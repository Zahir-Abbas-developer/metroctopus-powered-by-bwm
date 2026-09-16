import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Checking and issuing passwords, in one place.
 *
 * Two call sites used to compare passwords on their own — sign-in and the
 * forced first change — and a third is now issuing them from the Team page.
 * They have to agree on what counts as a match and on what a generated
 * password looks like, so both live here.
 */

/** bcrypt cost for every password this app sets, matching team creation. */
export const PASSWORD_HASH_COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

/**
 * Does what was typed match the stored hash?
 *
 * Exactly first. Failing that, once more with surrounding whitespace removed —
 * and only when there was some to remove, so an ordinary wrong password costs
 * one comparison, not two.
 *
 * The second try exists because of a real sign-in failure: the password was
 * correct, checked against the database, and was still refused. Temporary
 * passwords reach people through chat apps, and copying one out of a message
 * routinely brings a trailing space along. It cannot be seen in a masked field
 * and the error cannot say what is wrong, so the person has nothing to act on.
 *
 * It gives an attacker nothing: whitespace around a password is not a secret
 * anyone chose, and every guess still counts against the same rate limit.
 */
export async function passwordMatches(input: string, hash: string): Promise<boolean> {
  if (await bcrypt.compare(input, hash)) return true;
  const trimmed = input.trim();
  if (trimmed === input || trimmed.length === 0) return false;
  return bcrypt.compare(trimmed, hash);
}

/**
 * Characters that cannot be confused with each other when read aloud or copied
 * off a phone screen: no 0/O, no 1/l/I.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * A temporary password, e.g. `k7Qm-3xTp-9wZr`.
 *
 * Three groups of four from a 54-character alphabet — about 69 bits, far past
 * guessing through a login form that allows eight attempts per account every
 * ten minutes, and still short enough to type once before it is replaced.
 * Regenerated until it holds an upper-case letter, a lower-case letter and a
 * digit, so no password rule anywhere downstream can reject it.
 *
 * `scripts/set-passwords.mjs` keeps its own copy of this, because it runs as
 * plain Node without the TypeScript loader; keep the two in step.
 */
export function generatePassword(): string {
  for (;;) {
    const groups = Array.from({ length: 3 }, () =>
      Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
    );
    const password = groups.join("-");
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) {
      return password;
    }
  }
}

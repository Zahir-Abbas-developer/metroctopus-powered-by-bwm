import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generatePassword, hashPassword, passwordMatches } from "../lib/passwords";

/**
 * Checking and issuing passwords.
 *
 * The matching tests are here because of a real failure: a team member's
 * temporary password was, checked against the database, exactly right — and
 * the same characters with a trailing space, which is what copying out of a
 * chat message tends to produce, were refused.
 */

describe("passwordMatches", () => {
  it("accepts the exact password", async () => {
    const hash = await hashPassword("t8Gq-yWUW-GAZh");
    assert.equal(await passwordMatches("t8Gq-yWUW-GAZh", hash), true);
  });

  it("accepts it with whitespace picked up by copy and paste", async () => {
    const hash = await hashPassword("t8Gq-yWUW-GAZh");
    assert.equal(await passwordMatches("t8Gq-yWUW-GAZh ", hash), true);
    assert.equal(await passwordMatches("  t8Gq-yWUW-GAZh\n", hash), true);
  });

  it("still refuses the wrong password", async () => {
    const hash = await hashPassword("t8Gq-yWUW-GAZh");
    assert.equal(await passwordMatches("t8gq-ywuw-gazh", hash), false);
    assert.equal(await passwordMatches("t8Gq-yWUW-GAZ ", hash), false);
  });

  it("refuses a password made only of whitespace", async () => {
    const hash = await hashPassword("t8Gq-yWUW-GAZh");
    assert.equal(await passwordMatches("   ", hash), false);
  });

  it("keeps a password that really does contain spaces working", async () => {
    // Trimming is a second attempt, never a replacement for the exact one.
    const hash = await hashPassword(" padded ");
    assert.equal(await passwordMatches(" padded ", hash), true);
  });
});

describe("generatePassword", () => {
  it("is three groups of four", () => {
    for (let i = 0; i < 50; i += 1) {
      assert.match(generatePassword(), /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    }
  });

  it("never uses characters that are easy to misread", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.doesNotMatch(generatePassword(), /[0O1lI]/);
    }
  });

  it("always mixes upper case, lower case and a digit", () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generatePassword();
      assert.match(password, /[a-z]/);
      assert.match(password, /[A-Z]/);
      assert.match(password, /\d/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()));
    assert.equal(seen.size, 500);
  });

  it("is long enough for every password rule in the app", () => {
    // Team creation asks for 8, the forced change for 10.
    assert.ok(generatePassword().length >= 10);
  });
});

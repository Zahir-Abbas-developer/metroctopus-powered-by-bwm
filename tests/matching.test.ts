import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALIAS_ENTRIES,
  PHRASE_OUTPUTS,
  canonical,
  phraseMatches,
  sharedTerms,
  stem,
  tokenise,
} from "../lib/matching";

/**
 * Turning work into terms, and terms into a routing decision.
 *
 * The cases that matter here are the ones where a naive matcher gets it wrong
 * in a way nobody notices until a job has been sitting with the wrong person
 * for a week. Two families of those:
 *
 * - **False negatives**, where the same idea is spelled two ways. A service
 *   called "shopify-development" and a job title reading "Shopify Developer"
 *   describe one thing; a matcher that compares raw words says they share
 *   nothing.
 * - **False positives**, where two unrelated words overlap. This is the one
 *   CLAUDE.md names: "cam" is a substring of "campaign", and Culture Plus has a
 *   category called Cam.
 */

describe("stem", () => {
  it("reduces a role and its activity to one word", () => {
    // The whole reason the stemmer exists: "Shopify Developer" has to reach
    // "shopify-development".
    assert.equal(stem("developer"), "develop");
    assert.equal(stem("development"), "develop");
  });

  it("reduces the -ing and -er forms of the same work", () => {
    assert.equal(stem("marketing"), "market");
    assert.equal(stem("marketer"), "market");
    assert.equal(stem("designer"), "design");
    assert.equal(stem("design"), "design");
  });

  it("leaves a short word alone rather than mangling it", () => {
    // Stripping the "s" from "ads" would leave "ad", which matches far too
    // much. The four-character floor is what stops that.
    assert.equal(stem("ads"), "ads");
    assert.equal(stem("seo"), "seo");
    assert.equal(stem("cam"), "cam");
  });

  it("does not invent a suffix where there is none", () => {
    assert.equal(stem("campaign"), "campaign");
    assert.equal(stem("shopify"), "shopify");
  });

  it("maps a word and its own plural to the same stem", () => {
    // The regression that motivated `depluralise`. Stripping "es" turned
    // "insurances" into "insuranc", which did not match "insurance" — so a
    // brief written in the plural routed to nobody at all.
    assert.equal(stem("insurances"), stem("insurance"));
    assert.equal(stem("campaigns"), stem("campaign"));
    assert.equal(stem("companies"), stem("company"));
    assert.equal(stem("developers"), stem("development"));
  });

  it("strips a plural only when enough of the word survives", () => {
    assert.equal(stem("sales"), "sale");
    assert.equal(stem("ads"), "ads");
  });

  it("leaves a double s alone, because it is not a plural", () => {
    assert.equal(stem("business"), "business");
  });
});

describe("canonical", () => {
  it("collapses the paid-social spellings onto one token", () => {
    // A "Meta Ads" specialist and a brief that says "facebook" are the same
    // person's day.
    assert.equal(canonical("facebook"), "meta");
    assert.equal(canonical("fb"), "meta");
    assert.equal(canonical("Instagram"), "meta");
  });

  it("collapses the paid-search spellings", () => {
    // "googlead" rather than "googleads": the canonical token is what survives
    // this module's own stemmer, and a trailing s would not.
    assert.equal(canonical("ppc"), "googlead");
    assert.equal(canonical("adwords"), "googlead");
    assert.equal(canonical("sem"), "googlead");
  });

  it("leaves a word with no alias as its stem", () => {
    assert.equal(canonical("Shopify"), "shopify");
  });
});

describe("tokenise", () => {
  it("reads a slug and a job title into the same token", () => {
    assert.ok(tokenise("shopify-development").includes("shopify"));
    assert.ok(tokenise("Shopify Developer").includes("shopify"));
  });

  it("drops words too short to distinguish anyone", () => {
    const terms = tokenise("SEO of my ad");
    assert.ok(terms.includes("seo"));
    assert.ok(!terms.includes("of"));
    assert.ok(!terms.includes("my"));
    assert.ok(!terms.includes("ad"));
  });

  it("drops filler that can never name a specialism", () => {
    const terms = tokenise("we need the new store for our client");
    assert.ok(terms.includes("store"));
    assert.ok(!terms.includes("need"));
    assert.ok(!terms.includes("the"));
  });

  it("de-duplicates across every part it is given", () => {
    const terms = tokenise("shopify", "Shopify store", "shopify-development");
    assert.equal(terms.filter((term) => term === "shopify").length, 1);
  });
});

describe("phraseMatches", () => {
  it("routes a Shopify job to a Shopify developer", () => {
    // The case the whole feature exists for, and it has to work from the job
    // title alone — nobody should have to retype "shopify" into a skills box
    // for a Shopify job to reach the Shopify developer.
    const work = tokenise("shopify-development", "needs a new storefront");
    assert.ok(phraseMatches("Shopify Developer", work));
  });

  it("routes a Meta campaign to a media buyer who does Facebook", () => {
    const work = tokenise("facebook-ads", "launch a retargeting campaign");
    assert.ok(phraseMatches("Meta Ads", work));
  });

  it("does not match Cam against campaign", () => {
    // The named failure from CLAUDE.md. Substring matching passes this; whole
    // word matching is why it does not.
    const work = tokenise("Cam");
    assert.ok(!phraseMatches("Campaign management", work));
  });

  it("does not match a Shopify developer to an SEO brief", () => {
    const work = tokenise("seo-audit", "technical audit and keyword research");
    assert.ok(!phraseMatches("Shopify Developer", work));
  });

  it("matches nothing when there is no context at all", () => {
    // An empty brief must not make everyone a match, or the ranking silently
    // becomes alphabetical.
    assert.ok(!phraseMatches("Shopify Developer", []));
  });
});

describe("sharedTerms", () => {
  it("reports the terms that actually did the matching", () => {
    // These become the "why" shown next to the assignee, so they have to be
    // the real overlap rather than the whole phrase. "Developer" and
    // "development" both reduce to "develop", so both words of the title
    // genuinely matched — the SEO in the brief did not.
    const work = tokenise("shopify-development", "seo");
    assert.deepEqual(sharedTerms("Shopify Developer", work), ["shopify", "develop"]);
  });

  it("reports only the overlap, not every word of the phrase", () => {
    const work = tokenise("shopify-store");
    assert.deepEqual(sharedTerms("Senior Shopify Engineer", work), ["shopify"]);
  });

  it("reports nothing for a phrase that did not match", () => {
    assert.deepEqual(sharedTerms("Insurance advisor", tokenise("shopify")), []);
  });
});

describe("the tables hold to their own rules", () => {
  /*
   * Both regressions these catch were real, and neither showed up as an error.
   *
   * The alias table wrote "googleads" as a value. Everything else in the module
   * stems that to "googlead", so the alias produced a token no brief could ever
   * contain — "PPC" and "Google Ads" named the same platform and matched
   * nothing. The phrase table had the same hole from the other direction.
   *
   * The invariant that kills both: anything this module produces has to survive
   * being fed back through it.
   */

  it("produces alias values that survive their own stemmer", () => {
    for (const [key, value] of ALIAS_ENTRIES) {
      assert.equal(
        canonical(value),
        value,
        `alias ${key} -> ${value} does not stem to itself`,
      );
    }
  });

  it("produces phrase outputs that survive their own stemmer", () => {
    for (const output of PHRASE_OUTPUTS) {
      assert.deepEqual(
        tokenise(output),
        [output],
        `phrase output "${output}" does not tokenise to itself`,
      );
    }
  });

  it("keeps an alias key reachable however short the word is", () => {
    // The length floor used to run before the alias table, so "fb", "wp", "ui"
    // and "ux" were discarded as too short and half the table was dead.
    for (const [key] of ALIAS_ENTRIES) {
      assert.ok(
        tokenise(key).length > 0,
        `alias key "${key}" is dropped before it can be looked up`,
      );
    }
  });
});

describe("platform names survive being spelled differently", () => {
  it("reaches one token from every spelling of Google Ads", () => {
    // A slug, a skills box and a typed note each pick a different separator,
    // and "PPC" is a fourth name for the same thing.
    const spellings = ["google ads", "Google-Ads", "google_ad", "AdWords", "PPC"];
    const tokens = spellings.map((spelling) => tokenise(spelling));
    for (const token of tokens) assert.deepEqual(token, tokens[0]);
  });

  it("does not let a Facebook brief match a Google Ads specialist", () => {
    // The stray "ads" used to do exactly this, and the reason shown on the
    // record read "google ads" — true of the token, false about the work.
    const work = tokenise("facebook-ads", "retargeting campaign");
    assert.deepEqual(sharedTerms("Google Ads", work), []);
    assert.ok(phraseMatches("Meta Ads", work));
  });
});

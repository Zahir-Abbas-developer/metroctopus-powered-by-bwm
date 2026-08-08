import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  narrateClientReport,
  narrateMemberReport,
  formatScore,
  type MemberNarrativeFacts,
} from "../lib/narrative";

function facts(overrides: Partial<MemberNarrativeFacts> = {}): MemberNarrativeFacts {
  return {
    firstName: "Ayesha",
    periodPhrase: "this month",
    previousPhrase: "last month",
    completedTotal: 10,
    completedOnTime: 9,
    lateCount: 1,
    missedCount: 0,
    rejectedCount: 0,
    score: 92,
    delta: 4,
    troubleArea: "Google Ads reporting",
    ...overrides,
  };
}

describe("narrateMemberReport", () => {
  it("reads like the example in the brief", () => {
    const text = narrateMemberReport(facts());

    assert.equal(
      text,
      "You completed 9 of 10 milestones on time this month. " +
        "Your score of 92 places you in the Excellent band, up 4 points from last month. " +
        "Watch out: 1 late delivery in Google Ads reporting.",
    );
  });

  it("writes the owner's copy in the third person", () => {
    const text = narrateMemberReport(facts(), "third");

    assert.match(text, /^Ayesha completed 9 of 10 milestones on time this month\./);
    assert.match(text, /Ayesha's score of 92 sits in the Excellent band/);
    assert.doesNotMatch(text, /\bYou\b/);
  });

  it("never names the member twice in the same sentence", () => {
    const text = narrateMemberReport(facts(), "third");
    for (const sentence of text.split(". ")) {
      const mentions = sentence.match(/Ayesha/g)?.length ?? 0;
      assert.ok(mentions <= 1, `"${sentence}" mentions Ayesha ${mentions} times`);
    }
  });

  it("is always two or three sentences", () => {
    for (const override of [
      {},
      { completedTotal: 0, completedOnTime: 0, lateCount: 0, troubleArea: null },
      { lateCount: 0, completedOnTime: 10, troubleArea: null },
      { delta: null },
      { missedCount: 3, rejectedCount: 2 },
    ]) {
      const text = narrateMemberReport(facts(override as Partial<MemberNarrativeFacts>));
      const count = text.split(". ").length;
      assert.ok(count >= 2 && count <= 3, `${count} sentences: ${text}`);
    }
  });

  it("celebrates a clean period instead of warning", () => {
    const text = narrateMemberReport(
      facts({ completedOnTime: 10, lateCount: 0, missedCount: 0, troubleArea: null }),
    );

    assert.match(text, /completed all 10 milestones on time/);
    assert.match(text, /Nothing slipped/);
    assert.doesNotMatch(text, /Watch out/);
  });

  it("handles a single milestone without saying '1 of 1'", () => {
    const text = narrateMemberReport(
      facts({ completedTotal: 1, completedOnTime: 1, lateCount: 0, troubleArea: null }),
    );
    assert.match(text, /single milestone on time/);
  });

  it("handles a period with nothing approved", () => {
    const text = narrateMemberReport(
      facts({ completedTotal: 0, completedOnTime: 0, lateCount: 0, troubleArea: null }),
    );
    assert.match(text, /no milestones approved this month/);
  });

  it("names unfinished deadlines when nothing was approved", () => {
    const text = narrateMemberReport(
      facts({ completedTotal: 0, completedOnTime: 0, lateCount: 0, missedCount: 2, troubleArea: null }),
    );
    assert.match(text, /2 deadlines passed unfinished/);
  });

  it("describes every direction the score can move", () => {
    assert.match(narrateMemberReport(facts({ delta: 4 })), /up 4 points from last month/);
    assert.match(narrateMemberReport(facts({ delta: -3.5 })), /down 3\.5 points from last month/);
    assert.match(narrateMemberReport(facts({ delta: 0 })), /level with last month/);
    assert.match(narrateMemberReport(facts({ delta: 1 })), /up 1 point from/);
    // No prior period at all: say nothing rather than invent a comparison.
    const fresh = narrateMemberReport(facts({ delta: null }));
    assert.doesNotMatch(fresh, /last month/);
  });

  it("names the band that matches the score", () => {
    assert.match(narrateMemberReport(facts({ score: 95 })), /Excellent band/);
    assert.match(narrateMemberReport(facts({ score: 80 })), /Good band/);
    assert.match(narrateMemberReport(facts({ score: 65 })), /Needs attention band/);
    assert.match(narrateMemberReport(facts({ score: 40 })), /Critical band/);
  });

  it("lists several kinds of problem in one warning", () => {
    const text = narrateMemberReport(
      facts({ missedCount: 1, lateCount: 2, rejectedCount: 1, troubleArea: null }),
    );
    assert.match(text, /Watch out: 1 missed deadline, 2 late deliveries and 1 rejection\./);
  });

  it("omits the location when there isn't one", () => {
    const text = narrateMemberReport(facts({ troubleArea: null }));
    assert.match(text, /Watch out: 1 late delivery\./);
  });

  it("adapts to a weekly period", () => {
    const text = narrateMemberReport(
      facts({ periodPhrase: "this week", previousPhrase: "last week" }),
    );
    assert.match(text, /on time this week/);
    assert.match(text, /from last week/);
  });

  it("never leaves a double space or a stray comma", () => {
    for (const delta of [null, 0, 4, -2]) {
      const text = narrateMemberReport(facts({ delta }));
      assert.doesNotMatch(text, / {2}/);
      assert.doesNotMatch(text, /,\./);
    }
  });
});

describe("narrateClientReport", () => {
  it("summarises a productive week", () => {
    const text = narrateClientReport({
      clientName: "Maison Rue",
      projectTitle: "Aug 2026 Retainer",
      completedThisPeriod: 3,
      completionPercent: 45,
      plannedNext: 4,
      overdueCount: 1,
    });

    assert.equal(
      text,
      "3 milestones were completed for Maison Rue this week, taking Aug 2026 Retainer to 45% complete. " +
        "4 items are scheduled for next week. 1 item is overdue and needs attention.",
    );
  });

  it("handles a week with no completions", () => {
    const text = narrateClientReport({
      clientName: "Copper & Oak",
      projectTitle: "Jul 2026 Retainer",
      completedThisPeriod: 0,
      completionPercent: 20,
      plannedNext: 0,
      overdueCount: 0,
    });

    assert.match(text, /No milestones were completed for Copper & Oak this week/);
    assert.match(text, /Nothing is scheduled for next week\./);
    assert.doesNotMatch(text, /overdue/);
  });

  it("gets singular agreement right", () => {
    const text = narrateClientReport({
      clientName: "Lumen Skincare",
      projectTitle: "Aug 2026 Retainer",
      completedThisPeriod: 1,
      completionPercent: 10,
      plannedNext: 1,
      overdueCount: 1,
    });

    assert.match(text, /1 milestone was completed/);
    assert.match(text, /1 item is scheduled/);
    assert.match(text, /1 item is overdue and needs attention/);
  });

  it("says so plainly when there is no engagement", () => {
    const text = narrateClientReport({
      clientName: "Verdant Pet Co.",
      projectTitle: null,
      completedThisPeriod: 0,
      completionPercent: 0,
      plannedNext: 0,
      overdueCount: 0,
    });

    assert.equal(text, "Verdant Pet Co. had no active engagement this week.");
  });
});

describe("formatScore", () => {
  it("keeps whole numbers whole and shows a half point when there is one", () => {
    assert.equal(formatScore(92), "92");
    assert.equal(formatScore(91.5), "91.5");
    assert.equal(formatScore(100), "100");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canSeeAdminTooling,
  canSeeAgencyMoney,
  canSeeClientBrief,
  canSeeClientKpis,
  canSeeClientPhone,
  canSeeDealValue,
  canSeeIncentiveAmounts,
  canSeeMemberNumbers,
  canSeeOwnStreak,
  canSeePipelineTotals,
  canSeeRetainer,
  visibleClient,
  visibleLead,
  visiblePipelineTotals,
  visibleStageBreakdown,
  type Viewer,
} from "../lib/visibility";

/**
 * The Production Doctrine calls the permission matrix law, so it is tested as
 * law: every row, every role, both directions. A permission test that only
 * checks what is denied passes perfectly on an implementation that denies
 * everything, so each row asserts what the role *does* get as well.
 */

const owner: Viewer = {
  id: "owner",
  role: "ADMIN",
  leadServiceIds: [],
  isBusinessDev: false,
  assignedClientIds: [],
  podMemberIds: [],
};

const lead: Viewer = {
  id: "lead",
  role: "SERVICE_LEAD",
  leadServiceIds: ["svc-ads"],
  isBusinessDev: false,
  assignedClientIds: ["client-assigned"],
  podMemberIds: ["pod-member"],
};

const bd: Viewer = {
  id: "bd",
  role: "MEMBER",
  leadServiceIds: [],
  isBusinessDev: true,
  assignedClientIds: [],
  podMemberIds: [],
};

const member: Viewer = {
  id: "member",
  role: "MEMBER",
  leadServiceIds: [],
  isBusinessDev: false,
  assignedClientIds: ["client-assigned"],
  podMemberIds: [],
};

describe("client contact and money", () => {
  it("gives the phone number to the owner alone", () => {
    assert.equal(canSeeClientPhone(owner), true);
    assert.equal(canSeeClientPhone(lead), false);
    assert.equal(canSeeClientPhone(bd), false);
    assert.equal(canSeeClientPhone(member), false);
  });

  it("gives the retainer value to the owner alone", () => {
    assert.equal(canSeeRetainer(owner), true);
    assert.equal(canSeeRetainer(lead), false);
    assert.equal(canSeeRetainer(member), false);
  });

  it("removes the keys rather than nulling them", () => {
    const client = {
      id: "c1",
      businessName: "Lumen Skincare",
      contactName: "Ada",
      email: "ada@lumen.example",
      phone: "+92 300 1234567",
      industry: "Beauty",
      country: "PK",
      monthlyBudget: 4500,
    };

    const forLead = visibleClient(lead, client);
    // Absent, not null: a null still says the field exists and invites a
    // component to render a placeholder where a number belongs.
    assert.equal("phone" in forLead, false);
    assert.equal("monthlyBudget" in forLead, false);

    // Everything the matrix grants survives.
    assert.equal(forLead.businessName, "Lumen Skincare");
    assert.equal(forLead.email, "ada@lumen.example");
    assert.equal(forLead.industry, "Beauty");
    assert.equal(forLead.country, "PK");
  });

  it("leaves the owner's copy untouched", () => {
    const client = {
      id: "c1",
      businessName: "Lumen",
      contactName: "Ada",
      email: "a@b.c",
      phone: "+92 300",
      monthlyBudget: 4500,
    };
    const forOwner = visibleClient(owner, client);
    assert.equal(forOwner.phone, "+92 300");
    assert.equal(forOwner.monthlyBudget, 4500);
  });

  it("does not mutate the row it was handed", () => {
    const client = { id: "c1", businessName: "L", contactName: "A", email: "a@b.c", monthlyBudget: 4500 };
    visibleClient(member, client);
    assert.equal(client.monthlyBudget, 4500);
  });
});

describe("agency money and admin tooling", () => {
  it("is owner-only in every case", () => {
    for (const viewer of [lead, bd, member]) {
      assert.equal(canSeeAgencyMoney(viewer), false);
      assert.equal(canSeeAdminTooling(viewer), false);
      assert.equal(canSeeIncentiveAmounts(viewer), false);
      assert.equal(canSeePipelineTotals(viewer), false);
    }
    assert.equal(canSeeAgencyMoney(owner), true);
    assert.equal(canSeeAdminTooling(owner), true);
    assert.equal(canSeeIncentiveAmounts(owner), true);
    assert.equal(canSeePipelineTotals(owner), true);
  });

  it("lets anyone see their own streak, and nobody else's", () => {
    assert.equal(canSeeOwnStreak(member, "member"), true);
    assert.equal(canSeeOwnStreak(member, "someone-else"), false);
    // The owner sees everyone's, because they decide the bonuses.
    assert.equal(canSeeOwnStreak(owner, "member"), true);
  });
});

describe("deal values", () => {
  it("gives a business developer their own deals", () => {
    assert.equal(canSeeDealValue(bd, { ownerId: "bd" }), true);
  });

  it("withholds another developer's deals from them", () => {
    assert.equal(canSeeDealValue(bd, { ownerId: "someone-else" }), false);
  });

  it("withholds every deal from a service lead who does not do sales", () => {
    assert.equal(canSeeDealValue(lead, { ownerId: "lead" }), false);
    assert.equal(canSeeDealValue(lead, { ownerId: "bd" }), false);
  });

  it("withholds every deal from a plain member, including their own", () => {
    // A member who is not a BD has no sales role, so a lead assigned to them
    // is a data-entry accident rather than a pipeline they are measured on.
    assert.equal(canSeeDealValue(member, { ownerId: "member" }), false);
  });

  it("gives the owner every deal", () => {
    assert.equal(canSeeDealValue(owner, { ownerId: "bd" }), true);
    assert.equal(canSeeDealValue(owner, { ownerId: null }), true);
  });

  it("strips the value from a lead the viewer does not own", () => {
    const row = { id: "l1", businessName: "Harbour & Vine", ownerId: "someone-else", estimatedMonthlyValue: 6500 };
    const stripped = visibleLead(bd, row);
    assert.equal("estimatedMonthlyValue" in stripped, false);
    assert.equal(stripped.businessName, "Harbour & Vine");
  });

  it("keeps the value on a lead the viewer owns", () => {
    const row = { id: "l1", businessName: "Nordwell", ownerId: "bd", estimatedMonthlyValue: 4800 };
    assert.equal(visibleLead(bd, row).estimatedMonthlyValue, 4800);
  });
});

describe("pipeline aggregates", () => {
  it("returns null rather than zeros for a non-owner", () => {
    // A board reading "0 open" is a false statement about the business.
    assert.equal(visiblePipelineTotals(lead, { openValue: 33800 }), null);
    assert.deepEqual(visiblePipelineTotals(owner, { openValue: 33800 }), { openValue: 33800 });
  });

  it("keeps stage counts while removing stage money", () => {
    const stages = [
      { stage: "NEW", count: 2, value: 11300 },
      { stage: "WON", count: 1, value: 5600 },
    ];

    const forMember = visibleStageBreakdown(member, stages);
    assert.equal(forMember.length, 2);
    assert.equal(forMember[0].count, 2, "counts survive — the board still works");
    assert.equal("value" in forMember[0], false);

    const forOwner = visibleStageBreakdown(owner, stages);
    assert.equal(forOwner[0].value, 11300);
  });
});

describe("client briefs", () => {
  it("follows the work for a member", () => {
    assert.equal(canSeeClientBrief(member, "client-assigned"), true);
    assert.equal(canSeeClientBrief(member, "client-elsewhere"), false);
  });

  it("gives a lead every client, because their authority spans a service line", () => {
    assert.equal(canSeeClientBrief(lead, "client-elsewhere"), true);
  });

  it("gives the owner every client", () => {
    assert.equal(canSeeClientBrief(owner, "anything"), true);
  });
});

describe("ad KPIs", () => {
  it("gives a lead the clients their service lines touch", () => {
    assert.equal(canSeeClientKpis(lead, { id: "c9", serviceIds: ["svc-ads"] }), true);
    assert.equal(canSeeClientKpis(lead, { id: "c9", serviceIds: ["svc-shopify"] }), false);
  });

  it("gives a member only the clients they are assigned to", () => {
    assert.equal(canSeeClientKpis(member, { id: "client-assigned" }), true);
    assert.equal(canSeeClientKpis(member, { id: "client-elsewhere" }), false);
  });

  it("is operational, so it is wider than the money rules", () => {
    // The point of the matrix: you cannot run a campaign you are not allowed
    // to measure, but what the client pays us is none of your business.
    assert.equal(canSeeClientKpis(member, { id: "client-assigned" }), true);
    assert.equal(canSeeRetainer(member), false);
  });
});

describe("other members' numbers", () => {
  it("shows a member themselves and nobody else", () => {
    assert.equal(canSeeMemberNumbers(member, "member"), true);
    assert.equal(canSeeMemberNumbers(member, "someone-else"), false);
  });

  it("shows a lead their pod", () => {
    assert.equal(canSeeMemberNumbers(lead, "pod-member"), true);
    assert.equal(canSeeMemberNumbers(lead, "outside-the-pod"), false);
  });

  it("always shows a lead themselves, pod or not", () => {
    assert.equal(canSeeMemberNumbers(lead, "lead"), true);
  });

  it("shows the owner everyone", () => {
    assert.equal(canSeeMemberNumbers(owner, "anyone"), true);
  });
});

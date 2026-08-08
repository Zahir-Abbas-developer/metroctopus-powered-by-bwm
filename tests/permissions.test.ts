import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canDecideAttendance,
  canDecideMilestone,
  canResolveDispute,
  canViewPodMetrics,
  leadsService,
  routeReview,
  type Actor,
} from "../lib/permissions";

const OWNER: Actor = { id: "owner", role: "ADMIN", leadServiceIds: [] };
const BACKUP_OWNER: Actor = { id: "backup", role: "ADMIN", leadServiceIds: ["shopify"] };
const SHOPIFY_LEAD: Actor = { id: "shahnawaz", role: "MEMBER", leadServiceIds: ["shopify"] };
const ADS_LEAD: Actor = {
  id: "subtain",
  role: "MEMBER",
  leadServiceIds: ["google-ads", "meta-ads"],
};
const PLAIN_MEMBER: Actor = { id: "shahzaib", role: "MEMBER", leadServiceIds: [] };

describe("canDecideMilestone", () => {
  it("lets the owner decide anything", () => {
    const decision = canDecideMilestone(OWNER, { assigneeId: "anyone", serviceId: "shopify" });
    assert.equal(decision.allowed, true);
    assert.equal(decision.as, "ADMIN");
  });

  it("lets a lead decide inside their service", () => {
    const decision = canDecideMilestone(SHOPIFY_LEAD, {
      assigneeId: "shahzaib",
      serviceId: "shopify",
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.as, "LEAD");
  });

  it("lets a lead of several services decide in any of them", () => {
    for (const serviceId of ["google-ads", "meta-ads"]) {
      assert.equal(
        canDecideMilestone(ADS_LEAD, { assigneeId: "shahzaib", serviceId }).allowed,
        true,
        serviceId,
      );
    }
  });

  it("refuses a lead outside their service", () => {
    const decision = canDecideMilestone(SHOPIFY_LEAD, {
      assigneeId: "shahzaib",
      serviceId: "google-ads",
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /outside the service lines/);
  });

  it("REFUSES A LEAD ON THEIR OWN WORK", () => {
    // The rule the whole delegation model rests on. Approving your own work
    // would make the score self-reported, which is what the approval model has
    // refused since Phase 3.
    const decision = canDecideMilestone(SHOPIFY_LEAD, {
      assigneeId: SHOPIFY_LEAD.id,
      serviceId: "shopify",
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.as, "NONE");
    assert.match(decision.reason ?? "", /your own work/);
  });

  it("says 'your own work' rather than 'wrong service' for a lead's own milestone", () => {
    // Checked before scope so the message is the useful one.
    const outOfScope = canDecideMilestone(SHOPIFY_LEAD, {
      assigneeId: SHOPIFY_LEAD.id,
      serviceId: "google-ads",
    });
    assert.match(outOfScope.reason ?? "", /your own work/);
  });

  it("still lets an ADMIN who happens to lead a service decide their own work", () => {
    // The owner is the fallback for everything, including themselves — there
    // is nobody above them to escalate to.
    assert.equal(
      canDecideMilestone(BACKUP_OWNER, { assigneeId: BACKUP_OWNER.id, serviceId: "shopify" })
        .allowed,
      true,
    );
  });

  it("refuses a plain member entirely", () => {
    const decision = canDecideMilestone(PLAIN_MEMBER, {
      assigneeId: "someone",
      serviceId: "shopify",
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /owner or the service lead/);
  });

  it("is admin-only for a module with no service", () => {
    // A hand-made module has no service line to confer authority.
    assert.equal(
      canDecideMilestone(SHOPIFY_LEAD, { assigneeId: "someone", serviceId: null }).allowed,
      false,
    );
    assert.equal(
      canDecideMilestone(OWNER, { assigneeId: "someone", serviceId: null }).allowed,
      true,
    );
  });

  it("never allows an unassigned milestone to be self-approved by accident", () => {
    // assigneeId null must not match a null actor id or similar sloppiness.
    assert.equal(
      canDecideMilestone(SHOPIFY_LEAD, { assigneeId: null, serviceId: "shopify" }).allowed,
      true,
    );
  });
});

describe("canDecideAttendance", () => {
  it("lets the owner excuse anyone", () => {
    assert.equal(
      canDecideAttendance(OWNER, { userId: "anyone", inPod: false }).allowed,
      true,
    );
  });

  it("lets a lead excuse someone in their pod", () => {
    const decision = canDecideAttendance(ADS_LEAD, { userId: "shahzaib", inPod: true });
    assert.equal(decision.allowed, true);
    assert.equal(decision.as, "LEAD");
  });

  it("refuses a lead outside their pod", () => {
    assert.equal(
      canDecideAttendance(ADS_LEAD, { userId: "shahnawaz", inPod: false }).allowed,
      false,
    );
  });

  it("REFUSES A LEAD EXCUSING THEIR OWN ATTENDANCE", () => {
    const decision = canDecideAttendance(ADS_LEAD, { userId: ADS_LEAD.id, inPod: true });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /your own work/);
  });

  it("refuses a plain member", () => {
    assert.equal(
      canDecideAttendance(PLAIN_MEMBER, { userId: "someone", inPod: true }).allowed,
      false,
    );
  });
});

describe("canResolveDispute", () => {
  const base = { subjectId: "shahzaib", inPod: true, eventAuthorId: "owner" };

  it("lets the owner rule on anything", () => {
    assert.equal(canResolveDispute(OWNER, base).allowed, true);
  });

  it("lets a lead rule inside their pod", () => {
    assert.equal(canResolveDispute(ADS_LEAD, base).allowed, true);
  });

  it("REFUSES A LEAD RULING ON THEIR OWN DISPUTE", () => {
    assert.equal(
      canResolveDispute(ADS_LEAD, { ...base, subjectId: ADS_LEAD.id }).allowed,
      false,
    );
  });

  it("REFUSES A LEAD RULING ON A CHARGE THEY THEMSELVES RAISED", () => {
    // Otherwise the lead who charged a rejection is the judge of their own
    // charge — the self-rule conflict, one step removed.
    const decision = canResolveDispute(ADS_LEAD, { ...base, eventAuthorId: ADS_LEAD.id });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /raised this charge/);
  });

  it("still lets the owner rule on a charge they raised themselves", () => {
    // There is nobody above the owner to escalate to; the audit log is the
    // check on that, not a permission.
    assert.equal(
      canResolveDispute(OWNER, { ...base, eventAuthorId: OWNER.id }).allowed,
      true,
    );
  });

  it("handles a system-generated event with no author", () => {
    assert.equal(canResolveDispute(ADS_LEAD, { ...base, eventAuthorId: null }).allowed, true);
  });
});

describe("canViewPodMetrics", () => {
  it("always lets someone see their own numbers", () => {
    assert.equal(canViewPodMetrics(PLAIN_MEMBER, PLAIN_MEMBER.id, false).allowed, true);
  });

  it("lets a lead see their pod", () => {
    assert.equal(canViewPodMetrics(ADS_LEAD, "shahzaib", true).allowed, true);
  });

  it("refuses a lead outside their pod", () => {
    assert.equal(canViewPodMetrics(ADS_LEAD, "shahnawaz", false).allowed, false);
  });

  it("refuses a plain member looking at a colleague", () => {
    assert.equal(canViewPodMetrics(PLAIN_MEMBER, "someone", true).allowed, false);
  });
});

describe("leadsService", () => {
  it("is false for a null service", () => {
    assert.equal(leadsService(SHOPIFY_LEAD, null), false);
  });
});

describe("routeReview", () => {
  const base = {
    assigneeId: "shahzaib",
    serviceId: "shopify",
    serviceLeadIds: ["shahnawaz"],
    adminIds: ["owner"],
    escalationHours: 24,
  };

  it("routes to the service lead first", () => {
    const route = routeReview({ ...base, waitingHours: 2 });
    assert.equal(route.leadUserId, "shahnawaz");
    assert.equal(route.escalated, false);
    assert.deepEqual(route.reviewerIds, ["shahnawaz"]);
  });

  it("adds the owner after the escalation window rather than removing the lead", () => {
    // Delegation must not become a place work goes to die — but taking the
    // lead off it would punish them for a busy Tuesday.
    const route = routeReview({ ...base, waitingHours: 30 });
    assert.equal(route.escalated, true);
    assert.deepEqual([...route.reviewerIds].sort(), ["owner", "shahnawaz"]);
  });

  it("escalates exactly at the threshold", () => {
    assert.equal(routeReview({ ...base, waitingHours: 24 }).escalated, true);
    assert.equal(routeReview({ ...base, waitingHours: 23.9 }).escalated, false);
  });

  it("goes straight to the owner when the lead is the assignee", () => {
    // Otherwise it sits in a queue nobody may legitimately clear.
    const route = routeReview({
      ...base,
      assigneeId: "shahnawaz",
      waitingHours: 1,
    });
    assert.equal(route.leadUserId, null);
    assert.equal(route.escalated, true);
    assert.deepEqual(route.reviewerIds, ["owner"]);
  });

  it("goes to the owner when the service has no lead", () => {
    const route = routeReview({ ...base, serviceLeadIds: [], waitingHours: 1 });
    assert.equal(route.leadUserId, null);
    assert.deepEqual(route.reviewerIds, ["owner"]);
  });

  it("goes to the owner for a module with no service", () => {
    const route = routeReview({
      ...base,
      serviceId: null,
      serviceLeadIds: [],
      waitingHours: 1,
    });
    assert.deepEqual(route.reviewerIds, ["owner"]);
  });

  it("never lists the same reviewer twice", () => {
    // A lead who is also an admin would otherwise appear in both lists.
    const route = routeReview({
      ...base,
      serviceLeadIds: ["owner"],
      adminIds: ["owner"],
      waitingHours: 40,
    });
    assert.deepEqual(route.reviewerIds, ["owner"]);
  });

  it("handles several leads on one service", () => {
    const route = routeReview({
      ...base,
      serviceLeadIds: ["shahnawaz", "subtain"],
      waitingHours: 1,
    });
    assert.deepEqual([...route.reviewerIds].sort(), ["shahnawaz", "subtain"]);
  });
});

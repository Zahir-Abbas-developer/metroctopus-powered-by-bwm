import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canEditLeadDetails, canMoveLead } from "../lib/lead-access";

/**
 * Who may change a lead.
 *
 * The case that motivated this file: a member files a lead, automatic routing
 * gives it to a colleague, and the member can no longer correct what they
 * typed. The permission for the details has to follow the author as well as
 * the owner — while moving and reassigning the deal must not.
 */

const admin = { id: "a", role: "ADMIN" };
const support = { id: "s", role: "SUPPORT_ADMIN" };
const author = { id: "m1", role: "MEMBER" };
const owner = { id: "m2", role: "MEMBER" };
const bystander = { id: "m3", role: "MEMBER" };

const routedLead = { ownerId: owner.id, createdById: author.id };

describe("canEditLeadDetails", () => {
  it("lets the author fix a lead that was routed to someone else", () => {
    assert.equal(canEditLeadDetails(author, routedLead), true);
  });

  it("lets the owner edit it", () => {
    assert.equal(canEditLeadDetails(owner, routedLead), true);
  });

  it("lets both kinds of admin edit it", () => {
    assert.equal(canEditLeadDetails(admin, routedLead), true);
    assert.equal(canEditLeadDetails(support, routedLead), true);
  });

  it("refuses a member who neither wrote it nor owns it", () => {
    assert.equal(canEditLeadDetails(bystander, routedLead), false);
  });

  it("does not treat a missing author as a match for anyone", () => {
    // Leads filed before the column existed have no author. A null must never
    // compare equal to a member whose id happens to be falsy-adjacent.
    const legacy = { ownerId: owner.id, createdById: null };
    assert.equal(canEditLeadDetails(bystander, legacy), false);
    assert.equal(canEditLeadDetails({ id: "", role: "MEMBER" }, { ownerId: null, createdById: "" }), false);
  });
});

describe("canMoveLead", () => {
  it("keeps moving the deal with the owner", () => {
    assert.equal(canMoveLead(owner, routedLead), true);
  });

  it("does not extend to the author", () => {
    // Stages drive scoring and payouts; writing the lead is not owning the deal.
    assert.equal(canMoveLead(author, routedLead), false);
  });

  it("lets an admin move it", () => {
    assert.equal(canMoveLead(admin, routedLead), true);
  });
});

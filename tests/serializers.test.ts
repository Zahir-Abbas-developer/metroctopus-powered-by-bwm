import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serializeClient,
  serializeIncentive,
  serializeKpi,
  serializeLead,
  serializePipelineMetrics,
  serializeProject,
  serializeUser,
} from "../lib/serializers";
import type { Viewer } from "../lib/visibility";

/**
 * Snapshots of what each serializer emits, per role.
 *
 * These assert the exact set of keys, not a subset. That is the point: adding
 * a column to one of these entities breaks a test here, and fixing the test
 * means writing down who may see the new field. A subset assertion would let a
 * new column ship to everyone by default, which is the failure mode this whole
 * layer exists to prevent.
 *
 * If you are here because a test failed after adding a field: decide the
 * visibility, put it in the serializer, then update the expected keys.
 */

const owner: Viewer = {
  id: "owner",
  role: "ADMIN",
  leadServiceIds: [],
  isBusinessDev: false,
  assignedClientIds: [],
  podMemberIds: [],
  departmentIds: ["dept-a"],
};

const lead: Viewer = {
  id: "lead",
  role: "SERVICE_LEAD",
  leadServiceIds: ["svc-ads"],
  isBusinessDev: false,
  assignedClientIds: ["c1"],
  podMemberIds: ["member"],
  departmentIds: ["dept-a"],
};

const member: Viewer = {
  id: "member",
  role: "MEMBER",
  leadServiceIds: [],
  isBusinessDev: false,
  assignedClientIds: ["c1"],
  podMemberIds: [],
  departmentIds: ["dept-a"],
};

const keysOf = (value: object) => Object.keys(value).sort();

const CLIENT = {
  id: "c1",
  businessName: "Lumen Skincare",
  contactName: "Ada Okafor",
  email: "ada@lumen.example",
  phone: "+92 300 1234567",
  industry: "Beauty",
  country: "PK",
  monthlyBudget: 4500,
  status: "ACTIVE",
  notes: null,
  targetRoas: 2.5,
  startDate: new Date("2026-07-01T00:00:00Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

describe("serializeClient", () => {
  const shared = [
    "businessName",
    "contactName",
    "country",
    "createdAt",
    "email",
    "id",
    "industry",
    "notes",
    "startDate",
    "status",
    "targetRoas",
  ];

  it("gives the owner the money fields", () => {
    assert.deepEqual(keysOf(serializeClient(CLIENT, owner)), [...shared, "monthlyBudget", "phone"].sort());
  });

  it("gives a service lead the same client without phone or retainer", () => {
    assert.deepEqual(keysOf(serializeClient(CLIENT, lead)), shared);
  });

  it("gives a member the same client without phone or retainer", () => {
    assert.deepEqual(keysOf(serializeClient(CLIENT, member)), shared);
  });

  it("keeps targetRoas for everyone — it is operational, not agency money", () => {
    assert.equal(serializeClient(CLIENT, member).targetRoas, 2.5);
  });
});

const LEAD_ROW = {
  id: "l1",
  businessName: "Harbour & Vine",
  contactName: "Sam",
  email: "sam@harbour.example",
  phone: null,
  source: "Referral",
  country: "GB",
  interestedServices: ["google-ads"],
  estimatedMonthlyValue: 6500,
  dealValue: 6500,
  ownerId: "bd",
  stage: "NEGOTIATION",
  stageChangedAt: new Date("2026-08-01T00:00:00Z"),
  lostReason: null,
  lostNote: null,
  owner: { id: "bd", name: "Cam", avatarColor: "#1A6B3A" },
  activityCount: 3,
  convertedClientId: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

describe("serializeLead", () => {
  it("omits the deal value for a service lead who does not do sales", () => {
    assert.equal("estimatedMonthlyValue" in serializeLead(LEAD_ROW, lead), false);
  });

  it("keeps the deal value for the business developer who owns it", () => {
    const bd: Viewer = { ...member, id: "bd", isBusinessDev: true };
    assert.equal(serializeLead(LEAD_ROW, bd).estimatedMonthlyValue, 6500);
  });

  it("omits another developer's deal value", () => {
    const other: Viewer = { ...member, id: "other-bd", isBusinessDev: true };
    assert.equal("estimatedMonthlyValue" in serializeLead(LEAD_ROW, other), false);
  });
});

describe("serializePipelineMetrics", () => {
  const metrics = {
    stages: [{ stage: "NEW", count: 2, value: 11300 }],
    openValue: 33800,
    openCount: 7,
    wonThisMonth: { count: 1, value: 5600 },
    winRate: 33,
    averageDealSize: 5600,
  };

  it("gives a non-owner counts and nothing else", () => {
    const result = serializePipelineMetrics(metrics, member);
    assert.deepEqual(keysOf(result), ["openCount", "stages"]);
    assert.deepEqual(keysOf(result.stages[0]), ["count", "stage"]);
  });

  it("gives the owner everything", () => {
    const result = serializePipelineMetrics(metrics, owner);
    assert.equal(result.openValue, 33800);
    assert.equal(result.stages[0].value, 11300);
  });
});

describe("serializeUser", () => {
  const row = {
    id: "member",
    name: "Claire",
    email: "claire@bwm.local",
    role: "MEMBER",
    jobTitle: "Shopify Designer",
    avatarColor: "#1A6B3A",
    isActive: true,
    weeklyCapacityHours: 40,
    phone: "+92 300 9999999",
    score: 92,
    onTimeRate: 88,
    load: 12,
  };

  it("gives a member their own numbers", () => {
    const result = serializeUser(row, member);
    assert.equal(result.score, 92);
    assert.equal(result.onTimeRate, 88);
  });

  it("withholds another member's numbers", () => {
    const other: Viewer = { ...member, id: "someone-else" };
    const result = serializeUser(row, other);
    assert.equal("score" in result, false);
    assert.equal("onTimeRate" in result, false);
    // Identity still travels — you cannot collaborate with someone invisible.
    assert.equal(result.name, "Claire");
    assert.equal(result.jobTitle, "Shopify Designer");
  });

  it("gives a lead their pod's numbers", () => {
    assert.equal(serializeUser(row, lead).score, 92);
  });

  it("withholds a personal phone number from a peer", () => {
    const other: Viewer = { ...member, id: "someone-else" };
    assert.equal("phone" in serializeUser(row, other), false);
  });

  it("keeps capacity visible, because assignment depends on it", () => {
    const other: Viewer = { ...member, id: "someone-else" };
    assert.equal(serializeUser(row, other).weeklyCapacityHours, 40);
  });
});

describe("serializeKpi", () => {
  const kpi = {
    id: "k1",
    clientId: "c1",
    weekStart: new Date("2026-08-03T00:00:00Z"),
    adSpend: 1200,
    revenue: 4300,
    roas: 3.58,
    conversions: 41,
  };

  it("gives ad performance to a member assigned to the client", () => {
    assert.equal(serializeKpi(kpi, member, { id: "c1" })?.roas, 3.58);
  });

  it("withholds it for a client they do not work on", () => {
    assert.equal(serializeKpi({ ...kpi, clientId: "c9" }, member, { id: "c9" }), null);
  });

  it("gives a lead the clients their service lines touch", () => {
    assert.notEqual(serializeKpi(kpi, lead, { id: "c9", serviceIds: ["svc-ads"] }), null);
  });
});

describe("serializeIncentive", () => {
  const award = {
    userId: "member",
    type: "EXCELLENCE_STREAK",
    year: 2026,
    month: 8,
    amount: 25000,
    percent: 10,
    streakMonths: 3,
  };

  it("shows a member their streak without the amount", () => {
    const result = serializeIncentive(award, member);
    assert.notEqual(result, null);
    assert.equal(result?.streakMonths, 3);
    assert.equal("amount" in (result as object), false);
    assert.equal("percent" in (result as object), false);
  });

  it("shows the owner the amount", () => {
    assert.equal(serializeIncentive(award, owner)?.amount, 25000);
  });

  it("hides another member's award entirely", () => {
    const other: Viewer = { ...member, id: "someone-else" };
    assert.equal(serializeIncentive(award, other), null);
  });
});

describe("serializeProject", () => {
  const project = {
    id: "p1",
    title: "Aug 2026 Retainer",
    clientId: "c1",
    status: "ACTIVE",
    startDate: new Date("2026-08-01T00:00:00Z"),
    endDate: null,
    client: { id: "c1", businessName: "Lumen", monthlyBudget: 4500 },
  };

  it("strips the retainer off the nested client for a member", () => {
    const result = serializeProject(project, member);
    assert.equal(result?.client?.businessName, "Lumen");
    assert.equal("monthlyBudget" in (result?.client as object), false);
  });

  it("returns null for a client the member does not work on", () => {
    assert.equal(serializeProject({ ...project, clientId: "c9" }, member), null);
  });

  it("keeps the retainer for the owner", () => {
    assert.equal(serializeProject(project, owner)?.client?.monthlyBudget, 4500);
  });
});

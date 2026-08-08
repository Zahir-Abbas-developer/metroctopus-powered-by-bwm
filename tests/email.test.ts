import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  escape,
  overdueAlertEmail,
  reportReadyEmail,
  weeklyDigestEmail,
  welcomeEmail,
} from "../lib/email/templates";

describe("escape", () => {
  it("neutralises markup", () => {
    assert.equal(escape('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    assert.equal(escape("Tom & Jerry"), "Tom &amp; Jerry");
    assert.equal(escape("it's"), "it&#39;s");
  });
});

describe("welcomeEmail", () => {
  const email = welcomeEmail({
    name: "Ayesha Khan",
    email: "ayesha@agency.local",
    password: "s3cret-temp-pass",
    jobTitle: "Shopify Developer",
    signInUrl: "https://agency.example.com/login",
  });

  it("greets by first name", () => {
    assert.match(email.html, /Hello Ayesha/);
    assert.match(email.text, /Hello Ayesha/);
  });

  it("carries the credentials", () => {
    assert.match(email.html, /ayesha@agency\.local/);
    assert.match(email.html, /s3cret-temp-pass/);
  });

  it("links to sign in", () => {
    assert.match(email.html, /https:\/\/agency\.example\.com\/login/);
  });

  it("has a plain-text alternative", () => {
    assert.ok(email.text.length > 40);
    assert.doesNotMatch(email.text, /<[a-z]/i);
  });
});

describe("weeklyDigestEmail", () => {
  it("shows the score and flags overdue work", () => {
    const email = weeklyDigestEmail({
      name: "Bilal Ahmed",
      score: 88,
      bandLabel: "Good",
      appUrl: "https://agency.example.com",
      dueThisWeek: [
        { title: "Campaign launch", clientName: "Lumen", dueLabel: "9 Aug 2026", overdue: false },
        { title: "Week 2 report", clientName: "Maison Rue", dueLabel: "4 Aug 2026", overdue: true },
      ],
    });

    assert.match(email.html, />88</);
    assert.match(email.html, /Good/);
    assert.match(email.html, /overdue/);
    assert.match(email.subject, /2 items due/);
  });

  it("says so plainly when nothing is due", () => {
    const email = weeklyDigestEmail({
      name: "Bilal Ahmed",
      score: 100,
      bandLabel: "Excellent",
      appUrl: "https://agency.example.com",
      dueThisWeek: [],
    });

    assert.match(email.html, /Nothing is due in the next seven days/);
    assert.match(email.subject, /0 items due/);
  });
});

describe("reportReadyEmail", () => {
  it("leads with the narrative and links the report", () => {
    const email = reportReadyEmail({
      name: "Ayesha Khan",
      periodLabel: "August 2026",
      typeLabel: "Monthly performance",
      narrative: "You completed 9 of 10 milestones on time this month.",
      score: 92,
      reportUrl: "https://agency.example.com/reports/abc",
    });

    assert.match(email.html, /You completed 9 of 10 milestones/);
    assert.match(email.html, /https:\/\/agency\.example\.com\/reports\/abc/);
    assert.match(email.subject, /monthly performance for August 2026/);
  });
});

describe("overdueAlertEmail", () => {
  it("counts and lists what slipped", () => {
    const email = overdueAlertEmail({
      appUrl: "https://agency.example.com",
      overdue: [
        { title: "Theme build", clientName: "Northline", assigneeName: "Ayesha Khan", daysLate: 3 },
      ],
    });

    assert.match(email.subject, /^1 overdue milestone$/);
    assert.match(email.html, /Theme build/);
    assert.match(email.html, /3 days late/);
  });

  it("gets plural agreement right", () => {
    const email = overdueAlertEmail({
      appUrl: "https://agency.example.com",
      overdue: [
        { title: "A", clientName: "C", assigneeName: "N", daysLate: 1 },
        { title: "B", clientName: "C", assigneeName: "N", daysLate: 2 },
      ],
    });

    assert.match(email.subject, /^2 overdue milestones$/);
    assert.match(email.html, /1 day late/);
    assert.match(email.html, /2 days late/);
  });
});

describe("every template", () => {
  it("escapes hostile input rather than emitting it", () => {
    const email = welcomeEmail({
      name: '<img src=x onerror="alert(1)">',
      email: "x@y.z",
      password: "</td><script>evil()</script>",
      jobTitle: "Dev",
      signInUrl: "https://agency.example.com/login",
    });

    assert.doesNotMatch(email.html, /<script>evil/);
    assert.doesNotMatch(email.html, /onerror="alert/);
    assert.match(email.html, /&lt;script&gt;evil/);
  });
});

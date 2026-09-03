import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMentions, mentionedUserIds, segmentMentions } from "../lib/mentions";

const TEAM = [
  { id: "u1", name: "Ayesha Khan" },
  { id: "u2", name: "Bilal Ahmed" },
  { id: "u3", name: "Hira Siddiqui" },
  { id: "u4", name: "Usman Tariq" },
];

describe("findMentions", () => {
  it("matches a full name", () => {
    const matches = findMentions("Can @Ayesha Khan take this?", TEAM);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "u1");
    assert.equal(matches[0].name, "Ayesha Khan");
  });

  it("matches a unique first name", () => {
    assert.deepEqual(mentionedUserIds("@Bilal can you check the tracking?", TEAM), ["u2"]);
  });

  it("prefers the full name over the first name", () => {
    const matches = findMentions("@Ayesha Khan", TEAM);
    assert.equal(matches[0].name, "Ayesha Khan");
    assert.equal(matches[0].end, "@Ayesha Khan".length);
  });

  it("finds several mentions in one comment", () => {
    assert.deepEqual(
      mentionedUserIds("@Bilal and @Hira Siddiqui please sync with @Usman", TEAM),
      ["u2", "u3", "u4"],
    );
  });

  it("returns each person once however often they are named", () => {
    assert.deepEqual(mentionedUserIds("@Bilal @Bilal Ahmed @Bilal", TEAM), ["u2"]);
  });

  it("ignores an unknown name", () => {
    assert.deepEqual(mentionedUserIds("@Nobody At All can you look?", TEAM), []);
  });

  it("ignores an email address", () => {
    assert.deepEqual(mentionedUserIds("mail bilal@bwm.local about it", TEAM), []);
  });

  it("does not match a name embedded in a longer word", () => {
    const people = [
      { id: "a", name: "Ali" },
      { id: "b", name: "Alison Reed" },
    ];
    assert.deepEqual(mentionedUserIds("@Alison Reed owns it", people), ["b"]);
    assert.deepEqual(mentionedUserIds("@Ali owns it", people), ["a"]);
  });

  it("refuses an ambiguous first name", () => {
    const people = [
      { id: "x", name: "Ayesha Khan" },
      { id: "y", name: "Ayesha Malik" },
    ];
    // Notifying an arbitrary one of two people would be worse than nothing.
    assert.deepEqual(mentionedUserIds("@Ayesha please review", people), []);
    assert.deepEqual(mentionedUserIds("@Ayesha Malik please review", people), ["y"]);
  });

  it("is case insensitive", () => {
    assert.deepEqual(mentionedUserIds("@bilal ahmed take a look", TEAM), ["u2"]);
  });

  it("handles punctuation right after the name", () => {
    assert.deepEqual(mentionedUserIds("@Bilal, can you?", TEAM), ["u2"]);
    assert.deepEqual(mentionedUserIds("ping @Hira Siddiqui.", TEAM), ["u3"]);
  });

  it("handles a mention at the very start and very end", () => {
    assert.deepEqual(mentionedUserIds("@Usman", TEAM), ["u4"]);
    assert.deepEqual(mentionedUserIds("over to @Usman", TEAM), ["u4"]);
  });

  it("returns nothing for text with no mentions", () => {
    assert.deepEqual(mentionedUserIds("No mentions here at all.", TEAM), []);
    assert.deepEqual(mentionedUserIds("", TEAM), []);
  });

  it("survives a stray @", () => {
    assert.deepEqual(mentionedUserIds("costs @ 20% margin", TEAM), []);
    assert.deepEqual(mentionedUserIds("@", TEAM), []);
  });
});

describe("segmentMentions", () => {
  it("splits text and mentions in order", () => {
    const segments = segmentMentions("Hi @Bilal — see @Hira Siddiqui too", TEAM);

    assert.deepEqual(segments, [
      { kind: "text", text: "Hi " },
      { kind: "mention", text: "@Bilal", id: "u2" },
      { kind: "text", text: " — see " },
      { kind: "mention", text: "@Hira Siddiqui", id: "u3" },
      { kind: "text", text: " too" },
    ]);
  });

  it("returns a single text segment when there is nothing to link", () => {
    assert.deepEqual(segmentMentions("plain text", TEAM), [
      { kind: "text", text: "plain text" },
    ]);
  });

  it("reassembles into the original string", () => {
    const body = "@Bilal and @Usman: the @Hira Siddiqui draft is ready @ 5pm";
    const rebuilt = segmentMentions(body, TEAM)
      .map((segment) => segment.text)
      .join("");
    assert.equal(rebuilt, body);
  });
});

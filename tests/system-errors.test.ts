import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeError } from "../lib/system-errors";

/**
 * The error logger runs at the worst possible moment — a page has already
 * failed — so the thing it must never do is throw. Most of that guarantee is
 * in the swallowed database write, which needs a database to exercise; what is
 * testable here is the part that reads whatever was thrown, and "whatever was
 * thrown" is not always an Error.
 */
describe("describeError", () => {
  it("takes the message, stack and digest off a real Error", () => {
    const error = Object.assign(new Error("client.project is undefined"), {
      digest: "3341276598",
    });

    const described = describeError(error);

    assert.equal(described.message, "client.project is undefined");
    assert.equal(described.digest, "3341276598");
    assert.ok(described.stack?.includes("Error: client.project is undefined"));
  });

  it("leaves digest null on an Error that has none", () => {
    // Only Next sets a digest. A plain throw in a client component has none,
    // and null has to stay null rather than becoming the string "undefined".
    const described = describeError(new Error("boom"));

    assert.equal(described.digest, null);
    assert.equal(described.message, "boom");
  });

  it("survives a thrown string", () => {
    // `throw "nope"` is legal JavaScript and reaches the boundary the same way
    // an Error does.
    const described = describeError("nope");

    assert.equal(described.message, "nope");
    assert.equal(described.stack, null);
    assert.equal(described.digest, null);
  });

  it("survives a thrown null", () => {
    const described = describeError(null);

    assert.equal(described.message, "null");
    assert.equal(described.stack, null);
  });

  it("survives a thrown object with no message", () => {
    const described = describeError({ status: 500 });

    // Not useful, but a string — the logger records something rather than
    // failing to record that anything happened.
    assert.equal(typeof described.message, "string");
    assert.equal(described.stack, null);
  });
});

/**
 * The only exit door for entity data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  CONVENTION — read before adding a field
 *
 *  Nothing in this directory is optional plumbing. A Prisma row must not reach
 *  a route response or a server component's props except through a
 *  `serializeX(row, viewer)` in this directory. Passing a row straight to the
 *  UI is the bug this layer exists to make impossible, because "the component
 *  doesn't render it" is not the same as "the browser never received it".
 *
 *  When you add a column to one of these entities, the serializer will not
 *  compile until you say who may see it. That is deliberate: a new field
 *  should force a visibility decision, not inherit one by being forgotten.
 *  `npm run permtest` snapshots every serializer's output keys, so an
 *  accidental addition fails a test rather than shipping.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Each serializer takes the widest row the app reads and returns a narrowed
 * object whose *keys are absent* when the viewer may not see them. Absent, not
 * null and not masked: a null still tells the reader the field exists, invites
 * a component to render a placeholder where a number belongs, and leaves a
 * leak test unable to tell "withheld" from "genuinely empty".
 */

export * from "./client";
export * from "./lead";
export * from "./user";
export * from "./kpi";
export * from "./money";
export * from "./project";

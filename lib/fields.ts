import { prisma } from "@/lib/prisma";
import {
  FIELD_TYPES,
  FIELD_TYPES_WITH_OPTIONS,
  type FieldEntity,
  type FieldType,
} from "@/lib/constants";

/**
 * The dynamic field engine.
 *
 * Departments track different facts — Pilot Cars needs pickup and destination,
 * Insurance needs policy type and coverage, Affiliates needs commission terms.
 * Widening `Client` and `Lead` with every department's columns would give each
 * department a table full of other people's nulls, so each department declares
 * its own `FieldDefinition` rows and the answers live in `FieldValue`.
 *
 * Everything about that storage is owned here: options parsing, the text
 * encoding of each type, validation, and conditional visibility. Nothing
 * downstream splits a comma-separated string by hand or coerces a value inline.
 *
 * Two storage notes, both consequences of the Postgres-portable-SQLite rule in
 * CLAUDE.md:
 *
 * - `options` is a comma-separated `String`, not `String[]` — same convention
 *   as `DepartmentMembership.skills`.
 * - `FieldValue.value` is text whatever the declared type. A Json column would
 *   be the obvious alternative and SQLite has none; text plus a typed accessor
 *   also means changing a field from TEXT to SELECT is not a column migration.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** "Life, Health ,, Life" -> ["Life", "Health"] */
export function parseOptions(stored: string | null | undefined): string[] {
  if (!stored) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of stored.split(",")) {
    const option = raw.trim();
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

/** ["Life", " health", "Life"] -> "Life,health" */
export function serializeOptions(options: readonly string[]): string {
  return parseOptions(options.join(",")).join(",");
}

// ---------------------------------------------------------------------------
// The shape every screen receives
// ---------------------------------------------------------------------------

export type FieldDefinitionView = {
  id: string;
  departmentId: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  helpText: string | null;
  required: boolean;
  order: number;
  isActive: boolean;
  /** Show only when the field at `showIfKey` holds one of `showIfValues`. */
  showIfKey: string | null;
  showIfValues: string[];
};

type FieldDefinitionRow = {
  id: string;
  departmentId: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  options: string;
  helpText: string | null;
  required: boolean;
  order: number;
  isActive: boolean;
  showIfKey: string | null;
  showIfValues: string;
};

export function toFieldDefinitionView(row: FieldDefinitionRow): FieldDefinitionView {
  return {
    id: row.id,
    departmentId: row.departmentId,
    entity: row.entity as FieldEntity,
    key: row.key,
    label: row.label,
    type: row.type as FieldType,
    options: parseOptions(row.options),
    helpText: row.helpText,
    required: row.required,
    order: row.order,
    isActive: row.isActive,
    showIfKey: row.showIfKey,
    showIfValues: parseOptions(row.showIfValues),
  };
}

/**
 * The active field set for one department and entity, in display order.
 *
 * Inactive definitions are excluded: a field an admin switched off should stop
 * appearing on forms, while the values already recorded against it stay in the
 * database rather than being destroyed by a toggle.
 */
export async function fieldsFor(
  departmentId: string,
  entity: FieldEntity,
): Promise<FieldDefinitionView[]> {
  const rows = await prisma.fieldDefinition.findMany({
    where: { departmentId, entity, isActive: true },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });
  return rows.map(toFieldDefinitionView);
}

/** Every definition for a department and entity, active or not — for Settings. */
export async function allFieldsFor(
  departmentId: string,
  entity: FieldEntity,
): Promise<FieldDefinitionView[]> {
  const rows = await prisma.fieldDefinition.findMany({
    where: { departmentId, entity },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });
  return rows.map(toFieldDefinitionView);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A record's answers, keyed by field key. Absent keys were never answered. */
export type FieldValueMap = Record<string, string>;

export async function valuesFor(
  recordId: string,
  definitions: readonly FieldDefinitionView[],
): Promise<FieldValueMap> {
  if (definitions.length === 0) return {};
  const rows = await prisma.fieldValue.findMany({
    where: { recordId, fieldDefinitionId: { in: definitions.map((d) => d.id) } },
  });

  const keyById = new Map(definitions.map((d) => [d.id, d.key]));
  const out: FieldValueMap = {};
  for (const row of rows) {
    const key = keyById.get(row.fieldDefinitionId);
    if (key) out[key] = row.value;
  }
  return out;
}

/**
 * Values for many records at once.
 *
 * A list of 200 clients must not become 200 round trips; the browser and the
 * card grid both read through here.
 */
export async function valuesForMany(
  recordIds: readonly string[],
  definitions: readonly FieldDefinitionView[],
): Promise<Record<string, FieldValueMap>> {
  const out: Record<string, FieldValueMap> = {};
  for (const id of recordIds) out[id] = {};
  if (recordIds.length === 0 || definitions.length === 0) return out;

  const rows = await prisma.fieldValue.findMany({
    where: {
      recordId: { in: [...recordIds] },
      fieldDefinitionId: { in: definitions.map((d) => d.id) },
    },
  });

  const keyById = new Map(definitions.map((d) => [d.id, d.key]));
  for (const row of rows) {
    const key = keyById.get(row.fieldDefinitionId);
    if (!key) continue;
    (out[row.recordId] ??= {})[key] = row.value;
  }
  return out;
}

/**
 * Write a record's answers.
 *
 * An empty answer deletes the row rather than storing `""`, so "never answered"
 * and "answered with nothing" cannot drift apart. Only keys present in
 * `definitions` are touched — a payload naming another department's field is
 * ignored rather than trusted.
 */
export async function writeFieldValues(
  recordId: string,
  definitions: readonly FieldDefinitionView[],
  values: FieldValueMap,
): Promise<void> {
  const visible = visibleFields(definitions, values);
  const visibleIds = new Set(visible.map((d) => d.id));

  for (const definition of definitions) {
    const supplied = values[definition.key];
    if (supplied === undefined) continue;

    // A hidden field's answer is discarded: leaving the insurance answers on a
    // record whose category moved to "Cam" would show them again the moment it
    // moved back, as data nobody entered for that state.
    const stored = visibleIds.has(definition.id) ? normalize(definition, supplied) : "";

    if (stored === "") {
      await prisma.fieldValue.deleteMany({
        where: { fieldDefinitionId: definition.id, recordId },
      });
      continue;
    }

    await prisma.fieldValue.upsert({
      where: {
        fieldDefinitionId_recordId: { fieldDefinitionId: definition.id, recordId },
      },
      update: { value: stored },
      create: { fieldDefinitionId: definition.id, recordId, value: stored },
    });
  }
}

/**
 * Remove every answer belonging to a record.
 *
 * `FieldValue.recordId` is deliberately not a foreign key — the definition's
 * `entity` says which table it points at, and Prisma cannot express a relation
 * whose target depends on another column. Deleting a Lead or Client therefore
 * has to clear its values explicitly, and every delete path calls this.
 */
export async function deleteFieldValues(recordId: string): Promise<void> {
  await prisma.fieldValue.deleteMany({ where: { recordId } });
}

// ---------------------------------------------------------------------------
// Conditional visibility
// ---------------------------------------------------------------------------

/**
 * Which definitions apply given the answers so far.
 *
 * Culture Plus needs this: its insurance questions are irrelevant to a Cam sale
 * and vice versa, and asking every question of every lead is how a form stops
 * being filled in honestly.
 *
 * A rule pointing at a missing or inactive field hides the dependent field
 * rather than showing it — a condition that cannot be evaluated has not been
 * met, and silently ignoring it would leak the very questions it was written to
 * hide.
 */
export function isVisible(
  definition: FieldDefinitionView,
  values: FieldValueMap,
  all: readonly FieldDefinitionView[],
): boolean {
  if (!definition.showIfKey) return true;

  const controller = all.find((d) => d.key === definition.showIfKey && d.isActive);
  if (!controller) return false;

  const current = values[definition.showIfKey];
  if (current === undefined || current === "") return false;

  // A MULTISELECT controller matches if any selected option is listed.
  const selected =
    controller.type === "MULTISELECT" ? parseOptions(current) : [current];

  const wanted = definition.showIfValues.map((v) => v.toLowerCase());
  return selected.some((value) => wanted.includes(value.trim().toLowerCase()));
}

export function visibleFields(
  definitions: readonly FieldDefinitionView[],
  values: FieldValueMap,
): FieldDefinitionView[] {
  return definitions.filter((d) => isVisible(d, values, definitions));
}

// ---------------------------------------------------------------------------
// Validation and normalisation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Canonical stored text for a submitted answer. Never throws — see `validate`. */
function normalize(definition: FieldDefinitionView, raw: string): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";

  switch (definition.type) {
    case "CHECKBOX":
      return value === "true" || value === "on" || value === "1" ? "true" : "";
    case "NUMBER":
    case "CURRENCY": {
      const cleaned = value.replace(/[,\s]/g, "");
      return Number.isFinite(Number(cleaned)) ? cleaned : "";
    }
    case "MULTISELECT":
      // Keep only options the definition still offers, in the order it lists
      // them, so a removed option disappears instead of lingering as a value
      // the edit form cannot render.
      return serializeOptions(
        definition.options.filter((option) =>
          parseOptions(value).some((v) => v.toLowerCase() === option.toLowerCase()),
        ),
      );
    case "SELECT": {
      const match = definition.options.find(
        (option) => option.toLowerCase() === value.toLowerCase(),
      );
      return match ?? "";
    }
    case "DATE": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? "" : value;
    }
    default:
      return value;
  }
}

export type FieldError = { key: string; message: string };

/**
 * Validate a submitted answer set against its definitions.
 *
 * Only visible fields are checked: a required insurance question on a Cam sale
 * is not a missing answer, it is a question that was never asked.
 */
export function validateFieldValues(
  definitions: readonly FieldDefinitionView[],
  values: FieldValueMap,
): FieldError[] {
  const errors: FieldError[] = [];

  for (const definition of visibleFields(definitions, values)) {
    const raw = (values[definition.key] ?? "").trim();

    if (raw === "") {
      if (definition.required) {
        errors.push({ key: definition.key, message: `${definition.label} is required.` });
      }
      continue;
    }

    switch (definition.type) {
      case "EMAIL":
        if (!EMAIL_RE.test(raw)) {
          errors.push({
            key: definition.key,
            message: `${definition.label} must be a valid email address.`,
          });
        }
        break;
      case "NUMBER":
      case "CURRENCY":
        if (!Number.isFinite(Number(raw.replace(/[,\s]/g, "")))) {
          errors.push({
            key: definition.key,
            message: `${definition.label} must be a number.`,
          });
        }
        break;
      case "DATE":
        if (Number.isNaN(new Date(raw).getTime())) {
          errors.push({
            key: definition.key,
            message: `${definition.label} must be a valid date.`,
          });
        }
        break;
      case "SELECT":
        if (!definition.options.some((o) => o.toLowerCase() === raw.toLowerCase())) {
          errors.push({
            key: definition.key,
            message: `${definition.label} must be one of the listed options.`,
          });
        }
        break;
      case "MULTISELECT": {
        const unknown = parseOptions(raw).filter(
          (v) => !definition.options.some((o) => o.toLowerCase() === v.toLowerCase()),
        );
        if (unknown.length > 0) {
          errors.push({
            key: definition.key,
            message: `${definition.label} has an option that no longer exists.`,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Human-readable form of a stored value.
 *
 * Currency and dates are deliberately left to the caller's formatter — money
 * formatting and the company timezone both live elsewhere, and duplicating
 * either here is how two screens start disagreeing.
 */
export function displayValue(
  definition: FieldDefinitionView,
  stored: string | undefined,
): string {
  const value = (stored ?? "").trim();
  if (value === "") return "";

  switch (definition.type) {
    case "CHECKBOX":
      return value === "true" ? "Yes" : "No";
    case "MULTISELECT":
      return parseOptions(value).join(", ");
    default:
      return value;
  }
}

/** A definition key an admin typed, reduced to the stable machine form. */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

export function typeTakesOptions(type: FieldType): boolean {
  return FIELD_TYPES_WITH_OPTIONS.includes(type);
}

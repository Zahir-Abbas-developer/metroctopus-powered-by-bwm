"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { isVisible, parseOptions, serializeOptions } from "@/lib/fields";
import type { FieldDefinitionView, FieldValueMap } from "@/lib/fields";
import { cn } from "@/lib/utils";

/**
 * A department's own questions, rendered from its field definitions.
 *
 * Every control here is an existing primitive — `Input`, `Textarea`, `Select`,
 * and for MULTISELECT the same pill-toggle the lead form already uses for
 * services. Nothing new is invented: the field engine decides *what* is asked,
 * the design system decides how it looks.
 *
 * Visibility is evaluated with the same `isVisible` the server validates and
 * writes with, so a conditional field cannot be shown here and rejected there.
 */
export function DynamicFields({
  definitions,
  values,
  errors,
  disabled,
  onChange,
}: {
  definitions: readonly FieldDefinitionView[];
  values: FieldValueMap;
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const shown = definitions.filter((definition) =>
    isVisible(definition, values, definitions),
  );

  if (shown.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {shown.map((definition) => (
        <div
          key={definition.id}
          // Long-form answers and choice lists get the full width; short
          // scalars sit two-up like the core fields above them.
          className={cn(
            (definition.type === "TEXTAREA" || definition.type === "MULTISELECT") &&
              "sm:col-span-2",
          )}
        >
          <DynamicField
            definition={definition}
            value={values[definition.key] ?? ""}
            error={errors?.[definition.key]}
            disabled={disabled}
            onChange={(next) => onChange(definition.key, next)}
          />
        </div>
      ))}
    </div>
  );
}

function DynamicField({
  definition,
  value,
  error,
  disabled,
  onChange,
}: {
  definition: FieldDefinitionView;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const shared = {
    label: definition.label,
    requiredMark: definition.required,
    hint: definition.helpText ?? undefined,
    error,
    disabled,
  };

  switch (definition.type) {
    case "TEXTAREA":
      return (
        <Textarea
          {...shared}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "SELECT":
      return (
        <Select
          {...shared}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Choose one"
          options={definition.options.map((option) => ({
            value: option,
            label: option,
          }))}
        />
      );

    case "MULTISELECT": {
      const selected = parseOptions(value);
      return (
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">
            {definition.label}
            {definition.required && <span className="ml-0.5 text-danger">*</span>}
            {definition.helpText && (
              <span className="ml-2 font-normal text-ink/45">{definition.helpText}</span>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {definition.options.map((option) => {
              const active = selected.some(
                (item) => item.toLowerCase() === option.toLowerCase(),
              );
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() =>
                    onChange(
                      serializeOptions(
                        active
                          ? selected.filter(
                              (item) => item.toLowerCase() !== option.toLowerCase(),
                            )
                          : [...selected, option],
                      ),
                    )
                  }
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/55 hover:border-ink/25",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
        </div>
      );
    }

    case "CHECKBOX":
      return (
        <label className="flex items-start gap-2.5 pt-6 text-[13px] text-ink/80">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value === "true"}
            onChange={(event) => onChange(event.target.checked ? "true" : "")}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
          />
          <span>
            {definition.label}
            {definition.helpText && (
              <span className="ml-2 text-ink/45">{definition.helpText}</span>
            )}
            {error && <span className="mt-1 block text-[12px] text-danger">{error}</span>}
          </span>
        </label>
      );

    case "DATE":
      return (
        <Input
          {...shared}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "NUMBER":
      return (
        <Input
          {...shared}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "CURRENCY":
      return (
        <Input
          {...shared}
          type="number"
          min={0}
          icon={<span className="text-[13px]">$</span>}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "EMAIL":
      return (
        <Input
          {...shared}
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "PHONE":
      return (
        <Input
          {...shared}
          type="tel"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    default:
      return (
        <Input
          {...shared}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

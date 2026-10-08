// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  eventInputSchema,
  MAX_REGISTRATION_FIELDS,
  utcToZonedLocal,
  zonedLocalToUtc,
  type Event,
  type EventInput,
  type RegistrationField,
} from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi, problemIssues, type ApiErrorKey } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

type FieldType = RegistrationField["type"];

interface FieldDraft {
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** Select options, one per line. */
  optionsText: string;
}

interface Draft {
  name: string;
  description: string;
  startsLocal: string;
  endsLocal: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  capacity: string;
  registrationMode: "open" | "closed";
  deadlineLocal: string;
  fields: FieldDraft[];
}

type ErrorKey =
  "required" | "endsBeforeStart" | "deadlineAfterEnd" | "capacityInvalid" | "optionsRequired";

const DEFAULT_TIME_ZONE = "America/Mexico_City";

function toDraft(event: Event | null): Draft {
  if (!event) {
    return {
      name: "",
      description: "",
      startsLocal: "",
      endsLocal: "",
      timezone: DEFAULT_TIME_ZONE,
      venueName: "",
      venueAddress: "",
      capacity: "",
      registrationMode: "open",
      deadlineLocal: "",
      fields: [],
    };
  }
  const local = (iso: string | null) => (iso ? utcToZonedLocal(new Date(iso), event.timezone) : "");
  return {
    name: event.name,
    description: event.description ?? "",
    startsLocal: local(event.startsAt),
    endsLocal: local(event.endsAt),
    timezone: event.timezone,
    venueName: event.venueName,
    venueAddress: event.venueAddress ?? "",
    capacity: event.capacity === null ? "" : String(event.capacity),
    registrationMode: event.registrationMode,
    deadlineLocal: local(event.registrationDeadline),
    fields: event.registrationFields.map((field) => ({
      key: field.key,
      type: field.type,
      label: field.label,
      required: field.required,
      optionsText: field.type === "select" ? field.options.join("\n") : "",
    })),
  };
}

function toInstant(local: string, timeZone: string): string | null {
  if (!local) return null;
  try {
    return zonedLocalToUtc(local, timeZone).toISOString();
  } catch {
    return "invalid";
  }
}

function toPayload(draft: Draft): Record<string, unknown> {
  const capacity = draft.capacity.trim();
  return {
    name: draft.name,
    description: draft.description.trim() || null,
    startsAt: toInstant(draft.startsLocal, draft.timezone) ?? "",
    endsAt: toInstant(draft.endsLocal, draft.timezone),
    timezone: draft.timezone,
    venueName: draft.venueName,
    venueAddress: draft.venueAddress.trim() || null,
    capacity: capacity === "" ? null : Number(capacity),
    registrationMode: draft.registrationMode,
    registrationDeadline: toInstant(draft.deadlineLocal, draft.timezone),
    registrationFields: draft.fields.map((field) => ({
      type: field.type,
      key: field.key,
      label: field.label,
      required: field.required,
      ...(field.type === "select"
        ? {
            options: field.optionsText
              .split("\n")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    })),
  };
}

/**
 * Maps a validation issue (client or API) to a form field and message. `endsAt` and
 * `registrationDeadline` are optional datetime inputs, so their only possible errors are the
 * cross-field date rules.
 */
function errorKeyFor(path: (string | number)[]): [string, ErrorKey] {
  const [head, index, sub] = path;
  if (head === "registrationFields" && typeof index === "number") {
    return sub === "options"
      ? [`fields.${index}.options`, "optionsRequired"]
      : [`fields.${index}.label`, "required"];
  }
  const name = String(head);
  if (name === "endsAt") return [name, "endsBeforeStart"];
  if (name === "registrationDeadline") return [name, "deadlineAfterEnd"];
  if (name === "capacity") return [name, "capacityInvalid"];
  return [name, "required"];
}

function nextFieldKey(fields: FieldDraft[]): string {
  const used = new Set(fields.map((f) => f.key));
  let n = fields.length + 1;
  while (used.has(`f${n}`)) n += 1;
  return `f${n}`;
}

export function EventForm({ event, timeZones }: { event: Event | null; timeZones: string[] }) {
  const t = useTranslations("events.form");
  const tCommon = useTranslations("common");
  const tApi = useTranslations("apiErrors");
  const router = useRouter();
  const hydrated = useHydrated();
  const [draft, setDraft] = useState<Draft>(() => toDraft(event));
  const [errors, setErrors] = useState<Record<string, ErrorKey>>({});
  const [formError, setFormError] = useState<ApiErrorKey | "invalid" | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const setField = (index: number, patch: Partial<FieldDraft>) =>
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    }));

  function showIssues(issues: { path: PropertyKey[] }[]) {
    const next: Record<string, ErrorKey> = {};
    for (const issue of issues) {
      const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
      const [name, key] = errorKeyFor(path);
      next[name] ??= key;
    }
    setErrors(next);
    setFormError("invalid");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const parsed = eventInputSchema.safeParse(toPayload(draft));
    if (!parsed.success) return showIssues(parsed.error.issues);

    setErrors({});
    setFormError(null);
    setPending(true);
    const body: EventInput = parsed.data;
    const result = event
      ? await browserApi.PATCH("/api/v1/events/{eventId}", {
          params: { path: { eventId: event.id } },
          body,
        })
      : await browserApi.POST("/api/v1/events", { body });
    setPending(false);

    if (result.error) {
      const issues = problemIssues(result.error);
      return issues.length > 0 ? showIssues(issues) : setFormError(apiErrorKey(result.error));
    }
    if (event) {
      setSaved(true);
      router.refresh();
    } else {
      router.push(`/events/${result.data.id}`);
    }
  }

  const err = (name: string) => (errors[name] ? t(errors[name]) : undefined);

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {formError ? (
        <Alert tone="error">{formError === "invalid" ? t("invalid") : tApi(formError)}</Alert>
      ) : null}
      {saved ? <Alert tone="success">{t("saved")}</Alert> : null}

      <FormField
        id="name"
        label={t("name")}
        required
        maxLength={120}
        value={draft.name}
        onChange={(e) => set("name", e.target.value)}
        error={err("name")}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">
          {t("description")} <span className="text-muted-foreground">{tCommon("optional")}</span>
        </Label>
        <Textarea
          id="description"
          maxLength={5000}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="startsAt"
          type="datetime-local"
          label={t("startsAt")}
          required
          value={draft.startsLocal}
          onChange={(e) => set("startsLocal", e.target.value)}
          error={err("startsAt")}
        />
        <FormField
          id="endsAt"
          type="datetime-local"
          label={`${t("endsAt")} ${tCommon("optional")}`}
          value={draft.endsLocal}
          onChange={(e) => set("endsLocal", e.target.value)}
          error={err("endsAt")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">{t("timezone")}</Label>
        <Select
          id="timezone"
          value={draft.timezone}
          onChange={(e) => set("timezone", e.target.value)}
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="venueName"
          label={t("venueName")}
          required
          maxLength={200}
          value={draft.venueName}
          onChange={(e) => set("venueName", e.target.value)}
          error={err("venueName")}
        />
        <FormField
          id="venueAddress"
          label={`${t("venueAddress")} ${tCommon("optional")}`}
          maxLength={500}
          value={draft.venueAddress}
          onChange={(e) => set("venueAddress", e.target.value)}
        />
      </div>

      <FormField
        id="capacity"
        type="number"
        inputMode="numeric"
        min={1}
        label={`${t("capacity")} ${tCommon("optional")}`}
        hint={t("capacityHint")}
        value={draft.capacity}
        onChange={(e) => set("capacity", e.target.value)}
        error={err("capacity")}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{t("registrationMode")}</legend>
        {(["open", "closed"] as const).map((mode) => (
          <label key={mode} className="flex items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name="registrationMode"
              value={mode}
              checked={draft.registrationMode === mode}
              onChange={() => set("registrationMode", mode)}
              className="mt-1 size-4"
            />
            <span className="flex flex-col">
              <span className="font-medium">
                {mode === "open" ? t("modeOpen") : t("modeClosed")}
              </span>
              <span className="text-sm text-muted-foreground">
                {mode === "open" ? t("modeOpenHint") : t("modeClosedHint")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <FormField
        id="registrationDeadline"
        type="datetime-local"
        label={`${t("registrationDeadline")} ${tCommon("optional")}`}
        value={draft.deadlineLocal}
        onChange={(e) => set("deadlineLocal", e.target.value)}
        error={err("registrationDeadline")}
      />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">{t("fieldsTitle")}</legend>
        <p className="text-sm text-muted-foreground">
          {t("fieldsHint", { max: MAX_REGISTRATION_FIELDS })}
        </p>
        {draft.fields.map((field, index) => (
          <div key={field.key} className="flex flex-col gap-3 rounded-md border p-4">
            <FormField
              id={`field-${field.key}-label`}
              label={t("fieldLabel")}
              maxLength={100}
              value={field.label}
              onChange={(e) => setField(index, { label: e.target.value })}
              error={err(`fields.${index}.label`)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`field-${field.key}-type`}>{t("fieldType")}</Label>
                <Select
                  id={`field-${field.key}-type`}
                  value={field.type}
                  onChange={(e) => setField(index, { type: e.target.value as FieldType })}
                >
                  {(["text", "select", "checkbox"] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(`fieldTypes.${type}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 self-end pb-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={field.required}
                  onChange={(e) => setField(index, { required: e.target.checked })}
                />
                {t("fieldRequired")}
              </label>
            </div>
            {field.type === "select" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`field-${field.key}-options`}>{t("fieldOptions")}</Label>
                <Textarea
                  id={`field-${field.key}-options`}
                  value={field.optionsText}
                  aria-describedby={`field-${field.key}-options-hint`}
                  aria-invalid={errors[`fields.${index}.options`] ? true : undefined}
                  onChange={(e) => setField(index, { optionsText: e.target.value })}
                />
                <p id={`field-${field.key}-options-hint`} className="text-sm text-muted-foreground">
                  {t("fieldOptionsHint")}
                </p>
                {err(`fields.${index}.options`) ? (
                  <p className="text-sm text-destructive">{err(`fields.${index}.options`)}</p>
                ) : null}
              </div>
            ) : null}
            <Button
              variant="outline"
              className="self-start"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  fields: current.fields.filter((_, i) => i !== index),
                }))
              }
            >
              {t("removeField", { number: index + 1 })}
            </Button>
          </div>
        ))}
        {draft.fields.length < MAX_REGISTRATION_FIELDS ? (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                fields: [
                  ...current.fields,
                  {
                    key: nextFieldKey(current.fields),
                    type: "text",
                    label: "",
                    required: false,
                    optionsText: "",
                  },
                ],
              }))
            }
          >
            {t("addField")}
          </Button>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
          {event ? t("save") : t("create")}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

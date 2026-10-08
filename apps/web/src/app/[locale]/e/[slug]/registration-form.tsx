// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { registrationInputSchema, validateAnswers, type RegistrationField } from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select } from "@/components/ui/select.tsx";
import { apiErrorKey, browserApi, problemIssues, type ApiErrorKey } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

type FieldError = "required" | "invalidOption" | "invalidEmail" | "nameRequired";

export function RegistrationForm({ slug, fields }: { slug: string; fields: RegistrationField[] }) {
  const t = useTranslations("publicEvent");
  const tAuth = useTranslations("auth");
  const tApi = useTranslations("apiErrors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [errors, setErrors] = useState<Record<string, FieldError>>({});
  const [formError, setFormError] = useState<ApiErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const message = (key: FieldError) =>
    key === "invalidEmail"
      ? tAuth("errors.invalidEmail")
      : key === "nameRequired"
        ? tAuth("errors.nameRequired")
        : t(key);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const answers: Record<string, string | boolean> = {};
    for (const field of fields) {
      const value = data.get(`answer-${field.key}`);
      answers[field.key] =
        field.type === "checkbox" ? value === "on" : typeof value === "string" ? value : "";
    }

    const next: Record<string, FieldError> = {};
    const parsed = registrationInputSchema.safeParse({
      name: data.get("name"),
      email: data.get("email"),
      locale,
      answers,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "name") next.name = "nameRequired";
        if (issue.path[0] === "email") next.email = "invalidEmail";
      }
    }
    const checked = validateAnswers(fields, answers);
    if (!checked.ok) {
      for (const issue of checked.issues) {
        next[issue.key] = issue.problem === "required" ? "required" : "invalidOption";
      }
    }
    setErrors(next);
    if (!parsed.success || !checked.ok) return;

    setFormError(null);
    setPending(true);
    const { error } = await browserApi.POST("/api/v1/public/events/{slug}/registrations", {
      params: { path: { slug } },
      body: { ...parsed.data, answers: checked.answers },
    });
    setPending(false);
    if (error) {
      const fieldIssues: Record<string, FieldError> = {};
      for (const issue of problemIssues(error)) {
        if (issue.path[0] === "answers" && typeof issue.path[1] === "string") {
          fieldIssues[issue.path[1]] = issue.message === "required" ? "required" : "invalidOption";
        }
      }
      setErrors(fieldIssues);
      setFormError(apiErrorKey(error));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Alert tone="success">
        <p className="font-medium">{t("successTitle")}</p>
        <p>{t("successBody")}</p>
      </Alert>
    );
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError ? <Alert tone="error">{tApi(formError)}</Alert> : null}
      <FormField
        id="name"
        label={tAuth("fields.name")}
        autoComplete="name"
        required
        error={errors.name && message(errors.name)}
      />
      <FormField
        id="email"
        type="email"
        label={tAuth("fields.email")}
        autoComplete="email"
        required
        error={errors.email && message(errors.email)}
      />

      {fields.map((field) => {
        const id = `answer-${field.key}`;
        const error = errors[field.key] && message(errors[field.key]!);
        const label = field.required ? field.label : `${field.label} ${tCommon("optional")}`;
        if (field.type === "text") {
          return (
            <FormField
              key={field.key}
              id={id}
              label={label}
              maxLength={500}
              required={field.required}
              error={error}
            />
          );
        }
        if (field.type === "select") {
          return (
            <div key={field.key} className="flex flex-col gap-2">
              <Label htmlFor={id}>{label}</Label>
              <Select
                id={id}
                name={id}
                defaultValue=""
                required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              >
                <option value="">{t("selectPlaceholder")}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              {error ? (
                <p id={`${id}-error`} className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={field.key} className="flex flex-col gap-1">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name={id}
                className="mt-1 size-4"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              <span>{label}</span>
            </label>
            {error ? (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}

      <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}

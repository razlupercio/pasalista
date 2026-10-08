// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, signUpInputSchema } from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors.ts";

type FieldErrors = Partial<Record<"name" | "email" | "password", AuthErrorKey>>;

export function SignUpForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<AuthErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = signUpInputSchema.safeParse({
      name: data.get("name"),
      email: data.get("email"),
      password: data.get("password"),
      locale,
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name") errors.name = "nameRequired";
        if (field === "email") errors.email = "invalidEmail";
        if (field === "password")
          errors.password = issue.code === "too_big" ? "passwordTooLong" : "passwordTooShort";
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setPending(true);
    const { error } = await authClient.signUp.email({
      ...parsed.data,
      callbackURL: `/${locale}/dashboard`,
    });
    setPending(false);
    // An existing account gets the same answer, so the form does not reveal registered emails.
    if (
      error &&
      error.code !== "USER_ALREADY_EXISTS" &&
      error.code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
    ) {
      setFormError(authErrorKey(error));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Alert tone="success">
        <p className="font-medium">{t("signUp.checkInboxTitle")}</p>
        <p>{t("signUp.checkInbox")}</p>
      </Alert>
    );
  }

  const limits = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH };
  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError ? <Alert tone="error">{t(`errors.${formError}`, limits)}</Alert> : null}
      <FormField
        id="name"
        label={t("fields.name")}
        autoComplete="name"
        required
        error={fieldErrors.name && t(`errors.${fieldErrors.name}`, limits)}
      />
      <FormField
        id="email"
        type="email"
        label={t("fields.email")}
        autoComplete="email"
        required
        error={fieldErrors.email && t(`errors.${fieldErrors.email}`, limits)}
      />
      <FormField
        id="password"
        type="password"
        label={t("fields.password")}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={t("fields.passwordHint", limits)}
        error={fieldErrors.password && t(`errors.${fieldErrors.password}`, limits)}
      />
      <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
        {t("signUp.submit")}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t("signUp.haveAccount")}{" "}
        <Link href="/sign-in" className="text-foreground underline underline-offset-4">
          {t("signIn.submit")}
        </Link>
      </p>
    </form>
  );
}

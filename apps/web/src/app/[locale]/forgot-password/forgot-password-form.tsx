// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  forgotPasswordInputSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors.ts";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = forgotPasswordInputSchema.safeParse({
      email: new FormData(event.currentTarget).get("email"),
    });
    if (!parsed.success) return setError("invalidEmail");
    setError(null);
    setPending(true);
    const result = await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: `/${locale}/reset-password`,
    });
    setPending(false);
    if (result.error) return setError(authErrorKey(result.error));
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t("forgotPassword.sent")}</Alert>
        <Link href="/sign-in" className="text-sm underline underline-offset-4">
          {t("forgotPassword.backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? (
        <Alert tone="error">
          {t(`errors.${error}`, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })}
        </Alert>
      ) : null}
      <FormField id="email" type="email" label={t("fields.email")} autoComplete="email" required />
      <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
        {t("forgotPassword.submit")}
      </Button>
      <Link href="/sign-in" className="text-sm underline underline-offset-4">
        {t("forgotPassword.backToSignIn")}
      </Link>
    </form>
  );
}

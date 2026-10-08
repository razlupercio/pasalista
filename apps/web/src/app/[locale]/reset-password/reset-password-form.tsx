// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  resetPasswordInputSchema,
} from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors.ts";

const limits = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH };

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = resetPasswordInputSchema.safeParse({
      password: new FormData(event.currentTarget).get("password"),
    });
    if (!parsed.success) {
      return setError(
        parsed.error.issues[0]?.code === "too_big" ? "passwordTooLong" : "passwordTooShort",
      );
    }
    setError(null);
    setPending(true);
    const result = await authClient.resetPassword({ newPassword: parsed.data.password, token });
    setPending(false);
    if (result.error) return setError(authErrorKey(result.error));
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t("resetPassword.success")}</Alert>
        <Link href="/sign-in" className="text-sm underline underline-offset-4">
          {t("signIn.submit")}
        </Link>
      </div>
    );
  }

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? <Alert tone="error">{t(`errors.${error}`, limits)}</Alert> : null}
      <FormField
        id="password"
        type="password"
        label={t("fields.newPassword")}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={t("fields.passwordHint", limits)}
      />
      <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
        {t("resetPassword.submit")}
      </Button>
    </form>
  );
}

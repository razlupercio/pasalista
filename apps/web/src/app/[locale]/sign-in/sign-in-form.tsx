// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  magicLinkInputSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signInInputSchema,
} from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Link, useRouter } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth-errors.ts";

type Notice = {
  tone: "error" | "success";
  key: AuthErrorKey | "magicLinkSent" | "verificationResent";
};

export function SignInForm({ linkInvalid, next }: { linkInvalid: boolean; next: string | null }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "magicLink">("password");
  const [notice, setNotice] = useState<Notice | null>(
    linkInvalid ? { tone: "error", key: "linkInvalid" } : null,
  );
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const destination = next ?? "/dashboard";
  const callbackURL = `/${locale}${destination}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setNotice(null);
    setUnverifiedEmail(null);

    if (mode === "magicLink") {
      const parsed = magicLinkInputSchema.safeParse({ email: data.get("email") });
      if (!parsed.success) return setNotice({ tone: "error", key: "invalidEmail" });
      setPending(true);
      const { error } = await authClient.signIn.magicLink({
        email: parsed.data.email,
        callbackURL,
        errorCallbackURL: `/${locale}/sign-in?error=link`,
      });
      setPending(false);
      return setNotice(
        error
          ? { tone: "error", key: authErrorKey(error) }
          : { tone: "success", key: "magicLinkSent" },
      );
    }

    const parsed = signInInputSchema.safeParse({
      email: data.get("email"),
      password: data.get("password"),
    });
    if (!parsed.success) return setNotice({ tone: "error", key: "invalidCredentials" });
    setPending(true);
    const { error } = await authClient.signIn.email({ ...parsed.data, callbackURL });
    setPending(false);
    if (error) {
      const key = authErrorKey(error);
      if (key === "emailNotVerified") setUnverifiedEmail(parsed.data.email);
      return setNotice({ tone: "error", key });
    }
    router.replace(destination);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    setPending(true);
    await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL });
    setPending(false);
    setUnverifiedEmail(null);
    setNotice({ tone: "success", key: "verificationResent" });
  }

  const noticeText = (n: Notice) =>
    n.key === "magicLinkSent" || n.key === "verificationResent"
      ? t(`signIn.${n.key}`)
      : t(`errors.${n.key}`, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {notice ? <Alert tone={notice.tone}>{noticeText(notice)}</Alert> : null}
      {unverifiedEmail ? (
        <Button variant="outline" onClick={resendVerification} disabled={pending}>
          {t("signIn.resendVerification")}
        </Button>
      ) : null}
      <FormField id="email" type="email" label={t("fields.email")} autoComplete="email" required />
      {mode === "password" ? (
        <FormField
          id="password"
          type="password"
          label={t("fields.password")}
          autoComplete="current-password"
          required
        />
      ) : null}
      <Button type="submit" disabled={!hydrated || pending} aria-busy={pending}>
        {mode === "password" ? t("signIn.submit") : t("signIn.magicLinkSubmit")}
      </Button>
      <Button
        variant="link"
        onClick={() => setMode(mode === "password" ? "magicLink" : "password")}
      >
        {mode === "password" ? t("signIn.useMagicLink") : t("signIn.usePassword")}
      </Button>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
          {t("signIn.forgotPassword")}
        </Link>
        <p>
          {t("signIn.noAccount")}{" "}
          <Link
            href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}
            className="text-foreground underline underline-offset-4"
          >
            {t("signUp.submit")}
          </Link>
        </p>
      </div>
    </form>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert } from "@/components/ui/alert.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { ResetPasswordForm } from "./reset-password-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("title") };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const [{ locale: rawLocale }, { token, error }] = await Promise.all([params, searchParams]);
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("auth");

  return (
    <Card className="mx-auto max-w-md">
      <CardTitle className="mb-6">{t("resetPassword.title")}</CardTitle>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="flex flex-col gap-4">
          <Alert tone="error">{t("errors.linkInvalid")}</Alert>
          <Link href="/forgot-password" className="text-sm underline underline-offset-4">
            {t("forgotPassword.title")}
          </Link>
        </div>
      )}
    </Card>
  );
}

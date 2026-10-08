// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { ForgotPasswordForm } from "./forgot-password-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("title") };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("auth.forgotPassword");
  return (
    <Card className="mx-auto max-w-md">
      <CardTitle className="mb-2">{t("title")}</CardTitle>
      <p className="mb-6 text-sm text-muted-foreground">{t("description")}</p>
      <ForgotPasswordForm />
    </Card>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { SignUpForm } from "./sign-up-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp");
  return { title: t("title") };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("auth.signUp");
  return (
    <Card className="mx-auto max-w-md">
      <CardTitle className="mb-6">{t("title")}</CardTitle>
      <SignUpForm />
    </Card>
  );
}

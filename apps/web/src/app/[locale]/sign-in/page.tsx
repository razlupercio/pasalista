// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { safeNextPath } from "@/lib/next-path.ts";
import { SignInForm } from "./sign-in-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [{ locale: rawLocale }, { error, next }] = await Promise.all([params, searchParams]);
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("auth.signIn");
  return (
    <Card className="mx-auto max-w-md">
      <CardTitle className="mb-6">{t("title")}</CardTitle>
      <SignInForm linkInvalid={error !== undefined} next={safeNextPath(next)} />
    </Card>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { getSession } from "@/lib/session.ts";
import { AcceptStaffInvitation } from "./accept-staff-invitation.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invitations");
  return { title: t("staffTitle"), robots: { index: false, follow: false } };
}

export default async function StaffInvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("invitations");
  const tNav = await getTranslations("nav");

  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const api = await serverApi();
  const [{ data: invitation }, session] = await Promise.all([
    valid
      ? api.GET("/api/v1/staff-invitations/{token}", { params: { path: { token } } })
      : Promise.resolve({ data: undefined }),
    getSession(),
  ]);
  const here = `/invitations/staff/${token}`;

  return (
    <Card className="mx-auto flex max-w-md flex-col gap-4">
      <CardTitle>{t("staffTitle")}</CardTitle>
      {!invitation ? (
        <Alert tone="error">{t("notFound")}</Alert>
      ) : (
        <>
          <p>
            {t("staffBody", { organizer: invitation.organizerName, event: invitation.eventName })}
          </p>
          {invitation.state !== "pending" ? (
            <Alert tone="error">{t(`states.${invitation.state}`)}</Alert>
          ) : !session ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("forEmail", { email: invitation.email })} {t("signInToAccept")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/sign-in?next=${encodeURIComponent(here)}`}
                  className={buttonVariants()}
                >
                  {tNav("signIn")}
                </Link>
                <Link
                  href={`/sign-up?next=${encodeURIComponent(here)}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  {tNav("signUp")}
                </Link>
              </div>
            </>
          ) : session.user.email.toLowerCase() !== invitation.email ? (
            <>
              <Alert tone="error">{t("wrongAccount", { email: invitation.email })}</Alert>
              <SignOutButton />
            </>
          ) : (
            <AcceptStaffInvitation token={token} eventName={invitation.eventName} />
          )}
        </>
      )}
    </Card>
  );
}

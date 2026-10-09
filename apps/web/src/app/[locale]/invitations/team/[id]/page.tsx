// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert } from "@/components/ui/alert.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { authGet, getSession, type MemberRole } from "@/lib/session.ts";
import { RespondTeamInvitation } from "./respond-team-invitation.tsx";

interface TeamInvitation {
  id: string;
  email: string;
  role: MemberRole;
  status: string;
  organizationId: string;
  organizationName: string;
  inviterEmail: string;
}

/** Better Auth only returns the invitation to the signed-in invitee (email must match). */
function loadInvitation(id: string): Promise<TeamInvitation | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(null);
  return authGet<TeamInvitation>(`/organization/get-invitation?id=${encodeURIComponent(id)}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invitations");
  return { title: t("teamTitle"), robots: { index: false, follow: false } };
}

export default async function TeamInvitationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  const [t, tNav, tTeam, session] = await Promise.all([
    getTranslations("invitations"),
    getTranslations("nav"),
    getTranslations("team"),
    getSession(),
  ]);
  const here = `/invitations/team/${id}`;
  const invitation = session ? await loadInvitation(id) : null;

  return (
    <Card className="mx-auto flex max-w-md flex-col gap-4">
      <CardTitle>{t("teamTitle")}</CardTitle>
      {!session ? (
        <>
          <p className="text-sm text-muted-foreground">{t("signInToAccept")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonVariants()}>
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
      ) : !invitation ? (
        <Alert tone="error">{t("notFound")}</Alert>
      ) : invitation.status !== "pending" ? (
        <Alert tone="error">{t("states.revoked")}</Alert>
      ) : (
        <>
          <p>
            {t("teamBody", {
              inviter: invitation.inviterEmail,
              organization: invitation.organizationName,
              role: tTeam(`roles.${invitation.role}`),
            })}
          </p>
          <RespondTeamInvitation
            invitationId={invitation.id}
            organizationId={invitation.organizationId}
            organizationName={invitation.organizationName}
          />
        </>
      )}
    </Card>
  );
}

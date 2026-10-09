// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

export function RespondTeamInvitation({
  invitationId,
  organizationId,
  organizationName,
}: {
  invitationId: string;
  organizationId: string;
  organizationName: string;
}) {
  const t = useTranslations("invitations");
  const tApi = useTranslations("apiErrors");
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "error" | null>(null);

  async function respond(accept: boolean) {
    setPending(true);
    const result = accept
      ? await authClient.organization.acceptInvitation({ invitationId })
      : await authClient.organization.rejectInvitation({ invitationId });
    if (!result.error && accept) await authClient.organization.setActive({ organizationId });
    setPending(false);
    setOutcome(result.error ? "error" : accept ? "accepted" : "rejected");
  }

  if (outcome === "accepted" || outcome === "rejected") {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">
          {outcome === "accepted"
            ? t("teamAccepted", { organization: organizationName })
            : t("rejected")}
        </Alert>
        <Link href="/dashboard" className={buttonVariants()}>
          {t("goToDashboard")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {outcome === "error" ? <Alert tone="error">{tApi("generic")}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!hydrated || pending} onClick={() => respond(true)}>
          {t("accept")}
        </Button>
        <Button variant="outline" disabled={!hydrated || pending} onClick={() => respond(false)}>
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}

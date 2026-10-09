// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi, type ApiErrorKey } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

export function AcceptStaffInvitation({ token, eventName }: { token: string; eventName: string }) {
  const t = useTranslations("invitations");
  const tApi = useTranslations("apiErrors");
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<ApiErrorKey | null>(null);

  if (accepted) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success">{t("staffAccepted", { event: eventName })}</Alert>
        <Link href="/dashboard" className={buttonVariants()}>
          {t("goToDashboard")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="error">{tApi(error)}</Alert> : null}
      <Button
        disabled={!hydrated || pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          const result = await browserApi.POST("/api/v1/staff-invitations/{token}/accept", {
            params: { path: { token } },
          });
          setPending(false);
          if (result.error) return setError(apiErrorKey(result.error));
          setAccepted(true);
        }}
      >
        {t("accept")}
      </Button>
    </div>
  );
}

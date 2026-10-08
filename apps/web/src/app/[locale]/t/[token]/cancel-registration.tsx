// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi, type ApiErrorKey } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

export function CancelRegistration({ token }: { token: string }) {
  const t = useTranslations("ticket");
  const tApi = useTranslations("apiErrors");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorKey | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert tone="error">{tApi(error)}</Alert> : null}
      <Button
        variant="ghost"
        className="px-0 text-destructive"
        disabled={!hydrated || pending}
        onClick={async () => {
          if (!window.confirm(t("cancelConfirm"))) return;
          setPending(true);
          const result = await browserApi.POST("/api/v1/public/tickets/{accessToken}/cancel", {
            params: { path: { accessToken: token } },
          });
          setPending(false);
          if (result.error) return setError(apiErrorKey(result.error));
          router.refresh();
        }}
      >
        {t("cancel")}
      </Button>
    </div>
  );
}

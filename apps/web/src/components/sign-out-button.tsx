// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";

export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace("/");
          router.refresh();
        })
      }
    >
      {t("signOut")}
    </Button>
  );
}

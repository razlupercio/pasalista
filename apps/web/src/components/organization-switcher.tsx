// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Label } from "@/components/ui/label.tsx";
import { Select } from "@/components/ui/select.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";

export interface OrganizationOption {
  id: string;
  name: string;
}

/** Changes the session's active organization (Better Auth) and reloads server data. */
export function OrganizationSwitcher({
  organizations,
  activeId,
}: {
  organizations: OrganizationOption[];
  activeId: string | null;
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (organizations.length < 2) return null;

  return (
    <div className="flex flex-col gap-2 sm:max-w-xs">
      <Label htmlFor="active-organization">{t("activeOrganization")}</Label>
      <Select
        id="active-organization"
        value={activeId ?? ""}
        disabled={pending}
        onChange={(event) => {
          const organizationId = event.target.value;
          startTransition(async () => {
            await authClient.organization.setActive({ organizationId });
            router.refresh();
          });
        }}
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

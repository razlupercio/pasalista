// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { Attendee } from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

type Action = "reissue" | "revoke" | "cancel";

const endpoints = {
  reissue: "/api/v1/attendees/{attendeeId}/ticket/reissue",
  revoke: "/api/v1/attendees/{attendeeId}/ticket/revoke",
  cancel: "/api/v1/attendees/{attendeeId}/cancel",
} as const;

export function AttendeesTable({ attendees }: { attendees: Attendee[] }) {
  const t = useTranslations("events.attendees");
  const tApi = useTranslations("apiErrors");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  if (attendees.length === 0) return <p className="text-muted-foreground">{t("empty")}</p>;

  async function act(attendee: Attendee, action: Action) {
    if (!window.confirm(t(`${action}Confirm`))) return;
    setPending(attendee.id);
    setNotice(null);
    const { error } = await browserApi.POST(endpoints[action], {
      params: { path: { attendeeId: attendee.id } },
    });
    setPending(null);
    setNotice(
      error
        ? { tone: "error", text: tApi(apiErrorKey(error)) }
        : { tone: "success", text: t("done") },
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("name")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("email")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("status")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("ticket")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {attendees.map((attendee) => {
              const active = attendee.status === "active";
              const busy = !hydrated || pending !== null;
              return (
                <tr key={attendee.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{attendee.name}</td>
                  <td className="px-3 py-2 break-all">{attendee.email}</td>
                  <td className="px-3 py-2">{t(`statuses.${attendee.status}`)}</td>
                  <td className="px-3 py-2">
                    {t(`ticketStatuses.${attendee.ticketStatus ?? "none"}`)}
                  </td>
                  <td className="px-3 py-2">
                    {active ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="min-h-9 px-3"
                          disabled={busy}
                          onClick={() => act(attendee, "reissue")}
                        >
                          {t("reissue")}
                        </Button>
                        {attendee.ticketStatus === "active" ? (
                          <Button
                            variant="outline"
                            className="min-h-9 px-3"
                            disabled={busy}
                            onClick={() => act(attendee, "revoke")}
                          >
                            {t("revoke")}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          className="min-h-9 px-3"
                          disabled={busy}
                          onClick={() => act(attendee, "cancel")}
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

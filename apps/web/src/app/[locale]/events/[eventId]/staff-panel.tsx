// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { emailSchema, type StaffOverview } from "@pasalista/core";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

export function StaffPanel({ eventId, staff }: { eventId: string; staff: StaffOverview }) {
  const t = useTranslations("events.staff");
  const tApi = useTranslations("apiErrors");
  const tAuth = useTranslations("auth");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<{ error?: unknown }>, success?: string) {
    setBusy(true);
    setNotice(null);
    const { error } = await action();
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: tApi(apiErrorKey(error)) });
    if (success) setNotice({ tone: "success", text: success });
    router.refresh();
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = emailSchema.safeParse(new FormData(form).get("staff-email"));
    if (!email.success) return setNotice({ tone: "error", text: tAuth("errors.invalidEmail") });
    await run(
      () =>
        browserApi.POST("/api/v1/events/{eventId}/staff/invitations", {
          params: { path: { eventId } },
          body: { email: email.data, locale },
        }),
      t("invited"),
    );
    form.reset();
  }

  const disabled = !hydrated || busy;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <form
        method="post"
        noValidate
        onSubmit={invite}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <FormField id="staff-email" type="email" label={t("email")} autoComplete="off" required />
        </div>
        <Button type="submit" disabled={disabled}>
          {t("invite")}
        </Button>
      </form>

      {staff.members.length === 0 && staff.invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}

      {staff.members.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t("members")}</h3>
          <ul className="flex flex-col gap-2">
            {staff.members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {member.name} <span className="text-muted-foreground">({member.email})</span>
                </span>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3"
                  disabled={disabled}
                  onClick={() => {
                    if (!window.confirm(t("removeConfirm", { name: member.name }))) return;
                    void run(() =>
                      browserApi.DELETE("/api/v1/events/{eventId}/staff/{userId}", {
                        params: { path: { eventId, userId: member.userId } },
                      }),
                    );
                  }}
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {staff.invitations.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t("pending")}</h3>
          <ul className="flex flex-col gap-2">
            {staff.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {invitation.email}{" "}
                  <span className="text-muted-foreground">
                    {t("expires", {
                      date: format.dateTime(new Date(invitation.expiresAt), {
                        dateStyle: "medium",
                      }),
                    })}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3"
                  disabled={disabled}
                  onClick={() =>
                    run(() =>
                      browserApi.DELETE(
                        "/api/v1/events/{eventId}/staff/invitations/{invitationId}",
                        {
                          params: { path: { eventId, invitationId: invitation.id } },
                        },
                      ),
                    )
                  }
                >
                  {t("revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

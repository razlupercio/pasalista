// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { emailSchema } from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select } from "@/components/ui/select.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { authClient } from "@/lib/auth-client.ts";
import type { ApiErrorKey } from "@/lib/api-browser.ts";
import type { FullOrganization } from "@/lib/session.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { formText } from "@/lib/utils.ts";

type Notice = { tone: "success" | "error"; text: string };

/** Better Auth organization errors to our generic API messages. */
function orgErrorKey(error: { status?: number; code?: string | undefined }): ApiErrorKey {
  if (error.status === 429) return "rate_limited";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  if (error.code?.includes("ALREADY")) return "conflict";
  return "generic";
}

function slugFor(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

export function TeamManager({
  organization,
  currentUserId,
}: {
  organization: FullOrganization | null;
  currentUserId: string;
}) {
  const t = useTranslations("team");
  const tApi = useTranslations("apiErrors");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const me = organization?.members.find((m) => m.userId === currentUserId);
  const canManage = me?.role === "owner" || me?.role === "admin";
  const disabled = !hydrated || busy;
  const pendingInvitations = organization?.invitations.filter((i) => i.status === "pending") ?? [];

  async function run(action: () => Promise<{ error: unknown }>, success?: string) {
    setBusy(true);
    setNotice(null);
    const { error } = await action();
    setBusy(false);
    if (error) {
      setNotice({
        tone: "error",
        text: tApi(orgErrorKey(error as { status?: number; code?: string })),
      });
      return false;
    }
    if (success) setNotice({ tone: "success", text: success });
    router.refresh();
    return true;
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = emailSchema.safeParse(data.get("invite-email"));
    if (!email.success) return setNotice({ tone: "error", text: tAuth("errors.invalidEmail") });
    const role = data.get("invite-role") === "admin" ? "admin" : "member";
    const ok = await run(
      () => authClient.organization.inviteMember({ email: email.data, role }),
      t("invited", { email: email.data }),
    );
    if (ok) form.reset();
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formText(new FormData(event.currentTarget), "org-name").trim();
    if (!name) return;
    await run(async () => {
      const created = await authClient.organization.create({ name, slug: slugFor(name) });
      if (created.error || !created.data) return { error: created.error ?? {} };
      return authClient.organization.setActive({ organizationId: created.data.id });
    }, t("created"));
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {organization ? (
        <Card className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("organization")}</p>
            <p className="text-lg font-semibold">
              {organization.name}
              {organization.isPersonal ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({t("personal")})
                </span>
              ) : null}
            </p>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">{t("members")}</h2>
            <ul className="flex flex-col gap-2">
              {organization.members.map((member) => {
                const isMe = member.userId === currentUserId;
                const editable = canManage && !isMe && member.role !== "owner";
                return (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <span>
                      {member.user.name}{" "}
                      {isMe ? <span className="text-muted-foreground">{t("you")}</span> : null}
                      <br />
                      <span className="text-muted-foreground">{member.user.email}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {editable ? (
                        <>
                          <Label htmlFor={`role-${member.id}`} className="sr-only">
                            {t("makeRole")}
                          </Label>
                          <Select
                            id={`role-${member.id}`}
                            className="min-h-9 w-auto"
                            value={member.role}
                            disabled={disabled}
                            onChange={(e) =>
                              run(() =>
                                authClient.organization.updateMemberRole({
                                  memberId: member.id,
                                  role: e.target.value,
                                }),
                              )
                            }
                          >
                            {(["admin", "member"] as const).map((role) => (
                              <option key={role} value={role}>
                                {t(`roles.${role}`)}
                              </option>
                            ))}
                          </Select>
                          <Button
                            variant="ghost"
                            className="min-h-9 px-3"
                            disabled={disabled}
                            onClick={() => {
                              if (!window.confirm(t("removeConfirm", { name: member.user.name })))
                                return;
                              void run(() =>
                                authClient.organization.removeMember({
                                  memberIdOrEmail: member.id,
                                }),
                              );
                            }}
                          >
                            {t("remove")}
                          </Button>
                        </>
                      ) : (
                        <span className="rounded-full border px-2.5 py-0.5 text-xs">
                          {t(`roles.${member.role}`)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {canManage ? (
            <form
              method="post"
              noValidate
              onSubmit={invite}
              className="flex flex-col gap-3 rounded-md border p-4"
            >
              <h2 className="font-medium">{t("invite")}</h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <FormField
                  id="invite-email"
                  type="email"
                  label={t("inviteEmail")}
                  autoComplete="off"
                  required
                />
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-role">{t("inviteRole")}</Label>
                  <Select id="invite-role" name="invite-role" defaultValue="member">
                    {(["member", "admin"] as const).map((role) => (
                      <option key={role} value={role}>
                        {t(`roles.${role}`)} · {t(`roleHints.${role}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <Button type="submit" className="self-start" disabled={disabled}>
                {t("inviteSubmit")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{t("onlyAdmins")}</p>
          )}

          {pendingInvitations.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium">{t("pending")}</h2>
              <ul className="flex flex-col gap-2">
                {pendingInvitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span>
                      {invitation.email}{" "}
                      <span className="text-muted-foreground">
                        · {t(`roles.${invitation.role}`)}
                      </span>
                    </span>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        className="min-h-9 px-3"
                        disabled={disabled}
                        onClick={() =>
                          run(() =>
                            authClient.organization.cancelInvitation({
                              invitationId: invitation.id,
                            }),
                          )
                        }
                      >
                        {t("cancelInvitation")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!organization.isPersonal && me?.role !== "owner" ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={disabled}
              onClick={() => {
                if (!window.confirm(t("leaveConfirm", { organization: organization.name }))) return;
                void run(() => authClient.organization.leave({ organizationId: organization.id }));
              }}
            >
              {t("leave")}
            </Button>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <form
          method="post"
          noValidate
          onSubmit={createOrganization}
          className="flex flex-col gap-3"
        >
          <h2 className="font-medium">{t("newOrganization")}</h2>
          <FormField id="org-name" label={t("newOrganizationName")} maxLength={80} required />
          <Button type="submit" className="self-start" disabled={disabled}>
            {t("create")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

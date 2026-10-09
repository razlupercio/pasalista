// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  guestInputSchema,
  type Attendee,
  type AttendeeList,
  type AttendeeListQuery,
  type EventStatus,
} from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select } from "@/components/ui/select.tsx";
import { Link, useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { formText } from "@/lib/utils.ts";

const PAGE_SIZE = 50;
type Filters = Pick<AttendeeListQuery, "q" | "status" | "ticket">;
type Action = "reissue" | "resend" | "revoke" | "cancel";

const endpoints = {
  reissue: "/api/v1/attendees/{attendeeId}/ticket/reissue",
  resend: "/api/v1/attendees/{attendeeId}/ticket/resend",
  revoke: "/api/v1/attendees/{attendeeId}/ticket/revoke",
  cancel: "/api/v1/attendees/{attendeeId}/cancel",
} as const;

export function GuestList({
  eventId,
  eventStatus,
  initial,
}: {
  eventId: string;
  eventStatus: EventStatus;
  initial: AttendeeList;
}) {
  const t = useTranslations("events.attendees");
  const tCommon = useTranslations("common");
  const tApi = useTranslations("apiErrors");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [data, setData] = useState<AttendeeList>(initial);
  const [filters, setFilters] = useState<Filters>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  async function load(next: Filters, offset = 0) {
    setBusy(true);
    const { data: page, error } = await browserApi.GET("/api/v1/events/{eventId}/attendees", {
      params: {
        path: { eventId },
        query: { ...next, q: next.q || undefined, limit: PAGE_SIZE, offset },
      },
    });
    setBusy(false);
    if (error || !page) return setNotice({ tone: "error", text: tApi(apiErrorKey(error)) });
    setData((current) =>
      offset === 0 ? page : { ...page, items: [...current.items, ...page.items] },
    );
  }

  function applyFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  }

  async function refresh(text: string) {
    setNotice({ tone: "success", text });
    await load(filters);
    router.refresh();
  }

  async function act(attendee: Attendee, action: Action) {
    // Sending a pending invitation needs no confirmation; replacing or revoking a ticket does.
    const needsConfirm = !(action === "reissue" && attendee.ticketStatus === null);
    if (needsConfirm && !window.confirm(t(`${action}Confirm`))) return;
    setBusy(true);
    setNotice(null);
    const { error } = await browserApi.POST(endpoints[action], {
      params: { path: { attendeeId: attendee.id } },
    });
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: tApi(apiErrorKey(error)) });
    await refresh(t("done"));
  }

  async function sendAll() {
    if (!window.confirm(t("sendConfirm", { count: data.pendingCount }))) return;
    setBusy(true);
    setNotice(null);
    const { data: result, error } = await browserApi.POST(
      "/api/v1/events/{eventId}/invitations/send",
      {
        params: { path: { eventId } },
      },
    );
    setBusy(false);
    if (error || !result) return setNotice({ tone: "error", text: tApi(apiErrorKey(error)) });
    await refresh(t("sent", { count: result.sent }));
  }

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = guestInputSchema.safeParse({
      name: values.get("guest-name"),
      email: values.get("guest-email"),
      locale: values.get("guest-locale"),
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return setNotice({
        tone: "error",
        text: field === "name" ? tAuth("errors.nameRequired") : tAuth("errors.invalidEmail"),
      });
    }
    setBusy(true);
    const { error } = await browserApi.POST("/api/v1/events/{eventId}/attendees", {
      params: { path: { eventId } },
      body: parsed.data,
    });
    setBusy(false);
    if (error) return setNotice({ tone: "error", text: tApi(apiErrorKey(error)) });
    form.reset();
    await refresh(t("added"));
  }

  const disabled = !hydrated || busy;
  const filtered = Boolean(filters.q || filters.status || filters.ticket);

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {t("add")}
        </Button>
        <Link href={`/events/${eventId}/import`} className={buttonVariants({ variant: "outline" })}>
          {t("import")}
        </Link>
        {data.pendingCount > 0 ? (
          <Button disabled={disabled || eventStatus !== "published"} onClick={sendAll}>
            {t("send", { count: data.pendingCount })}
          </Button>
        ) : null}
      </div>
      {data.pendingCount > 0 && eventStatus !== "published" ? (
        <p className="text-sm text-muted-foreground">{t("sendNeedsPublish")}</p>
      ) : null}

      {adding ? (
        <form
          method="post"
          noValidate
          onSubmit={addGuest}
          className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
        >
          <FormField id="guest-name" label={tAuth("fields.name")} autoComplete="off" required />
          <FormField
            id="guest-email"
            type="email"
            label={tAuth("fields.email")}
            autoComplete="off"
            required
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="guest-locale">{t("locale")}</Label>
            <Select id="guest-locale" name="guest-locale" defaultValue={locale}>
              <option value="es-MX">{tCommon("languages.es-MX")}</option>
              <option value="en">{tCommon("languages.en")}</option>
            </Select>
          </div>
          <Button type="submit" disabled={disabled}>
            {t("addSubmit")}
          </Button>
        </form>
      ) : null}

      <form
        role="search"
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters({ q: formText(new FormData(e.currentTarget), "q").trim() });
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="q">{t("search")}</Label>
          <Input id="q" name="q" type="search" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-status">{t("filterStatus")}</Label>
          <Select
            id="filter-status"
            value={filters.status ?? ""}
            onChange={(e) =>
              applyFilters({ status: (e.target.value || undefined) as Filters["status"] })
            }
          >
            <option value="">{tCommon("all")}</option>
            <option value="active">{t("statuses.active")}</option>
            <option value="cancelled">{t("statuses.cancelled")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="filter-ticket">{t("filterTicket")}</Label>
          <Select
            id="filter-ticket"
            value={filters.ticket ?? ""}
            onChange={(e) =>
              applyFilters({ ticket: (e.target.value || undefined) as Filters["ticket"] })
            }
          >
            <option value="">{tCommon("all")}</option>
            {(["pending", "active", "superseded", "revoked"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`ticketStatuses.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </form>

      {data.items.length === 0 ? (
        <p className="text-muted-foreground">{filtered ? t("noResults") : t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" aria-busy={busy}>
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {(["name", "email", "status", "ticket", "actions"] as const).map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 font-medium">
                    {t(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((attendee) => (
                <GuestRow
                  key={attendee.id}
                  attendee={attendee}
                  disabled={disabled}
                  onAction={act}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{t("showing", { shown: data.items.length, total: data.total })}</span>
        {data.items.length < data.total ? (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => load(filters, data.items.length)}
          >
            {t("loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GuestRow({
  attendee,
  disabled,
  onAction,
}: {
  attendee: Attendee;
  disabled: boolean;
  onAction: (attendee: Attendee, action: Action) => void;
}) {
  const t = useTranslations("events.attendees");
  const active = attendee.status === "active";
  const ticket = attendee.ticketStatus;
  const small = "min-h-9 px-3";

  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">{attendee.name}</td>
      <td className="px-3 py-2 break-all">{attendee.email}</td>
      <td className="px-3 py-2">{t(`statuses.${attendee.status}`)}</td>
      <td className="px-3 py-2">{t(`ticketStatuses.${ticket ?? "pending"}`)}</td>
      <td className="px-3 py-2">
        {active ? (
          <div className="flex flex-wrap gap-2">
            {ticket === null ? (
              <Button
                variant="outline"
                className={small}
                disabled={disabled}
                onClick={() => onAction(attendee, "reissue")}
              >
                {t("sendOne")}
              </Button>
            ) : null}
            {ticket === "active" ? (
              <>
                <Button
                  variant="outline"
                  className={small}
                  disabled={disabled}
                  onClick={() => onAction(attendee, "resend")}
                >
                  {t("resend")}
                </Button>
                <Button
                  variant="outline"
                  className={small}
                  disabled={disabled}
                  onClick={() => onAction(attendee, "revoke")}
                >
                  {t("revoke")}
                </Button>
              </>
            ) : null}
            {ticket !== null ? (
              <Button
                variant="outline"
                className={small}
                disabled={disabled}
                onClick={() => onAction(attendee, "reissue")}
              >
                {t("reissue")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className={small}
              disabled={disabled}
              onClick={() => onAction(attendee, "cancel")}
            >
              {t("cancel")}
            </Button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

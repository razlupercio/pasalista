// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  MAX_IMPORT_ROWS,
  planGuestImport,
  readGuestList,
  type ImportReport,
  type RawGuest,
} from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Link } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

type Problem = ImportReport["skipped"][number];

const MAX_FILE_BYTES = 1024 * 1024;

export function ImportGuests({ eventId }: { eventId: string }) {
  const t = useTranslations("events.import");
  const tApi = useTranslations("apiErrors");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [rows, setRows] = useState<RawGuest[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState(false);

  const plan = rows ? planGuestImport(rows, locale) : null;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    setRows(null);
    setFileError(null);
    setSubmitError(null);
    setReport(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setFileError(t("fileTooLarge"));
    let parsed: RawGuest[] | null;
    try {
      parsed = readGuestList(await file.text());
    } catch {
      return setFileError(t("unreadable"));
    }
    if (parsed === null) return setFileError(t("missingColumns"));
    if (parsed.length === 0) return setFileError(t("empty"));
    if (parsed.length > MAX_IMPORT_ROWS) {
      return setFileError(t("tooMany", { count: parsed.length, max: MAX_IMPORT_ROWS }));
    }
    setRows(parsed);
  }

  async function submit() {
    if (!rows || !plan) return;
    setPending(true);
    setSubmitError(null);
    // The API re-validates every row; the preview only helps fix the file first.
    const { data, error } = await browserApi.POST("/api/v1/events/{eventId}/attendees/import", {
      params: { path: { eventId } },
      body: { rows, defaultLocale: locale },
    });
    setPending(false);
    if (error || !data) return setSubmitError(tApi(apiErrorKey(error)));
    setReport(data);
    setRows(null);
  }

  if (report) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">
          <p className="font-medium">{t("done", { count: report.added })}</p>
          <p>{t("doneHint")}</p>
        </Alert>
        {report.skipped.length > 0 ? <ProblemTable problems={report.skipped} /> : null}
        <Link href={`/events/${eventId}`} className={buttonVariants()}>
          {t("backToEvent")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p>{t("intro")}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="guest-file">{t("file")}</Label>
        <input
          id="guest-file"
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={!hydrated}
          aria-describedby="guest-file-hint"
          className="text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-input file:bg-background file:px-4 file:text-sm file:font-medium"
        />
        <p id="guest-file-hint" className="text-sm text-muted-foreground">
          {t("limits", { max: MAX_IMPORT_ROWS })}
        </p>
      </div>

      {fileError ? <Alert tone="error">{fileError}</Alert> : null}
      {submitError ? <Alert tone="error">{submitError}</Alert> : null}

      {plan ? (
        <div className="flex flex-col gap-4">
          <Alert tone={plan.guests.length > 0 ? "success" : "error"}>
            <p>{t("ready", { count: plan.guests.length })}</p>
            {plan.skipped.length > 0 ? (
              <p>{t("withProblems", { count: plan.skipped.length })}</p>
            ) : null}
          </Alert>
          {plan.skipped.length > 0 ? <ProblemTable problems={plan.skipped} /> : null}
          <Button
            className="self-start"
            disabled={!hydrated || pending || plan.guests.length === 0}
            aria-busy={pending}
            onClick={submit}
          >
            {t("submit", { count: plan.guests.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ProblemTable({ problems }: { problems: Problem[] }) {
  const t = useTranslations("events.import");
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 border-b bg-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("line")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("email")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("problem")}
            </th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={`${problem.line}-${problem.problem}`} className="border-b last:border-0">
              <td className="px-3 py-2">{problem.line}</td>
              <td className="px-3 py-2 break-all">{problem.email}</td>
              <td className="px-3 py-2">{t(`problems.${problem.problem}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

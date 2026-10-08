// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, type Page, type TestInfo } from "@playwright/test";
import { latestLinkFor } from "./mailpit.ts";

export const PASSWORD = "correct horse battery staple";

export function uniqueEmail(testInfo: Pick<TestInfo, "project">, label = "e2e"): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${label}-${testInfo.project.name}-${Date.now()}-${random}@example.test`;
}

/**
 * Each page acts as a different client so per-IP rate limits do not interfere. The stack must
 * run with TRUSTED_PROXY_HOPS=1 for the API to honour this header (see README).
 */
export async function useDistinctClientIp(page: Page): Promise<void> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${octet()}.${octet()}` });
}

/** Signs up through the UI (es-MX), verifies via Mailpit and lands on the dashboard. */
export async function signUpOrganizer(
  page: Page,
  email: string,
  name = "Ana López",
): Promise<void> {
  await page.goto("/es-MX/sign-up");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("status")).toContainText("Revisa tu correo");
  const { link } = await latestLinkFor(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/es-MX\/dashboard$/);
}

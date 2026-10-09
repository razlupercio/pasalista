// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from "@axe-core/playwright";
import { utcToZonedLocal } from "@pasalista/core";
import { expect, test, type Page } from "@playwright/test";
import { setDistinctClientIp, signUpOrganizer, uniqueEmail } from "./helpers.ts";
import { latestLinkFor } from "./mailpit.ts";

test.beforeEach(async ({ page }) => {
  await setDistinctClientIp(page);
});

/** Collects CSP violations reported by the browser while the page is used. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await page.exposeFunction("__reportCsp", (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __reportCsp: (t: string) => void }).__reportCsp(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} @${location.pathname}`,
      );
    });
  });
  return violations;
}

async function expectAccessible(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => `${colorScheme}: ${v.id} (${v.nodes.length})`)).toEqual(
      [],
    );
  }
}

/** Organizer with a published event starting in an hour and one registered guest. */
async function eventWithGuest(page: Page, testInfo: Parameters<typeof uniqueEmail>[0]) {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  const startsLocal = utcToZonedLocal(new Date(Date.now() + 60 * 60 * 1000), "America/Mexico_City");
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill("Noche de demos");
  await page.getByLabel("Inicio").fill(startsLocal);
  await page.getByLabel("Lugar").fill("Foro");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  const eventUrl = page.url();
  const publicUrl = await page.getByLabel("Enlace público de registro").inputValue();

  const guestEmail = uniqueEmail(testInfo, "guest");
  await page.goto(publicUrl);
  await page.getByLabel("Nombre").fill("Lola Montero");
  await page.getByLabel("Correo electrónico").fill(guestEmail);
  await page.getByRole("button", { name: "Registrarme" }).click();
  const { link: ticketLink } = await latestLinkFor(guestEmail, { subject: /boleto/ });
  return { eventUrl, eventId: eventUrl.split("/").at(-1)!, publicUrl, ticketLink };
}

test("pages send a nonce-based CSP, run without violations and pass axe in light and dark mode", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const violations = await watchCsp(page);

  const home = await page.goto("/es-MX");
  const policy = home!.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(policy).not.toContain("'unsafe-eval'");
  await expectAccessible(page);

  await page.goto("/es-MX/sign-in");
  await expectAccessible(page);

  const { eventUrl, eventId, publicUrl, ticketLink } = await eventWithGuest(page, testInfo);
  for (const url of [
    "/es-MX/dashboard",
    eventUrl,
    publicUrl,
    ticketLink,
    `/es-MX/scan/${eventId}?mode=search`,
  ]) {
    await page.goto(url);
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
    await expectAccessible(page);
  }
  expect(violations).toEqual([]);
});

test("owners purge attendee data of a closed event and keep its totals", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop Chromium");
  const { eventUrl, publicUrl } = await eventWithGuest(page, testInfo);
  await page.goto(eventUrl);
  await page.getByRole("button", { name: "Cerrar registro" }).click();

  const slug = publicUrl.split("/").at(-1)!;
  const submit = page.getByRole("button", { name: "Eliminar datos para siempre" });
  await page.getByLabel(`Escribe ${slug} para confirmar`).fill("otro-evento");
  await expect(submit).toBeDisabled();
  await page.getByLabel(`Escribe ${slug} para confirmar`).fill(slug);
  await submit.click();

  await expect(page.getByText(/Los datos de asistentes se eliminaron/)).toContainText(
    "1 registrados, 0 entradas",
  );
  await expect(page.getByRole("heading", { name: "Asistentes" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);

  await page.goto("/es-MX/dashboard");
  await expect(page.getByText("Datos de asistentes eliminados")).toBeVisible();
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { chromium, expect, test } from "@playwright/test";
import { utcToZonedLocal } from "@pasalista/core";
import { writeQrVideo } from "./fake-camera.ts";
import { signUpOrganizer, uniqueEmail, useDistinctClientIp } from "./helpers.ts";
import { latestLinkFor } from "./mailpit.ts";

test.beforeEach(async ({ page }) => {
  await useDistinctClientIp(page);
});

test("scanning a ticket with the camera checks the guest in and updates the dashboard", async ({
  page,
}, testInfo) => {
  // One run is enough: the fake camera is a Chromium launch flag.
  test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop Chromium");
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));

  // An event starting in an hour (check-in opens 6 h before).
  const startsLocal = utcToZonedLocal(new Date(Date.now() + 60 * 60 * 1000), "America/Mexico_City");
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill("Concierto de hoy");
  await page.getByLabel("Inicio").fill(startsLocal);
  await page.getByLabel("Lugar").fill("Foro Sol");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  const eventUrl = page.url();
  const eventId = eventUrl.split("/").at(-1)!;
  const publicUrl = await page.getByLabel("Enlace público de registro").inputValue();

  // A guest registers; read the QR payload through their ticket link.
  const guestEmail = uniqueEmail(testInfo, "guest");
  await page.goto(publicUrl);
  await page.getByLabel("Nombre").fill("Fan Número Uno");
  await page.getByLabel("Correo electrónico").fill(guestEmail);
  await page.getByRole("button", { name: "Registrarme" }).click();
  const { link } = await latestLinkFor(guestEmail, { subject: /boleto/ });
  const accessToken = link.split("/").at(-1)!;
  const ticket = (await (
    await page.request.get(`/api/v1/public/tickets/${accessToken}`)
  ).json()) as {
    ticket: { qrToken: string };
  };

  // Scanner on a browser whose camera "sees" that QR, signed in as the organizer.
  const video = testInfo.outputPath("ticket-qr.y4m");
  writeQrVideo(video, ticket.ticket.qrToken);
  const cameraBrowser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const scannerContext = await cameraBrowser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
    permissions: ["camera"],
    locale: "es-MX",
  });
  const scanner = await scannerContext.newPage();
  await useDistinctClientIp(scanner);
  const thirdParty: string[] = [];
  scanner.on("request", (request) => {
    if (!request.url().startsWith(testInfo.project.use.baseURL ?? "http://localhost")) {
      thirdParty.push(request.url());
    }
  });

  await scanner.goto(`/es-MX/scan/${eventId}`);
  await expect(scanner.getByText("VÁLIDO", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(scanner.getByText("Fan Número Uno")).toBeVisible();
  await expect(scanner.getByText("1 de 1 dentro")).toBeVisible();
  // The QR decoder must come from our own origin, never a CDN.
  expect(thirdParty).toEqual([]);

  // Manual search shows the guest as already inside, with a partial email.
  await scanner.getByText("VÁLIDO", { exact: true }).click();
  await scanner.getByRole("tab", { name: "Buscar" }).click();
  await scanner.getByLabel("Nombre o correo").fill("Fan");
  await scanner.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(scanner.getByText(/^gu\*\*\*@example\.test$/)).toBeVisible();
  await expect(scanner.getByText(/^Entró a las/)).toBeVisible();
  await cameraBrowser.close();

  // The organizer's dashboard shows the check-in.
  await page.goto(eventUrl);
  await expect(page.getByRole("heading", { name: "En vivo" })).toBeVisible();
  await expect(page.getByText(/Fan Número Uno/).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /Fan Número Uno/ })).toContainText("Anular entrada");
});

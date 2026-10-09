// SPDX-License-Identifier: AGPL-3.0-or-later
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { utcToZonedLocal } from "@pasalista/core";
import { writeQrVideo } from "./fake-camera.ts";
import { signUpOrganizer, uniqueEmail, setDistinctClientIp } from "./helpers.ts";
import { latestLinkFor } from "./mailpit.ts";

test.beforeEach(async ({ page }) => {
  await setDistinctClientIp(page);
});

/** Organizer with a published event starting in an hour and one registered guest. */
async function eventWithGuest(page: Page, testInfo: Parameters<typeof uniqueEmail>[0]) {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  const startsLocal = utcToZonedLocal(new Date(Date.now() + 60 * 60 * 1000), "America/Mexico_City");
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill("Festival sin señal");
  await page.getByLabel("Inicio").fill(startsLocal);
  await page.getByLabel("Lugar").fill("Bosque");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  const eventUrl = page.url();
  const publicUrl = await page.getByLabel("Enlace público de registro").inputValue();

  const guestEmail = uniqueEmail(testInfo, "guest");
  await page.goto(publicUrl);
  await page.getByLabel("Nombre").fill("Lola Montero");
  await page.getByLabel("Correo electrónico").fill(guestEmail);
  await page.getByRole("button", { name: "Registrarme" }).click();
  const { link } = await latestLinkFor(guestEmail, { subject: /boleto/ });
  const ticket = (await (
    await page.request.get(`/api/v1/public/tickets/${link.split("/").at(-1)}`)
  ).json()) as {
    ticket: { qrToken: string };
  };
  return { eventUrl, eventId: eventUrl.split("/").at(-1)!, qrToken: ticket.ticket.qrToken };
}

async function cameraBrowser(videoPath: string): Promise<Browser> {
  return chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${videoPath}`,
    ],
  });
}

/** Opens the scanner on the manual-search tab (camera off) and waits for the offline bundle. */
async function openScannerReadyForOffline(
  browser: Browser,
  organizer: Page,
  eventId: string,
  baseURL: string,
) {
  const context = await browser.newContext({
    baseURL,
    storageState: await organizer.context().storageState(),
    permissions: ["camera"],
    locale: "es-MX",
  });
  const scanner = await context.newPage();
  await setDistinctClientIp(scanner);
  await scanner.goto(`/es-MX/scan/${eventId}?mode=search`);
  await expect(scanner.getByText(/Listo para trabajar sin conexión/)).toBeVisible();
  // The service worker must control the page and hold the scanner page before going offline.
  await expect
    .poll(
      () =>
        scanner.evaluate(async () =>
          Boolean(await caches.match(location.href, { ignoreSearch: true })),
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  return { context, scanner };
}

test("scans offline, survives a reload without network and syncs when the connection returns", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop Chromium");
  const { eventUrl, eventId, qrToken } = await eventWithGuest(page, testInfo);
  const video = testInfo.outputPath("offline-qr.y4m");
  writeQrVideo(video, qrToken);
  const browser = await cameraBrowser(video);
  const { context, scanner } = await openScannerReadyForOffline(
    browser,
    page,
    eventId,
    testInfo.project.use.baseURL!,
  );

  await context.setOffline(true);
  await scanner.reload();
  await expect(scanner.getByRole("heading", { name: "Festival sin señal" })).toBeVisible();
  await expect(scanner.getByText("Sin conexión", { exact: true })).toBeVisible();

  await scanner.getByRole("tab", { name: "Escanear" }).click();
  await expect(scanner.getByText("VÁLIDO", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(scanner.getByText("Lola M.")).toBeVisible();
  await expect(scanner.getByText(/Registrado sin conexión/)).toBeVisible();
  await expect(scanner.getByText("1 entrada por sincronizar")).toBeVisible();

  await context.setOffline(false);
  await expect(scanner.getByText("Todo sincronizado")).toBeVisible({ timeout: 20_000 });
  await browser.close();

  await page.goto(eventUrl);
  await expect(page.getByRole("row", { name: /Lola Montero/ })).toContainText("Anular entrada");
});

test("two offline devices scan the same QR: one check-in is kept and the duplicate is reported", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop Chromium");
  const { eventUrl, eventId, qrToken } = await eventWithGuest(page, testInfo);
  const video = testInfo.outputPath("shared-qr.y4m");
  writeQrVideo(video, qrToken);
  const browser = await cameraBrowser(video);
  const baseURL = testInfo.project.use.baseURL!;
  const a = await openScannerReadyForOffline(browser, page, eventId, baseURL);
  const b = await openScannerReadyForOffline(browser, page, eventId, baseURL);

  for (const device of [a, b]) {
    await device.context.setOffline(true);
    await device.scanner.getByRole("tab", { name: "Escanear" }).click();
    await expect(device.scanner.getByText("VÁLIDO", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(device.scanner.getByText("1 entrada por sincronizar")).toBeVisible();
  }

  for (const device of [a, b]) {
    await device.context.setOffline(false);
    await expect(device.scanner.getByText("Todo sincronizado")).toBeVisible({ timeout: 20_000 });
  }
  // The device whose scan was later learns it was a duplicate.
  await expect(b.scanner.getByText(/estaba duplicada en otro dispositivo/)).toBeVisible();
  await browser.close();

  await page.goto(eventUrl);
  await expect(page.getByRole("heading", { name: "Duplicados sin conexión" })).toBeVisible();
  await expect(page.getByText("Dentro").locator("..")).toContainText("1");
});

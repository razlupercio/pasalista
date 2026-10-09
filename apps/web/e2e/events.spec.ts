// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { signUpOrganizer, uniqueEmail, setDistinctClientIp } from "./helpers.ts";
import { latestLinkFor } from "./mailpit.ts";

test.beforeEach(async ({ page }) => {
  await setDistinctClientIp(page);
});

test("organizer publishes an event, a guest registers, gets the QR by email and cancels", async ({
  page,
  browser,
}, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));

  // Create a draft with one extra question.
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill("Noche de demos");
  await page.getByLabel("Inicio").fill("2030-01-15T19:00");
  await page.getByLabel("Lugar").fill("Foro Central");
  await page.getByRole("button", { name: "Agregar pregunta" }).click();
  await page.getByLabel("Pregunta", { exact: true }).fill("Talla de playera");
  await page.getByLabel("Tipo de respuesta").selectOption("select");
  await page.getByLabel("Opciones").fill("S\nM\nL");
  await page.getByLabel("Obligatoria").check();
  await page.getByRole("button", { name: "Crear borrador" }).click();

  await expect(page.getByRole("heading", { name: "Noche de demos" })).toBeVisible();
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  const publicUrl = await page.getByLabel("Enlace público de registro").inputValue();
  expect(publicUrl).toMatch(/\/es-MX\/e\/noche-de-demos-[a-z0-9]{6}$/);

  // A guest registers from another browser context.
  const guestContext = await browser.newContext({ locale: "es-MX" });
  const guest = await guestContext.newPage();
  await setDistinctClientIp(guest);
  const guestEmail = uniqueEmail(testInfo, "guest");
  await guest.goto(publicUrl);
  await expect(guest.getByText("Organiza: Ana López")).toBeVisible();
  await guest.getByLabel("Nombre").fill("Sam Doe");
  await guest.getByLabel("Correo electrónico").fill(guestEmail);
  await guest.getByRole("button", { name: "Registrarme" }).click();
  await expect(guest.getByText("Este campo es obligatorio.")).toBeVisible();
  await guest.getByLabel("Talla de playera").selectOption("M");
  await guest.getByRole("button", { name: "Registrarme" }).click();
  await expect(guest.getByRole("status")).toContainText("Ya estás registrado");

  // Registering the same email again is refused (maintainer decision, ADR-0007).
  await guest.goto(publicUrl);
  await guest.getByLabel("Nombre").fill("Sam Doe");
  await guest.getByLabel("Correo electrónico").fill(guestEmail);
  await guest.getByLabel("Talla de playera").selectOption("S");
  await guest.getByRole("button", { name: "Registrarme" }).click();
  await expect(guest.locator("form").getByRole("alert")).toHaveText(
    "Este correo ya está registrado en el evento.",
  );

  // The ticket email links to the ticket page with a working QR.
  const { subject, link } = await latestLinkFor(guestEmail);
  expect(subject).toBe("Tu boleto para Noche de demos");
  await guest.goto(link);
  const qr = guest.getByRole("img", { name: "Código QR de tu boleto para Noche de demos" });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(guest.getByRole("link", { name: "Descargar QR" })).toBeVisible();

  // The organizer sees the attendee.
  await page.reload();
  const row = page.getByRole("row", { name: /Sam Doe/ });
  await expect(row).toContainText(guestEmail);
  await expect(row).toContainText("Válido");

  // The guest cancels; the QR disappears.
  guest.once("dialog", (dialog) => void dialog.accept());
  await guest.getByRole("button", { name: "Cancelar mi registro" }).click();
  await expect(
    guest.getByRole("alert").filter({ hasText: "Tu registro está cancelado" }),
  ).toBeVisible();
  await expect(qr).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("row", { name: /Sam Doe/ })).toContainText("Cancelado");
  await guestContext.close();
});

test("closed-list events do not accept public registrations", async ({ page }, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill("Cena privada");
  await page.getByLabel("Inicio").fill("2030-02-01T20:00");
  await page.getByLabel("Lugar").fill("Casa");
  await page.getByLabel(/Lista cerrada/).check();
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  const publicUrl = await page.getByLabel("Enlace público de registro").inputValue();

  await page.goto(publicUrl);
  await expect(page.getByText("El registro a este evento es solo por invitación.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrarme" })).toHaveCount(0);
});

test("event form reports invalid dates", async ({ page }, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  await page.goto("/es-MX/events/new");
  await page.getByLabel("Nombre del evento").fill("Fechas raras");
  await page.getByLabel("Inicio").fill("2030-03-01T20:00");
  await page.getByLabel(/^Fin/).fill("2030-03-01T18:00");
  await page.getByLabel("Lugar").fill("Sala");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(page.getByText("El fin debe ser después del inicio.")).toBeVisible();
});

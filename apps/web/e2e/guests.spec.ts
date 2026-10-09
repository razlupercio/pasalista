// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, signUpOrganizer, uniqueEmail, useDistinctClientIp } from "./helpers.ts";
import { latestLinkFor } from "./mailpit.ts";

test.beforeEach(async ({ page }) => {
  await useDistinctClientIp(page);
});

async function createPublishedClosedEvent(page: Page, name: string): Promise<string> {
  await page.getByRole("link", { name: "Crear evento" }).click();
  await page.getByLabel("Nombre del evento").fill(name);
  await page.getByLabel("Inicio").fill("2030-04-10T19:00");
  await page.getByLabel("Lugar").fill("Salón Azul");
  await page.getByLabel(/Lista cerrada/).check();
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  return page.url();
}

test("closed list: add a guest, import a CSV, send invitations, guest gets the QR", async ({
  page,
}, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  const eventUrl = await createPublishedClosedEvent(page, "Gala privada");

  // Manual guest.
  const manualGuest = uniqueEmail(testInfo, "manual");
  await page.getByRole("button", { name: "Agregar invitado" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Invitada Manual");
  await page.getByLabel("Correo electrónico").fill(manualGuest);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByText("Invitado agregado.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Invitada Manual/ })).toContainText("Por enviar");

  // CSV with one bad row, semicolons and Spanish headers (as exported by Excel in Spanish).
  const csvGuest = uniqueEmail(testInfo, "csv");
  const csv = `nombre;correo;idioma\nInvitado CSV;${csvGuest};en\nSin correo;no-es-correo;\n`;
  await page.getByRole("link", { name: "Importar CSV" }).click();
  await page.getByLabel("Archivo CSV").setInputFiles({
    name: "invitados.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await expect(page.getByText("1 invitado listo para agregar.")).toBeVisible();
  await expect(page.getByRole("row", { name: /3 no-es-correo Correo inválido/ })).toBeVisible();
  await page.getByRole("button", { name: "Agregar 1 invitado" }).click();
  await expect(page.getByText("Se agregó 1 invitado.")).toBeVisible();
  await page.getByRole("link", { name: "Volver al evento" }).last().click();

  // Send both pending invitations.
  await expect(page).toHaveURL(eventUrl);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Enviar invitaciones (2)" }).click();
  await expect(page.getByText("Se enviaron 2 invitaciones.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Invitado CSV/ })).toContainText("Válido");

  // The CSV guest asked for English.
  const { subject, link } = await latestLinkFor(csvGuest);
  expect(subject).toBe("Your ticket for Gala privada");
  await page.goto(link);
  await expect(page.getByRole("img", { name: "QR code of your ticket for Gala privada" })).toBeVisible();
});

test("staff invitation: the invitee signs up from the link and sees the event", async ({
  page,
  browser,
}, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "organizer"));
  await createPublishedClosedEvent(page, "Congreso");

  const staffEmail = uniqueEmail(testInfo, "staff");
  await page.getByLabel("Correo de la persona").fill(staffEmail);
  await page.getByRole("button", { name: "Invitar", exact: true }).click();
  await expect(page.getByText("Invitación enviada. Vence en 7 días.")).toBeVisible();
  await expect(page.getByText(staffEmail)).toBeVisible();

  const { link } = await latestLinkFor(staffEmail);
  const staffContext = await browser.newContext({ locale: "es-MX" });
  const staff = await staffContext.newPage();
  await useDistinctClientIp(staff);
  await staff.goto(link);
  await expect(staff.getByText("te invitó a validar la entrada en Congreso")).toBeVisible();
  await staff.getByRole("link", { name: "Crear cuenta" }).last().click();

  await staff.getByLabel("Nombre").fill("Persona Staff");
  await staff.getByLabel("Correo electrónico").fill(staffEmail);
  await staff.getByLabel("Contraseña").fill(PASSWORD);
  await staff.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(staff.getByRole("status")).toContainText("Revisa tu correo");

  // Verification brings the new account back to the invitation.
  const verification = await latestLinkFor(staffEmail, { subject: /Verifica tu correo/ });
  await staff.goto(verification.link);
  await expect(staff).toHaveURL(/\/es-MX\/invitations\/staff\//);
  await staff.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(staff.getByText("¡Listo! Ya eres staff de Congreso.")).toBeVisible();
  await staff.getByRole("link", { name: "Ir a mi panel" }).click();
  await expect(staff.getByRole("heading", { name: "Eventos donde eres staff" })).toBeVisible();
  await expect(staff.getByText("Congreso")).toBeVisible();
  await staffContext.close();

  await page.reload();
  await expect(page.getByText("Staff activo")).toBeVisible();
});

test("team: a co-organizer joins and sees the organization's events", async ({ page, browser }, testInfo) => {
  await signUpOrganizer(page, uniqueEmail(testInfo, "owner"), "Dueña Equipo");
  await createPublishedClosedEvent(page, "Evento del equipo");

  await page.goto("/es-MX/team");
  const teammateEmail = uniqueEmail(testInfo, "teammate");
  await page.getByLabel("Correo", { exact: true }).fill(teammateEmail);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(`Invitación enviada a ${teammateEmail}.`)).toBeVisible();

  const { link } = await latestLinkFor(teammateEmail);
  const context = await browser.newContext({ locale: "es-MX" });
  const teammate = await context.newPage();
  await useDistinctClientIp(teammate);
  await teammate.goto(link);
  await teammate.getByRole("link", { name: "Crear cuenta" }).last().click();
  await teammate.getByLabel("Nombre").fill("Compañero");
  await teammate.getByLabel("Correo electrónico").fill(teammateEmail);
  await teammate.getByLabel("Contraseña").fill(PASSWORD);
  await teammate.getByRole("button", { name: "Crear cuenta" }).click();
  const verification = await latestLinkFor(teammateEmail, { subject: /Verifica tu correo/ });
  await teammate.goto(verification.link);

  await expect(teammate).toHaveURL(/\/es-MX\/invitations\/team\//);
  await teammate.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(teammate.getByText("¡Listo! Ya eres parte de Dueña Equipo.")).toBeVisible();
  await teammate.getByRole("link", { name: "Ir a mi panel" }).click();
  await expect(teammate.getByText("Evento del equipo")).toBeVisible();
  await expect(teammate.getByLabel("Organización activa")).toBeVisible();
  await context.close();
});

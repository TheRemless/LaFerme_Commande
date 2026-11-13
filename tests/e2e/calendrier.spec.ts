import { SITE, adresseDuCompte } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Calendrier du back-office (vague 3, bo-operations) : la route, en lecture seule. L'écran attend la coque.
test.describe.configure({ mode: "serial" });

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("calendrier : jours, fériés, fermeture annuelle, commandes prises", async ({ page, request }, info) => {
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  expect((await request.get(`${SITE}/api/gestion/calendrier`)).status()).toBe(401);
  await connecter(page, "calendrier-bureau@laferme.test");
  const r = await page.request.get("/api/gestion/calendrier?debut=2026-12-20&fin=2026-12-31");
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.commandes_disponibles).toBe(true);
  const noel = d.jours.find((j: { date: string }) => j.date === "2026-12-25");
  expect(noel.ferie).toBe("Noël");
  expect(noel.services[0]).toMatchObject({ service: "midi", ouvert: false, source: "fermeture", motif: "Fermeture annuelle", commandes: { livraisons: 0, retraits: 0 } });
  expect(Array.isArray(d.feries_a_confirmer)).toBe(true);
  expect((await page.request.get("/api/gestion/calendrier?debut=2026-12-01&fin=2027-03-01")).status()).toBe(400);
});

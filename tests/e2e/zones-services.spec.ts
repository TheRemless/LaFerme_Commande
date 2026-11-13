import { SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Zones par service et zone fermée jusqu'à une heure (vague 3, bo-operations) : la route du back-office, sans
// écran pour l'instant (il attend la coque). Sur la zone 3, fermée dans la base de départ : les autres
// fichiers de tests, qui livrent en zones 1 et 2, ne sont pas gênés.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };

async function connecter(page: Page, email: string) {
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

const zone3 = async (page: Page) => {
  const d = await (await page.request.get("/api/gestion/service")).json();
  return d.zones.find((z: { numero: number }) => z.numero === 3) as { services: string[]; fermee_jusqu_a: string | null; fermee_motif: string | null };
};

test("services d'une zone et zone fermée jusqu'à une heure", async ({ page, request }, info) => {
  // Route seule, sans écran : un passage suffit, et deux projets en même temps se gêneraient sur la zone 3.
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  expect((await request.post("/api/gestion/service", { headers: ORIGINE, data: { type: "zone-rouvrir", numero: 3 } })).status()).toBe(401);
  await connecter(page, `zones-${info.project.name}@laferme.test`);
  const poster = (data: Record<string, unknown>) => page.request.post("/api/gestion/service", { headers: ORIGINE, data });

  try {
    expect((await poster({ type: "zone-services", numero: 3, services: ["soir"] })).status()).toBe(200);
    expect((await zone3(page)).services).toEqual(["soir"]);
    const vide = await poster({ type: "zone-services", numero: 3, services: [] });
    expect(vide.status()).toBe(422);
    expect((await vide.json()).erreur).toMatch(/midi, soir/);

    const jusqua = new Date(Date.now() + 2 * 3600_000).toISOString();
    expect((await poster({ type: "zone-fermer", numero: 3, jusqua, motif: "Neige" })).status()).toBe(200);
    const fermee = await zone3(page);
    expect(new Date(fermee.fermee_jusqu_a!).getTime()).toBe(new Date(jusqua).getTime());
    expect(fermee.fermee_motif).toBe("Neige");
    const passee = await poster({ type: "zone-fermer", numero: 3, jusqua: new Date(Date.now() - 60_000).toISOString(), motif: "Neige" });
    expect(passee.status()).toBe(422);
    expect((await (await poster({ type: "zone-rouvrir", numero: 3 })).json()).enregistre).toBe(true);
    expect((await zone3(page)).fermee_jusqu_a).toBeNull();
  } finally {
    // La zone 3 revient comme au départ, même après un échec.
    await poster({ type: "zone-services", numero: 3, services: ["midi", "soir"] });
    await poster({ type: "zone-rouvrir", numero: 3 });
  }
});

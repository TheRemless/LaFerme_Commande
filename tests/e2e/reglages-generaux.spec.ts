import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Réglages généraux (vague 3, bo-operations) : la route du back-office, sans écran pour l'instant (il attend
// la coque). Seulement l'e-mail des alertes : créneau, jours à l'avance et plafond des codes changeraient le
// site pour les autres fichiers de tests qui tournent en même temps (couverts par les tests en base).
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("e-mail des alertes : saisi au back-office, jamais sur une page publique", async ({ page, request }, info) => {
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  await connecter(page, "reglages-bureau@laferme.test");
  const poster = (data: Record<string, unknown>) => page.request.post("/api/gestion/service", { headers: ORIGINE, data });
  const generaux = async () => (await (await page.request.get("/api/gestion/service")).json()).generaux;

  expect(await generaux()).toMatchObject({ creneau_minutes: 15, avance_jours: 7 });
  try {
    expect((await poster({ type: "reglage-general", cle: "alerte_email", valeur: "alertes-e2e@laferme.test" })).status()).toBe(200);
    expect((await generaux()).alerte_email).toBe("alertes-e2e@laferme.test");
    const illisible = await poster({ type: "reglage-general", cle: "alerte_email", valeur: "alertes@" });
    expect(illisible.status()).toBe(422);
    const hors = await poster({ type: "reglage-general", cle: "creneau_minutes", valeur: 25 });
    expect(hors.status()).toBe(422);
    expect((await hors.json()).erreur).toMatch(/10, 15, 20 ou 30/);
    // Ni l'accueil ni sa config servie au navigateur ne contiennent l'adresse.
    expect(await (await request.get("/")).text()).not.toContain("alertes-e2e@laferme.test");
  } finally {
    await poster({ type: "reglage-general", cle: "alerte_email", valeur: null });
  }
});

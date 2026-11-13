import { SITE, adresseDuCompte } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Messages d'information aux clients (vague 3, bo-operations) : la route du back-office. L'écran attend le kit,
// l'affichage sur le site est fait par client-commande. Le message est retiré à la fin, même après un échec.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };

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

test("programmer et retirer un message", async ({ page, request }, info) => {
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  expect((await request.get(`${SITE}/api/gestion/messages`)).status()).toBe(401);
  await connecter(page, "messages-bureau@laferme.test");
  const poster = (data: Record<string, unknown>) => page.request.post("/api/gestion/messages", { headers: ORIGINE, data });
  let id: number | null = null;
  try {
    const court = await poster({ type: "ajouter", texte: "Bof", fin: new Date(Date.now() + 3600_000).toISOString() });
    expect(court.status()).toBe(422);
    expect((await court.json()).erreur).toMatch(/5 à 200/);
    const r = await poster({ type: "ajouter", texte: "Message de test e2e.", fin: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.status()).toBe(200);
    id = (await r.json()).id;
    const liste = (await (await page.request.get("/api/gestion/messages")).json()).messages as { id: number; texte: string; cree_par: string }[];
    expect(liste.find((m) => m.id === id)).toMatchObject({ texte: "Message de test e2e.", cree_par: "Messages bureau" });
  } finally {
    if (id !== null) expect((await (await poster({ type: "retirer", id })).json()).enregistre).toBe(true);
  }
});

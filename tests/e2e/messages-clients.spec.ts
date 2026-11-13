import { SITE, connecterPersonnelApi, passage } from "./site";
import { expect, test } from "@playwright/test";

// Messages d'information aux clients (vague 3, bo-operations) : la route du back-office (l'écran a son test,
// gestion-messages.spec.ts ; l'affichage sur le site est fait par client-commande). Le message est retiré à
// la fin, même après un échec.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };

const TEXTE = `Message de test e2e ${passage()}.`;

test("programmer et retirer un message", async ({ playwright, request }, info) => {
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  // Au réessai, la connexion attend la fin du délai d'un code par e-mail (30 s).
  test.setTimeout(90_000);
  expect((await request.get(`${SITE}/api/gestion/messages`)).status()).toBe(401);
  const gerant = await playwright.request.newContext({ baseURL: SITE, extraHTTPHeaders: ORIGINE });
  await connecterPersonnelApi(gerant, "messages-bureau@laferme.test");
  const poster = (data: Record<string, unknown>) => gerant.post("/api/gestion/messages", { data });
  let id: number | null = null;
  try {
    const court = await poster({ type: "ajouter", texte: "Bof", fin: new Date(Date.now() + 3600_000).toISOString() });
    expect(court.status()).toBe(422);
    expect((await court.json()).erreur).toMatch(/5 à 200/);
    const r = await poster({ type: "ajouter", texte: TEXTE, fin: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.status()).toBe(200);
    id = (await r.json()).id;
    const liste = (await (await gerant.get("/api/gestion/messages")).json()).messages as { id: number; texte: string; cree_par: string }[];
    expect(liste.find((m) => m.id === id)).toMatchObject({ texte: TEXTE, cree_par: "Messages bureau" });
  } finally {
    if (id !== null) expect((await (await poster({ type: "retirer", id })).json()).enregistre).toBe(true);
    await gerant.dispose();
  }
});

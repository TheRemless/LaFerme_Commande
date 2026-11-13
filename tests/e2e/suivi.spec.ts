import { expect, test, type Page } from "@playwright/test";
import { SITE } from "./site";

// Vague 3, client-compte : la page de suivi dit ce qui est rendu au client et dans quel état (S2-03).
// Un remboursement partiel du gérant apparaît « remboursé », puis « n'a pas abouti » si Stripe l'annonce en échec.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
// Captures pour le bilan : dans docs/rendus seulement avec RENDUS=1, sinon avec les résultats du test.
// Écrire à chaque passage dans des fichiers suivis par git salissait le worktree de toutes les sessions.
const capture = (nom: string) => (process.env.RENDUS === "1" ? `docs/rendus/vague-3/client-compte/${nom}` : test.info().outputPath(nom));
let gestion: Page;

test.beforeAll(async ({ browser }, info) => {
  gestion = await browser.newPage({ baseURL: SITE });
  // IP propre (x-forwarded-for, cru seulement sur le poste local) : la limite de 20 codes de l'équipe par heure
  // et par IP est partagée par toute la suite sinon.
  await gestion.setExtraHTTPHeaders({ "x-forwarded-for": `10.27.${info.project.name === "bureau" ? 1 : 2}.${Math.floor(Math.random() * 250)}` });
  await gestion.goto("/gestion");
  await gestion.getByLabel("E-mail", { exact: true }).fill(`suivi-${info.project.name}@laferme.test`);
  await gestion.getByRole("button", { name: "Recevoir un code" }).click();
  const code = gestion.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await gestion.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { name: "Back-office" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

async function commandeRetireePayee(prenom: string): Promise<{ id: string; jeton: string }> {
  const rep = await gestion.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `suivi-${prenom}-${Date.now()}`,
      mode: "retrait",
      moyen: "en_ligne",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Test", telephone: "079 000 00 00", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  const id = ((await rep.json()) as { redirection: string }).redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
  const paye = await gestion.request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
  const jeton = ((await paye.json()) as { redirection?: string }).redirection?.match(/suivi\/([A-Za-z0-9_-]+)/)?.[1];
  const file = (await (await gestion.request.get("/api/tablette/file")).json()) as { commandes: { id: string; client_prenom: string; heure_proposee: string }[] };
  const c = file.commandes.find((x) => x.client_prenom === prenom)!;
  for (const corps of [
    { action: "accepter", heure: c.heure_proposee, de: "nouvelle" },
    { action: "statut", vers: "prete", de: "acceptee" },
    { action: "statut", vers: "terminee", de: "prete" },
  ]) {
    expect((await gestion.request.post("/api/tablette/action", { headers: ORIGINE, data: { commande: c.id, ...corps } })).ok()).toBe(true);
  }
  expect(jeton).toBeTruthy();
  return { id: c.id, jeton: jeton! };
}

test("remboursement partiel : visible au suivi, puis son échec chez Stripe", async ({ browser }, info) => {
  const prenom = `Suivi${info.project.name}`;
  const { id, jeton } = await commandeRetireePayee(prenom);
  const cle = `suivi-geste-${info.project.name}-${Date.now()}`;
  const remb = await gestion.request.post("/api/gestion/commandes", {
    headers: ORIGINE,
    data: { action: "rembourser", id, montant: "5", motif: "Geste pour le retard", cle },
  });
  expect(remb.ok()).toBe(true);

  const client = await browser.newPage({ baseURL: SITE, viewport: { width: 375, height: 812 } });
  await client.goto(`/suivi/${jeton}`);
  const bloc = client.locator(".suivi-remboursements");
  await expect(bloc.getByRole("heading", { name: "Remboursement" })).toBeVisible();
  await expect(bloc).toContainText(/CHF\s5\.00 remboursés le \d+ \w+\. La somme revient sur le moyen de paiement utilisé\./);
  // Le motif écrit par l'équipe ne s'affiche pas au suivi (il part dans l'e-mail, rédigé pour le client).
  await expect(client.locator("main")).not.toContainText("Geste pour le retard");
  await expect(client.locator(".somme-totale dt")).toHaveText("Payée en ligne");
  await bloc.scrollIntoViewIfNeeded();
  await client.screenshot({ path: capture("suivi-rembourse-375.png"), fullPage: true });

  // Stripe annonce l'échec (doublure) : la page le dit, avec le numéro à appeler.
  const echec = await gestion.request.post("/api/paiement-test", { data: { remboursement: `re_doublure_${cle}`, issue: "echec" } });
  expect(echec.ok()).toBe(true);
  await client.close();
  const petit = await browser.newPage({ baseURL: SITE, viewport: { width: 320, height: 700 } });
  await petit.goto(`/suivi/${jeton}`);
  await expect(petit.locator(".suivi-remboursements .remb-echec")).toHaveText(
    "Le remboursement de CHF 5.00 n'a pas abouti. Le restaurant est prévenu. Appelez-nous au 022 792 16 89.",
  );
  await petit.screenshot({ path: capture("suivi-echec-320.png"), fullPage: true });
  // Rien ne déborde à 320 px.
  expect(await petit.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await petit.close();
});

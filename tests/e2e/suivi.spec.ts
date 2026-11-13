import { expect, test, type Page } from "@playwright/test";
import { SITE } from "./site";

// Vague 3, client-compte : la page de suivi dit ce qui est rendu au client et dans quel état (S2-03).
// Un remboursement partiel du gérant apparaît « remboursé », puis « n'a pas abouti » si Stripe l'annonce en échec.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
const RENDUS = "docs/rendus/vague-3/client-compte";
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
  await client.screenshot({ path: `${RENDUS}/suivi-rembourse-375.png`, fullPage: true });

  // Stripe annonce l'échec (doublure) : la page le dit, avec le numéro à appeler.
  const echec = await gestion.request.post("/api/paiement-test", { data: { remboursement: `re_doublure_${cle}`, issue: "echec" } });
  expect(echec.ok()).toBe(true);
  await client.close();
  const petit = await browser.newPage({ baseURL: SITE, viewport: { width: 320, height: 700 } });
  await petit.goto(`/suivi/${jeton}`);
  await expect(petit.locator(".suivi-remboursements .remb-echec")).toHaveText(
    "Le remboursement de CHF 5.00 n'a pas abouti. Le restaurant est prévenu. Appelez-nous au 022 792 16 89.",
  );
  await petit.screenshot({ path: `${RENDUS}/suivi-echec-320.png`, fullPage: true });
  // Rien ne déborde à 320 px.
  expect(await petit.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await petit.close();
});

test("reçu avec TVA : vendeur, numéro de TVA, plats et TVA, sans données du client", async ({ browser }, info) => {
  const prenom = `Recu${info.project.name}`;
  const { jeton } = await commandeRetireePayee(prenom);
  const client = await browser.newPage({ baseURL: SITE, viewport: { width: 375, height: 812 } });
  await client.goto(`/suivi/${jeton}`);
  await client.getByRole("link", { name: "Reçu avec TVA" }).click();
  await expect(client).toHaveURL(new RegExp(`/suivi/${jeton}/recu$`));
  const recu = client.locator(".recu");
  await expect(recu.getByRole("heading", { name: /^Reçu, commande \d+$/ })).toBeVisible();
  await expect(recu).toContainText("Restaurant La Ferme Sàrl");
  await expect(recu).toContainText("TVA CHE-103.250.692 TVA");
  await expect(recu).toContainText("2 × Margherita");
  await expect(recu.locator(".recu-total")).toContainText("Total");
  await expect(recu).toContainText(/dont TVA \d+,?\d* %/);
  await expect(recu).toContainText("Payé en ligne.");
  // Ni nom de famille, ni téléphone, ni e-mail.
  await expect(recu).not.toContainText("079 000 00 00");
  await expect(recu).not.toContainText(`${prenom.toLowerCase()}@laferme.test`);
  await expect(recu).not.toContainText("Test");
  await client.screenshot({ path: `${RENDUS}/recu-375.png`, fullPage: true });
  await client.close();
  const petit = await browser.newPage({ baseURL: SITE, viewport: { width: 320, height: 700 } });
  await petit.goto(`/suivi/${jeton}/recu`);
  await expect(petit.locator(".recu h1")).toBeVisible();
  expect(await petit.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await petit.screenshot({ path: `${RENDUS}/recu-320.png`, fullPage: true });
  await petit.close();
});

test("annulation par le client : désactivée par défaut, aucun bouton au suivi", async ({ browser }, info) => {
  const prenom = `Annul${info.project.name}`;
  const rep = await gestion.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `annul-${prenom}-${Date.now()}`,
      mode: "retrait",
      moyen: "en_ligne",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Test", telephone: "079 000 00 00", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  const id = ((await rep.json()) as { redirection: string }).redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
  const paye = await gestion.request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
  const lien = ((await paye.json()) as { redirection: string }).redirection;
  const client = await browser.newPage({ baseURL: SITE });
  await client.goto(lien);
  await expect(client.getByRole("heading", { name: "Commande reçue" })).toBeVisible();
  await expect(client.getByRole("button", { name: "Annuler ma commande" })).toHaveCount(0);
  // La route le refuse aussi, avec le numéro du restaurant.
  const jeton = lien.match(/suivi\/([A-Za-z0-9_-]+)/)![1];
  const r = await client.request.post("/api/suivi/annuler", { headers: ORIGINE, data: { jeton } });
  expect(r.status()).toBe(403);
  await client.close();
});

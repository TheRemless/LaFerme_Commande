import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage, SITE } from "./site";

// Cagnotte des clients (validée par Jérémy le 15.11.2026) : gagner à la remise, ajuster au back-office, utiliser au
// paiement en ligne, deux paiements en même temps. L'expiration à 12 mois se vérifie en base
// (tests/unit/cagnotte-sql.test.ts) : le temps ne se simule pas ici. La base locale a la cagnotte allumée.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
const capture = (nom: string) => (process.env.RENDUS === "1" ? `docs/rendus/vague-3/client-compte/${nom}` : test.info().outputPath(nom));

let gestion: Page;
let client: Page;
let email: string;
let prenom: string;

async function codeClient(page: Page): Promise<string> {
  const note = page.locator(".note-preversion strong");
  await expect(note).toHaveText(/^\d{6}$/);
  return note.innerText();
}

async function connecterClient(browser: Browser, adresse = email, avant?: (page: Page) => Promise<void>): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: SITE, viewport: { width: 390, height: 844 } })).newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  if (avant) await avant(page);
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill(adresse);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(await codeClient(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: "Vos commandes" })).toBeVisible();
  return page;
}

// Commande en ligne passée avec la session du client, payée, puis acceptée, prête et retirée à la tablette.
async function commandeRemise(page = client, qui = { prenom: "", email: "", telephone: "079 000 00 00" }): Promise<string> {
  const p = qui.prenom || prenom;
  const rep = await page.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `cagnotte-${p}-${Date.now()}`,
      mode: "retrait",
      moyen: "en_ligne",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom: p, nom: "Test", telephone: qui.telephone, email: qui.email || email },
      lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok(), await rep.text()).toBe(true);
  const id = ((await rep.json()) as { redirection: string }).redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
  expect((await page.request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } })).ok()).toBe(true);
  const file = (await (await gestion.request.get("/api/tablette/file")).json()) as { commandes: { id: string; client_prenom: string; heure_proposee: string }[] };
  const c = file.commandes.find((x) => x.client_prenom === p)!;
  for (const corps of [
    { action: "accepter", heure: c.heure_proposee, de: "nouvelle" },
    { action: "statut", vers: "prete", de: "acceptee" },
    { action: "statut", vers: "terminee", de: "prete" },
  ]) {
    expect((await gestion.request.post("/api/tablette/action", { headers: ORIGINE, data: { commande: c.id, ...corps } })).ok()).toBe(true);
  }
  return c.id;
}

const soldeAffiche = async () => {
  await client.goto("/compte");
  const t = await client.locator(".cagnotte-solde").innerText();
  return Math.round(Number(/CHF (\d+\.\d{2})/.exec(t)![1]) * 100);
};

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "bureau", "Un client et un gérant simulés dans ce fichier, à leurs largeurs.");
  prenom = `Cagnotte${passage()}`;
  email = `cagnotte-${passage()}-${Math.random().toString(36).slice(2, 7)}@laferme.test`;
  gestion = await (await browser.newContext({ baseURL: SITE, viewport: { width: 1440, height: 900 } })).newPage();
  await adresseDuCompte(gestion, "cagnotte-bureau@laferme.test");
  await gestion.goto("/gestion/clients");
  await gestion.getByLabel("E-mail", { exact: true }).fill("cagnotte-bureau@laferme.test");
  await gestion.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(gestion));
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  client = await connecterClient(browser);
});

test.afterAll(async () => {
  await gestion?.context().close();
  await client?.context().close();
});

test("gagner : 5 % des plats à la remise, visible dans le compte", async () => {
  await client.goto("/compte");
  // Avant la première commande, la rubrique explique comment gagner.
  await expect(client.locator(".cagnotte-solde")).toHaveText("Vous avez CHF 0.00 dans votre cagnotte.");
  await commandeRemise();
  const solde = await soldeAffiche();
  expect(solde).toBeGreaterThan(0);
  const bloc = client.locator(".cagnotte-compte");
  await expect(bloc).toContainText("Chaque commande livrée ou retirée vous rapporte 5 % du prix des plats.");
  await expect(bloc).toContainText(/À utiliser avant le \d{1,2} \S+ \d{4}\./);
  await bloc.getByText("Historique").click();
  await expect(bloc).toContainText("Gagné, commande");
  await client.screenshot({ path: capture("cagnotte-compte-390.png"), fullPage: true });
});

test("ajuster au back-office : le gérant ajoute CHF 20 avec un motif", async () => {
  await gestion.getByLabel("Nom, téléphone ou e-mail").fill(email);
  const ligne = gestion.getByRole("row", { name: new RegExp(prenom) });
  await expect(ligne).toHaveCount(1);
  await ligne.getByRole("button").first().click();
  const fiche = gestion.getByRole("dialog");
  await fiche.getByRole("tab", { name: "Cagnotte" }).click();
  await fiche.getByLabel("Montant (CHF)").fill("20");
  await fiche.getByLabel("Motif").fill("Geste après réclamation");
  await fiche.getByRole("button", { name: "Ajuster la cagnotte" }).click();
  await expect(gestion.getByText("Cagnotte ajustée.")).toBeVisible();
  await expect(fiche).toContainText("Geste après réclamation");
  await expect(fiche).toContainText("(Cagnotte bureau)");
  const r = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await gestion.screenshot({ path: capture("cagnotte-fiche-client-bureau.png") });
});

test("utiliser au paiement en ligne : déduite, TVA sur le net, ligne au suivi", async () => {
  const avant = await soldeAffiche();
  expect(avant).toBeGreaterThan(2000);
  await client.goto("/commande");
  await client.getByLabel("Prénom").fill(prenom);
  await client.getByLabel("Nom", { exact: true }).fill("Test");
  await client.getByLabel("Téléphone").fill("079 000 00 00");
  const caseCagnotte = client.getByLabel(/^Utiliser ma cagnotte, CHF \d+\.\d{2} disponibles$/);
  await caseCagnotte.check();
  await expect(client.locator(".cagnotte-paiement")).toContainText(/− CHF \d+\.\d{2} sur cette commande\./);
  const r = await new AxeBuilder({ page: client }).include(".cagnotte-paiement").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await expect(client.locator(".sommes")).toContainText("Cagnotte utilisée");
  await client.screenshot({ path: capture("cagnotte-paiement-390.png"), fullPage: true });
  // En partie : CHF 5 seulement, le solde baisse d'autant au paiement.
  await client.getByRole("button", { name: "Changer le montant" }).click();
  await client.getByLabel("Montant à utiliser, en francs").fill("5");
  await client.locator(".cagnotte-paiement").getByRole("button", { name: "Appliquer" }).click();
  await expect(client.locator(".cagnotte-paiement")).toContainText("− CHF 5.00 sur cette commande.");
  await client.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(client).toHaveURL(/paiement-test/);
  await client.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await expect(client).toHaveURL(/\/suivi\//);
  await expect(client.locator(".sommes")).toContainText("Cagnotte utilisée");
  // Rien ne reste de la cagnotte sous le prix des plats (2 pizzas), et jamais de solde négatif.
  expect(await soldeAffiche()).toBe(avant - 500);
  await client.locator(".cagnotte-compte").getByText("Historique").click();
  await expect(client.locator(".cagnotte-compte")).toContainText("Utilisé, commande");
});

test("deux paiements en même temps ne dépensent pas deux fois le même solde", async () => {
  // Le gérant remet CHF 15 : au-dessus du seuil, une seule commande peut tout prendre.
  const fiche = gestion.getByRole("dialog");
  await fiche.getByLabel("Montant (CHF)").fill("15");
  await fiche.getByLabel("Motif").fill("Essai de deux onglets");
  await fiche.getByRole("button", { name: "Ajuster la cagnotte" }).click();
  await expect(fiche).toContainText("Essai de deux onglets");
  const payer = (k: number) =>
    client.request.post("/api/commandes", {
      headers: ORIGINE,
      data: {
        cle: `cagnotte-course-${prenom}-${k}-${Date.now()}`,
        mode: "retrait",
        moyen: "en_ligne",
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        cagnotte: 1_000_000,
        client: { prenom, nom: "Test", telephone: "079 000 00 00", email },
        lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
      },
    });
  const [a, b] = await Promise.all([payer(1), payer(2)]);
  const reponses = [await a.json(), await b.json()] as { redirection?: string; erreur?: string }[];
  expect(reponses.filter((x) => x.redirection).length).toBe(1);
  expect(reponses.find((x) => x.erreur)?.erreur).toMatch(/cagnotte n'atteint plus le montant minimum/);
  expect(await soldeAffiche()).toBeGreaterThanOrEqual(0);
});

test("parrainer : CHF 10 au parrain et au filleul après la première commande retirée du filleul", async ({ browser }) => {
  await client.goto("/compte");
  const bloc = client.locator(".parrainage-compte");
  await expect(bloc).toContainText("Envoyez ce lien à un proche qui n'a jamais commandé chez nous.");
  const lien = await bloc.getByLabel("Votre lien").inputValue();
  expect(lien).toMatch(/\/parrain\/[A-HJ-NP-Z2-9]{8}$/);
  // Rien du client dans le lien : le code seul.
  expect(lien).not.toContain(email.split("@")[0]);
  await client.screenshot({ path: capture("parrainage-compte-390.png"), fullPage: true });
  const avantParrain = await soldeAffiche();

  // Le proche ouvre le lien, puis crée son compte avec une adresse jamais vue.
  const filleulEmail = `filleul-${passage()}-${Math.random().toString(36).slice(2, 7)}@laferme.test`;
  const filleul = await connecterClient(browser, filleulEmail, async (page) => {
    await page.goto(new URL(lien).pathname);
    await expect(page).toHaveURL(/\/$/);
  });
  await expect(filleul.locator(".parrainage-compte")).toContainText("Un proche vous a parrainé.");
  const telephone = `079 ${String(Math.floor(Math.random() * 1e7)).padStart(7, "0").replace(/(\d{3})(\d{2})(\d{2})/, "$1 $2 $3")}`;
  await commandeRemise(filleul, { prenom: `Filleul${passage()}`, email: filleulEmail, telephone });

  await filleul.goto("/compte");
  await filleul.locator(".cagnotte-compte").getByText("Historique").click();
  await expect(filleul.locator(".cagnotte-compte")).toContainText("Parrainage");
  expect(await soldeAffiche()).toBe(avantParrain + 1000);
  await expect(client.locator(".parrainage-compte")).toContainText("1 proche parrainé.");
  await filleul.context().close();
});

test("rubrique Parrainages : le gérant voit le filleul, suspend puis réactive le parrain", async () => {
  await gestion.goto("/gestion/parrainages");
  const fiche = gestion.locator(".bo-parr-fiche", { hasText: email });
  await expect(fiche).toContainText("Crédité");
  await fiche.getByRole("button", { name: "Suspendre ce parrain" }).click();
  await fiche.getByLabel("Pourquoi le suspendre").fill("Essai de la suspension");
  await fiche.getByRole("button", { name: "Suspendre", exact: true }).click();
  await expect(fiche).toContainText("Suspendu");
  await expect(fiche).toContainText("Essai de la suspension");
  const r = await new AxeBuilder({ page: gestion }).include(".bo-parr").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await gestion.screenshot({ path: capture("parrainages-bureau.png"), fullPage: true });
  await gestion.setViewportSize({ width: 390, height: 844 });
  await gestion.reload();
  await expect(fiche).toContainText("Suspendu");
  await gestion.screenshot({ path: capture("parrainages-390.png") });
  await gestion.setViewportSize({ width: 1440, height: 900 });
  await fiche.getByRole("button", { name: "Réactiver ce parrain" }).click();
  await gestion.getByRole("button", { name: "Réactiver", exact: true }).click();
  await expect(fiche.getByRole("button", { name: "Suspendre ce parrain" })).toBeVisible();
});

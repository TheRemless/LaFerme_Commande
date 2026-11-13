import { expect, test, type Page, type Route } from "@playwright/test";
import { adresseDuCompte, SITE } from "./site";

// Back-office : réservé au gérant. Un gérant de test par projet (supabase/local/donnees-test.sql).
// L'import est seulement prévisualisé ici : l'appliquer changerait des prix pendant les autres tests
// (l'application est couverte par tests/unit/gestion.test.ts).
test.describe.configure({ mode: "serial" });

let gestion: Page;

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
}

// Coque du back-office (vague 3) : une adresse par rubrique, menu latéral, tiroir « Menu » sur téléphone.
async function rubrique(page: Page, titre: string) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Rubriques" }).getByRole("link", { name: titre, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: titre })).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
  gestion = await browser.newPage({ baseURL: SITE });
  await connecter(gestion, `gerant-${info.project.name}@laferme.test`);
  await expect(gestion.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("un plat se modifie, ce qui bloque s'affiche, la modification va au journal", async () => {
  await expect(gestion.locator(".ges-bloquants")).toContainText("bloquent la mise en ligne");
  await rubrique(gestion, "Carte");
  await gestion.getByLabel("Chercher un plat").fill("tonno");
  await gestion.getByRole("button", { name: /^Pizza Tonno/ }).click();
  const fiche = gestion.locator(".ges-fiche");
  await fiche.getByLabel("Allergènes").fill("gluten, lait, poisson (test)");
  await fiche.getByRole("button", { name: "Enregistrer le plat" }).click();
  await expect(fiche.getByText("Enregistré.")).toBeVisible();
  await expect(gestion.getByRole("button", { name: /^Pizza Tonno/ })).not.toContainText("allergènes manquants");

  await rubrique(gestion, "Journal");
  await expect(gestion.locator(".ges-journal-liste")).toContainText("Plat Pizza Tonno");
  await expect(gestion.locator(".ges-journal-liste")).toContainText("gluten, lait, poisson (test)");
});

test("l'import du tableau montre les changements avant de les appliquer", async () => {
  await rubrique(gestion, "Importer le tableau");
  await gestion.getByLabel("Fichier .xlsx").setInputFiles("tests/fixtures/validation-remplie.xlsx");
  await gestion.getByRole("button", { name: "Voir les changements" }).click();
  const apercu = gestion.locator(".ges-apercu");
  await expect(apercu).toContainText("Pizza Margherita");
  await expect(apercu).toContainText("19.50 (validé)");
  await expect(apercu).toContainText("Plat inventé");
  await expect(gestion.getByRole("button", { name: /^Appliquer \d+ changements?$/ })).toBeVisible();
});

test("l'export comptable se télécharge en CSV", async () => {
  await rubrique(gestion, "Export comptable");
  const telechargement = gestion.waitForEvent("download");
  await gestion.getByRole("button", { name: "Télécharger le fichier CSV" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^la-ferme-ventes-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const morceaux: Buffer[] = [];
  for await (const m of await fichier.createReadStream()) morceaux.push(m as Buffer);
  expect(Buffer.concat(morceaux).toString("utf8")).toContain("Jour;Numéro;Heure;Mode;Paiement");
});

test("une zone se valide, les horaires et les fermetures s'affichent", async () => {
  await rubrique(gestion, "Livraison et horaires");
  const zone = gestion.locator(".ges-zone").first();
  await zone.getByRole("button", { name: "Enregistrer la zone" }).click();
  await expect(zone.getByText("Enregistré.")).toBeVisible();
  await expect(gestion.locator(".ges-horaire").first()).toBeVisible();
  await expect(gestion.getByRole("heading", { name: "Fermetures" })).toBeVisible();
});

// Audit du gérant, G02 et G04 : une commande livrée se retrouve par le nom et se rembourse en partie.
test("une commande passée se retrouve et se rembourse en partie", async ({}, info) => {
  const ORIGINE = { Origin: SITE };
  const prenom = `Remb${info.project.name}`;
  const rep = await gestion.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `remb-${info.project.name}-${Date.now()}`,
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
  await gestion.request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
  const file = (await (await gestion.request.get("/api/tablette/file")).json()) as { commandes: { id: string; client_prenom: string; heure_proposee: string }[] };
  const c = file.commandes.find((x) => x.client_prenom === prenom)!;
  for (const corps of [
    { action: "accepter", heure: c.heure_proposee, de: "nouvelle" },
    { action: "statut", vers: "prete", de: "acceptee" },
    { action: "statut", vers: "terminee", de: "prete" },
  ]) {
    expect((await gestion.request.post("/api/tablette/action", { headers: ORIGINE, data: { commande: c.id, ...corps } })).ok()).toBe(true);
  }

  await rubrique(gestion, "Commandes");
  await gestion.getByLabel("Nom, téléphone ou numéro").fill(prenom);
  await gestion.getByRole("button", { name: "Chercher" }).click();
  // La liste du jour montre déjà la commande : attendre le résultat de la recherche avant d'ouvrir la fiche.
  await expect(gestion.getByRole("heading", { name: new RegExp(`^Recherche « ${prenom} »`) })).toBeVisible();
  await gestion.getByRole("button", { name: new RegExp(`${prenom} Test`) }).click();
  const fiche = gestion.locator(".ges-fiche-commande");
  await fiche.getByLabel("Montant à rembourser (CHF)").fill("5");
  await fiche.getByLabel("Motif").fill("Geste pour le retard");
  await fiche.getByRole("button", { name: "Rembourser CHF 5" }).click();
  await expect(fiche.getByText("CHF 5.00 remboursés. Le client reçoit un e-mail.")).toBeVisible();
  await expect(fiche.getByText(/CHF 5\.00 par Stripe, fait/)).toBeVisible();
  // Plus que ce qui reste : refusé avec un message clair.
  await fiche.getByLabel("Montant à rembourser (CHF)").fill("500");
  await fiche.getByLabel("Motif").fill("Erreur");
  await fiche.getByRole("button", { name: /^Rembourser/ }).click();
  await expect(fiche.getByText(/Montant invalide|dépasse ce qui reste/)).toBeVisible();
});

// Test instable signalé le 13.11 : la liste du jour, demandée à l'ouverture des commandes, arrivait après
// la recherche sur une machine chargée et remplaçait son résultat. Ici elle arrive toujours en retard.
test("une recherche n'est pas remplacée par la liste du jour arrivée en retard", async ({}, info) => {
  const nom = `Lent${info.project.name}`;
  const retarder = async (route: Route) => {
    const corps = route.request().postDataJSON() as { action?: string; recherche?: string };
    if (corps.action === "liste" && !corps.recherche) await new Promise((ok) => setTimeout(ok, 2000));
    await route.continue();
  };
  await gestion.route("**/api/gestion/commandes", retarder);
  await gestion.getByRole("button", { name: "Carte", exact: true }).click();
  const listeDuJour = gestion.waitForResponse((r) => {
    if (!r.url().endsWith("/api/gestion/commandes")) return false;
    const corps = r.request().postDataJSON() as { action?: string; recherche?: string };
    return corps.action === "liste" && !corps.recherche;
  });
  await gestion.getByRole("button", { name: "Commandes", exact: true }).click();
  await gestion.getByLabel("Nom, téléphone ou numéro").fill(nom);
  await gestion.getByRole("button", { name: "Chercher" }).click();
  const titre = gestion.getByRole("heading", { name: new RegExp(`^Recherche « ${nom} »`) });
  await expect(titre).toBeVisible();
  await listeDuJour;
  await expect(titre).toBeVisible();
  await gestion.unroute("**/api/gestion/commandes", retarder);
});

// Audit du gérant, G03 : l'équipe se gère sans SQL.
test("un membre de l'équipe s'ajoute puis se retire", async ({}, info) => {
  const email = `nouveau-${info.project.name}@laferme.test`;
  await rubrique(gestion, "Équipe");
  await gestion.getByLabel("Prénom").fill(`Nouveau ${info.project.name}`);
  await gestion.getByLabel("E-mail").fill(email);
  await gestion.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(gestion.getByText("Ajouté. Il se connecte avec son e-mail et le code reçu.")).toBeVisible();
  const ligne = gestion.locator(".ges-equipe li", { hasText: email });
  await ligne.getByRole("button", { name: "Retirer" }).click();
  await ligne.getByRole("button", { name: /^Oui, retirer/ }).click();
  await expect(gestion.getByText("Retiré. Ses sessions sont coupées.")).toBeVisible();
  await expect(gestion.getByRole("heading", { name: "Anciens membres" })).toBeVisible();
});

// Audit du gérant, vague 2 : fermer un seul soir, puis le rouvrir depuis le journal (G11).
test("un soir se ferme, puis se rouvre par le journal", async ({}, info) => {
  const jour = info.project.name === "bureau" ? "2027-01-05" : "2027-01-12";
  await rubrique(gestion, "Livraison et horaires");
  const bloc = gestion.locator(".ges-bloc", { has: gestion.getByRole("heading", { name: "Fermetures" }) });
  await bloc.getByLabel("Fermer").selectOption("soir");
  await bloc.getByLabel("Le", { exact: true }).fill(jour);
  await bloc.getByLabel("Motif (pour vous)").fill(`Soirée privée ${info.project.name}`);
  await bloc.getByRole("button", { name: "Ajouter la fermeture" }).click();
  await expect(bloc.getByText("Fermeture ajoutée.")).toBeVisible();
  await expect(bloc).toContainText(`le soir, Soirée privée ${info.project.name}`);

  await rubrique(gestion, "Journal");
  const ligne = gestion.locator(".ges-journal-liste li", { hasText: `Soirée privée ${info.project.name}` }).first();
  await ligne.getByRole("button", { name: "Annuler" }).click();
  await ligne.getByRole("button", { name: "Oui, remettre l'ancienne valeur" }).click();
  await expect(gestion.getByText("Ancienne valeur remise.")).toBeVisible();
  await rubrique(gestion, "Livraison et horaires");
  await expect(gestion.locator(".ges-bloc", { has: gestion.getByRole("heading", { name: "Fermetures" }) })).not.toContainText(`Soirée privée ${info.project.name}`);
});

test("le back-office est fermé au personnel de service, aux clients et aux autres sites", async ({ page, request }, info) => {
  await connecter(page, `cuisine-${info.project.name}@laferme.test`);
  await expect(page.getByText("Réservé au gérant.")).toBeVisible();
  const service = (await page.context().cookies()).find((c) => c.name === "laferme-personnel")!;
  expect((await request.get("/api/gestion/carte", { headers: { Cookie: `laferme-personnel=${service.value}` } })).status()).toBe(403);
  expect((await request.get("/api/gestion/carte")).status()).toBe(401);
  expect((await request.get("/api/gestion/export?debut=2026-01-01&fin=2026-12-31")).status()).toBe(401);
  // Équipe et commandes passées : gérant seulement, requête du site seulement (audit du gérant).
  const commeService = { Cookie: `laferme-personnel=${service.value}`, Origin: SITE };
  expect((await request.get("/api/gestion/personnel", { headers: commeService })).status()).toBe(403);
  expect((await request.post("/api/gestion/personnel", { headers: commeService, data: { action: "ajouter", email: "x@y.ch", nom: "X", role: "gerant" } })).status()).toBe(403);
  expect((await request.post("/api/gestion/commandes", { headers: commeService, data: { action: "liste" } })).status()).toBe(403);
  expect((await request.post("/api/gestion/commandes", { headers: { Origin: SITE }, data: { action: "liste" } })).status()).toBe(401);
  const gerant = (await gestion.context().cookies()).find((c) => c.name === "laferme-personnel")!;
  const pirate = await request.post("/api/gestion/carte", {
    headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${gerant.value}` },
    data: { type: "plat", slug: "pizza-tonno", champs: { prix: "1" } },
  });
  expect(pirate.status()).toBe(403);
  const pirateRemb = await request.post("/api/gestion/commandes", {
    headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${gerant.value}` },
    data: { action: "rembourser", id: "00000000-0000-0000-0000-000000000000", montant: "1", motif: "Pirate", cle: "pirate-0000000" },
  });
  expect(pirateRemb.status()).toBe(403);
});

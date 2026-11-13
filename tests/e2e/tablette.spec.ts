import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adresseDuCompte, SITE } from "./site";

// Tablette du restaurant : connexion du personnel, file, accepter, statuts, refus et remboursement, rupture.
// Un membre d'équipe par projet (supabase/local/donnees-test.sql) : un seul code par e-mail toutes les 30 s.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let tablette: Page;

// Bureau et mobile tournent en même temps contre la même base. Une clé d'idempotence identique (même
// milliseconde) renvoie la même commande aux deux projets : chaque clé porte le projet et un tirage au hasard.
function cle(prefixe: string): string {
  return `${prefixe}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Prénom accentué (recherche au comptoir) : la clé d'idempotence et l'e-mail restent en ASCII.
const ascii = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Ruptures : état commun à toute la base. Chaque projet épuise son propre supplément et son propre plat,
// sinon l'un remet « Disponible » pendant que l'autre attend « Épuisé ».
const RUPTURES: Record<string, { supplement: string; recherchePlat: string; plat: string; slug: string }> = {
  bureau: { supplement: "Burrata", recherchePlat: "miss Italia", plat: "Pizza Miss Italia", slug: "pizza-miss-italia" },
  mobile: { supplement: "Gorgonzola", recherchePlat: "capricciosa", plat: "Pizza Capricciosa", slug: "pizza-capricciosa" },
};
const rupturesDuProjet = () => RUPTURES[test.info().project.name];

async function commander(request: APIRequestContext, prenom: string, moyen: "comptoir" | "en_ligne"): Promise<{ numero: string; suivi: string }> {
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: cle(`tablette-${ascii(prenom)}`),
      mode: "retrait",
      moyen,
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Test", telephone: "079 000 00 00", email: `${ascii(prenom).toLowerCase()}@laferme.test` },
      lignes: [
        { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" },
        { slug: "pasta-alla-carbonara", qte: 1, choix: { "choix-pates": ["Penne"] }, retraits: [], note: "" },
      ],
    },
  });
  expect(rep.ok()).toBe(true);
  let { redirection } = (await rep.json()) as { redirection: string };
  if (moyen === "en_ligne") {
    const id = redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
    const p = await request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
    redirection = ((await p.json()) as { redirection: string }).redirection;
  }
  const page = await (await request.get(redirection)).text();
  // Le HTML rendu glisse un commentaire React entre « Commande » et le numéro.
  return { numero: page.match(/Commande (?:<!-- -->)?(\d+)/)![1], suivi: redirection };
}

// Tableau (vague 3) : « En cours », « À l'avance », « Terminées » et la recherche affichent une ligne par
// commande ; toucher la ligne ouvre son détail (la carte complète) à côté. Sans effet si elle est déjà ouverte.
async function ouvrirCommande(page: Page, numero: string) {
  const ligne = page.locator(".tab-ligne", { has: page.locator(".tab-ligne-num", { hasText: new RegExp(`^${numero}$`) }) });
  const corps = ligne.locator(".tab-ligne-corps");
  await expect(corps).toBeVisible({ timeout: 15_000 });
  if ((await corps.getAttribute("aria-expanded")) !== "true") await corps.click();
}

test.beforeAll(async ({ browser }, info) => {
  tablette = await browser.newPage({ baseURL: SITE });
  await adresseDuCompte(tablette, `equipe-${info.project.name}@laferme.test`);
  await tablette.goto("/tablette");
  await tablette.getByLabel("E-mail", { exact: true }).fill(`equipe-${info.project.name}@laferme.test`);
  await tablette.getByRole("button", { name: "Recevoir un code" }).click();
  const code = tablette.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await tablette.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await tablette.getByRole("button", { name: "Me connecter" }).click();
  await tablette.getByRole("button", { name: "Continuer sans son" }).click();
  await expect(tablette.getByRole("button", { name: /^À accepter/ })).toBeVisible();
});

test.afterAll(async () => {
  await tablette.close();
});

test("une commande arrive, on l'accepte, puis prête, retirée et payée", async ({ request }) => {
  const { numero, suivi } = await commander(request, "Alice", "comptoir");
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await expect(carte).toBeVisible({ timeout: 10_000 });
  await expect(carte).toContainText("CHOIX Penne");
  await expect(carte).toContainText("À encaisser au comptoir");
  // Bandeau des commandes à accepter. Une imprimante laissée hors ligne par impression.spec.ts ajoute le sien.
  await expect(tablette.locator(".tab-attente", { hasText: /à accepter/ })).toBeVisible();

  await carte.getByRole("button", { name: "+15 min" }).click();
  await carte.getByRole("button", { name: /^Accepter pour/ }).click();
  // Retrait pour dans plus de 30 minutes : il attend dans « À l'avance », tickets prévus 30 minutes avant (SS-11).
  await tablette.getByRole("button", { name: /^À l'avance/ }).click();
  await ouvrirCommande(tablette, numero);
  await expect(carte).toContainText("Tickets prévus");
  await carte.getByRole("button", { name: "Imprimer maintenant" }).click();
  await tablette.getByRole("button", { name: /^En cours/ }).click();
  await expect(carte).toContainText("Acceptée pour");
  // Le client voit l'heure confirmée sur son suivi.
  expect(await (await request.get(suivi)).text()).toContain("Prête vers");

  await carte.getByRole("button", { name: "Prête au comptoir" }).click();
  await expect(carte).toContainText("Prête au comptoir pour");
  // Retrait payé au comptoir : un seul geste, retirée et encaissée (audit du gérant, G01).
  await carte.getByRole("button", { name: "Retirée et payée" }).click();
  await tablette.getByRole("button", { name: /^Terminées/ }).click();
  await expect(carte).toContainText(/Retirée pour \d{2}h\d{2}/);
  await expect(carte).toContainText("Encaissée CHF");
});

// Vague 3, rush : au comptoir, « c'est pour Bérénice » ou « le 42 », quel que soit l'onglet ouvert.
test("recherche au comptoir : par numéro ou par nom, toutes listes confondues", async ({ request }, info) => {
  // Bureau et mobile tournent en même temps : chacun son prénom, pour ne trouver que sa commande.
  const [prenom, tape] = info.project.name === "bureau" ? ["Bérénice", "berenice"] : ["Héloïse", "HELOISE"];
  const { numero } = await commander(request, prenom, "comptoir");
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await tablette.getByRole("button", { name: /^Terminées/ }).click();
  await expect(carte).toBeHidden();
  const champ = tablette.getByRole("searchbox", { name: "Chercher une commande par numéro, nom ou téléphone" });
  await champ.fill(numero);
  await expect(tablette.locator(".tab-ligne")).toHaveCount(1, { timeout: 10_000 });
  await ouvrirCommande(tablette, numero);
  await expect(carte).toBeVisible();
  await champ.fill(tape);
  await expect(carte).toBeVisible();
  await expect(tablette.locator(".tab-recherche-info")).toContainText(`pour « ${tape} »`);
  // Accepter depuis la recherche : la carte reste dans les résultats, avec son nouvel état.
  await carte.getByRole("button", { name: /^Accepter pour/ }).click();
  await expect(carte).toContainText("Acceptée pour");
  // Sur téléphone, le détail couvre la liste : on le ferme d'abord.
  await tablette.locator(".tab-detail-tete").getByRole("button", { name: "Fermer" }).click();
  await expect(carte).toBeHidden();
  await tablette.getByRole("button", { name: "Effacer la recherche" }).click();
  await expect(champ).toHaveValue("");
  await expect(tablette.locator(".tab-recherche-info")).toBeHidden();
});

test("refus d'une commande payée en ligne : remboursée, le client est prévenu", async ({ request }) => {
  const { numero, suivi } = await commander(request, "Bruno", "en_ligne");
  await tablette.getByRole("button", { name: /^À accepter/ }).click();
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await expect(carte).toBeVisible({ timeout: 10_000 });
  await carte.getByRole("button", { name: "Refuser" }).click();
  const bouton = carte.getByRole("button", { name: /^Refuser et rembourser/ });
  await expect(bouton).toBeDisabled();
  await carte.getByRole("button", { name: "La cuisine est complète pour ce service." }).click();
  await bouton.click();
  await expect(tablette.locator(".tab-message")).toHaveText("Commande refusée et remboursée.");
  const page = await (await request.get(suivi)).text();
  // Le client lit « annulée » partout (vague 3, client-compte) ; la tablette garde « refusée ».
  expect(page).toContain("Commande annulée par le restaurant");
  expect(page).toContain("Remboursée");
});

// Audit du gérant, G07 option A : un plat manque sur une commande acceptée, remboursé en partie.
test("il manque un plat : remboursé en partie, le client est prévenu", async ({ request }) => {
  const { numero } = await commander(request, "Carla", "en_ligne");
  await tablette.getByRole("button", { name: /^À accepter/ }).click();
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await expect(carte).toBeVisible({ timeout: 10_000 });
  await carte.getByRole("button", { name: /^Accepter pour/ }).click();
  await tablette.getByRole("button", { name: /^En cours/ }).click();
  await ouvrirCommande(tablette, numero);
  await carte.getByRole("button", { name: "Il manque…" }).click();
  await carte.getByRole("button", { name: "1 × Pasta alla carbonara" }).click();
  await carte.getByRole("button", { name: "Calculer le montant" }).click();
  await expect(carte.getByText(/^À rembourser : CHF \d+\.\d{2} \(1 × Pasta alla carbonara\)\.$/)).toBeVisible();
  await carte.getByRole("button", { name: "Confirmer et prévenir le client" }).click();
  await expect(carte.getByText(/remboursés\. Le client est prévenu par e-mail\./)).toBeVisible();
  await carte.getByRole("button", { name: "Fermer" }).click();
  await expect(carte.locator(".tab-manque")).toContainText("Manque : 1 × Pasta alla carbonara");
});

test("supplément épuisé : refusé à la commande, puis revient", async ({ request }) => {
  await tablette.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  const { supplement } = rupturesDuProjet();
  await tablette.getByLabel("Chercher un plat ou un supplément").fill(supplement);
  // Le supplément seul, pas les plats dont le nom le contient.
  const ligne = tablette.locator(".tab-plats li").filter({ hasText: new RegExp(`^${supplement}\\s*Supplément`) });
  await ligne.getByRole("button", { name: "Disponible" }).click();
  await expect(ligne.getByRole("button", { name: "Épuisé" })).toBeVisible();
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: cle("rupture-supplement"), mode: "retrait", moyen: "comptoir", quand: { type: "asap" }, heure: "2026-11-10T19:05",
      client: { prenom: "Dora", nom: "Test", telephone: "079 000 00 00", email: "dora@laferme.test" },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: { "supplements-pizza": [supplement] }, retraits: [], note: "" }],
    },
  });
  expect((await rep.json()).erreur).toContain(`${supplement} : épuisé pour aujourd'hui.`);
  await ligne.getByRole("button", { name: "Épuisé" }).click();
  await expect(ligne.getByRole("button", { name: "Disponible" })).toBeVisible();
  await tablette.getByRole("button", { name: "Fermer les réglages" }).click();
});

test("rupture du jour : le plat est grisé sur la carte, puis revient", async ({ page }) => {
  await tablette.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  const { recherchePlat, plat, slug } = rupturesDuProjet();
  await tablette.getByLabel("Chercher un plat").fill(recherchePlat);
  const ligne = tablette.locator(".tab-plats li", { hasText: plat });
  await ligne.getByRole("button", { name: "Disponible" }).click();
  await expect(ligne.getByRole("button", { name: "Épuisé" })).toBeVisible();
  await page.addInitScript(() =>
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() })),
  );
  // Le plat de ce projet, pas celui que l'autre projet a peut-être épuisé au même moment. La carte est en
  // cache : un rendu commencé juste avant la rupture (par l'autre projet) et fini après la purge reste en
  // cache jusqu'à sa régénération (revalidate = 60 s). On recharge jusque-là ; le serveur, lui, refuse le
  // plat épuisé dès la rupture.
  test.setTimeout(120_000);
  await expect
    .poll(
      async () => {
        await page.goto("/carte");
        return page.locator(`li.plat[data-slug="${slug}"]`).innerText();
      },
      { timeout: 80_000, intervals: [1_000, 5_000] },
    )
    .toContain("Épuisé pour aujourd'hui.");
  await ligne.getByRole("button", { name: "Épuisé" }).click();
  await expect(ligne.getByRole("button", { name: "Disponible" })).toBeVisible();
  await tablette.getByRole("button", { name: "Fermer les réglages" }).click();
});

test("la tablette est fermée aux clients et aux autres sites", async ({ request }) => {
  expect((await request.get("/api/tablette/file")).status()).toBe(401);
  expect((await request.post("/api/tablette/action", { headers: ORIGINE, data: { commande: "00000000-0000-0000-0000-000000000000", action: "encaisser" } })).status()).toBe(401);
  // Même avec la session de la tablette, une requête d'un autre site est refusée.
  const cookies = await tablette.context().cookies();
  const session = cookies.find((c) => c.name === "laferme-personnel")!;
  const pirate = await request.post("/api/tablette/reglages", {
    headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${session.value}` },
    data: { pause: "sans-fin" },
  });
  expect(pirate.status()).toBe(403);
  // Une session client ne donne pas accès à la tablette.
  expect((await request.get("/api/tablette/file", { headers: { Cookie: `laferme-session=${session.value}` } })).status()).toBe(401);
});

// Lot 8f : la file propose son rythme de relecture. Une commande en cours garde la tablette à 15 s.
test("rythme de relecture : 15 s tant qu'une commande est en cours", async ({ request }) => {
  await commander(request, "Rythme", "comptoir");
  const r = await (await tablette.request.get("/api/tablette/file")).json();
  expect(r.relecture_s).toBe(15);
});

import { expect, test, type Page } from "@playwright/test";
import { SITE } from "./site";

// Comptes clients : connexion par code (affiché à l'écran par la doublure, adresses en .test seulement),
// case « créer mon compte », historique, recommander, export, déconnexion et suppression.

let n = 0;
// Chaque test a son e-mail et son « IP » (x-forwarded-for, cru seulement sur le poste local) :
// les limites de débit d'un test ne gênent pas les autres.
async function identite(page: Page, nom: string) {
  // Le tirage au hasard évite que deux processus de test (même milliseconde, même compteur) aient le même e-mail.
  const id = `${nom}-${test.info().project.name}-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.6.${n}.${Math.floor(Math.random() * 250)}` });
  return `${id}@laferme.test`;
}

async function codeAffiche(page: Page): Promise<string> {
  const note = page.locator(".note-preversion strong");
  await expect(note).toHaveText(/^\d{6}$/);
  return note.innerText();
}

async function seConnecter(page: Page, email: string) {
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(await codeAffiche(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: "Vos commandes" })).toBeVisible();
}

async function preparerRetrait(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("laferme.choix.v1")) return;
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem(
      "laferme.panier.v1",
      JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }),
    );
  });
}

test("connexion par code, mauvais code refusé, puis espace client", async ({ page }) => {
  const email = await identite(page, "connexion");
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const bon = await codeAffiche(page);
  await page.getByLabel("Code à 6 chiffres").fill(bon === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.locator(".panier-alerte")).toContainText("Code incorrect ou expiré");
  // Délai croissant : une seconde après le premier essai faux.
  await page.waitForTimeout(1100);
  await page.getByLabel("Code à 6 chiffres").fill(bon);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByText("Pas encore de commande avec ce compte.")).toBeVisible();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(email);
});

test("préversion sans serveur d'envoi : une vraie adresse n'obtient pas de code à l'écran", async ({ page }) => {
  await identite(page, "vraie");
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill("quelquun@gmail.com");
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await expect(page.locator(".panier-alerte")).toContainText("utilisez une adresse qui finit par .test");
});

test("commande en invité avec « créer mon compte », code sur le suivi, puis recommander", async ({ page }) => {
  const email = await identite(page, "invite");
  await preparerRetrait(page);
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Léa");
  await page.getByLabel("Nom", { exact: true }).fill("Essai");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByText("Créer mon compte avec cet e-mail").click();
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
  const numero = (await page.locator(".suivi-num").innerText()).match(/Commande (\d+)/)![1];

  await expect(page.getByRole("heading", { name: "Créez votre compte" })).toBeVisible();
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(await codeAffiche(page));
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Compte créé. Cette commande est dans votre compte.")).toBeVisible();

  await page.getByRole("link", { name: "Voir mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Léa" })).toBeVisible();
  await expect(page.locator(".ancienne-num")).toHaveText(numero);
  await expect(page.locator(".ancienne-lignes")).toContainText("2 × Margherita");
  await expect(page.getByLabel("Téléphone")).toHaveValue("079 000 00 00");

  // Recommander avec un panier en cours : confirmation d'abord.
  await page.evaluate(() =>
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 5, choix: {}, retraits: [], note: "" }] })),
  );
  await page.getByRole("button", { name: "Recommander la même chose" }).click();
  await page.getByRole("button", { name: "Garder mon panier" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("laferme.panier.v1")!).lignes[0].qte)).toBe(5);
  // Puis on remplace : mêmes plats que la commande, prix actuels, panier contrôlé à l'heure choisie (CM-19).
  await page.getByRole("button", { name: "Recommander la même chose" }).click();
  await page.getByRole("button", { name: "Remplacer mon panier" }).click();
  await expect(page).toHaveURL(/\/panier/);
  await expect(page.getByText("2 plats remis dans votre panier.")).toBeVisible();
  const panier = await page.evaluate(() => JSON.parse(localStorage.getItem("laferme.panier.v1") ?? "{}"));
  expect(panier.lignes).toEqual([{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }]);
});

test("connecté, la commande va dans le compte et les coordonnées sont déjà remplies", async ({ page }) => {
  const email = await identite(page, "connecte");
  await seConnecter(page, email);
  await page.getByLabel("Prénom").fill("Max");
  await page.getByLabel("Nom", { exact: true }).fill("Test");
  await page.getByLabel("Téléphone").fill("079 111 22 33");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Enregistré.")).toBeVisible();

  // Connecté, l'accueil en cache reçoit ses adresses par /api/accueil (aucune tant qu'il n'a pas été livré).
  const accueil = await page.request.get("/api/accueil");
  expect(accueil.status()).toBe(200);
  expect((await accueil.json()).adresses).toEqual([]);

  await preparerRetrait(page);
  await page.goto("/commande");
  await expect(page.getByLabel("Prénom")).toHaveValue("Max");
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(email);
  await expect(page.getByText(`Connecté avec ${email}`)).toBeVisible();
  await expect(page.getByText("Créer mon compte avec cet e-mail")).toHaveCount(0);
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
  await page.goto("/compte");
  await expect(page.locator(".ancienne")).toHaveCount(1);
});

test("export des données puis suppression du compte, case de confirmation obligatoire", async ({ page }) => {
  const email = await identite(page, "depart");
  await seConnecter(page, email);

  const telechargement = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger mes données" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^la-ferme-mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
  const morceaux: Buffer[] = [];
  for await (const m of await fichier.createReadStream()) morceaux.push(m as Buffer);
  const contenu = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
  expect(contenu.compte.email).toBe(email);
  expect(JSON.stringify(contenu)).not.toMatch(/[0-9a-f]{64}/);

  const supprimer = page.getByRole("button", { name: "Supprimer définitivement" });
  await expect(supprimer).toBeDisabled();
  await page.getByText("Je veux supprimer mon compte").click();
  await supprimer.click();
  await expect(page.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
});

test("deux appareils, puis « déconnecter tous mes appareils »", async ({ page, browser }) => {
  // Un second code pour le même e-mail n'est permis qu'après 30 secondes (limite de débit).
  test.setTimeout(75_000);
  const email = await identite(page, "partout");
  await seConnecter(page, email);
  await page.waitForTimeout(31_000);
  const autre = await browser.newPage({ baseURL: SITE });
  await autre.setExtraHTTPHeaders({ "x-forwarded-for": `10.7.${n}.1` });
  await seConnecter(autre, email);
  await page.reload();
  await expect(page.getByText("Connecté sur 2 appareils.")).toBeVisible();
  await page.getByRole("button", { name: "Déconnecter tous mes appareils" }).click();
  await expect(page.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await autre.reload();
  await expect(autre.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await autre.close();
});

test("un second code tout de suite pour le même e-mail est refusé avec un délai", async ({ page }) => {
  const email = await identite(page, "debit");
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await codeAffiche(page);
  await page.getByRole("button", { name: "Renvoyer un code" }).click();
  // CM-16 : pas « trop d'essais » quand le client n'a fait aucun essai faux.
  await expect(page.locator(".panier-alerte")).toContainText(/Un nouveau code pourra partir dans \d+ secondes?\./);
});

test("le serveur refuse les requêtes d'un autre site et sans session", async ({ request }) => {
  const ailleurs = { headers: { Origin: "https://pirate.example" } };
  expect((await request.post("/api/compte/code", { ...ailleurs, data: { email: "a@laferme.test" } })).status()).toBe(403);
  expect((await request.post("/api/compte/connexion", { ...ailleurs, data: { email: "a@laferme.test", code: "123456" } })).status()).toBe(403);
  // Sans en-tête Origin ni Sec-Fetch-Site : refusé aussi.
  expect((await request.post("/api/compte/code", { data: { email: "a@laferme.test" } })).status()).toBe(403);
  const site = { headers: { Origin: SITE } };
  expect((await request.post("/api/compte/supprimer", { ...site, data: { confirmer: true } })).status()).toBe(401);
  expect((await request.post("/api/compte/recommander", { ...site, data: { commande: "00000000-0000-0000-0000-000000000000" } })).status()).toBe(401);
  expect((await request.get("/api/compte/export")).status()).toBe(401);
});

test("même réponse pour un compte existant et un e-mail inconnu", async ({ page, request }) => {
  const email = await identite(page, "enum");
  await seConnecter(page, email);
  const site = { Origin: SITE };
  const demande = (adresse: string, ip: string) => request.post("/api/compte/code", { headers: { ...site, "x-forwarded-for": ip }, data: { email: adresse } });
  // L'e-mail inconnu reçoit lui aussi un premier code : les deux sont alors dans le même état.
  expect((await demande(`x-${email}`, "10.8.0.3")).status()).toBe(200);
  const existant = await demande(email, "10.8.0.1");
  const inconnu = await demande(`x-${email}`, "10.8.0.2");
  expect(existant.status()).toBe(inconnu.status());
  // Même message ; le compte à rebours peut différer d'une seconde selon l'heure de la demande précédente.
  const sansSecondes = async (r: typeof existant) => JSON.stringify(await r.json()).replace(/\d+ secondes?/g, "N secondes");
  expect(await sansSecondes(existant)).toBe(await sansSecondes(inconnu));
});

import AxeBuilder from "@axe-core/playwright";
import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Livreurs : la tablette (1024 px) donne les commandes, deux téléphones (375 px tactiles) les livrent.
// Cas : deux livreurs, réattribution, déconnexion en tournée, annulation pendant la tournée, réseau
// coupé (geste renvoyé sans doublon), client absent. Un seul projet : les comptes ont un code par 30 s.
// 60 s par cas : le runner GitHub a deux processeurs. Les cas ne supposent pas une liste vide (un essai
// relancé retrouve les commandes de l'essai raté sur le même serveur).
test.describe.configure({ mode: "serial", timeout: 60_000 });

const BASE = SITE;
const ORIGINE = { Origin: BASE };
const TELEPHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
let tablette: Page;
let marco: Page;
let ines: Page;
let contexteMarco: BrowserContext;

async function connecter(page: Page, url: string, email: string) {
  await adresseDuCompte(page, email);
  await page.goto(url);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
}

async function telephone(browser: Browser, email: string): Promise<{ page: Page; contexte: BrowserContext }> {
  const contexte = await browser.newContext({ ...TELEPHONE, baseURL: BASE });
  const page = await contexte.newPage();
  await connecter(page, "/livreur", email);
  await expect(page.getByRole("heading", { name: "Mes livraisons" })).toBeVisible();
  return { page, contexte };
}

let n = 0;
// Commande en livraison payée (doublure de paiement), puis acceptée sur la tablette. Renvoie son numéro.
const jetons = new Map<string, string>();
async function livraison(request: APIRequestContext, adresse: { rue: string; numero: string; npa: string; localite: string }): Promise<string> {
  n += 1;
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `livreurs-${n}-${Date.now()}`,
      mode: "livraison",
      moyen: "en_ligne",
      adresse,
      details: { etage: "3", sonnette: `Sonnette${n}`, code: "4512", instructions: "Porte de gauche" },
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom: `Client${n}`, nom: "Discret", telephone: "079 000 00 00", email: `client${n}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 4, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok(), await rep.text()).toBe(true);
  const { redirection } = (await rep.json()) as { redirection: string };
  const id = redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
  const p = await request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } });
  const suivi = ((await p.json()) as { redirection: string }).redirection;
  const numero = (await (await request.get(suivi)).text()).match(/Commande (?:<!-- -->)?(\d+)/)![1];
  jetons.set(numero, suivi.split("/suivi/")[1].split(/[?#]/)[0]);
  await tablette.getByRole("button", { name: /^À accepter/ }).click();
  const carte = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
  await carte.getByRole("button", { name: /^Accepter pour/ }).click();
  await expect(carte).toHaveCount(0);
  return numero;
}

// Tableau (vague 3) : « En cours », « À l'avance », « Terminées » et la recherche affichent une ligne par
// commande ; toucher la ligne ouvre son détail (la carte complète) à côté. Sans effet si elle est déjà ouverte.
async function ouvrirCommande(page: Page, numero: string) {
  // Celle du jour : un même numéro reçu un autre jour porte « tab-autre-jour » (les numéros recommencent chaque jour).
  const ligne = page.locator(".tab-ligne:not(.tab-autre-jour)", { has: page.locator(".tab-ligne-num", { hasText: new RegExp(`^${numero}$`) }) });
  const corps = ligne.locator(".tab-ligne-corps");
  await expect(corps).toBeVisible({ timeout: 15_000 });
  if ((await corps.getAttribute("aria-expanded")) !== "true") await corps.click();
}

// Accessibilité (axe-core, WCAG 2.1 A et AA) des deux écrans avec de vraies livraisons à l'écran.
async function axe(page: Page, nom: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const resume = r.violations.map((v) => `${nom} ${v.id} (${v.impact}) : ${v.nodes.map((x) => x.target.join(" ")).slice(0, 4).join(" | ")}`);
  expect.soft(resume, resume.join("\n")).toEqual([]);
}

const ONEX = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" };
const ONEX_BIS = { rue: "Avenue du Gros-Chêne", numero: "38", npa: "1213", localite: "Onex" };
const LIGNON = { rue: "Avenue du Lignon", numero: "40", npa: "1219", localite: "Le Lignon" };

const ongletLivraisons = () => tablette.getByRole("button", { name: /^Livraisons/ });
const aAttribuer = (numero: string) => tablette.locator(".liv-carte", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${numero}$`) }) });
const tournee = (nom: string) => tablette.locator(".liv-tournee", { has: tablette.getByRole("heading", { name: nom, exact: true }) });
// L'ordre relatif de deux commandes, sur la tablette (N° 12) ou le téléphone (n° 12).
async function avant(liste: ReturnType<Page["locator"]>, prefixe: string, premier: string, second: string) {
  await expect(async () => {
    const textes = await liste.allInnerTexts();
    const i = textes.findIndex((t) => t.includes(`${prefixe} ${premier} `) || t.includes(`${prefixe} ${premier}\n`) || t.endsWith(`${prefixe} ${premier}`));
    const j = textes.findIndex((t) => t.includes(`${prefixe} ${second} `) || t.includes(`${prefixe} ${second}\n`) || t.endsWith(`${prefixe} ${second}`));
    expect(i, textes.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(j, textes.join(" | ")).toBeGreaterThan(i);
  }).toPass({ timeout: 10_000 });
}

const arret = (page: Page, numero: string) => page.locator(".liv-arret", { hasText: `n° ${numero}` });

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "bureau", "Téléphones et tablette simulés dans ce fichier.");
  tablette = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1024, height: 768 } })).newPage();
  await connecter(tablette, "/tablette", "livraison@laferme.test");
  await tablette.getByRole("button", { name: "Continuer sans son" }).click();
  ({ page: marco, contexte: contexteMarco } = await telephone(browser, "marco@laferme.test"));
  ({ page: ines } = await telephone(browser, "ines@laferme.test"));
});

test.afterAll(async () => {
  await tablette?.context().close();
  await marco?.context().close();
  await ines?.context().close();
});

test("un livreur n'entre ni sur la tablette ni dans ses routes", async () => {
  await expect((await marco.request.get("/api/tablette/file")).status()).toBe(403);
  await expect((await marco.request.get("/api/tablette/livraisons")).status()).toBe(403);
  await expect((await marco.request.get("/api/gestion/personnel")).status()).toBe(403);
  // La tablette n'a pas accès à la page des livreurs non plus.
  expect((await tablette.request.get("/api/livreur")).status()).toBe(403);
  const page = await contexteMarco.newPage();
  await page.goto("/tablette");
  await expect(page.getByRole("link", { name: "Mes livraisons" })).toBeVisible();
  await page.close();
});

test("tournée de deux livraisons, ordre proposé, Je pars, Livrée : plus rien sur le téléphone", async ({ request }) => {
  const a = await livraison(request, LIGNON);
  const b = await livraison(request, ONEX);
  await ongletLivraisons().click();
  await aAttribuer(a).getByRole("button", { name: "À Marco" }).click();
  await aAttribuer(b).getByRole("button", { name: "À Marco" }).click();
  // Ordre proposé : Onex (zone 1) avant Le Lignon (zone 2).
  await avant(tournee("Marco").locator(".liv-arret-tab"), "N°", b, a);
  await tablette.screenshot({ path: "test-results/livreurs/tablette-1024-tournee.png", fullPage: true });
  await axe(tablette, "tablette-livraisons");

  await marco.reload();
  await avant(marco.locator(".liv-arret"), "n°", b, a);
  const premier = arret(marco, b);
  await expect(premier).toContainText("Avenue du Gros-Chêne 20");
  await expect(premier).toContainText("Code 4512");
  await expect(premier).toContainText("4 articles, dont 4 pizzas. Payée en ligne");
  await expect(premier.getByRole("link", { name: /^Appeler Client/ })).toHaveAttribute("href", "tel:0790000000");
  await expect(premier.getByRole("link", { name: "Itinéraire" })).toHaveAttribute("href", /destination=Avenue%20du%20Gros-Ch%C3%AAne%2020/);
  // Pas le nom de famille du client sur le téléphone.
  await expect(marco.locator(".livreur")).not.toContainText("Discret");
  await marco.screenshot({ path: "test-results/livreurs/livreur-375-tournee.png", fullPage: true });
  await axe(marco, "livreur");

  // À la main : Le Lignon d'abord.
  // Un cran à la fois, jusqu'à passer devant b (une commande restée d'un essai raté peut être entre les deux).
  const rangDe = async (numero: string) => (await tournee("Marco").locator(".liv-arret-tab").allInnerTexts()).findIndex((t) => t.includes(`N° ${numero} `));
  for (let essai = 0; essai < 6 && (await rangDe(a)) > (await rangDe(b)); essai++) {
    const rang = await rangDe(a);
    await tournee("Marco").getByRole("button", { name: `Passer le ${a} plus tôt` }).click();
    await expect.poll(() => rangDe(a)).toBe(rang - 1);
  }
  await avant(tournee("Marco").locator(".liv-arret-tab"), "N°", a, b);
  await expect(tournee("Marco").getByRole("button", { name: "Reprendre l'ordre proposé" })).toBeVisible();
  await marco.reload();
  await avant(marco.locator(".liv-arret"), "n°", a, b);

  await marco.getByRole("button", { name: /^Je pars avec les \d+$/ }).click();
  await expect(arret(marco, a)).toContainText("En route.");
  await expect(arret(marco, b)).toContainText("En route.");
  for (const n of [a, b]) {
    await expect(tournee("Marco").locator(".liv-arret-tab", { hasText: `N° ${n} ` })).toContainText("En route depuis", { timeout: 15_000 });
  }
  // D'une main (vague 3) : en route, l'arrêt en cours a « Livrée » sous le pouce, le suivant est replié.
  await expect(marco.locator(".liv-pouce")).toContainText(`Livrée, n° ${a}`);
  await expect(arret(marco, b)).toHaveClass(/liv-arret-replie/);
  await arret(marco, a).getByRole("button", { name: "Livrée" }).click();
  await expect(arret(marco, a)).toHaveCount(0);
  await arret(marco, b).getByRole("button", { name: "Livrée" }).click();
  await expect(arret(marco, b)).toHaveCount(0);
  await tablette.getByRole("button", { name: /^Terminées/ }).click();
  await ouvrirCommande(tablette, a);
  // La commande de ce test : une « N° a » d'un autre jour peut rester dans « Terminées » (remboursement échoué, SS-04).
  const carte = tablette.locator(".tab-commande:not(.tab-autre-jour)", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${a}$`) }) });
  await expect(carte).toContainText(/Livrée/, { timeout: 15_000 });
});

test("deux livreurs et réattribution : l'ancien ne voit plus l'adresse", async ({ request }) => {
  const c = await livraison(request, ONEX_BIS);
  await ongletLivraisons().click();
  await aAttribuer(c).getByRole("button", { name: "À Marco" }).click();
  await marco.reload();
  await arret(marco, c).getByRole("button", { name: "Je pars" }).click();
  await expect(arret(marco, c)).toContainText("En route.");
  await ines.reload();
  await expect(arret(ines, c)).toHaveCount(0);

  // La ligne de cette commande : au réessai, la tournée de Marco garde celles du premier passage.
  await tournee("Marco").locator("li.liv-arret-tab", { has: tablette.getByText(`N° ${c}`, { exact: true }) }).getByRole("button", { name: "Donner à Inès" }).click();
  await marco.reload();
  await expect(arret(marco, c)).toHaveCount(0);
  await expect(marco.locator(".liv-retiree")).toContainText(`N° ${c} donnée à un autre livreur. Si vous avez le sac, appelez le restaurant.`);
  await expect(marco.locator(".livreur")).not.toContainText("Gros-Chêne 38");
  await marco.screenshot({ path: "test-results/livreurs/livreur-375-reattribuee.png", fullPage: true });
  await marco.getByRole("button", { name: "Compris" }).click();
  await expect(marco.locator(".liv-retiree")).toHaveCount(0);
  await ines.reload();
  await expect(arret(ines, c)).toContainText("Avenue du Gros-Chêne 38");
  await arret(ines, c).getByRole("button", { name: "Livrée" }).click();
  await expect(arret(ines, c)).toHaveCount(0);
});

test("réseau coupé : Je pars attend, repart seul, un seul e-mail au client", async ({ request }) => {
  const c = await livraison(request, ONEX);
  await ongletLivraisons().click();
  await aAttribuer(c).getByRole("button", { name: "À Marco" }).click();
  await marco.reload();
  // Le livreur a sa liste à l'écran avant d'entrer dans une zone sans réseau.
  await expect(arret(marco, c).getByRole("button", { name: "Je pars" })).toBeVisible({ timeout: 15_000 });
  await contexteMarco.setOffline(true);
  await arret(marco, c).getByRole("button", { name: "Je pars" }).click();
  await expect(marco.locator(".liv-alerte")).toContainText("Vos gestes partiront seuls au retour du signal.");
  await expect(arret(marco, c)).toContainText("En route, envoi en attente du réseau.");
  await marco.screenshot({ path: "test-results/livreurs/livreur-375-sans-reseau.png", fullPage: true });
  // Le geste est gardé dans le téléphone sans l'adresse.
  const garde = await marco.evaluate(() => localStorage.getItem("laferme-livreur-gestes") ?? "");
  expect(garde).toContain('"geste":"partie"');
  expect(garde).not.toContain("Gros-Chêne");
  await contexteMarco.setOffline(false);
  await expect(arret(marco, c)).toContainText("En route.", { timeout: 15_000 });
  await expect(arret(marco, c)).not.toContainText("envoi en attente");
  expect(await marco.evaluate(() => localStorage.getItem("laferme-livreur-gestes"))).toBeNull();

  // Réponse perdue : le téléphone renvoie la même clé, le serveur ne refait rien.
  const cle = `reponse-perdue-${Date.now()}`;
  const id = (await (await marco.request.get("/api/livreur")).json()).livraisons.find((l: { numero: number }) => String(l.numero) === c).commande_id;
  const geste = () => marco.request.post("/api/livreur", { headers: ORIGINE, data: { cle, commande: id, geste: "livree" } });
  expect((await (await geste()).json()).ok).toBe(true);
  expect(await (await geste()).json()).toEqual({ ok: true, deja: true });
  // Un seul e-mail à la commande (13.11.2026) : « en route » se lit au suivi, aucun e-mail ne part.
  const courriels = await (await request.get(`/dev/courriels?jeton=${jetons.get(c)}`)).text();
  expect(courriels).not.toContain(`<h2>Commande ${c} en route`);
});

test("client absent : signalé par le livreur, clos sans remboursement par la tablette", async ({ request }) => {
  const c = await livraison(request, LIGNON);
  await ongletLivraisons().click();
  await aAttribuer(c).getByRole("button", { name: "À Marco" }).click();
  await marco.reload();
  const carte = arret(marco, c);
  await carte.getByRole("button", { name: "Je pars" }).click();
  await carte.getByRole("button", { name: "Problème" }).click();
  await carte.getByRole("button", { name: "Client absent" }).click();
  await carte.getByLabel(/Un mot pour le restaurant/).fill("Sonné deux fois, pas de réponse");
  await marco.screenshot({ path: "test-results/livreurs/livreur-375-probleme.png", fullPage: true });
  await axe(marco, "livreur-probleme");
  await carte.getByRole("button", { name: "Prévenir le restaurant" }).click();
  await expect(carte).toContainText("Problème signalé : client absent, « Sonné deux fois, pas de réponse ». Le restaurant est prévenu.");

  await expect(tablette.locator(".tab-attente", { hasText: `Livraison ${c} : client absent` })).toBeVisible({ timeout: 10_000 });
  await expect(tournee("Marco").locator(".liv-souci")).toContainText("Sonné deux fois");
  await tablette.screenshot({ path: "test-results/livreurs/tablette-1024-probleme.png", fullPage: true });

  // Décision de Jérémy (12.11.2026) : clore sans rembourser, le gérant décide ensuite.
  await tournee("Marco").getByRole("button", { name: "Client absent : clore" }).click();
  await expect(tournee("Marco").locator(".liv-confirmer")).toContainText("sans le livrer ni le rembourser");
  await tablette.screenshot({ path: "test-results/livreurs/tablette-1024-client-absent.png", fullPage: true });
  await axe(tablette, "tablette-client-absent");
  await tournee("Marco").getByRole("button", { name: "Oui, clore sans rembourser" }).click();
  await expect(tablette.locator(".tab-message")).toContainText("Livraison close sans remboursement");

  await tablette.getByRole("button", { name: /^Terminées/ }).click();
  await ouvrirCommande(tablette, c);
  const terminee = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${c}$`) }) });
  await expect(terminee).toContainText("Non remise, client absent");
  await expect(terminee).toContainText("Payée en ligne");
  await expect(terminee).not.toContainText("Remboursée");

  // Le client : suivi « Commande non remise », un e-mail factuel, aucun remboursement annoncé.
  const suivi = await (await request.get(`/suivi/${jetons.get(c)}`)).text();
  expect(suivi).toContain("Commande non remise");
  const courriels = await (await request.get(`/dev/courriels?jeton=${jetons.get(c)}`)).text();
  expect(courriels).toContain(`<h2>Commande ${c} non remise, La Ferme`);
  expect(courriels).not.toMatch(/rembours/i);

  await marco.reload();
  await expect(arret(marco, c)).toHaveCount(0);
  await expect(marco.locator(".liv-retiree")).toContainText(`N° ${c} close, client absent. Rapportez le sac au restaurant.`);
  await marco.getByRole("button", { name: "Compris" }).click();
  await expect(marco.locator(".liv-retiree")).toHaveCount(0);
});

test("commande annulée pendant la tournée (adresse introuvable) : remboursée, le livreur rapporte le sac", async ({ request, browser }) => {
  const c = await livraison(request, LIGNON);
  await ongletLivraisons().click();
  await aAttribuer(c).getByRole("button", { name: "À Marco" }).click();
  await marco.reload();
  await arret(marco, c).getByRole("button", { name: "Je pars" }).click();
  await expect(arret(marco, c)).toContainText("En route.");

  await tablette.getByRole("button", { name: /^En cours/ }).click();
  await ouvrirCommande(tablette, c);
  const cours = tablette.locator(".tab-commande", { has: tablette.locator(".tab-num", { hasText: new RegExp(`^${c}$`) }) });
  await expect(cours).toContainText("Livreur : Marco");
  // La tablette envoie l'état qu'elle affiche (SS-06) : attendre qu'elle ait relu « Partie ».
  await expect(cours.locator(".tab-meta")).toContainText("Partie", { timeout: 10_000 });
  // Annuler une livraison partie rembourse tout : gérant seulement (audit de sécurité 2, S2-01).
  await expect(cours.getByRole("button", { name: "Annuler la commande" })).toHaveCount(0);
  await expect(cours).toContainText("Seul le gérant ou le responsable de service peut annuler une livraison partie.");
  const gerant = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1024, height: 768 } })).newPage();
  await connecter(gerant, "/tablette", "gerant-livraison@laferme.test");
  await gerant.getByRole("button", { name: "Continuer sans son" }).click();
  await gerant.getByRole("button", { name: /^En cours/ }).click();
  await ouvrirCommande(gerant, c);
  const coursGerant = gerant.locator(".tab-commande", { has: gerant.locator(".tab-num", { hasText: new RegExp(`^${c}$`) }) });
  await expect(coursGerant.locator(".tab-meta")).toContainText("Partie", { timeout: 10_000 });
  await coursGerant.getByRole("button", { name: "Annuler la commande" }).click();
  await coursGerant.getByLabel("Autre motif").fill("Adresse introuvable, livreur revenu");
  await coursGerant.getByRole("button", { name: /^Annuler et rembourser/ }).click();
  await expect(gerant.locator(".tab-message")).toContainText("remboursée");
  await gerant.context().close();

  await marco.reload();
  await expect(arret(marco, c)).toHaveCount(0);
  await expect(marco.locator(".liv-retiree")).toContainText(`N° ${c} annulée. Ne la livrez pas, rapportez le sac au restaurant.`);
  await marco.screenshot({ path: "test-results/livreurs/livreur-375-annulee.png", fullPage: true });
  await ongletLivraisons().click();
  await expect(tournee("Marco")).toContainText(`N° ${c} annulée alors qu'elle était partie`);
  await marco.getByRole("button", { name: "Compris" }).click();
  await expect(marco.locator(".liv-retiree")).toHaveCount(0);
  await expect(tournee("Marco")).not.toContainText(`N° ${c} annulée`, { timeout: 10_000 });
});

test("livreur déconnecté en tournée : il retrouve sa livraison en se reconnectant", async ({ request }) => {
  test.setTimeout(90_000);
  const c = await livraison(request, ONEX);
  await ongletLivraisons().click();
  await aAttribuer(c).getByRole("button", { name: "À Marco" }).click();
  await marco.reload();
  await arret(marco, c).getByRole("button", { name: "Je pars" }).click();
  await expect(arret(marco, c)).toContainText("En route.");
  await marco.getByRole("button", { name: "Déconnexion" }).click();
  await expect(marco.getByLabel("E-mail", { exact: true })).toBeVisible();
  expect((await marco.request.get("/api/livreur")).status()).toBe(401);
  await expect(tournee("Marco").locator(".liv-arret-tab", { hasText: `N° ${c} ` })).toContainText("En route depuis", { timeout: 15_000 });
  // Un code par 30 secondes et par e-mail : on attend avant de redemander.
  await marco.waitForTimeout(31_000);
  await connecter(marco, "/livreur", "marco@laferme.test");
  await expect(arret(marco, c)).toContainText("En route.");
  await arret(marco, c).getByRole("button", { name: "Livrée" }).click();
  await expect(arret(marco, c)).toHaveCount(0);
});

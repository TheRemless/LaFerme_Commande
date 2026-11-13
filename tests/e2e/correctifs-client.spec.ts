import { expect, test, type Page } from "@playwright/test";

// Correctifs du rapport client mystère (docs/audits/client-mystere.md). Un test par constat.

const L = (slug: string, qte = 1) => ({ slug, qte, choix: {}, retraits: [], note: "" });

async function poser(page: Page, choix: Record<string, unknown>, lignes: unknown[]) {
  await page.addInitScript(
    ([choix, lignes]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes }));
    },
    [choix, lignes] as const,
  );
}

const lignon = {
  mode: "livraison",
  adresse: { rue: "Avenue du Lignon", numero: "40", npa: "1219", localite: "Le Lignon" },
  details: { etage: "", sonnette: "Test", code: "", instructions: "" },
  zone: { numero: 2, frais_centimes: 0, minimum_centimes: 0, delai_min: 40, delai_max: 50 },
  quand: { type: "asap" },
  heureSimulee: "2026-11-10T19:05",
};

test("CM-02 : la raison du bouton gris est juste au-dessus du bouton", async ({ page }) => {
  // Deux pizzas bon marché en zone 2 : sous le minimum, quel qu'il soit dans la base.
  await poser(page, lignon, [L("pizza-margherita")]);
  await page.goto("/commande");
  const bouton = page.getByRole("button", { name: /^Payer/ });
  await expect(bouton).toBeDisabled();
  const raison = page.locator(".commande-form .panier-alerte");
  await expect(raison).toContainText(/de plats pour le minimum de livraison/);
  await expect(raison.getByRole("link", { name: "Ajouter un plat" })).toBeVisible();
  const yRaison = (await raison.boundingBox())!.y;
  const yBouton = (await bouton.boundingBox())!.y;
  expect(yBouton - yRaison).toBeLessThan(150);
});

test("CM-02 : panier mixte après 21h30, raison et lien près du bouton", async ({ page }) => {
  await poser(page, { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T21:31" }, [L("pizza-margherita"), L("lasagne-de-boeuf")]);
  await page.goto("/commande");
  const raison = page.locator(".commande-form .panier-alerte");
  await expect(raison).toContainText("on ne prend plus que les pizzas");
  await expect(raison.getByRole("link", { name: "Changer l'heure" })).toBeVisible();
});

test("CM-03 : à 22h14 en livraison, pas de « cuisine fermée » quand ce soir reste proposé", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T22:14");
  await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await page.locator(".suggestions button").first().click();
  await page.getByLabel("Nom sur la sonnette").fill("Test");
  await expect(page.getByText(/Trop tard pour «\s?dès que possible\s?»/)).toBeVisible();
  await expect(page.getByText(/La cuisine est fermée/)).toHaveCount(0);
  await expect(page.getByLabel("Jour")).toHaveValue("2026-11-10");
});

test("CM-04 : les coordonnées restent après un paiement refusé", async ({ page }) => {
  await poser(page, { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" }, [L("pizza-margherita", 2)]);
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Refus");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("refus@exemple.ch");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await page.getByRole("button", { name: "Simuler un refus de la banque" }).click();
  await expect(page).toHaveURL(/\/commande\?annule=1/);
  await expect(page.getByLabel("Prénom")).toHaveValue("Test");
  await expect(page.getByLabel("Téléphone")).toHaveValue("079 000 00 00");
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue("refus@exemple.ch");
});

test("CM-05 : l'heure « vers » de l'accueil est rappelée au paiement", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByRole("button", { name: /À emporter/ }).click();
  // Vague 3 : l'heure est annoncée en fourchette, « entre 19h35 et 19h45 », rappelée telle quelle au paiement.
  const vers = (await page.getByText(/Dès que possible, entre \d+h\d\d et \d+h\d\d/).innerText()).match(/(entre \d+h\d\d et \d+h\d\d)/)![1];
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await page.evaluate(() =>
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] })),
  );
  await page.goto("/commande");
  await expect(page.getByText(`Dès que possible, ${vers}`)).toBeVisible();
});

test("CM-06 : la fermeture annuelle est annoncée la veille, et la réouverture se commande pendant", async ({ page }) => {
  await page.goto("/?heure=2026-12-19T22:30");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByText("On rouvre le mardi 12 janvier.")).toBeVisible();
  await expect(page.getByText(/Aucun créneau libre/)).toHaveCount(0);

  await page.goto("/?heure=2027-01-08T12:00");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByLabel("Jour")).toHaveValue("2027-01-12");
});

test("CM-08 : pendant la fermeture, la carte se lit mais rien ne s'ajoute", async ({ page }) => {
  await page.goto("/?heure=2026-12-23T12:00");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await expect(page.getByText(/La commande en ligne est fermée en ce moment/)).toBeVisible();
  await page.getByText("Margherita", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Commande en ligne fermée" })).toBeDisabled();
});

test("CM-09 : un téléphone faux est signalé sous le champ, sans envoi", async ({ page }) => {
  await poser(page, { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" }, [L("pizza-margherita", 2)]);
  let envois = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commandes")) envois++;
  });
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Tel");
  await page.getByLabel("Téléphone").fill("abc");
  await page.getByLabel("E-mail", { exact: true }).fill("tel@exemple.ch");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page.getByText("Vérifiez le numéro de téléphone, il faut au moins neuf chiffres.")).toBeVisible();
  await expect(page.getByLabel("Téléphone")).toHaveAttribute("aria-invalid", "true");
  expect(envois).toBe(0);
});

test("CM-09 : le serveur nomme le champ faux", async ({ request }) => {
  const r = await request.post("/api/commandes", {
    data: {
      cle: "cle-de-test-cm09-000001",
      lignes: [L("pizza-margherita")],
      mode: "retrait",
      moyen: "en_ligne",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom: "A", nom: "B", telephone: "abc", email: "a@b.ch" },
    },
  });
  expect(r.status()).toBe(422);
  expect((await r.json()).erreur).toContain("numéro de téléphone");
});

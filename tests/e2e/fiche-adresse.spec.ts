import { expect, test } from "@playwright/test";

// Vague 3, client-commande : la fiche d'un plat s'ouvre depuis l'adresse (/carte#slug), pour partager un plat
// ou le voir « comme le client » depuis le back-office. Le slug seul, aucune donnée du client.

test("/carte#slug ouvre la fiche du plat, la fermer retire l'ancre", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
  await page.goto("/carte#pasta-alla-carbonara");
  const fiche = page.getByRole("dialog");
  await expect(fiche.getByRole("heading", { name: /carbonara/i })).toBeVisible();
  // La fiche écoute le clavier une fois le focus posé sur elle (effet après l'affichage) : sur la CI, un
  // Échap envoyé entre les deux se perdait. On attend le focus, puis on renvoie Échap tant qu'elle est là.
  await expect(fiche).toBeFocused();
  await expect(async () => {
    if (await fiche.isVisible()) await page.keyboard.press("Escape");
    await expect(fiche).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page).toHaveURL((u) => u.pathname === "/carte" && u.hash === "");
});

test("sans choix, le plat partagé suit le client à l'accueil puis s'ouvre sur la carte", async ({ page }) => {
  await page.goto("/carte#pasta-alla-carbonara");
  await expect(page).toHaveURL((u) => u.pathname === "/" && u.hash === "#pasta-alla-carbonara");
  await page.waitForFunction(() => (window as Window & { __laFermePret?: boolean }).__laFermePret === true);
  await page.getByRole("button", { name: /À emporter/ }).click();
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /carbonara/i })).toBeVisible();
});

test("une ancre inconnue n'ouvre rien", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
  await page.goto("/carte#plat-inexistant");
  await expect(page.getByLabel("Chercher un plat")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

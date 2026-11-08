import { expect, test } from "@playwright/test";

// Lot 8e : méta, Open Graph, Schema.org et manifestes. Hors production, tout est fermé aux moteurs.

test("accueil : description, Open Graph et Schema.org du restaurant", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /pizzas au feu de bois/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "La Ferme, livraison et à emporter");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "fr_CH");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", "Pizzas, pâtes et burger de La Ferme vus du dessus");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^http:\/\/localhost:3000\/?$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const schema = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  expect(schema["@type"]).toBe("Restaurant");
  expect(schema.telephone).toBe("+41 22 792 16 89");
  expect(schema.address).toMatchObject({ streetAddress: "Route de Chancy 132", postalCode: "1213", addressLocality: "Onex" });
  // Rien qui ne soit dans le registre de faits.
  for (const cle of ["openingHours", "openingHoursSpecification", "priceRange", "aggregateRating", "review", "servesCuisine"]) {
    expect(schema).not.toHaveProperty(cle);
  }
});

test("hors production : aucune page indexable, robots.txt fermé, plan du site vide", async ({ page, request }) => {
  await page.addInitScript(() =>
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() })),
  );
  for (const chemin of ["/", "/carte", "/cgv"]) {
    await page.goto(chemin);
    await expect(page).toHaveURL(new RegExp(`${chemin}$`));
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  }
  expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/\s*$/m);
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("<url>");
});

test("manifestes : site et tablette", async ({ page, request }) => {
  const site = await (await request.get("/manifest.webmanifest")).json();
  expect(site).toMatchObject({ short_name: "La Ferme", start_url: "/", display: "standalone", lang: "fr-CH" });
  for (const icone of site.icons) expect((await request.get(icone.src)).status()).toBe(200);
  await page.goto("/tablette");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/tablette.webmanifest");
  const reponse = await request.get("/tablette.webmanifest");
  expect(reponse.headers()["content-type"]).toContain("application/manifest+json");
  const tablette = await reponse.json();
  expect(tablette).toMatchObject({ start_url: "/tablette", display: "fullscreen" });
  expect((await request.get("/apple-icon.png")).status()).toBe(200);
});

test("pages propres à un client : jamais indexées", async ({ page }) => {
  // Sans choix, panier et commande renvoient à l'accueil : on en pose un.
  await page.addInitScript(() =>
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() })),
  );
  for (const chemin of ["/panier", "/commande", "/compte"]) {
    await page.goto(chemin);
    await expect(page).toHaveURL(new RegExp(`${chemin}$`));
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  }
});

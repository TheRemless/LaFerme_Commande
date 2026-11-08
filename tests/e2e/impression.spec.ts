import { expect, test, type APIRequestContext } from "@playwright/test";

// Faux client Star CloudPRNT : joue le rôle de l'imprimante (POST, GET, DELETE) contre le vrai serveur.
// Un seul projet : la file d'impression est commune, deux faux clients se prendraient leurs tickets.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: "http://localhost:3200" };
const MAC = "00:11:62:12:34:56";
let gerant: APIRequestContext;
let url: string;

test.beforeAll(async ({ playwright }, info) => {
  test.skip(info.project.name !== "bureau", "file d'impression partagée : un seul projet");
  gerant = await playwright.request.newContext({ baseURL: "http://localhost:3200", extraHTTPHeaders: ORIGINE });
  const c = await (await gerant.post("/api/personnel/code", { data: { email: "impression@laferme.test" } })).json();
  expect((await gerant.post("/api/personnel/connexion", { data: { email: "impression@laferme.test", code: c.codePreversion } })).ok()).toBe(true);
  const r = await gerant.post("/api/gestion/imprimantes", { data: { type: "ajouter", nom: "Imprimante pizza", station: "pizza" } });
  expect(r.ok()).toBe(true);
  url = new URL((await r.json()).url).pathname;
  expect(url).toMatch(/^\/api\/cloudprnt\/[A-Za-z0-9_-]{43}$/);
});

test.afterAll(async () => {
  await gerant?.dispose();
});

// Le faux client interroge jusqu'à trouver un ticket (ou abandonne).
async function attendreTicket(request: APIRequestContext): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const r = await request.post(url, { headers: { "X-Star-Mac": MAC }, data: { statusCode: "200%20OK", printerMAC: MAC, status: "23 6 0 0 0 0 0 0 0 " } });
    expect(r.status()).toBe(200);
    const j = await r.json();
    if (j.jobReady) {
      expect(j.mediaTypes).toContain("image/png");
      return j.jobToken;
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  throw new Error("Aucun ticket");
}

test("une commande acceptée sort à l'imprimante pizza : POST, GET image/png, DELETE 200 OK", async ({ request }) => {
  // Premier passage : rien à imprimer, l'imprimante est liée à sa MAC.
  const vide = await request.post(url, { headers: { "X-Star-Mac": MAC }, data: { statusCode: "200%20OK", printerMAC: MAC } });
  expect(await vide.json()).toEqual({ jobReady: false });

  const commande = await request.post("/api/commandes", {
    data: {
      cle: `impression-${Date.now()}`, mode: "retrait", moyen: "comptoir", quand: { type: "asap" }, heure: "2026-11-10T19:05",
      client: { prenom: "Zoé", nom: "Test", telephone: "079 000 00 00", email: "zoe@laferme.test" },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "œuf à part" }],
    },
  });
  expect(commande.ok()).toBe(true);
  const file = await (await gerant.get("/api/tablette/file")).json();
  const c = file.commandes.find((x: { client_prenom: string; statut: string }) => x.client_prenom === "Zoé" && x.statut === "nouvelle");
  expect((await gerant.post("/api/tablette/action", { data: { commande: c.id, action: "accepter", heure: c.heure_proposee } })).ok()).toBe(true);

  const jeton = await attendreTicket(request);
  // Un autre appareil avec la même adresse est refusé.
  expect((await request.get(`${url}?type=image/png&token=${jeton}&mac=00:11:62:99:99:99`)).status()).toBe(404);
  const png = await request.get(`${url}?type=image/png&token=${jeton}&mac=${MAC}`);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect(png.headers()["x-star-cut"]).toBe("full; feed=true");
  const octets = await png.body();
  expect(octets.subarray(1, 4).toString("ascii")).toBe("PNG");
  const texte = await (await request.get(`${url}?type=text/plain&token=${jeton}&mac=${MAC}`)).text();
  expect(texte).toContain("1 x Pizza Margherita");
  expect(texte).toContain("oeuf a part");

  expect((await request.delete(`${url}?code=200%20OK&token=${jeton}&mac=${MAC}`)).status()).toBe(200);
  const apres = await (await gerant.get("/api/tablette/file")).json();
  const taches = apres.impression.taches.filter((t: { commande_id: string }) => t.commande_id === c.id);
  expect(taches.map((t: { etat: string }) => t.etat)).toEqual(["imprimee"]);
  expect(apres.impression.imprimantes.find((i: { nom: string }) => i.nom === "Imprimante pizza").en_ligne).toBe(true);

  // Réimpression : un nouveau ticket marqué « RÉIMPRESSION ».
  expect((await gerant.post("/api/tablette/action", { data: { commande: c.id, action: "reimprimer" } })).ok()).toBe(true);
  const j2 = await attendreTicket(request);
  expect(await (await request.get(`${url}?type=text/plain&token=${j2}&mac=${MAC}`)).text()).toMatch(/^REIMPRESSION/);
  await request.delete(`${url}?code=200%20OK&token=${j2}&mac=${MAC}`);
});

test("jeton inconnu, MAC étrangère ou format inconnu : refusés", async ({ request }) => {
  expect((await request.post("/api/cloudprnt/inconnuinconnuinconnuinconnuinconnuinconnu12", { data: { statusCode: "200%20OK" } })).status()).toBe(403);
  expect((await request.post(url, { headers: { "X-Star-Mac": "00:11:62:99:99:99" }, data: { statusCode: "200%20OK" } })).status()).toBe(403);
  expect((await request.get(`${url}?type=application/pdf&token=00000000-0000-0000-0000-000000000000&mac=${MAC}`)).status()).toBe(415);
  // La gestion des imprimantes est réservée au gérant.
  expect((await request.post("/api/gestion/imprimantes", { headers: ORIGINE, data: { type: "ajouter", nom: "Pirate", station: "pizza" } })).status()).toBe(401);
});

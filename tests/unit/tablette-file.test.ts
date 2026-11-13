import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// File de la tablette allégée (vague 3, mesures de qualite) : terminées sans lignes, version calculée par le serveur,
// 204 sans corps quand rien n'a changé, signe de vie et surveillance toujours faits (pièges relevés par qualite).

const session = vi.hoisted(() => ({ personnel: { id: "00000000-0000-0000-0000-000000000000", email: "test@laferme.test", nom: "Test", role: "service" } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET } = await import("@/app/api/tablette/file/route");
const { GET: detail } = await import("@/app/api/tablette/commande/route");
const { agir } = await import("@/lib/tablette");
const personnel = session.personnel as { id: string; email: string; nom: string; role: "service" };

let n = 0;
async function commande(statut: "nouvelle" | "terminee"): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-tf-${n}`,
    cle_idempotence: `tf-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Tf",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: `tf${n}@laferme.test`,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1800,
    frais_centimes: 0,
    total_centimes: 1800,
    tva_centimes: 46,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "bien cuite" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  if (statut === "terminee") {
    const heure = new Date(Math.ceil((Date.now() + 20 * 60_000) / 300_000) * 300_000).toISOString();
    await agir(id, { action: "accepter", heure }, personnel);
    await agir(id, { action: "statut", vers: "prete", de: "acceptee" }, personnel);
    await agir(id, { action: "statut", vers: "terminee", de: "prete" }, personnel);
  }
  return id;
}
const lire = (params = "") => GET(new Request(`http://localhost/api/tablette/file${params}`));

describe("File allégée", () => {
  it("une terminée part sans ses lignes ; une active les garde", async () => {
    const finie = await commande("terminee");
    const active = await commande("nouvelle");
    const r = await lire();
    expect(r.status).toBe(200);
    const corps = (await r.json()) as { commandes: { id: string; lignes: unknown[]; lignes_omises?: boolean }[]; impression: { taches: { commande_id: string }[] } };
    expect(corps.commandes.find((c) => c.id === finie)).toMatchObject({ lignes: [], lignes_omises: true });
    expect(corps.commandes.find((c) => c.id === active)?.lignes).toHaveLength(1);
    // Ses tickets non plus : seulement ceux des commandes actives.
    expect(corps.impression.taches.some((t) => t.commande_id === finie)).toBe(false);
  });

  it("même version : 204 sans corps, avec l'heure du serveur ; un changement donne une nouvelle version", async () => {
    const r1 = await lire();
    const v1 = r1.headers.get("X-Version-File")!;
    expect(v1).toMatch(/^[\w-]{16}$/);
    const r2 = await lire(`?version=${v1}`);
    expect(r2.status).toBe(204);
    expect(await r2.text()).toBe("");
    expect(r2.headers.get("X-Version-File")).toBe(v1);
    expect(new Date(r2.headers.get("X-Maintenant")!).getTime()).toBeGreaterThan(0);
    await commande("nouvelle");
    const r3 = await lire(`?version=${v1}`);
    expect(r3.status).toBe(200);
    expect(r3.headers.get("X-Version-File")).not.toBe(v1);
  });

  it("204 répétés pendant 4 minutes : le signe de vie continue, pas de pause automatique", async () => {
    const db = await baseLocale();
    const v = (await lire("?service=1")).headers.get("X-Version-File")!;
    const vu = async () => (await db.query<{ t: string }>("select tablette_vue_le::text as t from surveillance_etat")).rows[0].t;
    const debut = Date.now();
    const horloge = vi.spyOn(Date, "now");
    try {
      let avant = await vu();
      // Toutes les 31 s pendant 4 minutes : le signe de vie est limité à un toutes les 30 s par instance.
      for (let i = 1; i <= 8; i++) {
        horloge.mockReturnValue(debut + i * 31_000);
        const r = await lire(`?service=1&version=${v}`);
        expect(r.status).toBe(204);
        const apres = await vu();
        expect(apres).not.toBe(avant);
        avant = apres;
      }
    } finally {
      horloge.mockRestore();
    }
    const pause = (await db.query<{ valeur: unknown }>("select valeur from reglages where cle = 'pause_jusqu_a'")).rows[0]?.valeur;
    expect(pause === null || pause === "null").toBe(true);
  });

  it("le détail d'une terminée se charge au toucher, avec ses lignes", async () => {
    const id = await commande("terminee");
    const r = await detail(new Request(`http://localhost/api/tablette/commande?id=${id}`));
    expect(r.status).toBe(200);
    const d = (await r.json()) as { commande: { lignes: { details: string[] }[] }; taches: unknown[] };
    expect(d.commande.lignes[0].details).toContain("« bien cuite »");
    expect((await detail(new Request("http://localhost/api/tablette/commande?id=pas-un-id"))).status).toBe(404);
  });
});

describe("Raison de l'heure réaliste", () => {
  it("la file porte raison_charge : null tant que rien n'allonge les heures, sinon une phrase", async () => {
    const corps = (await (await lire()).json()) as { reglages: { raison_charge?: string | null } };
    expect("raison_charge" in corps.reglages).toBe(true);
    expect(corps.reglages.raison_charge === null || typeof corps.reglages.raison_charge === "string").toBe(true);
  });
});

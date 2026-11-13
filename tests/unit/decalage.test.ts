import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import type { Personnel } from "@/lib/personnel/session";

// Décaler les commandes en cours, côté serveur (src/lib/decalage.ts) : un e-mail « nouvelle heure » par
// commande, aucun de plus au double appui. Base embarquée, courriels en doublure (copie gardée en base).

const { decalerCommandes, apercuDecalage } = await import("@/lib/decalage");
// Copies gardées en base, doublure comprise (courrielsPartis ne lit que les vrais envois).
async function nouvellesHeures(id: string): Promise<number> {
  const db = await baseLocale();
  const r = await db.query<{ n: number }>("select count(*)::integer as n from courriels where commande_id = $1 and sujet like '%nouvelle heure'", [id]);
  return r.rows[0].n;
}

const EMAIL = "decalage@laferme.test";

async function personnel(): Promise<Personnel> {
  const db = await baseLocale();
  const r = await db.query<{ id: string }>(
    "insert into personnel (email, nom, role) values ('decalage-service@laferme.test', 'Décalage service', 'service') on conflict (email) do update set actif = true returning id",
  );
  return { id: r.rows[0].id, email: "decalage-service@laferme.test", nom: "Décalage service", role: "service" };
}

async function commandeAcceptee(): Promise<string> {
  const db = await baseLocale();
  const p = {
    jeton_suivi: `jeton-decalage-${Date.now()}`,
    cle_idempotence: `decalage-${Date.now()}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: "Décalage",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: EMAIL,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1500,
    frais_centimes: 0,
    total_centimes: 1500,
    tva_centimes: 38,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = 'acceptee', heure_confirmee = now() + interval '20 minutes' where id = $1", [id]);
  return id;
}

afterAll(async () => {
  const db = await baseLocale();
  await db.query("delete from commandes where client_email = $1", [EMAIL]);
});

describe("decalerCommandes", () => {
  it("décale, prévient une fois par commande, rien au double appui", async () => {
    const qui = await personnel();
    const id = await commandeAcceptee();
    expect((await apercuDecalage(null)).commandes).toBeGreaterThanOrEqual(1);
    const cle = `test-${Date.now()}`;
    const r = await decalerCommandes({ minutes: 15, station: null, cle }, qui);
    expect(r).toMatchObject({ ok: true, deja: false, minutes: 15 });
    expect(await nouvellesHeures(id)).toBe(1);
    const encore = await decalerCommandes({ minutes: 15, station: null, cle }, qui);
    expect(encore).toMatchObject({ ok: true, deja: true, prevenus: 0 });
    expect(await nouvellesHeures(id)).toBe(1);
  });

  it("refuse une saisie hors bornes sans toucher la base", async () => {
    const qui = await personnel();
    expect(await decalerCommandes({ minutes: 2, cle: "abcdefgh" }, qui)).toEqual({ ok: false, erreur: "Décalage : de 5 à 90 minutes." });
    expect(await decalerCommandes({ minutes: 10, station: "bar", cle: "abcdefgh" }, qui)).toEqual({ ok: false, erreur: "Poste : pizza ou cuisine." });
    expect(await decalerCommandes({ minutes: 10, cle: 3 }, qui)).toEqual({ ok: false, erreur: "Geste illisible : rechargez la page." });
  });
});

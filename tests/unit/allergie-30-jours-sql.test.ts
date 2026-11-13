import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// C14 (décision de Jérémy du 13.11.2026), migration 20261214090000_allergie_30_jours.sql : l'allergie est
// effacée 30 jours après la commande, sur la commande et sur les tickets gardés, sans dater la commande.

let db: PGlite;
let n = 0;

async function commande(allergie: string, ilYa: string, statut = "terminee"): Promise<string> {
  n += 1;
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-allergie-${n}`,
      cle_idempotence: `allergie-${n}`,
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      client_prenom: `Allergie${n}`,
      client_nom: "Test",
      client_telephone: "079 000 00 00",
      client_email: "allergie@laferme.test",
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: 1800,
      frais_centimes: 0,
      total_centimes: 1800,
      tva_centimes: 46,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      allergie,
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
    },
  ]);
  const id = r.rows[0].id;
  await db.query(
    `select creer_taches_impression($1, $2, false)`,
    [
      id,
      JSON.stringify([
        {
          station: "pizza",
          contenu: [
            { t: "texte", texte: `N° ${n}`, taille: 3, gras: true },
            ...(allergie ? [{ t: "texte", texte: `ALLERGIE : ${allergie}`, taille: 2, gras: true, inverse: true }] : []),
            { t: "filet" },
            { t: "texte", texte: "1 × Margherita" },
          ],
        },
      ]),
    ],
  );
  // Commande passée il y a ilYa, terminée le jour même.
  await db.query(`update commandes set statut = $2, cree_le = now() - $3::interval, modifie_le = now() - $3::interval where id = $1`, [id, statut, ilYa]);
  return id;
}

const ligne = async (id: string) =>
  (await db.query<{ allergie: string; modifie_le: string; cree_le: string }>("select allergie, modifie_le::text, cree_le::text from commandes where id = $1", [id])).rows[0];
const ticket = async (id: string) =>
  (await db.query<{ contenu: { t: string; texte?: string }[] }>("select contenu from taches_impression where commande_id = $1", [id])).rows[0].contenu;
// L'horloge de PGlite peut rendre deux fois le même now() : une pause sépare deux mises à jour comparées.
const pause = () => new Promise((r) => setTimeout(r, 10));
const effacer = async () => (await db.query<{ n: number }>("select effacer_allergies_echues() as n")).rows[0].n;

beforeEach(async () => {
  db = await creerBaseLocale();
});

describe("allergie effacée 30 jours après la commande", () => {
  it("efface l'allergie de plus de 30 jours, garde celle de 29 jours", async () => {
    const vieille = await commande("Arachides", "31 days");
    const recente = await commande("Lactose", "29 days");
    expect(await effacer()).toBe(1);
    expect((await ligne(vieille)).allergie).toBe("");
    expect((await ligne(recente)).allergie).toBe("Lactose");
    // Un second tour ne trouve plus rien.
    expect(await effacer()).toBe(0);
  });

  it("retire la ligne « ALLERGIE » du ticket gardé, le reste du ticket reste", async () => {
    const vieille = await commande("Arachides, allergie sévère", "40 days");
    const recente = await commande("Gluten", "2 days");
    await effacer();
    const t = await ticket(vieille);
    expect(JSON.stringify(t)).not.toContain("Arachides");
    expect(t.map((l) => l.texte ?? l.t)).toEqual([expect.stringMatching(/^N° \d+$/), "filet", "1 × Margherita"]);
    expect(JSON.stringify(await ticket(recente))).toContain("ALLERGIE : Gluten");
  });

  it("ne date pas la commande : une commande terminée il y a un mois ne revient pas dans la journée de la tablette", async () => {
    const vieille = await commande("Arachides", "31 days");
    const avant = await ligne(vieille);
    await pause();
    await effacer();
    const apres = await ligne(vieille);
    expect(apres.allergie).toBe("");
    expect(apres.modifie_le).toBe(avant.modifie_le);
  });

  it("toute autre mise à jour date la commande comme avant", async () => {
    const id = await commande("", "31 days");
    const avant = await ligne(id);
    await pause();
    await db.query("update commandes set client_prenom = 'Autre' where id = $1", [id]);
    expect((await ligne(id)).modifie_le).not.toBe(avant.modifie_le);
    // Même une mise à jour sans changement (comportement d'avant, utilisé pour « toucher » une commande).
    const avant2 = await ligne(id);
    await pause();
    await db.query("update commandes set client_prenom = client_prenom where id = $1", [id]);
    expect((await ligne(id)).modifie_le).not.toBe(avant2.modifie_le);
    // Allergie ET autre chose : datée.
    const id2 = await commande("Soja", "1 day");
    const avant3 = await ligne(id2);
    await pause();
    await db.query("update commandes set allergie = '', client_prenom = 'X' where id = $1", [id2]);
    expect((await ligne(id2)).modifie_le).not.toBe(avant3.modifie_le);
  });

  it("réservée au serveur : ni anon ni authenticated", async () => {
    const droits = await db.query<{ r: string }>(
      "select grantee as r from information_schema.routine_privileges where routine_name = 'effacer_allergies_echues' and privilege_type = 'EXECUTE'",
    );
    const qui = droits.rows.map((d) => d.r);
    expect(qui).toContain("service_role");
    expect(qui).not.toContain("anon");
    expect(qui).not.toContain("authenticated");
    expect(qui).not.toContain("PUBLIC");
  });
});

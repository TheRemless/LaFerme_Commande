import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { pngTicket } from "@/lib/impression/png";
import { sansAccents, texteTicket, ticketsDeCommande, type CommandePourTicket, type LigneTicket } from "@/lib/impression/ticket";

const commande: CommandePourTicket = {
  numero: 7,
  mode: "livraison",
  client_prenom: "Léa",
  client_nom: "Rossi",
  client_telephone: "079 555 12 34",
  adresse: { rue: "Route de Chancy", numero: "76", npa: "1213", localite: "Onex" },
  details_livraison: { etage: "3e", sonnette: "Rossi", code: "", instructions: "" },
  heure_confirmee: "2026-11-10T18:45:00Z",
  statut_paiement: "paye",
  moyen_paiement: "en_ligne",
  lignes: [
    { nom: "Pizza au bœuf", qte: 2, station: "pizza", details: ["SANS œuf", "+ Câpres"] },
    { nom: "Pasta alla carbonara", qte: 1, station: "cuisine", details: ["CHOIX Penne"] },
  ],
};
const textes = (l: LigneTicket[]) => l.map((x) => (x.t === "texte" ? x.texte : x.t === "deux" ? `${x.gauche} ${x.droite}` : "---")).join("\n");

describe("ticket 80 mm", () => {
  it("un ticket par poste, chacun avec ses lignes, sans prix", () => {
    const t = ticketsDeCommande(commande, { accepteLe: "2026-11-10T17:52:00Z" });
    expect(t.map((x) => x.station)).toEqual(["pizza", "cuisine"]);
    const pizza = textes(t[0].contenu);
    expect(pizza).toMatch(/^PIZZA N° 007/);
    expect(pizza).toContain("LIVRAISON POUR 19:45");
    expect(pizza).toContain("2 x Pizza au bœuf");
    expect(pizza).toContain("SANS œuf");
    expect(pizza).toContain("+ Câpres");
    expect(pizza).not.toContain("carbonara");
    expect(pizza).toContain("Aussi en cuisine : 1 article");
    expect(pizza).toContain("Paiement : PAYÉ EN LIGNE");
    expect(pizza).not.toMatch(/CHF|\b\d+\.\d{2}\b(?!\.)/);
    expect(textes(t[1].contenu)).toContain("CHOIX Penne");
  });

  it("une commande sans pizza ne crée rien au poste pizza ; la réimpression est marquée", () => {
    const t = ticketsDeCommande({ ...commande, lignes: [commande.lignes[1]], statut_paiement: "a_encaisser_retrait", mode: "retrait" }, { accepteLe: new Date(), reimpression: true });
    expect(t.map((x) => x.station)).toEqual(["cuisine"]);
    expect(textes(t[0].contenu)).toMatch(/^RÉIMPRESSION/);
    expect(textes(t[0].contenu)).toContain("À ENCAISSER AU RETRAIT");
  });

  it("le texte de secours tient en 48 colonnes, en ASCII", () => {
    expect(sansAccents("bœuf, œuf, cœurs, à, é, ç, N°")).toBe("boeuf, oeuf, coeurs, a, e, c, No");
    const txt = texteTicket(ticketsDeCommande(commande, { accepteLe: new Date() })[0].contenu);
    expect(txt.split("\n").every((l) => l.length <= 48)).toBe(true);
    expect(/^[\x0a\x20-\x7e]*$/.test(txt)).toBe(true);
  });

  it("l'image fait 576 points de large (80 mm à 203 dpi)", async () => {
    const png = await pngTicket(ticketsDeCommande(commande, { accepteLe: new Date() })[0].contenu);
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    const largeur = new DataView(png.buffer, png.byteOffset).getUint32(16);
    expect(largeur).toBe(576);
  });
});

let db: PGlite;
let gerant: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}
let n = 0;
const h = () => (++n).toString(16).padStart(64, "a");
const MAC = "00:11:62:aa:bb:cc";

async function nouvelleCommande(cle: string) {
  return (await db.query<{ id: string }>("select * from creer_commande($1)", [{
    jeton_suivi: `j-imp-${cle}`, cle_idempotence: `imp-${cle}`, mode: "retrait", statut: "acceptee", statut_paiement: "paye", moyen_paiement: "en_ligne",
    client_prenom: "A", client_nom: "B", client_telephone: "079", client_email: "a@b.test", quand_type: "asap", pizzas_seulement: true,
    sous_total_centimes: 100, frais_centimes: 0, total_centimes: 100, tva_centimes: 3, taux_tva_pourcent: 2.6, origine: "http://localhost", lignes: [],
  }])).rows[0].id;
}

describe("file d'impression (CloudPRNT)", () => {
  it("cycle complet : liaison à la MAC, tâche, téléchargement, confirmation", async () => {
    const jeton = h();
    await f("ajouter_imprimante('Pizza test', 'pizza', $1, $2)", [jeton, gerant]);
    expect(await f("passage_imprimante($1, $2, '200 OK')", [jeton, MAC])).toMatchObject({ tache: null });
    // Un autre appareil avec le même jeton est refusé.
    expect(await f("passage_imprimante($1, '00:11:62:00:00:01', '200 OK')", [jeton])).toBeNull();
    expect(await f("passage_imprimante($1, $2, '200 OK')", [h(), MAC])).toBeNull();
    // Sans MAC : refusé, même avec le bon jeton.
    expect(await f("passage_imprimante($1, null, '200 OK')", [jeton])).toBeNull();

    const cmd = await nouvelleCommande("a");
    await f("creer_taches_impression($1, $2, false)", [cmd, [{ station: "pizza", contenu: [{ t: "texte", texte: "test" }] }, { station: "cuisine", contenu: [] }]]);
    const p = await f<{ tache: string }>("passage_imprimante($1, $2, '200 OK')", [jeton, MAC]);
    expect(p.tache).toMatch(/^[0-9a-f-]{36}$/);
    expect(await f("tache_pour_imprimante($1, $2, $3)", [jeton, MAC, p.tache])).toEqual([{ t: "texte", texte: "test" }]);
    expect(await f("tache_pour_imprimante($1, '00:11:62:00:00:01', $2)", [jeton, p.tache])).toBeNull();
    // Pendant l'impression (avant la confirmation), le même ticket n'est pas réannoncé.
    expect(await f("passage_imprimante($1, $2, '220 Printing')", [jeton, MAC])).toMatchObject({ tache: null });
    expect(await f("confirmer_tache($1, $2, $3, '200 OK')", [jeton, MAC, p.tache])).toMatchObject({ etat: "imprimee", station: "pizza" });
    expect(await f("passage_imprimante($1, $2, '200 OK')", [jeton, MAC])).toMatchObject({ tache: null });
    // Sans imprimante cuisine : la tâche est marquée pour la tablette.
    const etats = (await db.query<{ station: string; etat: string }>("select station, etat from taches_impression where commande_id = $1 order by station", [cmd])).rows;
    expect(etats).toEqual([{ station: "pizza", etat: "imprimee" }, { station: "cuisine", etat: "sans_imprimante" }]);
  });

  it("trois échecs signalés : la tâche passe en échec ; une tâche envoyée et jamais confirmée repart", async () => {
    const jeton = h();
    await f("ajouter_imprimante('Cuisine test', 'cuisine', $1, $2)", [jeton, gerant]);
    await f("passage_imprimante($1, $2, '200 OK')", [jeton, "00:11:62:aa:bb:01"]);
    const cmd = await nouvelleCommande("b");
    await f("creer_taches_impression($1, $2, false)", [cmd, [{ station: "cuisine", contenu: [] }]]);
    const { tache } = await f<{ tache: string }>("passage_imprimante($1, $2, '200 OK')", [jeton, "00:11:62:aa:bb:01"]);
    const resultats: { etat: string }[] = [];
    for (let i = 0; i < 3; i++) resultats.push(await f("confirmer_tache($1, $2, $3, '520 Timeout')", [jeton, "00:11:62:aa:bb:01", tache]));
    expect(resultats.map((r) => r.etat)).toEqual(["en_attente", "en_attente", "echec"]);
    expect((await db.query<{ etat: string; tentatives: number }>("select etat, tentatives from taches_impression where id = $1", [tache])).rows[0]).toEqual({ etat: "echec", tentatives: 3 });

    const cmd2 = await nouvelleCommande("c");
    await f("creer_taches_impression($1, $2, true)", [cmd2, [{ station: "cuisine", contenu: [] }]]);
    const { tache: t2 } = await f<{ tache: string }>("passage_imprimante($1, $2, '200 OK')", [jeton, "00:11:62:aa:bb:01"]);
    await f("tache_pour_imprimante($1, $2, $3)", [jeton, "00:11:62:aa:bb:01", t2]);
    await db.query("update taches_impression set envoye_le = now() - interval '3 minutes' where id = $1", [t2]);
    await f("passage_imprimante($1, $2, '200 OK')", [jeton, "00:11:62:aa:bb:01"]);
    expect((await db.query<{ etat: string }>("select etat from taches_impression where id = $1", [t2])).rows[0].etat).toBe("en_attente");
  });

  it("un nouveau jeton coupe l'ancien et délie l'appareil ; une imprimante désactivée ne reçoit plus rien", async () => {
    const ancien = h();
    const id = await f<number>("ajouter_imprimante('Jeton test', 'pizza', $1, $2)", [ancien, gerant]);
    await f("passage_imprimante($1, $2, '200 OK')", [ancien, MAC]);
    const nouveau = h();
    await f("modifier_imprimante($1::smallint, $2, null, $3)", [id, nouveau, gerant]);
    expect(await f("passage_imprimante($1, $2, '200 OK')", [ancien, MAC])).toBeNull();
    expect(await f("passage_imprimante($1, '00:11:62:dd:ee:ff', '200 OK')", [nouveau])).not.toBeNull();
    const cmd = await nouvelleCommande("desactivation");
    await f("creer_taches_impression($1, $2, false)", [cmd, [{ station: "pizza", contenu: [] }]]);
    await f("modifier_imprimante($1::smallint, null, false, $2)", [id, gerant]);
    expect(await f("passage_imprimante($1, '00:11:62:dd:ee:ff', '200 OK')", [nouveau])).toBeNull();
    // Le ticket ne reste pas bloqué sur l'imprimante désactivée.
    const t = (await db.query<{ imprimante_id: number | null }>("select imprimante_id from taches_impression where commande_id = $1", [cmd])).rows[0];
    expect(t.imprimante_id).not.toBe(id);
  });

  it("gestion des imprimantes réservée au gérant, aucun droit pour un visiteur", async () => {
    const service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
    await expect(f("ajouter_imprimante('X', 'pizza', $1, $2)", [h(), service])).rejects.toThrow(/gérant/);
    for (const sql of ["select * from imprimantes", "select * from taches_impression", "select * from surveillance_etat", `select passage_imprimante('${h()}', null, '200')`]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("surveillance", () => {
  it("alerte une seule fois pour une commande du jour qui attend trop", async () => {
    const id = await nouvelleCommande("retard");
    await db.query("update commandes set statut = 'nouvelle', cree_le = now() - interval '20 minutes' where id = $1", [id]);
    const r1 = await f<{ id: string }[]>("commandes_en_retard()");
    expect(r1.map((x) => x.id)).toContain(id);
    expect((await f<{ id: string }[]>("commandes_en_retard()")).map((x) => x.id)).not.toContain(id);
  });

  it("tablette muette : pause automatique une fois, levée par la reprise", async () => {
    expect(await f<boolean>("tablette_muette(180)")).toBe(false); // jamais vue
    await f("signe_tablette()");
    expect(await f<boolean>("tablette_muette(180)")).toBe(false);
    await db.query("update surveillance_etat set tablette_vue_le = now() - interval '5 minutes'");
    expect(await f<boolean>("tablette_muette(180)")).toBe(true);
    expect(await f<boolean>("pause_automatique()")).toBe(true);
    expect(await f<boolean>("pause_automatique()")).toBe(false);
    expect((await db.query<{ valeur: unknown }>("select valeur from reglages where cle = 'pause_auto'")).rows[0].valeur).toBe(true);
    await f("regler_service($1, null)", [{ pause_jusqu_a: null }]);
    expect((await db.query<{ valeur: unknown }>("select valeur from reglages where cle = 'pause_auto'")).rows[0].valeur).toBe(false);
  });
});

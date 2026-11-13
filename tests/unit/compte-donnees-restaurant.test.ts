import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande } from "@/lib/db/serveur";
import { exporterCompte, supprimerCompte } from "@/lib/comptes/donnees";

// Vague 3, client-compte (nLPD) : l'export du compte donne aussi ce que le restaurant note sur le client
// (notes internes, marque) ; la suppression du compte efface les notes. La marque reste (proposition de
// bo-commandes, à valider par Jérémy) pour qu'un blocage ne se lève pas en supprimant son compte.

async function compteAvecNotes() {
  const db = await baseLocale();
  const email = `notes-${randomUUID().slice(0, 8)}@exemple.test`;
  const compte = (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [email])).rows[0].id;
  // Une note ne s'écrit que sur un client connu (une commande avec cet e-mail). Montants d'essai.
  const cle = randomUUID();
  await creerCommande({
    jeton_suivi: `jeton-${cle}`, cle_idempotence: cle, mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir", client_prenom: "Note", client_nom: "Essai", client_telephone: "079 000 00 09", client_email: email,
    quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 2000, frais_centimes: 0, total_centimes: 2000, tva_centimes: 51,
    taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 2000, total_centimes: 2000, choix: {}, retraits: [], note: "" }],
  });
  const gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  await db.query("select ajouter_note_client($1, $2, $3)", [email, "Préfère qu'on sonne deux fois.", gerant]);
  // Les marques sont désactivées par défaut (réglage marque_client_active) : posée directement pour l'essai.
  await db.query("insert into marques_client (email, marque, motif, personnel_nom) values ($1, 'surveiller', 'Deux commandes non retirées.', 'Équipe test')", [email]);
  return { id: compte, email };
}

describe("données du restaurant sur le client", () => {
  it("l'export les contient : notes et marque", async () => {
    const c = await compteAvecNotes();
    const e = (await exporterCompte(c, "10.1")) as { restaurant: { notes: { texte: string }[]; marque: { marque: string } | null } };
    expect(e.restaurant.notes.map((n) => n.texte)).toEqual(["Préfère qu'on sonne deux fois."]);
    expect(e.restaurant.marque).toMatchObject({ marque: "surveiller" });
  });

  it("la suppression du compte efface les notes, garde la marque", async () => {
    const c = await compteAvecNotes();
    expect(await supprimerCompte(c)).toBe(true);
    const db = await baseLocale();
    expect((await db.query<{ n: number }>("select count(*)::int n from notes_client where email = $1", [c.email])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from comptes where id = $1", [c.id])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from marques_client where email = $1", [c.email])).rows[0].n).toBe(1);
  });
});

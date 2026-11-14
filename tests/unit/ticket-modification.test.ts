import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { texteTicket, ticketModification, type CommandePourTicket, type LigneTicket } from "@/lib/impression/ticket";

// Ticket « MODIFIÉE » (vague 3, contrat avec bo-commandes, #65) : un seul, au poste qui fait le sac, seulement si les
// premiers tickets sont sortis et la commande encore en cours.

const { imprimerModification } = await import("@/lib/impression/modification");

const c: CommandePourTicket = {
  numero: 42, mode: "livraison", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 444 55 66",
  adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" }, details_livraison: { etage: "2", sonnette: "Rossi", code: "", instructions: "" },
  heure_confirmee: "2026-11-13T18:45:00Z", statut_paiement: "paye", moyen_paiement: "en_ligne", lignes: [],
};

describe("ticketModification", () => {
  it("en-tête, avant et après pour chaque changement, puis l'état à jour", () => {
    const t = texteTicket(ticketModification(c, [{ champ: "Téléphone", avant: "079 111 22 33", apres: "079 444 55 66" }], "2026-11-13T18:20:00Z"));
    expect(t).toMatch(/^MODIFIEE/);
    expect(t).toMatch(/LIVRAISON\s+No? ?042/);
    expect(t).toMatch(/Telephone :\n\s+avant : 079 111 22 33\n\s+>> apres : 079 444 55 66 <</);
    expect(t).toMatch(/Client : Lea R\.\s+079 444 55 66/);
    expect(t).toContain("Adresse : Route de Chancy 1, 1213 Onex");
  });
});

describe("ticketModification : montant encore dû (bo-commandes)", () => {
  it("à encaisser ou complément dû : une ligne en gras ; tout payé ou 0 : rien", () => {
    const ch = [{ champ: "Téléphone", avant: "079 111 22 33", apres: "079 444 55 66" }];
    expect(texteTicket(ticketModification(c, ch, "2026-11-13T18:20:00Z", { centimes: 1250, complement: false }))).toMatch(/A ENCAISSER : CHF 12\.50\n/);
    expect(texteTicket(ticketModification(c, ch, "2026-11-13T18:20:00Z", { centimes: 300, complement: true }))).toContain("A ENCAISSER : CHF 3.00 (COMPLEMENT)");
    expect(texteTicket(ticketModification(c, ch, "2026-11-13T18:20:00Z", { centimes: 0, complement: true }))).not.toContain("A ENCAISSER");
    expect(texteTicket(ticketModification(c, ch, "2026-11-13T18:20:00Z"))).not.toContain("A ENCAISSER");
  });
});

describe("imprimerModification", () => {
  let n = 0;
  async function commande(statut: string, lignes: ("pizza" | "cuisine")[]) {
    const db = await baseLocale();
    n += 1;
    const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [{
      jeton_suivi: `j-mod-${n}-${Date.now()}`, cle_idempotence: `mod-${n}-${Date.now()}`, mode: "retrait", statut, statut_paiement: "paye", moyen_paiement: "en_ligne",
      client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 444 55 66", client_email: "mod@laferme.test", quand_type: "asap", pizzas_seulement: false,
      sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 26, taux_tva_pourcent: 2.6, origine: "http://localhost",
      lignes: lignes.map((s) => ({ slug: `plat-${s}`, nom: `Plat ${s}`, station: s, qte: 1, unitaire_centimes: 500, total_centimes: 500, choix: {}, retraits: [], note: "" })),
    }])).rows[0].id;
    return { db, id };
  }
  const ch = [{ champ: "Téléphone", avant: "079 111 22 33", apres: "079 444 55 66" }];
  const taches = async (db: Awaited<ReturnType<typeof baseLocale>>, id: string) =>
    (await db.query<{ station: string; contenu: LigneTicket[] }>("select station, contenu from taches_impression where commande_id = $1 and reimpression", [id])).rows;

  it("tickets déjà sortis : un ticket au poste du sac (cuisine s'il y en a)", async () => {
    const { db, id } = await commande("acceptee", ["pizza", "cuisine"]);
    await db.query("select premiers_tickets($1, $2::jsonb)", [id, JSON.stringify([{ station: "pizza", contenu: [] }, { station: "cuisine", contenu: [] }])]);
    expect(await imprimerModification(id, ch)).toBe(1);
    const t = await taches(db, id);
    expect(t.map((x) => x.station)).toEqual(["cuisine"]);
    expect(texteTicket(t[0].contenu)).toMatch(/^MODIFIEE/);
  });

  it("pizzas seules : au poste pizza", async () => {
    const { db, id } = await commande("acceptee", ["pizza"]);
    await db.query("select premiers_tickets($1, $2::jsonb)", [id, JSON.stringify([{ station: "pizza", contenu: [] }])]);
    expect(await imprimerModification(id, ch)).toBe(1);
    expect((await taches(db, id)).map((x) => x.station)).toEqual(["pizza"]);
  });

  it("complément encore dû à la porte : le ticket dit combien encaisser ; payée en ligne sans complément : rien", async () => {
    const { db, id } = await commande("acceptee", ["pizza"]);
    await db.query("select premiers_tickets($1, $2::jsonb)", [id, JSON.stringify([{ station: "pizza", contenu: [] }])]);
    expect(await imprimerModification(id, ch)).toBe(1);
    expect(texteTicket((await taches(db, id))[0].contenu)).not.toContain("A ENCAISSER");
    // Montant d'essai, posé directement (le geste vient de « Changer les plats »).
    await db.query("insert into complements (commande_id, montant_centimes, tva_centimes, moyen) values ($1, 450, 11, 'porte')", [id]);
    expect(await imprimerModification(id, [{ champ: "Nom", avant: "Rossi", apres: "Rosso" }])).toBe(1);
    const derniers = await taches(db, id);
    expect(texteTicket(derniers[derniers.length - 1].contenu)).toContain("A ENCAISSER : CHF 4.50 (COMPLEMENT)");
  });

  it("rien avant les premiers tickets, rien pour une commande finie, rien sans vrai changement", async () => {
    const pasSortie = await commande("acceptee", ["pizza"]);
    expect(await imprimerModification(pasSortie.id, ch)).toBe(0);
    const finie = await commande("acceptee", ["pizza"]);
    await finie.db.query("select premiers_tickets($1, $2::jsonb)", [finie.id, JSON.stringify([{ station: "pizza", contenu: [] }])]);
    await finie.db.query("update commandes set statut = 'terminee' where id = $1", [finie.id]);
    expect(await imprimerModification(finie.id, ch)).toBe(0);
    expect(await imprimerModification(finie.id, [{ champ: "Nom", avant: "Rossi", apres: "Rossi" }])).toBe(0);
  });
});

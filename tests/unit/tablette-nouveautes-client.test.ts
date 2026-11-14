import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { ticketsDeCommande, type CommandePourTicket, type LigneTicket } from "@/lib/impression/ticket";

// Nouveautés de la commande client (vague 3, client-commande) lues par la tablette, les tickets, la vue par poste
// et la page livreur : allergie, personne qui reçoit la commande, couverts, prénom par ligne. Migration 20261212110000.

const textes = (l: LigneTicket[]) => l.map((x) => (x.t === "texte" ? x.texte : x.t === "deux" ? `${x.gauche} ${x.droite}` : "---")).join("\n");
const base: CommandePourTicket = {
  numero: 7, mode: "livraison", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34",
  adresse: { rue: "Route de Chancy", numero: "76", npa: "1213", localite: "Onex" }, details_livraison: null,
  heure_confirmee: "2026-11-10T18:45:00Z", statut_paiement: "paye", moyen_paiement: "en_ligne",
  lignes: [
    { nom: "Pizza Margherita", qte: 1, station: "pizza", details: [], pour: "Hugo" },
    { nom: "Pasta alla carbonara", qte: 1, station: "cuisine", details: ["CHOIX Penne"], pour: "" },
  ],
};

describe("tickets", () => {
  it("personne qui reçoit, prénom sous le plat, couverts sur le seul ticket du sac", () => {
    const [pizza, cuisine] = ticketsDeCommande({ ...base, destinataire: { nom: "Marc Dupont", telephone: "078 111 22 33" }, couverts: true }, { accepteLe: "2026-11-10T18:10:00Z" });
    expect(textes(pizza.contenu)).toContain("Pour : Marc Dupont   078 111 22 33");
    expect(textes(pizza.contenu)).toMatch(/1 x Pizza Margherita\npour Hugo/);
    expect(textes(cuisine.contenu)).not.toMatch(/\npour /);
    // Le sac se fait en cuisine quand il y a des lignes cuisine.
    expect(textes(cuisine.contenu)).toContain("[ ] COUVERTS ET SERVIETTES");
    expect(textes(pizza.contenu)).not.toContain("COUVERTS");
  });

  it("sac (réponse de Jérémy du 14.11) : tous les articles en cases à cocher, boissons comprises, sur le seul ticket du sac", () => {
    const c: CommandePourTicket = { ...base, lignes: [...base.lignes, { nom: "Coca-Cola 33 cl", qte: 2, station: "comptoir", details: [] }] };
    const tickets = ticketsDeCommande(c, { accepteLe: "2026-11-10T18:10:00Z" });
    // Pas de ticket de préparation pour le comptoir.
    expect(tickets.map((t) => t.station)).toEqual(["pizza", "cuisine"]);
    const [pizza, cuisine] = tickets;
    expect(textes(cuisine.contenu)).toMatch(/SAC : COCHER CHAQUE ARTICLE\n\[ \] 1 x Pizza Margherita \(pour Hugo\)\n\[ \] 1 x Pasta alla carbonara\n\[ \] 2 x Coca-Cola 33 cl/);
    expect(textes(pizza.contenu)).not.toContain("SAC");
  });

  it("rien de nouveau quand le client n'a rien demandé", () => {
    const t = ticketsDeCommande(base, { accepteLe: "2026-11-10T18:10:00Z" }).map((x) => textes(x.contenu)).join("\n");
    expect(t).not.toMatch(/Pour :|COUVERTS|ALLERGIE/);
    // La liste du sac, elle, est toujours là, sur le ticket du sac.
    expect(t).toContain("SAC : COCHER CHAQUE ARTICLE");
  });
});

describe("file de la tablette et page livreur", () => {
  it("file_tablette et livraisons_livreur portent les nouveaux champs", async () => {
    const db = await baseLocale();
    const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [{
      jeton_suivi: "j-nc-1", cle_idempotence: "nc-1", mode: "retrait", statut: "nouvelle", statut_paiement: "paye", moyen_paiement: "en_ligne",
      client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: "nc@laferme.test", quand_type: "asap", pizzas_seulement: true,
      sous_total_centimes: 1800, frais_centimes: 0, total_centimes: 1800, tva_centimes: 46, taux_tva_pourcent: 2.6, origine: "http://localhost",
      allergie: "arachides", destinataire: { nom: "Marc Dupont", telephone: "078 111 22 33" }, couverts: true,
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "", pour: "Hugo" }],
    }])).rows[0].id;
    const file = (await db.query<{ f: { id: string; allergie: string; destinataire: unknown; couverts: boolean; lignes: { pour: string }[] }[] }>("select file_tablette() as f")).rows[0].f;
    const c = file.find((x) => x.id === id)!;
    expect(c).toMatchObject({ allergie: "arachides", destinataire: { nom: "Marc Dupont", telephone: "078 111 22 33" }, couverts: true });
    expect(c.lignes[0].pour).toBe("Hugo");
    const sql = (await db.query<{ d: string }>("select pg_get_functiondef('livraisons_livreur(uuid)'::regprocedure) as d")).rows[0].d;
    expect(sql).toContain("'destinataire', o.destinataire");
  });
});

describe("vue par poste", () => {
  it("l'allergie suit la commande au poste", async () => {
    const { vuePoste } = await import("@/components/tablette/poste");
    const c = { id: "a", numero: 1, statut: "acceptee", mode: "retrait", client_prenom: "Léa", client_nom: "R", heure_confirmee: "2026-11-13T19:00:00Z", heure_proposee: "", allergie: " lait ", lignes: [{ nom: "Pizza Margherita", qte: 1, station: "pizza", choix: {}, retraits: [], note: "", details: [], pour: "Hugo" }] };
    const v = vuePoste([c as never], [{ commande_id: "a", station: "pizza", a_faire_le: "2026-11-13T18:40:00Z", lance_le: null, pret_le: null, pret_par: null }], "pizza");
    expect(v.en_cours[0].allergie).toBe("lait");
    expect(v.en_cours[0].lignes[0].pour).toBe("Hugo");
  });
});

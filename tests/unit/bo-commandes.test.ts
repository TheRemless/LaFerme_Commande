import { beforeAll, describe, expect, it, vi } from "vitest";
import { filtresListe, texteNote } from "@/lib/gestion-commandes";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes, côté serveur : filtres de la liste contrôlés avant la base, notes internes, et
// la route /api/gestion/commandes de bout en bout sur la base embarquée (gérant simulé).

const session = vi.hoisted(() => ({ personnel: null as null | { id: string; nom: string; role: string } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerGerant: async () => {
    const { refus } = await import("@/lib/comptes/api");
    if (!session.personnel) return { reponse: refus("Connectez-vous.", 401) };
    if (session.personnel.role !== "gerant") return { reponse: refus("Réservé au gérant.", 403) };
    return { personnel: session.personnel };
  },
}));
const { POST } = await import("@/app/api/gestion/commandes/route");

async function appel(corps: unknown): Promise<{ status: number; corps: Record<string, unknown> }> {
  const r = await POST(new Request("http://localhost/api/gestion/commandes", { method: "POST", body: JSON.stringify(corps) }));
  return { status: r.status, corps: (await r.json()) as Record<string, unknown> };
}

describe("filtres de la liste", () => {
  it("garde ce qui est reconnu et convertit les montants en centimes", () => {
    const r = filtresListe({
      action: "liste_page", debut: "2026-11-01", fin: "2026-11-17", recherche: "  079  555 ", statuts: ["acceptee", "acceptee", "partie"],
      paiements: ["paye"], mode: "livraison", moyen: "en_ligne", zone: "2", montant_min: "20", montant_max: 45.5,
      remboursee: true, en_retard: false, avec_reclamation: true, tri: "heure", page: 2, par_page: 25, inconnu: "ignoré",
    });
    expect(r).toEqual({
      ok: true,
      valeur: {
        debut: "2026-11-01", fin: "2026-11-17", recherche: "079 555", statuts: ["acceptee", "partie"], paiements: ["paye"], mode: "livraison",
        moyen: "en_ligne", zone: 2, montant_min: 2000, montant_max: 4550, remboursee: true, avec_reclamation: true, tri: "heure", page: 2, par_page: 25,
      },
    });
  });

  it("refuse les valeurs douteuses avec un message clair", () => {
    const refus = (c: Record<string, unknown>) => {
      const r = filtresListe(c);
      return r.ok ? "accepté" : r.erreur;
    };
    expect(refus({ debut: "2026-11-17", fin: "2026-11-01" })).toBe("Période invalide.");
    expect(refus({ debut: "2025-01-01", fin: "2026-11-17" })).toMatch(/trop longue/);
    expect(refus({ statuts: ["livree"] })).toBe("Statut inconnu.");
    expect(refus({ statuts: "acceptee" })).toBe("Statut inconnu.");
    expect(refus({ paiements: ["gratuit"] })).toMatch(/paiement inconnu/);
    expect(refus({ mode: "drone" })).toBe("Mode inconnu.");
    expect(refus({ remboursement: "perdu" })).toBe("État de remboursement inconnu.");
    expect(refus({ service: "nuit" })).toBe("Service inconnu.");
    expect(refus({ zone: "1; drop table commandes" })).toBe("Zone inconnue.");
    expect(refus({ zone: true })).toBe("Zone inconnue.");
    expect(refus({ page: true })).toBe("Page invalide.");
    expect(refus({ livreur: "Marco" })).toBe("Livreur inconnu.");
    expect(refus({ montant_min: "-5" })).toMatch(/minimum invalide/);
    expect(refus({ montant_min: 50, montant_max: 20 })).toMatch(/plus petit/);
    expect(refus({ en_retard: "oui" })).toBe("Filtre illisible.");
    expect(refus({ tri: "client_email" })).toBe("Tri inconnu.");
    expect(refus({ par_page: 5000 })).toBe("Page invalide.");
    expect(refus({ recherche: { $ne: null } })).toBe("Recherche illisible.");
  });

  it("une recherche est coupée à 60 caractères", () => {
    const r = filtresListe({ recherche: "a".repeat(200) });
    expect(r.ok && (r.valeur.recherche as string).length).toBe(60);
  });
});

describe("texte d'une note", () => {
  it("garde les retours à la ligne, resserre les espaces, borne la longueur", () => {
    expect(texteNote("  Client   rappelé\r\n\r\n\r\n\r\nattend en bas  ")).toBe("Client rappelé\n\nattend en bas");
    expect(texteNote(" ")).toBeNull();
    expect(texteNote("x".repeat(501))).toBeNull();
    expect(texteNote(42)).toBeNull();
    // Un emoji seul : un caractère pour Postgres, refusé ici plutôt qu'en erreur 500 par la base.
    expect(texteNote("👍")).toBeNull();
    expect(texteNote("ok 👍")).toBe("ok 👍");
  });
});

describe("route /api/gestion/commandes, nouvelles actions", () => {
  let commande: string;
  beforeAll(async () => {
    const db = await baseLocale();
    const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
    session.personnel = { ...g, role: "gerant" };
    const p = {
      jeton_suivi: "jeton-bo-route", cle_idempotence: "bo-route", mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir", client_prenom: "Route", client_nom: "Test", client_telephone: "079 111 22 33", client_email: "route@laferme.test",
      quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 0,
      taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
      lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
    };
    commande = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
    await db.query("select enregistrer_courriel($1)", [{ commande_id: commande, destinataire: "route@laferme.test", sujet: "Reçu", texte: "Merci", html: "<b>Merci</b>", fournisseur: "doublure" }]);
  });

  it("liste paginée, fiche complète, contenu d'un e-mail, note", async () => {
    const l = await appel({ action: "liste_page", recherche: "079 111 22 33" });
    expect(l.status).toBe(200);
    expect((l.corps.lignes as { id: string }[]).map((x) => x.id)).toEqual([commande]);

    const n = await appel({ action: "noter", id: commande, texte: "Paiera en espèces, prévoir la monnaie." });
    expect(n.status).toBe(200);
    expect(n.corps).toMatchObject({ texte: "Paiera en espèces, prévoir la monnaie.", personnel_nom: "Gérant bureau" });

    const fiche = await appel({ action: "fiche_complete", id: commande });
    expect(fiche.status).toBe(200);
    const mail = (fiche.corps.courriels as { id: string }[])[0];
    const m = await appel({ action: "courriel", id: commande, courriel: mail.id });
    expect(m.corps).toMatchObject({ sujet: "Reçu", texte: "Merci" });
    expect(m.corps.html).toBeUndefined();
  });

  it("refuse un filtre douteux, une note vide, une commande ou un e-mail inconnus", async () => {
    expect((await appel({ action: "liste_page", tri: "prix; drop" })).status).toBe(422);
    expect((await appel({ action: "noter", id: commande, texte: "" })).status).toBe(422);
    expect((await appel({ action: "noter", id: "00000000-0000-0000-0000-000000000000", texte: "Note" })).status).toBe(404);
    expect((await appel({ action: "fiche_complete", id: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
    expect((await appel({ action: "fiche_complete", id: "------------------------------------" })).status).toBe(404);
    expect((await appel({ action: "courriel", id: commande, courriel: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
  });

  it("une relance de plus de 23 heures est refusée (Stripe a oublié sa clé)", async () => {
    const db = await baseLocale();
    await db.query(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, cree_le) values ($1, 'cle-vieille-0001', 500, 'Retard.', 'stripe', 'en_cours', 'Gérant', now() - interval '25 hours')",
      [commande],
    );
    const r = await appel({ action: "rembourser", id: commande, montant: "5", motif: "Retard.", cle: "cle-vieille-0001" });
    expect(r.status).toBe(409);
    expect(String(r.corps.erreur)).toContain("plus de 23 heures");
  });

  it("un membre du service n'y a pas accès", async () => {
    const avant = session.personnel;
    session.personnel = { id: "x", nom: "Service", role: "service" };
    expect((await appel({ action: "liste_page" })).status).toBe(403);
    session.personnel = avant;
  });
});

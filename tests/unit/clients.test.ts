import { beforeAll, describe, expect, it, vi } from "vitest";
import { emailClient, filtresClients, motifMarque } from "@/lib/gestion-clients";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes : rubrique Clients côté serveur. Filtres contrôlés avant la base, e-mail dans le
// corps seulement, route de bout en bout sur la base embarquée (gérant simulé).
const session = vi.hoisted(() => ({ personnel: null as null | { id: string; nom: string; role: string } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerGerant: async () => {
    const { refus } = await import("@/lib/comptes/api");
    if (!session.personnel) return { reponse: refus("Connectez-vous.", 401) };
    if (session.personnel.role !== "gerant") return { reponse: refus("Réservé au gérant.", 403) };
    return { personnel: session.personnel };
  },
  // D1 : le gérant, ou le responsable sur ses actions (tableau de src/lib/personnel/droits.ts).
  exigerDroit: async (_r: Request, action: import("@/lib/personnel/droits").ActionDroit) => {
    const { refus } = await import("@/lib/comptes/api");
    const { aLeDroit } = await import("@/lib/personnel/droits");
    if (!session.personnel) return { reponse: refus("Connectez-vous.", 401) };
    if (!aLeDroit(session.personnel.role, action)) return { reponse: refus("Réservé au gérant.", 403) };
    return { personnel: session.personnel };
  },
}));
const { POST } = await import("@/app/api/gestion/clients/route");

async function appel(corps: unknown) {
  const r = await POST(new Request("http://localhost/api/gestion/clients", { method: "POST", body: JSON.stringify(corps) }));
  return { status: r.status, corps: (await r.json()) as Record<string, unknown> };
}

describe("contrôles", () => {
  it("filtres reconnus, valeurs douteuses refusées", () => {
    expect(filtresClients({ recherche: "  079  12 ", tri: "depense", marque: "bloque", avec_compte: true, inactif_jours: "60", page: 2, inconnu: 1 })).toEqual({
      ok: true,
      valeur: { recherche: "079 12", tri: "depense", marque: "bloque", avec_compte: true, inactif_jours: 60, page: 2 },
    });
    expect(filtresClients({ tri: "email; drop" })).toEqual({ ok: false, erreur: "Tri inconnu." });
    expect(filtresClients({ marque: "banni" })).toEqual({ ok: false, erreur: "Marque inconnue." });
    expect(filtresClients({ inactif_jours: true })).toEqual({ ok: false, erreur: "Nombre de jours invalide." });
    expect(filtresClients({ avec_compte: "oui" })).toEqual({ ok: false, erreur: "Filtre illisible." });
  });
  it("e-mail et motif", () => {
    expect(emailClient(" Giulia@Exemple.CH ")).toBe("giulia@exemple.ch");
    expect(emailClient("pas un e-mail")).toBeNull();
    expect(emailClient({ email: "x@y.ch" })).toBeNull();
    expect(motifMarque("  Trois   commandes non retirées ")).toBe("Trois commandes non retirées");
    expect(motifMarque("ok")).toBeNull();
  });
});

describe("route /api/gestion/clients", () => {
  beforeAll(async () => {
    const db = await baseLocale();
    const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
    session.personnel = { ...g, role: "gerant" };
    const p = {
      jeton_suivi: "jeton-clients-route", cle_idempotence: "clients-route", mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir", client_prenom: "Route", client_nom: "Client", client_telephone: "079 444 55 66", client_email: "route.client@exemple.ch",
      quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 1200, frais_centimes: 0, total_centimes: 1200, tva_centimes: 0,
      taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
      lignes: [{ slug: "x", nom: "Lasagne", station: "cuisine", qte: 1, unitaire_centimes: 1200, total_centimes: 1200, choix: {}, retraits: [], note: "" }],
    };
    await db.query("select creer_commande($1)", [p]);
  });

  it("liste, fiche, note ; marque refusée tant que le réglage est éteint", async () => {
    const l = await appel({ action: "liste", recherche: "079 444 55 66" });
    expect(l.status).toBe(200);
    expect((l.corps.lignes as { email: string }[]).map((x) => x.email)).toEqual(["route.client@exemple.ch"]);
    const fiche = await appel({ action: "fiche", email: "Route.Client@exemple.ch" });
    expect(fiche.status).toBe(200);
    expect(fiche.corps).toMatchObject({ email: "route.client@exemple.ch", commandes: 1, marque_active: false });
    const n = await appel({ action: "noter", email: "route.client@exemple.ch", texte: "Préfère être appelé plutôt qu'un e-mail." });
    expect(n.corps).toMatchObject({ texte: "Préfère être appelé plutôt qu'un e-mail.", personnel_nom: "Gérant bureau" });
    const m = await appel({ action: "marquer", email: "route.client@exemple.ch", marque: "surveiller", motif: "Réclame à chaque commande" });
    expect(m).toEqual({ status: 409, corps: { erreur: "Marquer un client n'est pas encore activé." } });
  });

  it("refus : client inconnu, e-mail illisible, filtre douteux, membre du service", async () => {
    expect((await appel({ action: "fiche", email: "personne@exemple.ch" })).status).toBe(404);
    expect((await appel({ action: "fiche", email: "x" })).status).toBe(404);
    expect((await appel({ action: "noter", email: "personne@exemple.ch", texte: "Note" })).status).toBe(404);
    expect((await appel({ action: "liste", tri: "x" })).status).toBe(422);
    expect((await appel({ action: "marquer", email: "route.client@exemple.ch", marque: "banni", motif: "xxx" })).status).toBe(422);
    const avant = session.personnel;
    session.personnel = { id: "x", nom: "Service", role: "service" };
    expect((await appel({ action: "liste" })).status).toBe(403);
    session.personnel = avant;
  });
});

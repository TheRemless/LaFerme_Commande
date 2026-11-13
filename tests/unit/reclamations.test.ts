import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { filtresReclamations, gesteReclamation, nouvelleReclamation, suiviReclamation } from "@/lib/gestion-reclamations";

// Vague 3, bo-commandes : réclamations côté serveur. Contrôles avant la base, route du back-office (gérant
// simulé), route du suivi (jeton dans le corps, requête du site), réclamations dans la fiche de la commande.
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
const gestion = await import("@/app/api/gestion/reclamations/route");
const commandes = await import("@/app/api/gestion/commandes/route");
const suivi = await import("@/app/api/suivi/reclamation/route");

const appel = async (route: { POST: (r: Request) => Promise<Response> }, corps: unknown, origine?: string) => {
  const r = await route.POST(new Request("http://localhost:3000/x", { method: "POST", headers: origine ? { origin: origine, host: "localhost:3000" } : {}, body: JSON.stringify(corps) }));
  return { status: r.status, corps: (await r.json()) as Record<string, unknown> };
};

describe("contrôles", () => {
  it("nouvelle réclamation, filtres, suivi, geste", () => {
    expect(nouvelleReclamation({ type: "manquant", description: "  Il manque   le tiramisù ", commande_id: "11111111-1111-1111-1111-111111111111" })).toEqual({
      ok: true, valeur: { type: "manquant", description: "Il manque le tiramisù", commande_id: "11111111-1111-1111-1111-111111111111", source: "telephone" },
    });
    expect(nouvelleReclamation({ type: "colere", description: "Bof" })).toMatchObject({ ok: false });
    expect(nouvelleReclamation({ type: "froid", description: "Froid" })).toEqual({ ok: false, erreur: "Choisissez la commande concernée." });
    expect(filtresReclamations({ statuts: ["ouverte", "ouverte"], types: ["froid"], page: 2 })).toEqual({ ok: true, valeur: { statuts: ["ouverte"], types: ["froid"], page: 2 } });
    expect(filtresReclamations({ statuts: ["perdue"] })).toEqual({ ok: false, erreur: "Filtre inconnu." });
    expect(suiviReclamation({ statut: "close" })).toMatchObject({ ok: false });
    expect(suiviReclamation({})).toEqual({ ok: false, erreur: "Rien à enregistrer." });
    expect(gesteReclamation({ geste: "avoir", detail: "20 CHF" })).toEqual({ ok: false, erreur: "Geste inconnu." });
    expect(gesteReclamation({ geste: "aucun", detail: "Client absent" })).toEqual({ ok: true, valeur: { geste: "aucun", detail: "Client absent" } });
  });
});

describe("routes", () => {
  let commande: string;
  const jeton = "jeton-reclamation-route-abcdefgh";
  beforeAll(async () => {
    const db = await baseLocale();
    const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
    session.personnel = { ...g, role: "gerant" };
    const p = {
      jeton_suivi: jeton, cle_idempotence: "rec-route", mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir",
      client_prenom: "Route", client_nom: "Rec", client_telephone: "079 000 11 22", client_email: "route.rec@exemple.ch", quand_type: "asap",
      pizzas_seulement: false, sous_total_centimes: 1500, frais_centimes: 0, total_centimes: 1500, tva_centimes: 0, taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "x", nom: "Lasagne", station: "cuisine", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
    };
    commande = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  });

  it("le client ne peut pas réclamer avant l'acceptation, puis réclame depuis son suivi", async () => {
    expect((await appel(suivi, { jeton, type: "froid", description: "Arrivée froide" }, "https://pirate.example")).status).toBe(403);
    expect((await appel(suivi, { jeton, type: "froid", description: "Arrivée froide" }, "http://localhost:3000")).status).toBe(409);
    const db = await baseLocale();
    await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now())", [commande]);
    expect((await appel(suivi, { jeton, type: "colere", description: "Arrivée froide" }, "http://localhost:3000")).status).toBe(422);
    const r = await appel(suivi, { jeton, type: "froid", description: "Arrivée froide" }, "http://localhost:3000");
    expect(r).toEqual({ status: 200, corps: { ok: true, message: "Merci, le restaurant a reçu votre message." } });
  });

  it("le gérant ouvre, suit et voit la réclamation dans la fiche de la commande", async () => {
    const o = await appel(gestion, { action: "ouvrir", commande_id: commande, type: "manquant", description: "Il manque le dessert.", source: "telephone" });
    expect(o.status).toBe(200);
    const id = o.corps.id as string;
    expect((await appel(gestion, { action: "suivre", id, statut: "en_cours", texte: "Rappel à 20h." })).corps.statut).toBe("en_cours");
    expect(await appel(gestion, { action: "geste", id, geste: "plat_offert", detail: "Un dessert" })).toEqual({
      status: 409, corps: { erreur: "Offrir un plat à la prochaine commande n'est pas encore activé." },
    });
    const fiche = await appel(commandes, { action: "fiche_complete", id: commande });
    expect((fiche.corps.reclamations as { type: string }[]).map((x) => x.type).sort()).toEqual(["froid", "manquant"]);
    const l = await appel(gestion, { action: "liste", statuts: ["en_cours"] });
    expect((l.corps.lignes as { id: string }[]).map((x) => x.id)).toEqual([id]);
    expect((await appel(gestion, { action: "fiche", id: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
  });
});

import { describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { texteTicket, ticketsDeCommande, type CommandePourTicket } from "@/lib/impression/ticket";

// Commande prise au téléphone (vague 3, bo-commandes), côté serveur : livraison à une adresse du registre
// (simulé ici), acceptée, à payer à la livraison, e-mail seulement s'il est donné. Prix et créneaux tirés de la
// base et des réglages, jamais écrits ici.
vi.mock("@/lib/zone-serveur", () => ({
  zoneServeur: async (_config: unknown, adresse: Record<string, string>) => ({
    statut: "livrable",
    verifiee: true,
    zone: { numero: 1, nom: "Zone 1", frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 45 },
    adresse: { rue: "Route de Chancy", numero: adresse.numero, npa: "1213", localite: "Onex", featureId: "123" },
  }),
}));
const { prendreCommandeTelephone } = await import("@/lib/commande-telephone");
const { chargerConfigService } = await import("@/lib/config-service");
const { creneaux } = await import("@/lib/service");

async function equipier() {
  const db = await baseLocale();
  const r = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'equipe-bureau@laferme.test'")).rows[0];
  return { ...r, email: "equipe-bureau@laferme.test", role: "service" as const };
}
let n = 0;
async function demande(extra: Record<string, unknown> = {}) {
  n += 1;
  const config = await chargerConfigService();
  const h = creneaux(config, new Date(), "livraison", { numero: 1, nom: "Zone 1", frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 45 } as never, true)[0];
  return {
    cle: `tel-unitaire-${n}-${Date.now()}`,
    mode: "livraison",
    lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
    quand: { type: "creneau", date: h.date, minutes: h.minutes },
    adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details: { sonnette: "Rossi", etage: "2", code: "", instructions: "" },
    client: { prenom: "Giulia", nom: "Rossi", telephone: "079 555 12 34", email: "" },
    ...extra,
  };
}

describe("commande prise au téléphone, côté serveur", () => {
  it("livraison sans e-mail : acceptée, marquée téléphone, à payer à la livraison, aucun e-mail", async () => {
    const r = await prendreCommandeTelephone(await demande(), await equipier(), "http://localhost:3000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = await baseLocale();
    const c = (await db.query<{ statut: string; canal: string; mode: string; statut_paiement: string; client_email: string }>("select statut, canal, mode, statut_paiement, client_email from commandes where id = $1", [r.id])).rows[0];
    expect(c).toMatchObject({ statut: "acceptee", canal: "telephone", mode: "livraison", statut_paiement: "a_encaisser_retrait", client_email: "" });
    expect((await db.query("select 1 from courriels where commande_id = $1", [r.id])).rows).toHaveLength(0);
    // Rejouée (double appui) : la même commande.
    const encore = await prendreCommandeTelephone({ ...(await demande()), cle: undefined }, await equipier(), "http://localhost:3000");
    expect(encore).toMatchObject({ ok: false });
  });

  it("avec e-mail : le client reçoit le récapitulatif, paiement à la livraison", async () => {
    const r = await prendreCommandeTelephone(await demande({ client: { prenom: "Léa", nom: "", telephone: "079 555 12 35", email: "lea.tel@exemple.ch" } }), await equipier(), "http://localhost:3000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = await baseLocale();
    const m = (await db.query<{ sujet: string; texte: string }>("select sujet, texte from courriels where commande_id = $1", [r.id])).rows;
    expect(m).toHaveLength(1);
    expect(m[0].texte).toContain("À payer à la livraison, en espèces ou par carte");
  });

  it("refus clairs : téléphone, e-mail, sonnette, aucun plat", async () => {
    const p = await equipier();
    expect(await prendreCommandeTelephone(await demande({ client: { prenom: "A", telephone: "12" } }), p, "http://localhost:3000")).toMatchObject({ ok: false, champ: "telephone" });
    expect(await prendreCommandeTelephone(await demande({ client: { prenom: "A", telephone: "079 555 12 34", email: "pas-un-mail" } }), p, "http://localhost:3000")).toMatchObject({ ok: false, champ: "email" });
    expect(await prendreCommandeTelephone(await demande({ details: { sonnette: "" } }), p, "http://localhost:3000")).toMatchObject({ ok: false, champ: "sonnette" });
    expect(await prendreCommandeTelephone(await demande({ lignes: [] }), p, "http://localhost:3000")).toMatchObject({ ok: false, champ: "plats" });
  });

  it("ticket : la marque TÉLÉPHONE et le paiement à la livraison", () => {
    const c: CommandePourTicket = {
      numero: 7, mode: "livraison", client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34",
      adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" }, details_livraison: { etage: "", sonnette: "Rossi", code: "", instructions: "" },
      heure_confirmee: "2026-11-14T18:45:00Z", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir", canal: "telephone",
      lignes: [{ nom: "Margherita", qte: 1, station: "pizza", details: [] }],
    };
    const t = texteTicket(ticketsDeCommande(c, { accepteLe: "2026-11-14T18:00:00Z" })[0].contenu);
    expect(t).toContain("TELEPHONE");
    expect(t).toMatch(/A ENCAISSER A LA LIVRAISON/);
  });
});

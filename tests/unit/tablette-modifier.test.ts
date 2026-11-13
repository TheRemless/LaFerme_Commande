import { afterEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// « Modifier… » sur la tablette (vague 3, contrat de bo-commandes #65) : gérant toujours, équipe de service seulement
// si modification_par_equipe est vrai (construit désactivé).

const session = vi.hoisted(() => ({ personnel: { id: "", email: "", nom: "", role: "gerant" as "gerant" | "service" } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET, POST } = await import("@/app/api/tablette/modifier/route");
const poster = (corps: unknown) => POST(new Request("http://localhost/api/tablette/modifier", { method: "POST", body: JSON.stringify(corps) }));

async function qui(role: "gerant" | "service") {
  const db = await baseLocale();
  const r = (await db.query<{ id: string; nom: string; email: string }>("select id, nom, email from personnel where role = $1 and actif limit 1", [role])).rows[0];
  session.personnel = { ...r, role };
}
async function commande(): Promise<string> {
  const db = await baseLocale();
  const n = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return (await db.query<{ id: string }>("select id from creer_commande($1)", [{
    jeton_suivi: `j-mod-${n}`, cle_idempotence: `mod-${n}`, mode: "retrait", statut: "acceptee", statut_paiement: "paye", moyen_paiement: "en_ligne",
    client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 111 22 33", client_email: "mod@laferme.test", quand_type: "asap", pizzas_seulement: true,
    sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 26, taux_tva_pourcent: 2.6, origine: "http://localhost",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
  }])).rows[0].id;
}
const telephone = async (id: string) => (await (await baseLocale()).query<{ t: string }>("select client_telephone as t from commandes where id = $1", [id])).rows[0].t;
const parEquipe = async (v: boolean) => (await baseLocale()).query("update reglages set valeur = $1::jsonb where cle = 'modification_par_equipe'", [JSON.stringify(v)]);

afterEach(async () => {
  await parEquipe(false);
});

describe("Modifier depuis la tablette", () => {
  it("le gérant change le téléphone ; l'équipe est refusée tant que le réglage est faux", async () => {
    await qui("gerant");
    expect(((await (await GET(new Request("http://localhost/api/tablette/modifier"))).json()) as { autorise: boolean }).autorise).toBe(true);
    const id = await commande();
    const r = await poster({ commande: id, telephone: "079 444 55 66", de: "acceptee" });
    expect(r.status).toBe(200);
    expect(await telephone(id)).toBe("079 444 55 66");

    await qui("service");
    expect(((await (await GET(new Request("http://localhost/api/tablette/modifier"))).json()) as { autorise: boolean }).autorise).toBe(false);
    expect((await poster({ commande: id, telephone: "079 777 88 99", de: "acceptee" })).status).toBe(403);
    expect(await telephone(id)).toBe("079 444 55 66");
  });

  it("réglage à vrai : l'équipe modifie ; un téléphone trop court est refusé", async () => {
    await parEquipe(true);
    await qui("service");
    const id = await commande();
    expect((await poster({ commande: id, telephone: "079 777 88 99", de: "acceptee" })).status).toBe(200);
    expect(await telephone(id)).toBe("079 777 88 99");
    const court = await poster({ commande: id, telephone: "079", de: "acceptee" });
    expect(court.status).toBe(422);
    expect(((await court.json()) as { erreur: string }).erreur).toMatch(/neuf chiffres/);
  });
});

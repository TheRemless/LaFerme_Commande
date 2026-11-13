import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Encaissement au comptoir en espèces ou par carte (vague 3, demande de bo-pilotage pour la clôture du jour),
// et la file de la tablette avec le moyen noté et l'annulation faite par le client.

const { agir, fileTablette } = await import("@/lib/tablette");
const personnel = { id: "00000000-0000-0000-0000-000000000000", email: "test@laferme.test", nom: "Test", role: "service" as const };

let n = 0;
async function aEncaisser(statut: "prete" | "terminee" = "prete"): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-enc-${n}`,
    cle_idempotence: `enc-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: "Enc",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: `enc${n}@laferme.test`,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1800,
    frais_centimes: 0,
    total_centimes: 1800,
    tva_centimes: 46,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  const heure = new Date(Math.ceil((Date.now() + 20 * 60_000) / 300_000) * 300_000).toISOString();
  await agir(id, { action: "accepter", heure }, personnel);
  await agir(id, { action: "statut", vers: "prete", de: "acceptee" }, personnel);
  if (statut === "terminee") await agir(id, { action: "statut", vers: "terminee", de: "prete" }, personnel);
  return id;
}
async function commande(id: string) {
  const db = await baseLocale();
  return (await db.query<{ statut: string; statut_paiement: string; moyen_comptoir: string | null }>("select statut, statut_paiement, moyen_comptoir from commandes where id = $1", [id])).rows[0];
}

describe("Encaissement au comptoir", () => {
  it("« Retirée, espèces » termine, encaisse et note les espèces, avec le moyen dans l'historique", async () => {
    const id = await aEncaisser();
    expect((await agir(id, { action: "retiree_payee", moyen: "especes" }, personnel)).ok).toBe(true);
    expect(await commande(id)).toEqual({ statut: "terminee", statut_paiement: "encaisse", moyen_comptoir: "especes" });
    const db = await baseLocale();
    const ev = (await db.query<{ detail: string }>("select detail from evenements_commande where commande_id = $1 and vers = 'encaisse'", [id])).rows;
    expect(ev).toEqual([{ detail: "especes" }]);
  });

  it("encaissée par carte après coup, depuis « Terminées »", async () => {
    const id = await aEncaisser("terminee");
    expect((await agir(id, { action: "encaisser", moyen: "carte" }, personnel)).ok).toBe(true);
    expect((await commande(id)).moyen_comptoir).toBe("carte");
  });

  it("sans moyen (page ancienne, autre session) : encaissée, moyen non noté", async () => {
    const id = await aEncaisser();
    expect((await agir(id, { action: "retiree_payee" }, personnel)).ok).toBe(true);
    expect(await commande(id)).toEqual({ statut: "terminee", statut_paiement: "encaisse", moyen_comptoir: null });
  });

  it("la base refuse un moyen inconnu et un second encaissement", async () => {
    const id = await aEncaisser("terminee");
    const db = await baseLocale();
    await expect(db.query("select marquer_encaisse($1, 'test', 'cheque')", [id])).rejects.toThrow(/Moyen de paiement inconnu/);
    expect((await db.query<{ r: boolean }>("select marquer_encaisse($1, 'test', 'carte') as r", [id])).rows[0].r).toBe(true);
    expect((await db.query<{ r: boolean }>("select marquer_encaisse($1, 'test', 'especes') as r", [id])).rows[0].r).toBe(false);
    expect((await commande(id)).moyen_comptoir).toBe("carte");
  });

  it("la file de la tablette porte le moyen noté et l'heure d'annulation par le client", async () => {
    const id = await aEncaisser("terminee");
    await agir(id, { action: "encaisser", moyen: "especes" }, personnel);
    const c = (await fileTablette()).find((x) => x.id === id)!;
    expect(c.moyen_comptoir).toBe("especes");
    expect(c.annulee_par_client_le).toBeNull();
  });
});

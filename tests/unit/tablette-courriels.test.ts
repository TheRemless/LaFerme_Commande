import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// E-mail « prête » ou « en route » (question de client-compte, vague 3) : une livraison ne reçoit
// « Le livreur est en route » qu'au départ. La base refuse déjà « prête » pour une livraison (changer_statut) ;
// la tablette ne l'envoie plus qu'au statut qui correspond au mode, même si cette règle changeait.

const { agir } = await import("@/lib/tablette");
const personnel = { id: "00000000-0000-0000-0000-000000000000", email: "test@laferme.test", nom: "Test", role: "service" as const };

let n = 0;
async function acceptee(mode: "livraison" | "retrait"): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-tc-${n}`,
    cle_idempotence: `tc-${n}`,
    mode,
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Tc",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: `tc${n}@laferme.test`,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 1800,
    frais_centimes: 0,
    total_centimes: 1800,
    tva_centimes: 46,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    ...(mode === "livraison" ? { zone_numero: 1 } : {}),
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  const heure = new Date(Math.ceil((Date.now() + 20 * 60_000) / 300_000) * 300_000).toISOString();
  expect((await agir(id, { action: "accepter", heure }, personnel)).ok).toBe(true);
  return id;
}
async function sujets(id: string): Promise<string[]> {
  const db = await baseLocale();
  return (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1 order by envoye_le", [id])).rows.map((r) => r.sujet);
}

describe("E-mail au client quand la commande avance", () => {
  it("livraison : « prête » refusée par la base sans e-mail, « en route » seulement à « partie »", async () => {
    const id = await acceptee("livraison");
    const avant = (await sujets(id)).length;
    expect((await agir(id, { action: "statut", vers: "prete", de: "acceptee" }, personnel)).ok).toBe(false);
    expect((await sujets(id)).length).toBe(avant);
    expect((await agir(id, { action: "statut", vers: "partie", de: "acceptee" }, personnel)).ok).toBe(true);
    const s = await sujets(id);
    expect(s).toHaveLength(avant + 1);
    expect(s.at(-1)).toMatch(/en route/);
  });

  it("retrait : « prête » envoie l'e-mail « prête »", async () => {
    const id = await acceptee("retrait");
    expect((await agir(id, { action: "statut", vers: "prete", de: "acceptee" }, personnel)).ok).toBe(true);
    expect((await sujets(id)).at(-1)).toMatch(/prête/);
  });
});

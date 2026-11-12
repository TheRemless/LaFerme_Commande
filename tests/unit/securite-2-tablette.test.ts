import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Audit de sécurité 2, S2-01 : annuler une livraison partie (remboursement entier) est réservé au gérant,
// sur la tablette comme en base. Montants d'essai, pas des prix de la carte.

const { agir } = await import("@/lib/tablette");

async function livraisonPartie(): Promise<string> {
  const db = await baseLocale();
  const n = Math.random().toString(36).slice(2, 10);
  const r = await db.query<{ id: string }>("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-s201-${n}`,
      cle_idempotence: `s201-${n}`,
      mode: "livraison",
      statut: "nouvelle",
      statut_paiement: "paye",
      moyen_paiement: "en_ligne",
      client_prenom: "Essai",
      client_nom: "S201",
      client_telephone: "079 000 00 00",
      client_email: `s201-${n}@laferme.test`,
      adresse: { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" },
      details_livraison: { etage: "", sonnette: "", code: "", instructions: "" },
      zone_numero: 1,
      quand_type: "asap",
      pizzas_seulement: false,
      sous_total_centimes: 3000,
      frais_centimes: 500,
      total_centimes: 3500,
      tva_centimes: 76,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 1500, total_centimes: 3000, choix: {}, retraits: [], note: "" }],
    },
  ]);
  const id = r.rows[0].id;
  await db.query("update commandes set statut = 'partie', heure_confirmee = now() + interval '20 minutes' where id = $1", [id]);
  return id;
}

async function membre(email: string) {
  const db = await baseLocale();
  return (await db.query<{ id: string; email: string; nom: string; role: "service" | "gerant" | "livreur" }>("select id, email, nom, role from personnel where email = $1", [email])).rows[0];
}
const statut = async (id: string) => (await (await baseLocale()).query<{ statut: string }>("select statut from commandes where id = $1", [id])).rows[0].statut;

describe("S2-01 : annuler une livraison partie", () => {
  it("un membre « service » ne peut pas : rien n'est annulé ni remboursé", async () => {
    const id = await livraisonPartie();
    const r = await agir(id, { action: "refuser", motif: "Client absent.", de: "partie" }, await membre("livraison@laferme.test"));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^Seul le gérant peut annuler une livraison partie\./);
    expect(await statut(id)).toBe("partie");
  });

  it("le gérant peut, la commande est annulée", async () => {
    const id = await livraisonPartie();
    const r = await agir(id, { action: "refuser", motif: "Adresse introuvable.", de: "partie" }, await membre("equipe@laferme.test"));
    expect(r.ok).toBe(true);
    expect(await statut(id)).toBe("refusee");
  });
});

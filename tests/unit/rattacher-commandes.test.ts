import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande, fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-compte : un client qui a commandé en invité retrouve ses commandes en se connectant.
// Le code reçu par e-mail prouve l'adresse : les commandes payées avec cette adresse et sans compte sont
// rangées dans le sien. Jamais une commande d'un autre compte, ni une commande d'un compte supprimé.
// Montants d'essai, pas des prix de la carte.

delete process.env.SMTP_UTILISATEUR;
process.env.CONTEXTE_DEPLOIEMENT = "local";

let connexion: typeof import("@/lib/comptes/connexion");
beforeAll(async () => {
  connexion = await import("@/lib/comptes/connexion");
});

async function commande(email: string, statut = "terminee") {
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "livraison",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Invitée",
    client_nom: "Fidèle",
    client_telephone: "079 000 00 00",
    client_email: email,
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 2000,
    frais_centimes: 0,
    total_centimes: 2000,
    tva_centimes: 51,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details_livraison: { etage: "", sonnette: "Fidèle", code: "", instructions: "" },
    lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 2000, total_centimes: 2000, choix: {}, retraits: [], note: "" }],
  });
  await (await baseLocale()).query("update commandes set statut = $2 where id = $1", [c.id, statut]);
  return c.id;
}

async function seConnecter(email: string): Promise<string> {
  const d = await connexion.demanderCode(email, "10.9.0.1");
  if (d.statut !== "envoye" || !d.codePreversion) throw new Error(`code non reçu : ${JSON.stringify(d)}`);
  const v = await connexion.verifierCode(email, d.codePreversion, "10.9.0.1", null, null);
  if (v.statut !== "ok") throw new Error(`connexion refusée : ${v.statut}`);
  return (await (await baseLocale()).query<{ id: string }>("select id from comptes where email = $1", [email])).rows[0].id;
}

async function compteDe(commandeId: string) {
  return (await (await baseLocale()).query<{ compte_id: string | null }>("select compte_id from commandes where id = $1", [commandeId])).rows[0].compte_id;
}

describe("commandes passées en invité, rangées à la connexion", () => {
  it("les commandes enregistrées avec cet e-mail rejoignent le compte, sans recopier téléphone ni adresse", async () => {
    const email = `fidele-${randomUUID().slice(0, 8)}@laferme.test`;
    const a = await commande(email);
    const b = await commande(email.toUpperCase(), "acceptee");
    const id = await seConnecter(email);
    expect(await compteDe(a)).toBe(id);
    expect(await compteDe(b)).toBe(id);
    const espace = await fonctionSql<{ compte: { prenom: string }; commandes: unknown[]; adresses: unknown[] }>("espace_compte", { p_compte: id });
    expect(espace.commandes).toHaveLength(2);
    // Une adresse e-mail mal tapée ne doit pas livrer le téléphone et l'adresse d'un inconnu.
    expect(espace.compte.prenom).toBe("");
    expect(espace.adresses).toHaveLength(0);
  });

  it("l'export du compte ne donne ni le téléphone ni les détails de livraison d'une commande rangée par e-mail", async () => {
    const email = `export-${randomUUID().slice(0, 8)}@laferme.test`;
    await commande(email);
    const id = await seConnecter(email);
    const e = await fonctionSql<{ commandes: Record<string, unknown>[] }>("export_compte", { p_compte: id, p_ip_court: "10.9" });
    expect(e.commandes).toHaveLength(1);
    expect(e.commandes[0]).not.toHaveProperty("client_telephone");
    expect(e.commandes[0]).not.toHaveProperty("details_livraison");
    expect(e.commandes[0]).toHaveProperty("lignes");
  });

  it("ni une commande non payée ou annulée, ni celle d'un autre e-mail, ni celle d'un autre compte", async () => {
    const email = `prudent-${randomUUID().slice(0, 8)}@laferme.test`;
    const attente = await commande(email, "paiement_en_attente");
    const annulee = await commande(email, "annulee");
    const autre = await commande(`autre-${randomUUID().slice(0, 8)}@laferme.test`);
    const ailleurs = await commande(email);
    const db = await baseLocale();
    const tiers = (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [`tiers-${randomUUID().slice(0, 8)}@laferme.test`])).rows[0].id;
    await db.query("update commandes set compte_id = $2 where id = $1", [ailleurs, tiers]);
    await seConnecter(email);
    expect(await compteDe(attente)).toBeNull();
    expect(await compteDe(annulee)).toBeNull();
    expect(await compteDe(autre)).toBeNull();
    expect(await compteDe(ailleurs)).toBe(tiers);
  });

  it("un compte supprimé ne retrouve pas ses anciennes commandes en revenant", async () => {
    const email = `parti-${randomUUID().slice(0, 8)}@laferme.test`;
    const a = await commande(email);
    const id = await seConnecter(email);
    expect(await compteDe(a)).toBe(id);
    const db = await baseLocale();
    const cleEmail = (await import("@/lib/comptes/securite")).empreinte("email", email);
    expect(await fonctionSql<boolean>("supprimer_compte", { p_compte: id, p_cle_email: cleEmail })).toBe(true);
    expect(await compteDe(a)).toBeNull();
    // Il revient : nouveau compte, ancienne commande laissée à la comptabilité, une nouvelle commande rangée.
    const b = await commande(email);
    // Un code par 30 secondes et par e-mail : la base d'essai oublie la demande précédente.
    await db.query("delete from tentatives_connexion where cle = $1", [cleEmail]);
    const nouveau = await seConnecter(email);
    expect(await compteDe(a)).toBeNull();
    expect(await compteDe(b)).toBe(nouveau);
    expect((await db.query<{ d: boolean }>("select detachee_du_compte d from commandes where id = $1", [a])).rows[0].d).toBe(true);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes, PR B côté serveur : contrôle de forme, zone revérifiée par le serveur (registre
// fédéral simulé ici), e-mail récapitulatif au client, refus en clair.
const registre = vi.hoisted(() => ({ zone: 1 as number | null, erreur: null as string | null }));
vi.mock("@/lib/zone-serveur", () => ({
  zoneServeur: async (_config: unknown, adresse: Record<string, string>) => {
    if (registre.erreur) return { erreur: registre.erreur, code: 503 };
    if (registre.zone === null) return { statut: "hors-zone", verifiee: true };
    return {
      statut: "livrable", verifiee: true,
      zone: { numero: registre.zone, nom: `Zone ${registre.zone}`, frais_centimes: 0, minimum_centimes: 0 },
      // L'adresse officielle fait foi : le serveur enregistre celle du registre, pas celle tapée.
      adresse: { rue: "Route de Chancy", numero: adresse.numero, npa: "1213", localite: "Onex", featureId: "123" },
    };
  },
}));
const { champsModification, modifierCommande } = await import("@/lib/modifier-commande");

let gerant: { id: string; email: string; nom: string; role: "gerant" };
let service: { id: string; email: string; nom: string; role: "service" };
let n = 0;

async function livraison(): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-mods-${n}`, cle_idempotence: `mods-${n}`, mode: "livraison", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: `mods${n}@laferme.test`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 3000, frais_centimes: 0, total_centimes: 3000, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000", adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details_livraison: { sonnette: "Rossi", etage: "2", code: "", instructions: "" }, zone_numero: 1,
    lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 3000, total_centimes: 3000, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("select appliquer_paiement($1, $2, 'paye', 'pi_mods', 3000)", [`evt-${id}`, id]);
  await db.query("select changer_statut($1, 'acceptee', 'tablette:Test', now() + interval '30 minutes')", [id]);
  return id;
}
async function courriels(id: string) {
  const db = await baseLocale();
  return (await db.query<{ sujet: string; texte: string }>("select sujet, texte from courriels where commande_id = $1 order by envoye_le", [id])).rows;
}

beforeAll(async () => {
  const db = await baseLocale();
  const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
  const s = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'equipe-bureau@laferme.test'")).rows[0];
  gerant = { ...g, email: "gerant-bureau@laferme.test", role: "gerant" };
  service = { ...s, email: "equipe-bureau@laferme.test", role: "service" };
});

describe("contrôle de forme", () => {
  it("ne garde que les champs demandés et refuse les valeurs douteuses", () => {
    expect(champsModification({ telephone: " 079 555 99 99 " })).toEqual({ ok: true, p: { client_telephone: "079 555 99 99" } });
    expect(champsModification({ telephone: "12" })).toMatchObject({ ok: false });
    expect(champsModification({ prenom: "" })).toMatchObject({ ok: false, erreur: "Indiquez le prénom." });
    expect(champsModification({ details: { etage: "2" } })).toMatchObject({ ok: false });
    expect(champsModification({})).toEqual({ ok: false, erreur: "Rien à modifier." });
  });
});

describe("modifier une commande acceptée", () => {
  it("corrige l'étage : la base change, le client reçoit le récapitulatif des seuls champs changés", async () => {
    const c = await livraison();
    const r = await modifierCommande(c, { details: { sonnette: "Rossi", etage: "3", code: "4521", instructions: "" } }, service, { de: "acceptee" });
    expect(r).toEqual({ ok: true, message: "Commande modifiée. Le client reçoit le nouveau récapitulatif par e-mail.", champs: ["details_livraison"] });
    const m = await courriels(c);
    expect(m.at(-1)?.sujet).toMatch(/modifiée/);
    expect(m.at(-1)?.texte).toContain("Sonnette : Rossi. Étage : 3. Code : 4521.");
    expect(m.at(-1)?.texte).not.toContain("Téléphone");
  });

  it("adresse : l'adresse du registre est enregistrée, une autre zone ou un registre muet refusent", async () => {
    const c = await livraison();
    registre.zone = 1;
    expect((await modifierCommande(c, { adresse: { rue: "route de chancy", numero: "45", npa: "1213" } }, gerant, { depuis: "gestion" })).champs).toEqual(["adresse"]);
    const db = await baseLocale();
    const a = (await db.query<{ adresse: { rue: string; featureId: string }; par: string }>(
      "select c.adresse, (select par from evenements_commande e where e.commande_id = c.id order by id desc limit 1) as par from commandes c where c.id = $1", [c])).rows[0];
    expect(a.adresse).toMatchObject({ rue: "Route de Chancy", featureId: "123" });
    expect(a.par).toBe("gestion:Gérant bureau");
    registre.zone = 2;
    expect((await modifierCommande(c, { adresse: { rue: "x", numero: "1", npa: "1227" } }, gerant)).message).toMatch(/autre zone/);
    registre.zone = null;
    expect((await modifierCommande(c, { adresse: { rue: "x", numero: "1", npa: "1000" } }, gerant)).message).toMatch(/hors de notre zone/);
    registre.zone = 1;
    registre.erreur = "Le service fédéral des adresses ne répond pas. Réessayez dans un instant.";
    expect((await modifierCommande(c, { adresse: { rue: "x", numero: "1", npa: "1213" } }, gerant)).message).toMatch(/ne répond pas/);
    registre.erreur = null;
  });

  it("refus traduits : livraison partie pour l'équipe, état changé entre-temps", async () => {
    const c = await livraison();
    const db = await baseLocale();
    await db.query("select changer_statut($1, 'partie', 'tablette:Test')", [c]);
    expect(await modifierCommande(c, { nom: "Bianchi" }, service)).toEqual({ ok: false, message: "Commande prête ou partie : seul le gérant peut la modifier." });
    expect((await modifierCommande(c, { nom: "Bianchi" }, gerant, { de: "acceptee" })).message).toMatch(/déjà changé/);
    expect((await modifierCommande(c, { nom: "Bianchi" }, gerant, { de: "partie" })).ok).toBe(true);
  });
});

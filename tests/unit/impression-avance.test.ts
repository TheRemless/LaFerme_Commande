import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Impression des commandes à l'avance côté serveur (SS-11, G08 option A) : l'acceptation n'imprime que si
// l'heure d'impression est arrivée, la surveillance imprime le reste au bon moment, une seule fois.

const { agir } = await import("@/lib/tablette");
const { executerSurveillance } = await import("@/lib/surveillance");
const personnel = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "test@laferme.test",
  nom: "Test",
  role: "service" as const,
};

let n = 0;
async function nouvelle(extra: Record<string, unknown> = {}): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-iav-${n}`,
    cle_idempotence: `iav-${n}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: "Iav",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: `iav${n}@laferme.test`,
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 3300,
    frais_centimes: 0,
    total_centimes: 3300,
    tva_centimes: 85,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      {
        slug: "pizza-margherita",
        nom: "Pizza Margherita",
        station: "pizza",
        qte: 1,
        unitaire_centimes: 1800,
        total_centimes: 1800,
        choix: {},
        retraits: [],
        note: "",
      },
      {
        slug: "lasagne-de-boeuf",
        nom: "Lasagne de bœuf",
        station: "cuisine",
        qte: 1,
        unitaire_centimes: 1500,
        total_centimes: 1500,
        choix: {},
        retraits: [],
        note: "",
      },
    ],
    ...extra,
  };
  return (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
}
const dans = (minutes: number) => new Date(Math.ceil((Date.now() + minutes * 60_000) / 300_000) * 300_000).toISOString();
async function taches(id: string) {
  const db = await baseLocale();
  return (
    await db.query<{
      station: string;
      etat: string;
      reimpression: boolean;
      contenu: {
        t: string;
        texte?: string;
        gauche?: string;
        droite?: string;
      }[];
    }>("select station::text, etat, reimpression, contenu from taches_impression where commande_id = $1 order by cree_le, station::text", [id])
  ).rows;
}
async function surveiller() {
  const db = await baseLocale();
  await db.query("update surveillance_etat set surveillance_le = null where id");
  return executerSurveillance();
}
// Le temps passe : l'heure promise se rapproche (on avance l'heure de la commande plutôt que l'horloge).
async function rapprocher(id: string, minutes: number) {
  const db = await baseLocale();
  await db.query("update commandes set heure_confirmee = $2 where id = $1", [id, dans(minutes)]);
}

beforeAll(async () => {
  const db = await baseLocale();
  await db.query(
    "insert into imprimantes (nom, station, jeton_hache, mac) values ('IAV pizza', 'pizza', 'iav-pizza', '00:11:62:00:00:21'), ('IAV cuisine', 'cuisine', 'iav-cuisine', '00:11:62:00:00:22')",
  );
});
beforeEach(async () => {
  const db = await baseLocale();
  await db.query("update reglages set valeur = '60' where cle = 'impression_avance_livraison_minutes'");
  await db.query("update reglages set valeur = '30' where cle = 'impression_avance_retrait_minutes'");
  await db.query("update reglages set valeur = 'null' where cle = 'pause_jusqu_a'");
});

describe("Acceptation d'une commande pour plus tard", () => {
  it("accepte sans imprimer et dit quand les tickets sortiront", async () => {
    const id = await nouvelle();
    const r = await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Acceptée\. Tickets prévus (le [^à]+ )?à \d\dh\d\d\.$/);
    expect(await taches(id)).toEqual([]);
    const db = await baseLocale();
    // Un seul e-mail à la commande (13.11.2026) : l'acceptation se lit au suivi, aucun e-mail ne part.
    const mails = (await db.query<{ sujet: string }>("select sujet from courriels where commande_id = $1", [id])).rows;
    expect(mails).toHaveLength(0);
  });

  it("une commande pour bientôt s'imprime tout de suite, comme avant", async () => {
    const id = await nouvelle();
    expect((await agir(id, { action: "accepter", heure: dans(20) }, personnel)).ok).toBe(true);
    expect((await taches(id)).map((t) => [t.station, t.etat])).toEqual([
      ["cuisine", "en_attente"],
      ["pizza", "en_attente"],
    ]);
    // La surveillance ne la réimprime pas.
    await surveiller();
    expect(await taches(id)).toHaveLength(2);
  });
});

describe("Délai selon le mode", () => {
  it("à la même heure, une livraison s'imprime tout de suite et un retrait attend", async () => {
    const heure = dans(45);
    const livraison = await nouvelle({ mode: "livraison", moyen_paiement: "en_ligne", statut_paiement: "paye", zone_numero: 1 });
    const retrait = await nouvelle();
    expect((await agir(livraison, { action: "accepter", heure }, personnel)).message).toBeUndefined();
    expect((await agir(retrait, { action: "accepter", heure }, personnel)).message).toMatch(/^Acceptée\. Tickets prévus /);
    expect(await taches(livraison)).toHaveLength(2);
    expect(await taches(retrait)).toEqual([]);
  });
});

describe("Surveillance", () => {
  it("imprime à l'heure prévue, avec l'heure d'acceptation réelle sur le ticket", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    const db = await baseLocale();
    await db.query("update commandes set accepte_le = now() - interval '2 days' where id = $1", [id]);
    expect((await surveiller()).imprimees).toBe(0);
    await rapprocher(id, 25);
    expect((await surveiller()).imprimees).toBe(1);
    const t = await taches(id);
    expect(t.map((x) => [x.station, x.etat, x.reimpression])).toEqual([
      ["cuisine", "en_attente", false],
      ["pizza", "en_attente", false],
    ]);
    // Pas « acceptée » à l'heure de l'impression : à l'heure où la tablette a accepté.
    const accepte = (await db.query<{ a: string }>("select to_char(accepte_le at time zone 'Europe/Zurich', 'HH24:MI') as a from commandes where id = $1", [id])).rows[0].a;
    expect(t[0].contenu.some((l) => l.droite === `acceptée ${accepte}`)).toBe(true);
  });

  it("ne double rien après un redémarrage du serveur", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    await rapprocher(id, 20);
    await surveiller();
    vi.resetModules();
    const neuf = await import("@/lib/surveillance");
    const db = await baseLocale();
    await db.query("update surveillance_etat set surveillance_le = null where id");
    await neuf.executerSurveillance();
    expect(await taches(id)).toHaveLength(2);
  });

  it("changement d'heure après acceptation : le ticket porte la nouvelle heure", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    const nouvelleHeure = dans(20);
    expect((await agir(id, { action: "heure", heure: nouvelleHeure }, personnel)).ok).toBe(true);
    await surveiller();
    const hh = new Intl.DateTimeFormat("fr-CH", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(nouvelleHeure));
    expect((await taches(id))[0].contenu.some((l) => l.droite === `POUR ${hh}`)).toBe(true);
  });

  it("annulée avant l'impression : aucun ticket, ni normal ni « ANNULÉE »", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    expect((await agir(id, { action: "refuser", motif: "Client injoignable." }, personnel)).ok).toBe(true);
    await rapprocher(id, 20);
    await surveiller();
    expect(await taches(id)).toEqual([]);
  });

  it("imprime aussi pendant une pause des commandes", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    const db = await baseLocale();
    await db.query(`update reglages set valeur = '"sans-fin"' where cle = 'pause_jusqu_a'`);
    await rapprocher(id, 20);
    await surveiller();
    expect(await taches(id)).toHaveLength(2);
  });
});

describe("Imprimer avant l'heure prévue", () => {
  it("« Imprimer maintenant » sort les premiers tickets, que la surveillance ne refait pas", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    const r = await agir(id, { action: "reimprimer" }, personnel);
    expect(r).toEqual({ ok: true, message: "Tickets envoyés à l'imprimante." });
    expect((await taches(id)).map((t) => t.reimpression)).toEqual([false, false]);
    await rapprocher(id, 20);
    await surveiller();
    expect(await taches(id)).toHaveLength(2);
  });
  it("terminée avant l'heure d'impression : « Réimprimer » sort quand même un ticket", async () => {
    const id = await nouvelle();
    await agir(id, { action: "accepter", heure: dans(180) }, personnel);
    await agir(id, { action: "statut", vers: "prete" }, personnel);
    await agir(id, { action: "statut", vers: "terminee" }, personnel);
    const r = await agir(id, { action: "reimprimer" }, personnel);
    expect(r).toEqual({ ok: true, message: "Ticket renvoyé à l'imprimante." });
    expect((await taches(id)).map((t) => t.reimpression)).toEqual([true, true]);
  });
});

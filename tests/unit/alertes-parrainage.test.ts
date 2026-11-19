import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { alerteParrainage, courrielCasParrainage } from "@/lib/alertes-parrainage";

// Alertes d'abus du parrainage (client-compte, 20261217090000) : e-mail au restaurant sans donnée de client, envoyé
// une fois par la surveillance (doublure ici : aucun e-mail ne part), alerte à l'accueil tant que rien n'est classé.

const { executerSurveillance } = await import("@/lib/surveillance");

describe("alertes d'abus du parrainage, côté serveur", () => {
  it("l'e-mail ne dit que le type de signal", () => {
    const m = courrielCasParrainage([{ id: 1, type: "meme_adresse", compte_id: "x", detail: { filleuls: 2 } }]);
    expect(m.sujet).toBe("Parrainage à surveiller : filleuls à la même adresse de livraison");
    // Plusieurs cas du même tour : un seul e-mail.
    const deux = courrielCasParrainage([
      { id: 1, type: "meme_adresse", compte_id: "x", detail: {} },
      { id: 2, type: "meme_nom", compte_id: "x", detail: {} },
    ]);
    expect(deux.sujet).toBe("Parrainage à surveiller : 2 signaux");
    expect(deux.lignes.slice(0, 2)).toEqual(["Filleuls à la même adresse de livraison.", "Filleuls au même nom."]);
  });

  it("accueil : rien sans signal ouvert, un geste vers la rubrique sinon", () => {
    expect(alerteParrainage(0)).toBeNull();
    expect(alerteParrainage(2)).toMatchObject({ titre: "2 signaux de parrainage à examiner", geste: { href: "/gestion/parrainages" } });
  });

  it("la surveillance envoie chaque cas une fois puis le note envoyé", async () => {
    const db = await baseLocale();
    const parrain = (await db.query<{ id: string }>("insert into comptes (email, prenom) values ('surv-parrain@exemple.ch', 'Léa') returning id")).rows[0].id;
    const filleul = (await db.query<{ id: string }>("insert into comptes (email, prenom) values ('surv-filleul@exemple.ch', 'Noé') returning id")).rows[0].id;
    // Un cas posé directement : « reçu plus que payé » pour le filleul.
    await db.query("insert into parrainages (parrain_id, filleul_id, statut) values ($1, $2, 'credite')", [parrain, filleul]);
    await db.query("insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif) values ($1, 'parrainage_filleul', 1000, 'Bienvenue par parrainage')", [filleul]);
    await db.query("update surveillance_etat set surveillance_le = null where id");
    expect((await executerSurveillance()).fait).toBe(true);
    const copies = (await db.query<{ sujet: string; texte: string }>("select sujet, texte from courriels where sujet like 'Parrainage à surveiller%'")).rows;
    expect(copies.map((c) => c.sujet)).toContain("Parrainage à surveiller : plus reçu en parrainage que payé sur 30 jours");
    expect(copies.map((c) => c.texte).join("\n")).not.toContain("surv-filleul@exemple.ch");
    const ouverts = (await db.query<{ envoye_le: string | null }>("select envoye_le from alertes_parrainage where compte_id = $1", [filleul])).rows;
    expect(ouverts).toHaveLength(1);
    expect(ouverts[0].envoye_le).not.toBeNull();
    // Un second tour ne renvoie rien.
    await db.query("update surveillance_etat set surveillance_le = null where id");
    await executerSurveillance();
    expect((await db.query("select 1 from courriels where sujet = 'Parrainage à surveiller : plus reçu en parrainage que payé sur 30 jours'")).rows).toHaveLength(1);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { pageLegalePubliable, pagesLegalesValidees } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";
import { CONFIDENTIALITE } from "@/lib/legal/confidentialite";
import { MENTIONS } from "@/lib/legal/mentions";
import { aCompleter } from "@/lib/legal/types";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("ébauches légales", () => {
  it("restent fermées en production tant qu'elles ne sont pas validées", () => {
    const complete = { titre: "T", misAJour: "", sections: [{ titre: "S", contenu: ["Tout est rempli."] }] };
    process.env.CONTEXTE_DEPLOIEMENT = "production";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pageLegalePubliable(complete)).toBe(false);
    process.env.PAGES_LEGALES_VALIDEES = "1";
    expect(pagesLegalesValidees()).toBe(true);
    expect(pageLegalePubliable(complete)).toBe(true);
    // Validée mais encore trouée : toujours fermée.
    expect(pageLegalePubliable(MENTIONS)).toBe(false);
    process.env.CONTEXTE_DEPLOIEMENT = "deploy-preview";
    delete process.env.PAGES_LEGALES_VALIDEES;
    expect(pageLegalePubliable(MENTIONS)).toBe(true);
  });

  it("signalent ce qui reste à fournir et n'inventent pas de faits interdits", () => {
    for (const p of [MENTIONS, CGV, CONFIDENTIALITE]) {
      expect(aCompleter(p)).toBeGreaterThan(0);
      const texte = JSON.stringify(p).toLowerCase();
      for (const interdit of ["fait maison", "napolitain", "450", "chêne", "banquet", "tram", "apple pay", "google pay"]) {
        expect(texte).not.toContain(interdit);
      }
    }
    // Identité du vendeur (LCD art. 3 al. 1 let. s) : fournie par Jérémy le 13.11.2026 (extrait du registre du
    // commerce, registre IDE fédéral pour la TVA). La même raison sociale dans les trois pages.
    for (const p of [MENTIONS, CGV, CONFIDENTIALITE]) {
      expect(JSON.stringify(p)).toContain("Restaurant La Ferme Sàrl");
      expect(JSON.stringify(p).toLowerCase()).not.toContain("[raison sociale");
    }
    expect(JSON.stringify(MENTIONS)).toContain("société à responsabilité limitée");
    expect(JSON.stringify(MENTIONS)).toContain("Numéro IDE CHE-103.250.692. Numéro TVA CHE-103.250.692 TVA.");
    // L'e-mail reste demandé, pas deviné.
    expect(JSON.stringify(MENTIONS)).toContain("[adresse e-mail du restaurant]");
  });

  it("CGV, paiement : au comptoir pour l'emporter, à la livraison ou au retrait pour une commande par téléphone", () => {
    // Commande prise au téléphone (#248), payée à la livraison ou au retrait ; les livreurs auront un terminal de
    // carte (Jérémy, 14.11.2026). L'ancienne phrase « pas de paiement à la livraison » ne doit pas revenir.
    const paiement = CGV.sections.find((s) => s.titre === "Paiement");
    const texte = JSON.stringify(paiement?.contenu);
    expect(texte).toContain("Au comptoir, pour une commande à emporter.");
    expect(texte).toContain("Pour une commande passée par téléphone, à la livraison ou au retrait, en espèces ou par carte.");
    expect(JSON.stringify(CGV).toLowerCase()).not.toContain("paiement à la livraison n'est pas proposé");
  });

  it("CGV, commande : la phrase en ligne inchangée, la commande par téléphone et l'heure au suivi", () => {
    const commande = JSON.stringify(CGV.sections.find((s) => s.titre === "Commande et acceptation")?.contenu);
    expect(commande).toContain(
      "La commande est enregistrée quand le paiement en ligne est confirmé, ou à son envoi pour un paiement au comptoir. Vous recevez aussitôt un e-mail de confirmation.",
    );
    expect(commande).toContain("Une commande passée par téléphone est enregistrée par l'équipe pendant l'appel.");
    expect(commande).toContain("Si vous donnez votre adresse e-mail, vous recevez le récapitulatif et le lien de suivi.");
    // Un seul e-mail à la commande (#221) : l'acceptation n'envoie plus d'e-mail, l'heure se lit au suivi.
    expect(commande).not.toContain("Il vous envoie alors un e-mail avec l'heure");
    expect(commande).toContain("L'heure de livraison ou de retrait s'affiche alors sur la page de suivi.");
  });

  it("CGV, cagnotte : les règles validées par Jérémy le 15.11.2026", () => {
    const texte = JSON.stringify(CGV.sections.find((s) => s.titre === "Cagnotte")?.contenu);
    for (const regle of [
      "chaque commande livrée ou retirée vous rapporte 5 % du prix des plats",
      "Les frais de livraison ne comptent pas.",
      "arrondie au centime inférieur",
      "Une commande refusée, annulée ou remboursée ne rapporte rien.",
      "Un remboursement partiel retire la part correspondante",
      "Dès CHF 10",
      "Elle ne sert ni au comptoir ni pour une commande passée par téléphone.",
      "Elle expire 12 mois après votre dernière commande. Un e-mail vous prévient 30 jours avant",
      "vous recevez chacun CHF 10 dans votre cagnotte",
      "Le lien vaut une fois que vous avez vous-même passé une commande livrée ou retirée",
      "Le crédit est repris si cette commande est remboursée en entier.",
      "Un proche n'a qu'un seul parrain. Un compte parraine au plus 10 proches par mois.",
    ]) {
      expect(texte).toContain(regle);
    }
  });
});

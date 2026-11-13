import { describe, expect, it } from "vitest";
import { alerteAdresseAlertes } from "@/lib/adresse-alertes";

// « Aucune adresse ne reçoit les alertes » : tant que destinataireAlertes() (adresse saisie, sinon la variable
// d'installation ALERTE_EMAIL) ne donne rien. Même règle que la Mise en route de bo-socle.

describe("alerteAdresseAlertes", () => {
  it("aucun destinataire : l'alerte, clé stable et lien vers les réglages", () => {
    expect(alerteAdresseAlertes(undefined)).toMatchObject({ cle: "adresse-alertes", niveau: "attention", geste: { href: "/gestion/reglages" } });
    expect(alerteAdresseAlertes("  ")).not.toBeNull();
  });
  it("une adresse (saisie ou variable d'installation) : rien", () => {
    expect(alerteAdresseAlertes("resto@exemple.test")).toBeNull();
  });
});

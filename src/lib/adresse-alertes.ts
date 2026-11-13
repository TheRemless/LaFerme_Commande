import "server-only";
import type { Alerte } from "@/lib/accueil-gestion";
import { destinataireAlertes } from "@/lib/reglages-generaux";

// « Aucune adresse ne reçoit les alertes » (vague 3, bo-operations ; mise en situation M10 de produit-gestion).
// L'e-mail des alertes est vide au départ dans Réglages généraux ; sans la variable d'installation ALERTE_EMAIL,
// les alertes (commande pas acceptée, tablette injoignable, client absent, remboursement raté) ne partent nulle
// part. L'accueil du back-office le dit tant que c'est le cas. Même règle que l'étape de la Mise en route de
// bo-socle (destinataireAlertes : adresse saisie, sinon ALERTE_EMAIL) : les deux se taisent au même moment.

export function alerteAdresseAlertes(destinataire: string | null | undefined): Alerte | null {
  if ((destinataire ?? "").trim()) return null;
  return {
    cle: "adresse-alertes",
    niveau: "attention",
    titre: "Aucune adresse ne reçoit les alertes",
    detail: "Une commande pas acceptée, une tablette injoignable ou un remboursement raté ne vous préviennent pas par e-mail. Saisissez l'adresse dans Réglages généraux.",
    geste: { href: "/gestion/reglages", texte: "Ouvrir les réglages" },
  };
}

export async function chargerAlerteAdresseAlertes(): Promise<Alerte | null> {
  return alerteAdresseAlertes(await destinataireAlertes());
}

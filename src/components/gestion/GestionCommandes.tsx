"use client";

import { ListeCommandes } from "@/components/gestion/commandes/ListeCommandes";
import "@/components/gestion/commandes/commandes.css";

// Rubrique Commandes du back-office (vague 3, bo-commandes) : liste paginée côté serveur, fiche en panneau.
// L'ancien écran (sept derniers jours, recherche, fiche dépliée) est remplacé ; les chiffres par jour sont
// dans les rubriques de bo-pilotage.
export function GestionCommandes() {
  return <ListeCommandes />;
}

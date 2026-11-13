"use client";

import { createContext, useContext } from "react";
import { aLeDroit, type ActionDroit } from "@/lib/personnel/droits";

// Rôle de la personne connectée au back-office, fourni par la coque (BackOffice). Sert seulement à cacher les
// gestes qu'elle n'a pas : chaque route revérifie (exigerDroit) et chaque fonction SQL aussi (auteur_droit).
// const peutRembourser = useDroit("rembourser");

export type RoleGestion = "gerant" | "responsable";

const Ctx = createContext<RoleGestion>("gerant");

export const FournisseurRole = Ctx.Provider;

export const useRoleGestion = (): RoleGestion => useContext(Ctx);

/** Vrai pour le gérant, et pour le responsable sur les actions du tableau D1. */
export function useDroit(action: ActionDroit): boolean {
  return aLeDroit(useContext(Ctx), action);
}

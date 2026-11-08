import { poster } from "@/lib/requete-client";

// Envoie une modification du back-office ; renvoie le message d'erreur, ou null si c'est enregistré.
export async function enregistrer(url: string, corps: unknown): Promise<string | null> {
  const r = await poster(url, corps);
  return r.ok ? null : String(r.donnees.erreur ?? "Pas enregistré. Réessayez.");
}

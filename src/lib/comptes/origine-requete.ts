import "server-only";
import { origineSure } from "@/lib/origine";

// Protection contre les requêtes forgées depuis un autre site (CSRF) sur les routes qui changent un état.
// Le cookie de session est déjà SameSite=Lax ; en plus, l'en-tête Origin doit être celui du site.
// Un navigateur l'envoie toujours sur un POST ; sans lui, on exige Sec-Fetch-Site: same-origin.
export function requeteDuSite(requete: Request): boolean {
  const attendue = origineSure(requete);
  if (!attendue) return false;
  const origine = requete.headers.get("origin");
  if (origine) return origine === attendue;
  return requete.headers.get("sec-fetch-site") === "same-origin";
}

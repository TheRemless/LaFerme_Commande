import "server-only";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { verifierContexte } from "@/lib/environnement";

// Empreintes des secrets de connexion : codes, jetons de session, e-mails et adresses IP des limites.
// HMAC-SHA-256 : une copie de la base ne suffit pas pour retrouver un code ou une IP.
// En production, la clé est SECRET_COMPTES, et seulement elle : tirée de la clé Supabase, que les
// préversions ont aussi, une session ouverte sur une préversion vaudrait en production (audit, S6).
// Ailleurs, SECRET_COMPTES ou à défaut la clé Supabase ; sans aucune (poste local, tests), une clé fixe.

export function cleHmac(): string {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") {
    if (!process.env.SECRET_COMPTES) throw new Error("SECRET_COMPTES manquante en production.");
    return `laferme-comptes:${process.env.SECRET_COMPTES}`;
  }
  const source = process.env.SECRET_COMPTES ?? process.env.SUPABASE_SECRET_KEY;
  return source ? `laferme-comptes:${source}` : "laferme-comptes:developpement-local";
}

export function empreinte(
  usage: "code" | "session" | "email" | "ip" | "email-personnel" | "session-personnel" | "imprimante" | "surveillance",
  valeur: string,
): string {
  return createHmac("sha256", cleHmac()).update(`${usage}:${valeur}`).digest("hex");
}

// 6 chiffres pour les clients, 8 pour le personnel (audit de sécurité, S4).
export function nouveauCode(chiffres: 6 | 8 = 6): string {
  return String(randomInt(0, 10 ** chiffres)).padStart(chiffres, "0");
}

export function nouveauJeton(): string {
  return randomBytes(32).toString("base64url");
}

export { emailNormalise } from "@/lib/validation";

export function codeValide(v: unknown, chiffres: 6 | 8 = 6): string | null {
  if (typeof v !== "string") return null;
  const c = v.replace(/\s/g, "");
  return c.length === chiffres && /^\d+$/.test(c) ? c : null;
}

// Adresse IP du client. Netlify la donne dans x-nf-client-connection-ip, que le client ne peut pas imposer.
// Ailleurs (poste local), la première de x-forwarded-for, sinon « local ».
export function ipDe(requete: Request): string {
  verifierContexte();
  const netlify = requete.headers.get("x-nf-client-connection-ip");
  if (netlify) return reseauIp(netlify.trim());
  const transmis = (requete.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // Poste local : la première valeur (les tests s'en servent pour simuler plusieurs clients).
  if (process.env.CONTEXTE_DEPLOIEMENT === "local") return transmis[0] || "local";
  // Ailleurs, la dernière : celle ajoutée par le proxy, que le client ne choisit pas. Jamais une valeur
  // commune à tous, qui rendrait les limites par IP globales au site.
  return transmis.at(-1) || "inconnue";
}

// Une adresse IPv6 compte pour son /64 : un seul abonnement en a des milliards, qui contourneraient
// les limites par IP (audit, S4). IPv4 inchangée.
export function reseauIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  // IPv4 écrite en IPv6 (::ffff:203.0.113.7) : c'est une IPv4.
  const v4 = ip.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  const [gauche, droite = ""] = ip.toLowerCase().split("::");
  const g = gauche ? gauche.split(":") : [];
  const d = droite ? droite.split(":") : [];
  const complet = ip.includes("::") ? [...g, ...Array(Math.max(0, 8 - g.length - d.length)).fill("0"), ...d] : g;
  return `${complet.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Ce que le journal garde de l'IP : huit caractères de son empreinte, assez pour voir une rafale.
export function ipCourt(ip: string): string {
  return empreinte("ip", ip).slice(0, 8);
}

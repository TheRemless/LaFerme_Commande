import "server-only";
import { empreinte, ipDe, nouveauCode, nouveauJeton } from "@/lib/comptes/securite";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { alerter } from "@/lib/surveillance";

// Connexion d'un livreur par un code affiché sur la tablette (vague 3, D13 point 3) : construit désactivé
// (réglage connexion_livreur_par_code). Base : 20261203150000_code_livreur.sql. Le code (8 chiffres, 10 minutes,
// une seule fois) n'est gardé qu'en empreinte HMAC ; la session ouverte est une session de livreur de 12 heures.

const hache = (code: string) => empreinte("code", `livreur:${code}`);

// Gérant, ou responsable dont le rôle est ouvert : droit « deconnecter_appareil » (tableau D1), relu en base.
export async function peutCreerCode(p: Personnel): Promise<boolean> {
  if (p.role === "gerant") return true;
  if (p.role !== "responsable") return false;
  return fonctionSql<boolean>("droit_personnel", { p_personnel: p.id, p_action: "deconnecter_appareil" }).catch(() => false);
}

export async function connexionParCodeActive(): Promise<boolean> {
  const reglages = await lirePublic<{ cle: string; valeur: unknown }>("reglages").catch(() => []);
  return reglages.find((r) => r.cle === "connexion_livreur_par_code")?.valeur === true;
}

const ERREURS: [RegExp, string][] = [
  [/connexion_par_code_desactivee/, "La connexion par code n'est pas ouverte."],
  [/reserve_gerant/, "Réservé au gérant ou au responsable de service."],
  [/livreur_inconnu/, "Ce livreur ne fait plus partie de l'équipe."],
];

export async function creerCodeLivreur(livreurId: string, p: Personnel): Promise<{ ok: true; code: string; expire_le: string } | { ok: false; erreur: string }> {
  if (!/^[0-9a-f-]{36}$/.test(livreurId)) return { ok: false, erreur: "Ce livreur ne fait plus partie de l'équipe." };
  const code = nouveauCode(8);
  try {
    const expire = await fonctionSql<string>("creer_code_livreur", { p_livreur: livreurId, p_code_hache: hache(code), p_personnel: p.id });
    return { ok: true, code, expire_le: new Date(expire).toISOString() };
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    const connu = ERREURS.find(([m]) => m.test(texte));
    if (connu) return { ok: false, erreur: connu[1] };
    throw e;
  }
}

export async function utiliserCodeLivreur(
  code: string,
  requete: Request,
): Promise<{ statut: "ok"; jeton: string } | { statut: "invalide" | "desactive" } | { statut: "attente"; attente: number }> {
  const jeton = nouveauJeton();
  const r = await fonctionSql<{ statut: string; attente?: number; alerte?: boolean }>("utiliser_code_livreur", {
    p_code_hache: hache(code),
    p_cle_ip: empreinte("ip", ipDe(requete)),
    p_session_hache: empreinte("session-personnel", jeton),
  });
  // 100 codes faux en 10 minutes, toutes connexions confondues : on prévient le restaurant (une fois, au 100e).
  if (r.alerte) {
    await alerter("Codes de livreur : trop d'essais faux", [
      "Plus de 100 codes de connexion de livreur faux en 10 minutes, depuis plusieurs connexions.",
      "La connexion par code est bloquée 10 minutes. Les livreurs peuvent demander un code par e-mail.",
    ]).catch((e) => console.error(`Alerte des codes de livreur non envoyée : ${e instanceof Error ? e.message : e}`));
  }
  if (r.statut === "ok") return { statut: "ok", jeton };
  if (r.statut === "attente") return { statut: "attente", attente: r.attente ?? 60 };
  return { statut: r.statut === "desactive" ? "desactive" : "invalide" };
}

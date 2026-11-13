import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { emailNormalise, empreinte } from "@/lib/comptes/securite";
import { exigerGerant, jetonPersonnel } from "@/lib/personnel/session";

// L'équipe (audit du gérant, G03) : liste, ajout, rôle, retrait, sessions coupées. Gérant seulement ;
// chaque fonction SQL le vérifie encore et journalise.

const ERREURS: Record<string, string> = {
  adresse_invalide: "Adresse e-mail invalide.",
  nom_invalide: "Indiquez un prénom ou un nom (60 caractères au plus).",
  role_invalide: "Rôle inconnu.",
  role_desactive: "Le rôle « Responsable de service » n'est pas encore activé.",
  deja_membre: "Cette adresse fait déjà partie de l'équipe.",
  dernier_gerant: "Il faut toujours au moins un gérant. Nommez-en un autre d'abord.",
  "Réservé au gérant": "Réservé au gérant.",
};

function erreurConnue(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e);
  const cle = Object.keys(ERREURS).find((k) => m.includes(k));
  return cle ? ERREURS[cle] : null;
}

const UUID = /^[0-9a-f-]{36}$/;
const ROLE = (v: unknown) => (v === "service" || v === "gerant" || v === "livreur" || v === "responsable" ? v : null);

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [liste, responsable] = await Promise.all([
    fonctionSql("liste_personnel", { p_personnel: g.personnel.id }),
    // Base pas encore migrée : la fonction manque, le rôle reste caché.
    fonctionSql<boolean>("role_responsable_actif", {}).catch(() => false),
  ]);
  return NextResponse.json({ moi: g.personnel.id, liste, responsable_actif: responsable }, { headers: { "Cache-Control": "no-store" } });
}

// { action: "ajouter", email, nom, role } | { action: "modifier", id, nom?, role?, actif? } | { action: "couper", id }
// | { action: "appareils", id } | { action: "couper_appareil", session }
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const qui = g.personnel.id;
  try {
    if (c.action === "ajouter") {
      const role = ROLE(c.role);
      if (typeof c.email !== "string" || c.email.length > 120 || typeof c.nom !== "string" || c.nom.length > 60 || !role) return refus("Remplissez l'e-mail, le nom et le rôle.");
      // Même normalisation qu'à la connexion : une espace insécable collée ne crée pas un membre injoignable.
      const email = emailNormalise(c.email);
      if (!email) return refus(ERREURS.adresse_invalide);
      await fonctionSql("ajouter_personnel", { p_email: email, p_nom: c.nom, p_role: role, p_personnel: qui });
      return NextResponse.json({ enregistre: true, message: "Ajouté. Il se connecte avec son e-mail et le code reçu." });
    }
    // Un appareil se désigne par sa session, pas par le membre.
    if (c.action === "couper_appareil") {
      if (typeof c.session !== "string" || !UUID.test(c.session)) return refus("Appareil inconnu.", 404);
      const ok = await fonctionSql<boolean>("couper_appareil_personnel", { p_session: c.session, p_personnel: qui });
      return ok ? NextResponse.json({ enregistre: true, message: "Appareil déconnecté." }) : refus("Cet appareil est déjà déconnecté.", 404);
    }
    if (typeof c.id !== "string" || !UUID.test(c.id)) return refus("Membre inconnu.", 404);
    if (c.action === "modifier") {
      const p: Record<string, unknown> = {};
      if (c.nom !== undefined) {
        if (typeof c.nom !== "string" || c.nom.length > 60) return refus("Nom invalide.");
        p.nom = c.nom;
      }
      if (c.role !== undefined) {
        if (!ROLE(c.role)) return refus("Rôle inconnu.");
        p.role = c.role;
      }
      if (c.actif !== undefined) {
        if (typeof c.actif !== "boolean") return refus("Valeur invalide.");
        p.actif = c.actif;
      }
      if (Object.keys(p).length === 0) return refus("Rien à changer.");
      const ok = await fonctionSql<boolean>("modifier_personnel", { p_id: c.id, p, p_personnel: qui });
      if (!ok) return refus("Membre inconnu.", 404);
      return NextResponse.json({ enregistre: true, message: p.actif === false ? "Retiré. Ses sessions sont coupées." : "Enregistré." });
    }
    if (c.action === "appareils") {
      const jeton = await jetonPersonnel();
      const appareils = await fonctionSql("appareils_personnel", { p_membre: c.id, p_personnel: qui, p_session_hache: jeton ? empreinte("session-personnel", jeton) : "" });
      return NextResponse.json({ appareils }, { headers: { "Cache-Control": "no-store" } });
    }
    if (c.action === "couper") {
      const n = await fonctionSql<number>("couper_sessions_personnel", { p_id: c.id, p_personnel: qui });
      return NextResponse.json({ enregistre: true, message: n ? `${n} session${n > 1 ? "s" : ""} coupée${n > 1 ? "s" : ""}.` : "Aucune session ouverte." });
    }
  } catch (e) {
    const m = erreurConnue(e);
    if (m) return refus(m);
    throw e;
  }
  return refus("Action inconnue.");
}

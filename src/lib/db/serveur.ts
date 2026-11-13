import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { baseLocale } from "@/lib/db/locale";
import { verifierContexte } from "@/lib/environnement";

// Accès en écriture réservé au serveur : commandes, paiements, courriels.
// Supabase avec la clé secrète quand elle est là, sinon la base embarquée (développement, tests).
// Toute la logique vit dans les fonctions SQL de supabase/migrations/20261107090000_commandes.sql.

let client: SupabaseClient | null = null;

function supabaseServeur(): SupabaseClient | null {
  verifierContexte();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SECRET_KEY;
  if (url && cle) {
    client ??= createClient(url, cle, { auth: { persistSession: false } });
    return client;
  }
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") {
    throw new Error("SUPABASE_SECRET_KEY manquante : impossible d'enregistrer une commande en production.");
  }
  if (process.env.CONTEXTE_DEPLOIEMENT === "local" && process.env.NODE_ENV === "production" && !process.env.BASE_LOCALE) {
    throw new Error("Base embarquée refusée pour un build de production local sans BASE_LOCALE.");
  }
  if (url && process.env.CONTEXTE_DEPLOIEMENT !== "local") {
    // Preview qui lit la carte dans Supabase mais n'a pas de clé d'écriture : on le dit clairement.
    throw new ConfigurationManquante();
  }
  return null;
}

export class ConfigurationManquante extends Error {
  constructor() {
    super("Les commandes de test ne sont pas encore branchées sur cette préversion (clé Supabase de test manquante).");
  }
}

export function ecritureDisponible(): boolean {
  try {
    supabaseServeur();
    return true;
  } catch {
    return false;
  }
}

async function rpc<T>(nom: string, args: Record<string, unknown>, sqlLocal: string, valeurs: unknown[]): Promise<T> {
  const s = supabaseServeur();
  if (s) {
    const { data, error } = await s.rpc(nom, args);
    if (error) throw new Error(`${nom} : ${error.message}`);
    return data as T;
  }
  const db = await baseLocale();
  const res = await db.query<Record<string, unknown>>(sqlLocal, valeurs);
  return res.rows as T;
}

// Heures du dernier tour de surveillance et du dernier signe de vie de la tablette (route de santé).
export async function lireEtatSurveillance(): Promise<{ surveillance_le: string | null; tablette_vue_le: string | null }> {
  const s = supabaseServeur();
  if (s) {
    const { data, error } = await s.from("surveillance_etat").select("surveillance_le, tablette_vue_le").limit(1).single();
    if (error) throw new Error(`surveillance_etat : ${error.message}`);
    return data;
  }
  const db = await baseLocale();
  const res = await db.query<{ surveillance_le: Date | null; tablette_vue_le: Date | null }>("select surveillance_le, tablette_vue_le from surveillance_etat limit 1");
  const r = res.rows[0];
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return { surveillance_le: iso(r?.surveillance_le), tablette_vue_le: iso(r?.tablette_vue_le) };
}

// Appelle une fonction SQL qui renvoie une seule valeur (jsonb, entier, booléen ou rien).
// Les arguments sont passés par leur nom, dans les deux bases.
export async function fonctionSql<T>(nom: string, args: Record<string, unknown>): Promise<T> {
  const cles = Object.keys(args);
  if (!/^[a-z_]+$/.test(nom) || cles.some((k) => !/^p(_[a-z_]+)?$/.test(k))) throw new Error(`Appel SQL refusé : ${nom}`);
  const s = supabaseServeur();
  if (s) {
    const { data, error } = await s.rpc(nom, args);
    if (error) throw new Error(`${nom} : ${error.message}`);
    return data as T;
  }
  const db = await baseLocale();
  const sql = `select ${nom}(${cles.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  const res = await db.query<{ r: T }>(sql, cles.map((k) => args[k]));
  return res.rows[0]?.r as T;
}

export type CommandeCreee = { id: string; numero: number; jeton_suivi: string; deja: boolean };

export async function creerCommande(p: Record<string, unknown>): Promise<CommandeCreee> {
  const lignes = await rpc<CommandeCreee[]>("creer_commande", { p }, "select * from creer_commande($1)", [p]);
  return lignes[0];
}

export async function lierSessionPaiement(commande: string, session: string): Promise<void> {
  await rpc("lier_session_paiement", { p_commande: commande, p_session: session }, "select lier_session_paiement($1, $2)", [commande, session]);
}

export type TypePaiement = "paye" | "echec" | "rembourse";

// Vrai seulement la première fois qu'un événement change la commande (sert à n'envoyer qu'un courriel).
export async function appliquerPaiement(
  evenement: string,
  commande: string,
  type: TypePaiement,
  paymentIntent?: string,
  montantCentimes?: number,
): Promise<boolean> {
  const r = await rpc<unknown>(
    "appliquer_paiement",
    { p_evenement: evenement, p_commande: commande, p_type: type, p_payment_intent: paymentIntent ?? null, p_montant: montantCentimes ?? null },
    "select appliquer_paiement($1, $2, $3, $4, $5) as r",
    [evenement, commande, type, paymentIntent ?? null, montantCentimes ?? null],
  );
  return Array.isArray(r) ? Boolean((r[0] as { r: boolean }).r) : Boolean(r);
}

export type LigneCommande = {
  position: number;
  plat_slug: string;
  nom: string;
  station: "pizza" | "cuisine";
  qte: number;
  unitaire_centimes: number;
  total_centimes: number;
  choix: Record<string, string[]>;
  retraits: string[];
  note: string;
};

export type Commande = {
  id: string;
  numero: number;
  jour: string;
  jeton_suivi: string;
  mode: "livraison" | "retrait";
  statut: string;
  statut_paiement: string;
  moyen_paiement: "en_ligne" | "comptoir";
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  client_email: string;
  adresse: { rue: string; numero: string; npa: string; localite: string; featureId?: string } | null;
  details_livraison: { etage: string; sonnette: string; code: string; instructions: string } | null;
  quand_type: "asap" | "creneau";
  quand_date: string | null;
  quand_minutes: number | null;
  heure_confirmee: string | null;
  accepte_le?: string | null;
  paye_le?: string | null;
  // Premiers tickets créés (null : pas encore imprimée, commande à l'avance). Absent avant la migration.
  tickets_le?: string | null;
  zone_numero: number | null;
  pizzas_seulement: boolean;
  avertissement: string | null;
  sous_total_centimes: number;
  frais_centimes: number;
  total_centimes: number;
  tva_centimes: number;
  taux_tva_pourcent: number;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  motif: string | null;
  compte_id: string | null;
  compte_demande: boolean;
  // Détachée par la suppression de son compte : jamais rangée de nouveau. Absent avant la migration 20261202110000.
  detachee_du_compte?: boolean;
  // Annulée par le client depuis le suivi (bo-commandes, #70). Absent avant sa migration.
  annulee_par_client_le?: string | null;
  // Allergie ou intolérance pour toute la commande (client-commande, #71). Absente avant sa migration.
  allergie?: string;
  origine: string;
  cree_le: string;
  lignes: LigneCommande[];
};

async function lireCommande(fonction: "commande_par_jeton" | "commande_par_id", cle: string, arg: string): Promise<Commande | null> {
  const r = await rpc<unknown>(fonction, { [arg]: cle }, `select ${fonction}($1) as c`, [cle]);
  const brut = Array.isArray(r) ? (r[0] as { c: Commande | null })?.c : (r as Commande | null);
  return brut ?? null;
}

export const commandeParJeton = (jeton: string) => lireCommande("commande_par_jeton", jeton, "p_jeton");
export const commandeParId = (id: string) => lireCommande("commande_par_id", id, "p_id");

export async function enregistrerCourriel(p: Record<string, unknown>): Promise<void> {
  await rpc("enregistrer_courriel", { p }, "select enregistrer_courriel($1)", [p]);
}

// Courriels d'une commande réellement partis depuis moins de 24 heures (pas ceux de la doublure), le plus
// récent d'abord : registre qui évite d'envoyer deux fois de suite le même. Filtre sur la commande seule : ni adresse ni texte dans l'URL de l'appel.
export async function courrielsPartis(commandeId: string): Promise<{ destinataire: string; sujet: string; texte: string }[]> {
  const s = supabaseServeur();
  if (s) {
    const { data, error } = await s
      .from("courriels")
      .select("destinataire, sujet, texte")
      .eq("commande_id", commandeId)
      .neq("fournisseur", "doublure")
      .gte("envoye_le", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("envoye_le", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }
  const db = await baseLocale();
  return (await db.query<{ destinataire: string; sujet: string; texte: string }>(
    // La base embarquée horodate à la milliseconde : deux courriels enregistrés dans la même milliseconde se
    // départagent par leur ordre d'écriture (ctid), sinon « le dernier parti » est tiré au sort.
    "select destinataire, sujet, texte from courriels where commande_id = $1 and fournisseur <> 'doublure' and envoye_le > now() - interval '24 hours' order by envoye_le desc, ctid desc",
    [commandeId],
  )).rows;
}

// Préversion seulement : les courriels d'une commande, pour les montrer à celui qui a le lien de suivi.
export async function courrielsDeCommande(commandeId: string): Promise<{ destinataire: string; sujet: string; texte: string; envoye_le: string; fournisseur: string }[]> {
  const s = supabaseServeur();
  if (s) {
    const { data, error } = await s
      .from("courriels")
      .select("destinataire, sujet, texte, envoye_le, fournisseur")
      .eq("commande_id", commandeId)
      .order("envoye_le", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }
  const db = await baseLocale();
  return (await db.query<{ destinataire: string; sujet: string; texte: string; envoye_le: string; fournisseur: string }>(
    "select destinataire, sujet, texte, envoye_le::text, fournisseur from courriels where commande_id = $1 order by envoye_le desc",
    [commandeId],
  )).rows;
}

import type { CommandeTablette } from "@/lib/tablette";

// Aides de la tablette en plein service (vague 3) : retrouver une commande au comptoir, voir celles en retard.

const sansAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const chiffres = (s: string) => s.replace(/\D/g, "");

// « 27 » : le numéro exact. « 079 123 », « 0791234567 » (5 chiffres ou plus) : la fin ou le début du téléphone.
// « mar », « Martin », « léa audit » : chaque mot dans le prénom ou le nom, sans accents.
// Les commandes encore à faire passent devant, puis les plus récentes.
export function chercherCommandes(commandes: CommandeTablette[], requete: string): CommandeTablette[] {
  const q = sansAccents(requete);
  if (!q) return [];
  const mots = q.split(/\s+/);
  const tel = chiffres(q);
  const trouvees = /^[\d\s+]+$/.test(q) && tel.length >= 5
    ? commandes.filter((c) => {
        const t = chiffres(c.client_telephone);
        return t.includes(tel) || chiffres(t.replace(/^41/, "0")).includes(tel);
      })
    : /^\d+$/.test(q)
    ? commandes.filter((c) => String(c.numero) === q)
    : commandes.filter((c) => {
        const nom = sansAccents(`${c.client_prenom} ${c.client_nom}`);
        return mots.every((m) => nom.includes(m));
      });
  const finie = (c: CommandeTablette) => (c.statut === "terminee" || c.statut === "refusee" ? 1 : 0);
  return [...trouvees].sort((a, b) => finie(a) - finie(b) || b.cree_le.localeCompare(a.cree_le));
}

// Encore en cuisine : c'est là qu'un retard se rattrape. Prête ou partie, la cuisine a fini.
const EN_CUISINE = new Set(["acceptee", "en_preparation"]);

// Minutes entières passées depuis l'heure promise au client, null si elle n'est pas dépassée ou plus en cuisine.
export function minutesDeRetard(c: Pick<CommandeTablette, "statut" | "heure_confirmee">, maintenant: string): number | null {
  if (!c.heure_confirmee || !EN_CUISINE.has(c.statut)) return null;
  const ecart = Math.floor((new Date(maintenant).getTime() - new Date(c.heure_confirmee).getTime()) / 60_000);
  return ecart >= 1 ? ecart : null;
}

// Minutes restantes avant l'heure promise, pour une commande en cuisine aujourd'hui (moins de 3 h), sinon null.
export function minutesRestantes(c: Pick<CommandeTablette, "statut" | "heure_confirmee">, maintenant: string): number | null {
  if (!c.heure_confirmee || !EN_CUISINE.has(c.statut)) return null;
  const reste = Math.ceil((new Date(c.heure_confirmee).getTime() - new Date(maintenant).getTime()) / 60_000);
  return reste >= 0 && reste < 180 ? reste : null;
}

// Imprimantes hors service réunies en une ligne : « Pizza : jamais connectée. Cuisine : plus de papier. »
export function lignesImprimantes(ko: { nom: string; etat: string }[]): string {
  return ko.map((i) => `${i.nom} : ${i.etat}`).join(". ");
}

// ---------- Tableau « En cours » trié par urgence (vague 3) ----------

// Minutes de trajet par zone de livraison, et préparation habituelle : de quoi savoir quand lancer.
export type Rythme = { preparation: number; trajets: Record<number, number> };

const MIN = 60_000;
const minutesEntre = (a: number, b: number) => Math.round((b - a) / MIN);

// Heure à laquelle la commande doit quitter le restaurant (livraison) ou être prête au comptoir (retrait).
export function heureDepart(c: Pick<CommandeTablette, "mode" | "heure_confirmee" | "zone_numero">, r: Rythme): number | null {
  if (!c.heure_confirmee) return null;
  const promise = new Date(c.heure_confirmee).getTime();
  return c.mode === "livraison" ? promise - (r.trajets[c.zone_numero ?? 0] ?? 0) * MIN : promise;
}

export type Niveau = "retard" | "maintenant" | "bientot" | "calme" | "fini";
export type EtatTemps = { niveau: Niveau; texte: string; cle: number };

// Ce qui presse, dit en clair : « En retard de 4 min », « À lancer », « À lancer dans 12 min », « À sortir dans 6 min ».
// cle sert au tri : les retards d'abord (le plus ancien en tête), puis par heure de lancement ; prêtes et parties à la fin.
export function etatTemps(
  c: Pick<CommandeTablette, "statut" | "mode" | "heure_confirmee" | "zone_numero">,
  maintenant: string,
  r: Rythme,
): EtatTemps {
  const t = new Date(maintenant).getTime();
  const depart = heureDepart(c, r);
  if (c.statut === "terminee") return { niveau: "fini", texte: c.mode === "livraison" ? "Livrée" : "Retirée", cle: Number.MAX_SAFE_INTEGER };
  if (c.statut === "refusee") return { niveau: "fini", texte: "Refusée ou annulée", cle: Number.MAX_SAFE_INTEGER };
  if (c.statut === "nouvelle") return { niveau: "maintenant", texte: "À accepter", cle: depart ?? t };
  if (c.statut === "prete") return { niveau: "calme", texte: "Prête au comptoir", cle: 4e15 + (depart ?? t) };
  if (c.statut === "partie") return { niveau: "calme", texte: "Partie en livraison", cle: 5e15 + (depart ?? t) };
  if (!c.heure_confirmee || depart === null) return { niveau: "calme", texte: "", cle: 3e15 };
  const promise = new Date(c.heure_confirmee).getTime();
  if (t >= promise + MIN) return { niveau: "retard", texte: `En retard de ${minutesEntre(promise, t)} min`, cle: promise - 1e13 };
  if (c.statut === "en_preparation") {
    const reste = minutesEntre(t, depart);
    return reste <= 0 ? { niveau: "maintenant", texte: "À sortir", cle: depart - r.preparation * MIN } : { niveau: reste <= 10 ? "bientot" : "calme", texte: `À sortir dans ${reste} min`, cle: depart - r.preparation * MIN };
  }
  const lancement = depart - r.preparation * MIN;
  const reste = minutesEntre(t, lancement);
  if (reste <= 0) return { niveau: "maintenant", texte: "À lancer", cle: lancement };
  return { niveau: reste <= 10 ? "bientot" : "calme", texte: `À lancer dans ${reste} min`, cle: lancement };
}

// Un geste par ligne : le pas suivant de la commande, ou rien (on ouvre le détail).
export type Geste = { libelle: string; corps: Record<string, unknown> };
export function gestePrincipal(c: Pick<CommandeTablette, "statut" | "mode" | "statut_paiement">): Geste | null {
  if (c.statut === "acceptee" || c.statut === "en_preparation") {
    return c.mode === "livraison"
      ? { libelle: "Partie", corps: { action: "statut", vers: "partie", de: c.statut } }
      : { libelle: "Prête", corps: { action: "statut", vers: "prete", de: c.statut } };
  }
  if (c.statut === "prete") {
    return c.statut_paiement === "a_encaisser_retrait"
      ? { libelle: "Retirée et payée", corps: { action: "retiree_payee" } }
      : { libelle: "Retirée", corps: { action: "statut", vers: "terminee", de: "prete" } };
  }
  if (c.statut === "partie") return { libelle: "Livrée", corps: { action: "statut", vers: "terminee", de: "partie" } };
  if (c.statut === "terminee" && c.statut_paiement === "a_encaisser_retrait") return { libelle: "Encaissée", corps: { action: "encaisser" } };
  return null;
}

// Les plats d'une commande en une ligne courte : « 2 Margherita, Pasta al pesto ».
export function resumePlats(lignes: { nom: string; qte: number }[]): string {
  return lignes.map((l) => `${l.qte > 1 ? `${l.qte} ` : ""}${l.nom.replace(/^Pizza /, "")}`).join(", ");
}

// Rien ne saute sous le doigt : tant qu'on touche la liste, l'ordre affiché reste celui d'avant. Les
// nouvelles commandes s'ajoutent à la fin, celles qui ont quitté la liste disparaissent.
export function ordreStable(ids: string[], precedent: string[], fige: boolean): string[] {
  if (!fige) return ids;
  const restent = new Set(ids);
  const garde = precedent.filter((id) => restent.has(id));
  const connus = new Set(garde);
  return [...garde, ...ids.filter((id) => !connus.has(id))];
}

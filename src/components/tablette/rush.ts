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

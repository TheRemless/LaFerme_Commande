// Ordre de passage proposé pour les livraisons d'un livreur, sans service payant ni coordonnées :
// zone, heure promise et voisinage par NPA et rue.
//
// Règle : on part du restaurant (Onex, zone 1). À chaque étape, on prend la livraison la plus « proche »
// de la précédente (même rue, puis même NPA, puis même zone), sauf si elle ferait attendre une heure
// promise plus tôt : chaque cran d'éloignement vaut 15 minutes d'heure promise. Les livraisons déjà
// parties restent devant (le livreur les a dans son sac), dans le même calcul.

export type ArretTournee = {
  commande_id: string;
  statut: string;
  zone: number | null;
  npa: string | null;
  rue: string | null;
  numero: string | null;
  heure: string | null;
};

export const MINUTES_PAR_CRAN = 15;

const normal = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const minutes = (iso: string | null) => (iso ? new Date(iso).getTime() / 60_000 : Number.POSITIVE_INFINITY);
const numero = (s: string | null) => Number.parseInt(s ?? "", 10) || 0;

// 0 même rue, 1 même NPA, 2 même zone, 3 ailleurs. Depuis le restaurant : zone 1 vaut 1, zone 2 vaut 2.
export function eloignement(depuis: ArretTournee | null, vers: ArretTournee): number {
  if (!depuis) return Math.min(3, Math.max(1, vers.zone ?? 3));
  if (depuis.npa && depuis.npa === vers.npa) return normal(depuis.rue) === normal(vers.rue) && normal(vers.rue) !== "" ? 0 : 1;
  if (depuis.zone !== null && depuis.zone === vers.zone) return 2;
  return 3;
}

function ordonnerGroupe(arrets: ArretTournee[], depart: ArretTournee | null): ArretTournee[] {
  const restants = [...arrets];
  const resultat: ArretTournee[] = [];
  let courant = depart;
  while (restants.length > 0) {
    const plusTot = Math.min(...restants.map((a) => minutes(a.heure)));
    const cout = (a: ArretTournee) => {
      const attente = Number.isFinite(plusTot) && Number.isFinite(minutes(a.heure)) ? minutes(a.heure) - plusTot : 0;
      return eloignement(courant, a) * MINUTES_PAR_CRAN + attente;
    };
    restants.sort(
      (a, b) =>
        cout(a) - cout(b) ||
        minutes(a.heure) - minutes(b.heure) ||
        normal(a.rue).localeCompare(normal(b.rue)) ||
        numero(a.numero) - numero(b.numero) ||
        a.commande_id.localeCompare(b.commande_id),
    );
    courant = restants.shift()!;
    resultat.push(courant);
  }
  return resultat;
}

export function proposerOrdre(arrets: ArretTournee[]): string[] {
  const parties = ordonnerGroupe(arrets.filter((a) => a.statut === "partie"), null);
  const suite = ordonnerGroupe(arrets.filter((a) => a.statut !== "partie"), null);
  return [...parties, ...suite].map((a) => a.commande_id);
}

// Déplace une livraison d'un cran vers le haut (-1) ou le bas (+1) dans la liste donnée.
export function deplacer(ordre: string[], commande: string, sens: -1 | 1): string[] | null {
  const i = ordre.indexOf(commande);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= ordre.length) return null;
  const copie = [...ordre];
  [copie[i], copie[j]] = [copie[j], copie[i]];
  return copie;
}

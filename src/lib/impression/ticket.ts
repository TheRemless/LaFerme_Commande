// Ticket de cuisine 80 mm (docs/recherche/prompt-v1-ancien-site.md §8). Une liste de lignes mises en
// forme, figée à l'acceptation, puis rendue en image pour l'imprimante, en texte de secours, ou en grand
// sur la tablette. Pas de prix sur les tickets de poste. Fonctions pures, sans base ni réseau.

export type LigneTicket =
  // inverse : blanc sur noir, pour ce qui ne doit pas être manqué (allergie, note du client).
  | { t: "texte"; texte: string; taille?: 1 | 2 | 3; gras?: boolean; retrait?: boolean; inverse?: boolean }
  | { t: "deux"; gauche: string; droite: string; taille?: 1 | 2 | 3; gras?: boolean }
  | { t: "filet" };

export type CommandePourTicket = {
  numero: number;
  mode: "livraison" | "retrait";
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  adresse: { rue: string; numero: string; npa: string; localite: string } | null;
  details_livraison: { etage: string; sonnette: string; code: string; instructions: string } | null;
  heure_confirmee: string | null;
  statut_paiement: string;
  moyen_paiement: string;
  lignes: { nom: string; qte: number; station: "pizza" | "cuisine"; details: string[] }[];
  // Allergie ou intolérance signalée par le client pour toute la commande (vide ou absent : rien de signalé).
  allergie?: string | null;
};

// Note du client sur un plat : écrite « … » par detailsTablette.
const estNote = (d: string) => d.startsWith("« ");

const HEURE = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
const JOUR = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

function heure(iso: string | Date): string {
  return HEURE.format(new Date(iso));
}

function paiement(c: CommandePourTicket): string {
  if (c.statut_paiement === "paye") return "PAYÉ EN LIGNE";
  if (c.statut_paiement === "encaisse") return "ENCAISSÉ";
  if (c.statut_paiement === "a_encaisser_retrait") return "À ENCAISSER AU RETRAIT";
  if (c.statut_paiement === "rembourse") return "REMBOURSÉ";
  return "PAIEMENT EN ATTENTE";
}

// Une tâche par poste qui a des lignes. Le ticket dit aussi ce qui sort à l'autre poste.
export function ticketsDeCommande(
  c: CommandePourTicket,
  { accepteLe, reimpression = false }: { accepteLe: string | Date; reimpression?: boolean },
): { station: "pizza" | "cuisine"; contenu: LigneTicket[] }[] {
  const stations = (["pizza", "cuisine"] as const).filter((s) => c.lignes.some((l) => l.station === s));
  return stations.map((station) => {
    const lignes = c.lignes.filter((l) => l.station === station);
    const autre = station === "pizza" ? "cuisine" : "pizza";
    const ailleurs = c.lignes.filter((l) => l.station === autre).reduce((n, l) => n + l.qte, 0);
    const contenu: LigneTicket[] = [];
    if (reimpression) contenu.push({ t: "texte", texte: "RÉIMPRESSION", gras: true });
    contenu.push({ t: "deux", gauche: station === "pizza" ? "PIZZA" : "CUISINE", droite: `N° ${String(c.numero).padStart(3, "0")}`, taille: 3, gras: true });
    // Allergie en tête des deux postes, en négatif : c'est la seule ligne qui peut blesser un client.
    const allergie = c.allergie?.trim();
    if (allergie) contenu.push({ t: "texte", texte: `ALLERGIE : ${allergie}`, taille: 2, gras: true, inverse: true });
    contenu.push({
      t: "deux",
      gauche: c.mode === "livraison" ? "LIVRAISON" : "À EMPORTER",
      droite: c.heure_confirmee ? `POUR ${heure(c.heure_confirmee)}` : "",
      taille: 2,
      gras: true,
    });
    const jour = JOUR.format(new Date(c.heure_confirmee ?? accepteLe));
    contenu.push({ t: "deux", gauche: jour.charAt(0).toUpperCase() + jour.slice(1), droite: `acceptée ${heure(accepteLe)}` });
    contenu.push({ t: "texte", texte: `Client : ${c.client_prenom} ${c.client_nom.charAt(0)}.   ${c.client_telephone}` });
    if (c.mode === "livraison" && c.adresse) {
      contenu.push({ t: "texte", texte: `Adresse : ${c.adresse.rue} ${c.adresse.numero}, ${c.adresse.npa} ${c.adresse.localite}` });
      const d = c.details_livraison;
      if (d) {
        const complement = [d.etage && `${d.etage} étage`, d.sonnette && `sonnette ${d.sonnette}`, d.code && `code ${d.code}`].filter(Boolean).join(", ");
        if (complement) contenu.push({ t: "texte", texte: complement, retrait: true });
        if (d.instructions) contenu.push({ t: "texte", texte: `« ${d.instructions} »`, retrait: true });
      }
    }
    contenu.push({ t: "filet" });
    for (const l of lignes) {
      contenu.push({ t: "texte", texte: `${l.qte} x ${l.nom}`, taille: 2, gras: true });
      // Retraits en gras, note du client en négatif : lisibles à un mètre.
      for (const d of l.details) contenu.push({ t: "texte", texte: d, retrait: true, gras: d.startsWith("SANS") || estNote(d), inverse: estNote(d) });
    }
    contenu.push({ t: "filet" });
    if (ailleurs > 0) contenu.push({ t: "texte", texte: `Aussi ${autre === "pizza" ? "aux pizzas" : "en cuisine"} : ${ailleurs} article${ailleurs > 1 ? "s" : ""}` });
    contenu.push({ t: "texte", texte: `Paiement : ${paiement(c)}`, gras: true });
    return { station, contenu };
  });
}

// Ticket « ANNULÉE » pour un poste qui a déjà reçu la commande (annulation après acceptation, SS-03).
export function ticketAnnulation(
  c: Pick<CommandePourTicket, "numero" | "mode" | "client_prenom" | "client_nom" | "heure_confirmee">,
  station: "pizza" | "cuisine",
  maintenant: string | Date = new Date(),
): LigneTicket[] {
  return [
    { t: "texte", texte: "ANNULÉE", taille: 3, gras: true },
    { t: "deux", gauche: station === "pizza" ? "PIZZA" : "CUISINE", droite: `N° ${String(c.numero).padStart(3, "0")}`, taille: 3, gras: true },
    { t: "texte", texte: "NE PAS PRÉPARER", taille: 2, gras: true },
    { t: "filet" },
    { t: "texte", texte: `${c.mode === "livraison" ? "Livraison" : "À emporter"}${c.heure_confirmee ? ` pour ${heure(c.heure_confirmee)}` : ""}, client ${c.client_prenom} ${c.client_nom.charAt(0)}.` },
    { t: "texte", texte: `Annulée à ${heure(maintenant)}` },
  ];
}

// ---------- Rendu texte (secours CloudPRNT text/plain) ----------

// La page de codes par défaut de l'imprimante n'est pas connue : le texte de secours reste en ASCII.
export function sansAccents(t: string): string {
  return t
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/°/g, "o")
    .replace(/[«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?");
}

export function texteTicket(lignes: LigneTicket[], colonnes = 48): string {
  const sortie: string[] = [];
  const couper = (t: string, largeur: number) => {
    const mots = t.split(" ");
    const res: string[] = [];
    let cur = "";
    for (const m of mots) {
      if ((cur + " " + m).trim().length > largeur && cur) {
        res.push(cur);
        cur = m;
      } else cur = (cur + " " + m).trim();
    }
    if (cur) res.push(cur);
    return res;
  };
  for (const l of lignes) {
    if (l.t === "filet") sortie.push("-".repeat(colonnes));
    else if (l.t === "deux") {
      const g = sansAccents(l.gauche);
      const d = sansAccents(l.droite);
      sortie.push(g + " ".repeat(Math.max(1, colonnes - g.length - d.length)) + d);
    } else {
      // Sans négatif en mode texte : la ligne est encadrée de « >> » et « << ».
      const marge = l.retrait ? "    " : "";
      const t = l.inverse ? `>> ${l.texte} <<` : l.texte;
      for (const x of couper(sansAccents(t), colonnes - marge.length)) sortie.push(marge + x);
    }
  }
  return sortie.join("\n") + "\n\n\n";
}

// ---------- Rendu SVG (image PNG pour l'imprimante) ----------

export const LARGEUR_POINTS = 576; // 80 mm, 72 mm imprimables à 203 dpi (mC-Print3).
const TAILLES = { 1: 26, 2: 40, 3: 60 } as const;
// Largeur moyenne d'un caractère de DejaVu Sans Condensed, en part de la taille : sert au retour à la ligne.
const CHASSE = 0.55;

// Les caractères de contrôle sont interdits en XML : une note de client qui en contient ne doit pas
// empêcher le ticket de sortir.
function echapperXml(t: string): string {
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function svgTicket(lignes: LigneTicket[]): string {
  const marge = 8;
  let y = 10;
  const elements: string[] = [];
  const texte = (x: number, base: number, t: string, taille: number, gras: boolean, ancre: "start" | "end" = "start", blanc = false) =>
    `<text x="${x}" y="${base}" font-family="DejaVu Sans Condensed" font-size="${taille}" font-weight="${gras ? 700 : 400}" text-anchor="${ancre}"${blanc ? ' fill="#fff"' : ""}>${echapperXml(t)}</text>`;
  for (const l of lignes) {
    if (l.t === "filet") {
      y += 10;
      elements.push(`<rect x="${marge}" y="${y}" width="${LARGEUR_POINTS - 2 * marge}" height="3"/>`);
      y += 14;
      continue;
    }
    const taille = TAILLES[l.taille ?? 1];
    const hauteur = Math.round(taille * 1.25);
    if (l.t === "deux") {
      y += hauteur;
      elements.push(texte(marge, y - Math.round(taille * 0.25), l.gauche, taille, Boolean(l.gras)));
      if (l.droite) elements.push(texte(LARGEUR_POINTS - marge, y - Math.round(taille * 0.25), l.droite, taille, Boolean(l.gras), "end"));
      continue;
    }
    const x = marge + (l.retrait ? 32 : 0) + (l.inverse ? 8 : 0);
    const parLigne = Math.max(8, Math.floor((LARGEUR_POINTS - x - marge - (l.inverse ? 8 : 0)) / (taille * CHASSE)));
    const mots = l.texte.split(" ");
    let cur = "";
    const morceaux: string[] = [];
    for (const m of mots) {
      if ((cur + " " + m).trim().length > parLigne && cur) {
        morceaux.push(cur);
        cur = m;
      } else cur = (cur + " " + m).trim();
    }
    if (cur) morceaux.push(cur);
    for (const morceau of morceaux) {
      // Négatif : un pavé noir sur toute la largeur imprimable, le texte en blanc dessus.
      if (l.inverse) elements.push(`<rect x="${x - 8}" y="${y + 2}" width="${LARGEUR_POINTS - marge - (x - 8)}" height="${hauteur}"/>`);
      y += hauteur;
      elements.push(texte(x, y - Math.round(taille * 0.25), morceau, taille, Boolean(l.gras), "start", Boolean(l.inverse)));
    }
  }
  const hauteur = y + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGEUR_POINTS}" height="${hauteur}" viewBox="0 0 ${LARGEUR_POINTS} ${hauteur}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${elements.join("")}</g></svg>`;
}

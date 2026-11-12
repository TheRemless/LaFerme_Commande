import type { Commande } from "@/lib/db/serveur";
import type { Catalogue } from "@/lib/panier";
import { prixChf, prixCourt } from "@/lib/prix";
import { heureDe } from "@/lib/heures";
import { heureTexte, jourTexte } from "@/lib/service";

// Textes des courriels, passés par redaction-fr (voix de Giuseppe : direct, factuel).
// Rien d'autre que des faits du registre (adresse, téléphone) et le contenu de la commande.

const RESTAURANT = "Restaurant La Ferme, Route de Chancy 132, 1213 Onex";
const TELEPHONE = "022 792 16 89";

function echapper(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function quandTexte(c: Pick<Commande, "quand_type" | "quand_date" | "quand_minutes">): string {
  if (c.quand_type === "creneau" && c.quand_date && c.quand_minutes !== null) return `le ${jourTexte(c.quand_date)} à ${heureTexte(c.quand_minutes)}`;
  return "dès que possible";
}

export function detailsLigne(cat: Catalogue | null, l: { choix: Record<string, string[]>; retraits: string[]; note: string }): string[] {
  const choix = Object.entries(l.choix ?? {}).flatMap(([g, noms]) => {
    const unique = cat?.groupes[g]?.choix_max === 1;
    return noms.map((n) => (unique ? n : `+ ${n.toLowerCase()}`));
  });
  return [...choix, ...(l.retraits ?? []).map((r) => `sans ${r.toLowerCase()}`), ...(l.note ? [`« ${l.note} »`] : [])];
}

function lienSuivi(c: Commande): string {
  return `${c.origine}/suivi/${c.jeton_suivi}`;
}

// estimation : heure « vers » annoncée à l'accueil pour « dès que possible » (CM-05), en minutes du jour.
function modeTexte(c: Commande, estimation: number | null = null): string {
  const quand = c.quand_type === "asap" && estimation !== null ? `dès que possible (vers ${heureTexte(estimation)})` : quandTexte(c);
  if (c.mode === "livraison" && c.adresse) {
    return `Livraison ${quand}, ${c.adresse.rue}${c.adresse.numero ? ` ${c.adresse.numero}` : ""}, ${c.adresse.npa} ${c.adresse.localite}.`;
  }
  return `À emporter ${quand}, Route de Chancy 132 à Onex.`;
}

export function courrielConfirmation(c: Commande, cat: Catalogue | null, estimation: number | null = null) {
  const paiement = c.moyen_paiement === "comptoir" ? `À payer au comptoir en venant la chercher, ${prixChf(c.total_centimes)}.` : `Payée en ligne, ${prixChf(c.total_centimes)}.`;
  const lignes = c.lignes.map((l) => ({ titre: `${l.qte} × ${l.nom}`, prix: prixCourt(l.total_centimes), details: detailsLigne(cat, l) }));
  const sommes = [
    ["Sous-total", prixChf(c.sous_total_centimes)],
    ...(c.mode === "livraison" ? [["Livraison", prixChf(c.frais_centimes)]] : []),
    ["Total", prixChf(c.total_centimes)],
    [`dont TVA ${String(c.taux_tva_pourcent).replace(".", ",")} %`, prixChf(c.tva_centimes)],
  ];
  const sujet = `Commande ${c.numero} reçue, La Ferme`;
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    `Nous avons bien reçu votre commande n° ${c.numero}.`,
    modeTexte(c, estimation),
    "Le restaurant vous confirme l'heure dès qu'il l'accepte.",
    "",
    ...lignes.flatMap((l) => [`${l.titre}  ${l.prix}`, ...l.details.map((d) => `   ${d}`)]),
    "",
    ...sommes.map(([a, b]) => `${a}  ${b}`),
    paiement,
    "",
    `Suivre la commande : ${lienSuivi(c)}`,
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1b1a;max-width:560px">
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>Nous avons bien reçu votre commande n° <strong>${c.numero}</strong>.<br>${echapper(modeTexte(c, estimation))}<br>Le restaurant vous confirme l'heure dès qu'il l'accepte.</p>
<table style="width:100%;border-collapse:collapse">${lignes
    .map(
      (l) => `<tr><td style="padding:6px 0;border-top:1px solid #ddd"><strong>${echapper(l.titre)}</strong>${l.details
        .map((d) => `<br><span style="color:#55524f">${echapper(d)}</span>`)
        .join("")}</td><td style="padding:6px 0;border-top:1px solid #ddd;text-align:right;vertical-align:top">${l.prix}</td></tr>`,
    )
    .join("")}${sommes
    .map(([a, b]) => `<tr><td style="padding:4px 0">${echapper(a)}</td><td style="padding:4px 0;text-align:right">${b}</td></tr>`)
    .join("")}</table>
<p>${echapper(paiement)}</p>
<p><a href="${echapper(lienSuivi(c))}">Suivre la commande</a><br>Une question ? ${TELEPHONE}</p>
<p style="color:#55524f;font-size:13px">${RESTAURANT}</p></div>`;
  return { sujet, texte, html };
}

// Commande payée en ligne refusée, remboursement pas encore passé (prestataire en panne) : le client
// apprend le refus tout de suite. Le courriel de remboursement suit quand il est fait (audit, SS-04).
export function courrielRefusRemboursementEnCours(c: Commande, motif: string) {
  const sujet = `Commande ${c.numero} annulée, La Ferme`;
  const remboursement = `Vous avez payé ${prixChf(c.total_centimes)}. Le remboursement n'est pas encore parti. Nous le relançons et vous écrivons dès qu'il est fait.`;
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    `Nous ne pouvons pas préparer votre commande n° ${c.numero}. ${motif}`,
    remboursement,
    "",
    `Une question ? Appelez-nous au ${TELEPHONE}.`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1b1a;max-width:560px">
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>Nous ne pouvons pas préparer votre commande n° <strong>${c.numero}</strong>. ${echapper(motif)}</p>
<p>${remboursement}</p>
<p>Une question ? Appelez-nous au ${TELEPHONE}.</p>
<p style="color:#55524f;font-size:13px">${RESTAURANT}</p></div>`;
  return { sujet, texte, html };
}

export function courrielRemboursement(c: Commande, motif: string) {
  const sujet = `Commande ${c.numero} annulée, La Ferme`;
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    `Nous ne pouvons pas préparer votre commande n° ${c.numero}. ${motif}`,
    `Nous vous remboursons ${prixChf(c.total_centimes)} sur le moyen de paiement utilisé. Le délai dépend de votre banque.`,
    "",
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1b1a;max-width:560px">
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>Nous ne pouvons pas préparer votre commande n° <strong>${c.numero}</strong>. ${echapper(motif)}</p>
<p>Nous vous remboursons ${prixChf(c.total_centimes)} sur le moyen de paiement utilisé. Le délai dépend de votre banque.</p>
<p>Une question ? ${TELEPHONE}</p>
<p style="color:#55524f;font-size:13px">${RESTAURANT}</p></div>`;
  return { sujet, texte, html };
}

// Code de connexion au compte. Le code est dans le sujet pour se lire dans la notification.
export function courrielCode(code: string) {
  const sujet = `${code}, votre code La Ferme`;
  const texte = [
    "Bonjour,",
    "",
    `Votre code pour vous connecter au site de commande de La Ferme est le ${code}.`,
    "Il est valable 10 minutes et ne sert qu'une fois.",
    "",
    "Si vous n'avez rien demandé, ne faites rien. Sans ce code, personne n'entre dans votre compte.",
    "",
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1b1a;max-width:560px">
<p>Bonjour,</p>
<p>Votre code pour vous connecter au site de commande de La Ferme est le</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:8px 0">${echapper(code)}</p>
<p>Il est valable 10 minutes et ne sert qu'une fois.</p>
<p>Si vous n'avez rien demandé, ne faites rien. Sans ce code, personne n'entre dans votre compte.</p>
<p>Une question ? ${TELEPHONE}</p>
<p style="color:#55524f;font-size:13px">${RESTAURANT}</p></div>`;
  return { sujet, texte, html };
}

// ---------- Courriels envoyés depuis la tablette (lot 7a) ----------


function courrielCourt(c: Commande, sujet: string, phrases: string[], avecSuivi = true) {
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    ...phrases,
    "",
    ...(avecSuivi ? [`Suivre la commande : ${lienSuivi(c)}`] : []),
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1b1a;max-width:560px">
<p>Bonjour ${echapper(c.client_prenom)},</p>
${phrases.map((p) => `<p>${echapper(p)}</p>`).join("\n")}
<p>${avecSuivi ? `<a href="${echapper(lienSuivi(c))}">Suivre la commande</a><br>` : ""}Une question ? ${TELEPHONE}</p>
<p style="color:#55524f;font-size:13px">${RESTAURANT}</p></div>`;
  return { sujet, texte, html };
}

function heurePhrase(c: Commande, iso: string): string {
  return c.mode === "livraison" ? `Le livreur passe chez vous vers ${heureDe(iso)}.` : `Elle sera prête vers ${heureDe(iso)}, Route de Chancy 132 à Onex.`;
}

export function courrielAcceptation(c: Commande, heureIso: string) {
  return courrielCourt(c, `Commande ${c.numero} acceptée, La Ferme`, [`Votre commande n° ${c.numero} est acceptée.`, heurePhrase(c, heureIso)]);
}

export function courrielNouvelleHeure(c: Commande, heureIso: string) {
  return courrielCourt(c, `Commande ${c.numero}, nouvelle heure`, [`L'heure de votre commande n° ${c.numero} change.`, heurePhrase(c, heureIso)]);
}

export function courrielPrete(c: Commande) {
  if (c.mode === "livraison") {
    return courrielCourt(c, `Commande ${c.numero} en route, La Ferme`, [`Votre commande n° ${c.numero} est partie. Le livreur est en route.`]);
  }
  return courrielCourt(c, `Commande ${c.numero} prête, La Ferme`, [
    `Votre commande n° ${c.numero} est prête. Vous pouvez venir la chercher, Route de Chancy 132 à Onex.`,
    ...(c.statut_paiement === "a_encaisser_retrait" ? [`Le paiement de ${prixChf(c.total_centimes)} se fait au comptoir.`] : []),
  ]);
}

// Refus d'une commande qui n'a pas été payée en ligne (paiement au comptoir) : rien à rembourser.
export function courrielRefus(c: Commande, motif: string) {
  return courrielCourt(c, `Commande ${c.numero} annulée, La Ferme`, [`Nous ne pouvons pas préparer votre commande n° ${c.numero}. ${motif}`, "Rien n'a été débité."], false);
}

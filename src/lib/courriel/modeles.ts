import { TELEPHONE_RESTAURANT } from "@/lib/livraisons-textes";
import type { Commande } from "@/lib/db/serveur";
import type { Catalogue } from "@/lib/panier";
import { prixChf, prixCourt } from "@/lib/prix";
import { heureDe } from "@/lib/heures";
import { heureTexte, jourTexte } from "@/lib/service";
import { MOTIF_DEMANDE_CLIENT } from "@/lib/motifs";
import { nomClient } from "@/lib/nom-plat";
import { ADRESSE_SITE } from "@/lib/site";
import type { TypeCourriel } from "@/lib/courriel/quota";
import { fourchette } from "@/lib/heure-reelle";
import { plageTexte } from "@/lib/plage-heure";
import { instantGeneve, type ConfigService } from "@/lib/service";
import { recuDisponible } from "@/lib/recu";

// Même heure partout que l'accueil (client-commande) : fourchette selon les réglages de largeur de
// bo-operations ; sans configuration ou à largeur 0, une seule heure (« vers 19h40 »).
type ConfigHeure = Pick<ConfigService, "reglages"> | null | undefined;
function quandPlage(c: Pick<Commande, "mode">, minutes: number, config: ConfigHeure): string {
  return plageTexte(config ? fourchette(config, c.mode, minutes) : { basse: minutes, haute: minutes });
}

// Textes des courriels, passés par redaction-fr (voix de Giuseppe : direct, factuel).
// Rien d'autre que des faits du registre (adresse, téléphone) et le contenu de la commande.

const RESTAURANT = "Restaurant La Ferme, Route de Chancy 132, 1213 Onex";
const TELEPHONE = TELEPHONE_RESTAURANT;

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

export { MOTIF_DEMANDE_CLIENT };

// Un seul e-mail à la commande (13.11.2026) : l'acceptation ne part plus par e-mail, elle se lit au suivi.
const HEURE_AU_SUIVI = "Le restaurant confirme l'heure sur la page de suivi dès qu'il accepte la commande.";

// Allergie de la commande (client-commande, #71) : l'e-mail la mentionne sans recopier le texte, une donnée de
// santé ne se copie pas dans la table courriels ni dans un e-mail transférable. Le texte est sur le suivi.
const ALLERGIE_SIGNALEE = "Vous avez signalé une allergie. Vérifiez-la sur la page de suivi.";

// Délais de remboursement selon le moyen de paiement (le site ne sait pas lequel le client a choisi chez
// Stripe : on donne les deux). Sources lues le 13.11.2026 :
// - TWINT : https://docs.stripe.com/payments/twint (« Refunds usually take a few minutes to complete »).
// - Carte : https://support.stripe.com/questions/how-long-do-refunds-take-to-reach-my-customer (5 à 10 jours
//   ouvrables ; Stripe donne ailleurs jusqu'à 14 jours, d'où « en général » et « selon votre banque »).
export const DELAI_REMBOURSEMENT =
  "Avec TWINT, l'argent arrive en général en quelques minutes. Avec une carte, en général de 5 à 10 jours ouvrables, selon votre banque.";

function phraseAnnulation(c: Commande, motif: string): { texte: string; html: string } {
  if (motif === MOTIF_DEMANDE_CLIENT) {
    return {
      texte: `Votre commande n° ${c.numero} est annulée, comme vous nous l'avez demandé.`,
      html: `Votre commande n° <strong>${c.numero}</strong> est annulée, comme vous nous l'avez demandé.`,
    };
  }
  return {
    texte: `Nous ne pouvons pas préparer votre commande n° ${c.numero}. ${motif}`,
    html: `Nous ne pouvons pas préparer votre commande n° <strong>${c.numero}</strong>. ${echapper(motif)}`,
  };
}

// Mise en page commune des courriels (audit design, D17) : logo en tête, encre sur blanc, bouton noir pour le
// suivi. Arial, parce que les polices du site ne passent pas dans toutes les messageries. La version texte
// de chaque courriel reste la référence ; le HTML n'ajoute que la mise en forme.
// Vague 3 : document complet en français, thème clair déclaré et fond blanc explicite (les messageries en mode
// sombre n'inversent plus le logo bordeaux sur fond noir), largeur du téléphone, et une ligne d'aperçu cachée
// que la boîte de réception affiche sous le sujet.
function enveloppe(corps: string, origine: string, apercu = ""): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:16px;background:#ffffff;color:#1c1b1a">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${echapper(apercu)}</div>
<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1c1b1a;background:#ffffff;max-width:560px">
<p style="margin:0 0 20px"><img src="${echapper(origine)}/logo-la-ferme.png" width="120" height="40" alt="La Ferme" style="display:block;border:0"></p>
${corps}
<p style="margin-top:24px;padding-top:12px;border-top:1px solid #dcdcd8;color:#55524f;font-size:13px">${RESTAURANT}</p></div>
</body>
</html>`;
}

function bouton(url: string, texte: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td bgcolor="#1c1b1a" style="background:#1c1b1a;border-radius:4px"><a href="${echapper(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:700;text-decoration:none">${texte}</a></td></tr></table>`;
}

function lienSuivi(c: Commande): string {
  return `${c.origine}/suivi/${c.jeton_suivi}`;
}

// estimation : heure « vers » annoncée à l'accueil pour « dès que possible » (CM-05), en minutes du jour.
function modeTexte(c: Commande, estimation: number | null = null, config: ConfigHeure = null): string {
  const quand = c.quand_type === "asap" && estimation !== null ? `dès que possible (${quandPlage(c, estimation, config)})` : quandTexte(c);
  if (c.mode === "livraison" && c.adresse) {
    return `Livraison ${quand}, ${c.adresse.rue}${c.adresse.numero ? ` ${c.adresse.numero}` : ""}, ${c.adresse.npa} ${c.adresse.localite}.`;
  }
  return `À emporter ${quand}, Route de Chancy 132 à Onex.`;
}

export function courrielConfirmation(c: Commande, cat: Catalogue | null, estimation: number | null = null, config: ConfigHeure = null) {
  const paiement =
    c.moyen_paiement !== "comptoir"
      ? `Payée en ligne, ${prixChf(c.total_centimes)}.`
      : c.mode === "livraison"
        ? `À payer à la livraison, en espèces ou par carte, ${prixChf(c.total_centimes)}.`
        : `À payer au comptoir en venant la chercher, ${prixChf(c.total_centimes)}.`;
  const lignes = c.lignes.map((l) => ({ titre: `${l.qte} × ${nomClient(l.nom, l.station === "pizza")}`, prix: prixCourt(l.total_centimes), details: detailsLigne(cat, l) }));
  const sommes = [
    ["Sous-total", prixChf(c.sous_total_centimes)],
    ...(c.mode === "livraison" ? [["Livraison", prixChf(c.frais_centimes)]] : []),
    ["Total", prixChf(c.total_centimes)],
    [`dont TVA ${String(c.taux_tva_pourcent).replace(".", ",")} %`, prixChf(c.tva_centimes)],
  ];
  const sujet = `Commande ${c.numero} reçue, La Ferme`;
  const recu = recuDisponible(c);
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    `Nous avons bien reçu votre commande n° ${c.numero}.`,
    modeTexte(c, estimation, config),
    HEURE_AU_SUIVI,
    ...(c.allergie ? [ALLERGIE_SIGNALEE] : []),
    "",
    ...lignes.flatMap((l) => [`${l.titre}  ${l.prix}`, ...l.details.map((d) => `   ${d}`)]),
    "",
    ...sommes.map(([a, b]) => `${a}  ${b}`),
    paiement,
    "",
    `Suivre la commande : ${lienSuivi(c)}`,
    ...(recu ? [`Reçu avec TVA : ${lienSuivi(c)}/recu`] : []),
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = enveloppe(`
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>Nous avons bien reçu votre commande n° <strong>${c.numero}</strong>.<br>${echapper(modeTexte(c, estimation, config))}<br>${HEURE_AU_SUIVI}</p>${c.allergie ? `\n<p><strong>${ALLERGIE_SIGNALEE}</strong></p>` : ""}
<table style="width:100%;border-collapse:collapse">${lignes
    .map(
      (l) => `<tr><td style="padding:6px 0;border-top:1px solid #ddd"><strong>${echapper(l.titre)}</strong>${l.details
        .map((d) => `<br><span style="color:#55524f">${echapper(d)}</span>`)
        .join("")}</td><td style="padding:6px 0;border-top:1px solid #ddd;text-align:right;vertical-align:top">${l.prix}</td></tr>`,
    )
    .join("")}${sommes
    .map(([a, b]) => {
      const fort = a === "Total" ? ";font-weight:700;font-size:17px" : "";
      return `<tr><td style="padding:4px 0${fort}">${echapper(a)}</td><td style="padding:4px 0;text-align:right${fort}">${b}</td></tr>`;
    })
    .join("")}</table>
<p>${echapper(paiement)}</p>
${bouton(lienSuivi(c), "Suivre la commande")}${recu ? `\n<p><a href="${echapper(`${lienSuivi(c)}/recu`)}" style="color:#1c1b1a">Reçu avec TVA</a></p>` : ""}
<p>Une question ? ${TELEPHONE}</p>`, c.origine, `Nous avons bien reçu votre commande n° ${c.numero}.`);
  return { sujet, texte, html, type: "confirmation" as TypeCourriel };
}

// Commande payée en ligne refusée, remboursement pas encore passé (prestataire en panne) : le client
// apprend le refus tout de suite. Le courriel de remboursement suit quand il est fait (audit, SS-04).
export function courrielRefusRemboursementEnCours(c: Commande, motif: string) {
  const sujet = `Commande ${c.numero} annulée, La Ferme`;
  const remboursement = `Vous avez payé ${prixChf(c.total_centimes)}. Le remboursement n'est pas encore parti. Nous le relançons et vous écrivons dès qu'il est fait.`;
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    phraseAnnulation(c, motif).texte,
    remboursement,
    "",
    `Une question ? Appelez-nous au ${TELEPHONE}.`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = enveloppe(`
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>${phraseAnnulation(c, motif).html}</p>
<p>${remboursement}</p>
<p>Une question ? Appelez-nous au ${TELEPHONE}.</p>`, c.origine, phraseAnnulation(c, motif).texte);
  return { sujet, texte, html, type: "refus" as TypeCourriel };
}

export function courrielRemboursement(c: Commande, motif: string) {
  const sujet = `Commande ${c.numero} annulée, La Ferme`;
  const texte = [
    `Bonjour ${c.client_prenom},`,
    "",
    phraseAnnulation(c, motif).texte,
    `Nous vous remboursons ${prixChf(c.total_centimes)} sur le moyen de paiement utilisé.`,
    DELAI_REMBOURSEMENT,
    "",
    `Une question ? ${TELEPHONE}`,
    "",
    RESTAURANT,
  ].join("\n");
  const html = enveloppe(`
<p>Bonjour ${echapper(c.client_prenom)},</p>
<p>${phraseAnnulation(c, motif).html}</p>
<p>Nous vous remboursons ${prixChf(c.total_centimes)} sur le moyen de paiement utilisé.</p>
<p>${DELAI_REMBOURSEMENT}</p>
<p>Une question ? ${TELEPHONE}</p>`, c.origine, phraseAnnulation(c, motif).texte);
  return { sujet, texte, html, type: "refus" as TypeCourriel };
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
  const html = enveloppe(`
<p>Bonjour,</p>
<p>Votre code pour vous connecter au site de commande de La Ferme est le</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:8px 0">${echapper(code)}</p>
<p>Il est valable 10 minutes et ne sert qu'une fois.</p>
<p>Si vous n'avez rien demandé, ne faites rien. Sans ce code, personne n'entre dans votre compte.</p>
<p>Une question ? ${TELEPHONE}</p>`, ADRESSE_SITE, "Votre code est valable 10 minutes.");
  return { sujet, texte, html, type: "code" as TypeCourriel };
}

// Au membre de l'équipe dont l'adresse est bloquée par des codes faux (audit de sécurité, S4).
// quand : « vendredi 13 novembre à 14h05 », heure de Genève.
export function courrielBlocagePersonnel(quand: string) {
  const sujet = "Connexion bloquée 24 heures, La Ferme";
  const lignes = [
    "Bonjour,",
    "",
    `Quelqu'un a entré 15 codes faux avec votre adresse sur la tablette ou le back-office de La Ferme. La connexion par code est bloquée pour cette adresse jusqu'au ${quand}.`,
    "",
    "Les appareils déjà connectés restent connectés.",
    "",
    "Si ce n'était pas vous, quelqu'un connaît votre adresse et essaie d'entrer. Aucun code n'a été trouvé. Le restaurant reçoit une copie de ce message.",
    "",
    RESTAURANT,
  ];
  const texte = lignes.join("\n");
  // Même mise en page que les courriels aux clients (logo, pied commun qui porte déjà l'adresse du restaurant).
  const html = enveloppe(
    lignes
      .filter((l) => l !== "" && l !== RESTAURANT)
      .map((l) => `<p>${echapper(l)}</p>`)
      .join("\n"),
    ADRESSE_SITE,
    lignes[2],
  );
  return { sujet, texte, html, type: "blocage" as TypeCourriel };
}

// ---------- Courriels envoyés depuis la tablette (lot 7a) ----------


function courrielType(c: Commande, type: TypeCourriel, sujet: string, phrases: string[], avecSuivi = true) {
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
  const html = enveloppe(`
<p>Bonjour ${echapper(c.client_prenom)},</p>
${phrases.map((p) => `<p>${echapper(p)}</p>`).join("\n")}
${avecSuivi ? bouton(lienSuivi(c), "Suivre la commande") : ""}
<p>Une question ? ${TELEPHONE}</p>`, c.origine, phrases[0]);
  return { sujet, texte, html, type };
}

// Forme d'avant le quota, gardée pour les appels qui ne donnent pas de type : priorité « suivi ».
export function courrielCourt(c: Commande, sujet: string, phrases: string[], avecSuivi = true) {
  return courrielType(c, "suivi", sujet, phrases, avecSuivi);
}

// Commande modifiée au téléphone, plus chère (vague 3, bo-commandes) : le lien de paiement de la différence. Rien ne
// change avant le paiement : la cuisine reçoit l'ajout dès qu'il est payé.
export function courrielLienComplement(c: Commande, ajouts: string[], montantCentimes: number, url: string) {
  const phrases = [
    ...(ajouts.length ? [`Ajouté à votre commande n° ${c.numero} : ${ajouts.join(", ")}.`] : [`Votre commande n° ${c.numero} change à votre demande.`]),
    `Le complément est de ${prixChf(montantCentimes)}. Payez-le avec le bouton ci-dessous, il reste valable 30 minutes.`,
    "Nous préparons l'ajout dès que le paiement arrive. Sans paiement, votre commande reste comme avant.",
  ];
  const texte = [`Bonjour ${c.client_prenom},`, "", ...phrases, "", `Payer le complément : ${url}`, `Une question ? ${TELEPHONE}`, "", RESTAURANT].join("\n");
  const html = enveloppe(
    `
<p>Bonjour ${echapper(c.client_prenom)},</p>
${phrases.map((p) => `<p>${echapper(p)}</p>`).join("\n")}
${bouton(url, `Payer ${prixChf(montantCentimes)}`)}
<p>Une question ? ${TELEPHONE}</p>`,
    c.origine,
    phrases[0],
  );
  return { sujet: `Commande ${c.numero}, complément à payer`, texte, html, type: "suivi" as TypeCourriel };
}

// Commande modifiée au téléphone, appliquée (vague 3, bo-commandes) : ce qui a changé et ce que ça coûte en plus ou en moins.
export function courrielPlatsModifies(
  c: Commande,
  { ajouts, retires, difference, reglement }: { ajouts: string[]; retires: string[]; difference: number; reglement: string },
) {
  const argent =
    reglement === "remboursement"
      ? `Nous vous remboursons ${prixChf(-difference)} sur votre moyen de paiement.`
      : reglement === "lien"
        ? `Nous avons bien reçu le complément de ${prixChf(difference)}.`
        : reglement === "porte"
          ? `Le complément de ${prixChf(difference)} se paie à la livraison, en espèces ou par carte.`
          : reglement === "comptoir"
            ? `Le complément de ${prixChf(difference)} se paie au comptoir en venant la chercher.`
            : c.statut_paiement === "a_encaisser_retrait"
              ? `Le nouveau total à payer est de ${prixChf(c.total_centimes)}.`
              : null;
  return courrielCourt(c, `Commande ${c.numero} modifiée, La Ferme`, [
    `Votre commande n° ${c.numero} a été modifiée à votre demande.`,
    ...(ajouts.length ? [`Ajouté : ${ajouts.join(", ")}.`] : []),
    ...(retires.length ? [`Retiré : ${retires.join(", ")}.`] : []),
    ...(argent ? [argent] : []),
  ]);
}

function heurePhrase(c: Commande, iso: string, config: ConfigHeure = null): string {
  const quand = quandPlage(c, instantGeneve(new Date(iso)).minutes, config);
  return c.mode === "livraison" ? `Le livreur passe chez vous ${quand}.` : `Elle sera prête ${quand}, Route de Chancy 132 à Onex.`;
}

export function courrielAcceptation(c: Commande, heureIso: string, config: ConfigHeure = null) {
  return courrielType(c, "acceptation", `Commande ${c.numero} acceptée, La Ferme`, [`Votre commande n° ${c.numero} est acceptée.`, heurePhrase(c, heureIso, config)]);
}

export function courrielNouvelleHeure(c: Commande, heureIso: string, config: ConfigHeure = null) {
  return courrielType(c, "nouvelle_heure", `Commande ${c.numero}, nouvelle heure`, [`L'heure de votre commande n° ${c.numero} change.`, heurePhrase(c, heureIso, config)]);
}

// Commande modifiée par l'équipe à la demande du client (vague 3, bo-commandes) : nouveau récapitulatif
// des seuls champs changés. c est la commande déjà modifiée. Le montant ne change jamais par ce chemin.
export function courrielModification(c: Commande, champs: string[]) {
  const phrases = [`Votre commande n° ${c.numero} a été modifiée.`];
  if (champs.includes("adresse") && c.adresse) {
    phrases.push(`Adresse de livraison : ${[c.adresse.rue, c.adresse.numero].filter(Boolean).join(" ")}, ${c.adresse.npa} ${c.adresse.localite}.`);
  }
  if (champs.includes("details_livraison") && c.details_livraison) {
    const d = c.details_livraison;
    const morceaux = [`Sonnette : ${d.sonnette}`, d.etage && `Étage : ${d.etage}`, d.code && `Code : ${d.code}`].filter(Boolean);
    phrases.push(`${morceaux.join(". ")}.`);
    if (d.instructions) phrases.push(`Instructions : ${d.instructions}`);
  }
  if (champs.includes("client_prenom") || champs.includes("client_nom")) phrases.push(`Commande au nom de ${c.client_prenom} ${c.client_nom}.`);
  if (champs.includes("client_telephone")) phrases.push(`Téléphone : ${c.client_telephone}.`);
  return courrielCourt(c, `Commande ${c.numero} modifiée, La Ferme`, phrases);
}

export function courrielPrete(c: Commande) {
  if (c.mode === "livraison") {
    return courrielType(c, "en_route", `Commande ${c.numero} en route, La Ferme`, [`Votre commande n° ${c.numero} est partie. Le livreur est en route.`]);
  }
  return courrielType(c, "prete", `Commande ${c.numero} prête, La Ferme`, [
    `Votre commande n° ${c.numero} est prête. Vous pouvez venir la chercher, Route de Chancy 132 à Onex.`,
    ...(c.statut_paiement === "a_encaisser_retrait" ? [`Le paiement de ${prixChf(c.total_centimes)} se fait au comptoir.`] : []),
  ]);
}

// Livraison close, client absent (décision de Jérémy du 12.11.2026) : factuel, sans promesse. Le gérant
// décide ensuite d'un éventuel remboursement depuis le back-office. Pas de lien de suivi (rien à suivre).
export function courrielClientAbsent(c: Commande, passageIso: string) {
  return courrielType(
    c,
    "client_absent",
    `Commande ${c.numero} non remise, La Ferme`,
    [`Notre livreur est passé chez vous vers ${heureDe(passageIso)} avec votre commande n° ${c.numero}.`, "Personne n'a répondu et il est reparti avec la commande."],
    false,
  );
}

// Refus d'une commande qui n'a pas été payée en ligne (paiement au comptoir) : rien à rembourser.
export function courrielRefus(c: Commande, motif: string) {
  return courrielType(c, "refus", `Commande ${c.numero} annulée, La Ferme`, [phraseAnnulation(c, motif).texte, "Rien n'a été débité."], false);
}

// Remboursement décidé par le gérant après la remise (audit du gérant, G02), en entier ou en partie.
// Le motif est celui que le gérant a écrit : le formulaire prévient qu'il part chez le client.
export function courrielRemboursementGeste(c: Commande, montantCentimes: number, motif: string) {
  const montant = prixChf(montantCentimes);
  const phrase =
    montantCentimes >= c.total_centimes
      ? `Nous vous remboursons ${montant}, le montant de votre commande n° ${c.numero}.`
      : `Nous vous remboursons ${montant} sur votre commande n° ${c.numero}.`;
  return courrielType(c, "remboursement", `Remboursement de ${montant}, commande ${c.numero}, La Ferme`, [
    phrase,
    motif,
    "La somme revient sur le moyen de paiement utilisé.",
    DELAI_REMBOURSEMENT,
  ], false);
}

// Un plat ou un supplément manque sur une commande acceptée (audit du gérant, G07). Le client apprend ce qui
// manque, ce qui lui est rendu, et que le reste est préparé. moyen : stripe (remboursé), deduction (au comptoir,
// pas encore payé), especes (déjà payé au comptoir, rendu sur place).
export function courrielManque(c: Commande, description: string, montantCentimes: number, moyen: "stripe" | "especes" | "deduction", resteCentimes: number) {
  const montant = prixChf(montantCentimes);
  const argent =
    moyen === "stripe"
      ? [`Nous vous remboursons ${montant}.`, "La somme revient sur le moyen de paiement utilisé.", DELAI_REMBOURSEMENT]
      : moyen === "deduction"
        ? [`Vous payez ${prixChf(resteCentimes)} au comptoir au lieu de ${prixChf(c.total_centimes)}.`]
        : [`Nous vous rendons ${montant} au comptoir.`];
  return courrielType(c, "manque", `Il manque une partie de votre commande ${c.numero}, La Ferme`, [
    `Nous ne pouvons pas préparer toute votre commande n° ${c.numero}. Il manque ${description}.`,
    ...argent,
    "Le reste de la commande est préparé comme prévu.",
  ]);
}

// Maquette du lot 1 : parcours client simulé dans le navigateur, sans serveur.
// Les deux directions partagent ce fichier, seule la feuille de style change.

const CATEGORIES = [
  ["Pizzas", "Pizzas"],
  ["Entrées", "Entrées"],
  ["Pâtes", "Pâtes et risottos"],
  ["Poissons", "Poissons"],
  ["Viandes", "Viandes"],
  ["Desserts", "Desserts"],
  ["Boissons", "Boissons"],
];

// Propositions de docs/PROMPT.md §6, à valider par Jérémy.
const ZONES = {
  1: { frais: 2.9, minimum: 30, trajet: 15 },
  2: { frais: 4.9, minimum: 40, trajet: 25 },
};
const ADRESSES = [
  { rue: "Avenue du Gros-Chêne 20", npa: "1213", ville: "Onex", zone: 1 },
  { rue: "Rue des Bossons 12", npa: "1213", ville: "Onex", zone: 1 },
  { rue: "Route de Chancy 59", npa: "1213", ville: "Onex", zone: 1 },
  { rue: "Boulevard Carl-Vogt 40", npa: "1205", ville: "Genève", zone: 2 },
  { rue: "Rue de Lausanne 20", npa: "1201", ville: "Genève", zone: null },
];
// Horloge figée pour que les captures soient stables : mardi, 19h05.
const MAINTENANT = 19 * 60 + 5;
const PREPARATION = 20;
const RUPTURES = { "pizza-parma": "Épuisée ce soir" };

const plats = window.CARTE.plats;
const groupes = window.CARTE.groupes;
const parId = Object.fromEntries(plats.map((p) => [p.id, p]));

const paniersDemo = {
  petit: [{ id: "pizza-margherita", qte: 1, retraits: [], ajouts: [], choix: null, note: "" }],
  plein: [
    { id: "pizza-miss-italia", qte: 1, retraits: ["Rucola"], ajouts: ["Burrata"], choix: null, note: "" },
    { id: "pizza-margherita", qte: 2, retraits: [], ajouts: ["Olives"], choix: null, note: "Bien cuite" },
    { id: "pasta-alla-carbonara", qte: 1, retraits: [], ajouts: [], choix: "Spaghetti", note: "" },
  ],
};

const etat = chargerEtat();

function chargerEtat() {
  const p = new URLSearchParams(location.search);
  let e;
  try {
    e = JSON.parse(sessionStorage.getItem("maquette") || "null");
  } catch {
    e = null;
  }
  e = e || { mode: "livraison", adresse: null, saisie: "", details: {}, quand: "asap", panier: [], paiement: "twint", compte: true };
  if (p.has("adresse")) {
    e.mode = "livraison";
    e.adresse = ADRESSES[Number(p.get("adresse"))];
    e.saisie = e.adresse.rue;
    e.details = { etage: "3e", sonnette: "Rochat", code: "", note: "" };
  }
  if (p.get("mode") === "retrait") e.mode = "retrait";
  if (p.has("panier")) e.panier = paniersDemo[p.get("panier")] || [];
  return e;
}


function sauver() {
  try {
    sessionStorage.setItem("maquette", JSON.stringify(etat));
  } catch {}
}

const prixSupp = Object.fromEntries(groupes.g1.choix.map((c) => [c.nom, c.prix]));

function prix(n) {
  return Number.isInteger(n) ? `${n}.–` : n.toFixed(2);
}
function chf(n) {
  return `CHF ${n.toFixed(2)}`;
}
function heure(min) {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, "0");
  return `${h}h${m}`;
}
function nomCourt(p) {
  if (p.categorie !== "Pizzas") return p.nom;
  const n = p.nom.replace(/^Pizza /, "");
  return n[0].toUpperCase() + n.slice(1);
}
function prixLigne(l) {
  const p = parId[l.id];
  return (p.prixPropose + l.ajouts.reduce((s, a) => s + prixSupp[a], 0)) * l.qte;
}
function sousTotal() {
  return etat.panier.reduce((s, l) => s + prixLigne(l), 0);
}
function nbArticles() {
  return etat.panier.reduce((s, l) => s + l.qte, 0);
}
function zone() {
  return etat.mode === "livraison" && etat.adresse && etat.adresse.zone ? ZONES[etat.adresse.zone] : null;
}
function frais() {
  const z = zone();
  return z ? z.frais : 0;
}
function heureAsap() {
  const z = zone();
  const total = MAINTENANT + PREPARATION + (z ? z.trajet : 0);
  return heure(Math.ceil(total / 5) * 5);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const ICONES = {
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
  fermer: '<path d="M6 6l12 12M18 6 6 18"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  sac: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  repere: '<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  retour: '<path d="M15 5l-7 7 7 7"/>',
  compte: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
function icone(nom) {
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom]}</svg>`;
}

// ---------- Vues ----------

function vueAccueil() {
  const a = etat.adresse;
  const z = zone();
  const horsZone = etat.mode === "livraison" && a && !a.zone;
  const pret = etat.mode === "retrait" || (a && a.zone);
  let bloc = "";
  if (etat.mode === "livraison") {
    const suggestions = etat.saisie && !a ? ADRESSES.filter((x) => (x.rue + " " + x.npa + " " + x.ville).toLowerCase().includes(etat.saisie.toLowerCase().slice(0, 3))) : [];
    bloc = `
      <div class="champ champ-adresse">
        <label for="adresse">Adresse de livraison</label>
        <div class="saisie-adresse">
          ${icone("repere")}
          <input id="adresse" type="text" autocomplete="street-address" placeholder="Rue et numéro" value="${esc(etat.saisie)}" />
          ${a ? `<button type="button" class="effacer" data-action="effacer-adresse" aria-label="Changer d'adresse">${icone("fermer")}</button>` : ""}
        </div>
        ${suggestions.length ? `<ul class="suggestions" role="listbox">${suggestions.map((x) => `<li><button type="button" data-action="choisir-adresse" data-i="${ADRESSES.indexOf(x)}"><strong>${x.rue}</strong> ${x.npa} ${x.ville}</button></li>`).join("")}</ul>` : ""}
      </div>
      ${
        z
          ? `<div class="verdict verdict-ok" role="status">
              <p class="verdict-titre">${icone("ok")} Dans notre zone de livraison</p>
              <dl class="chiffres">
                <div><dt>Livraison</dt><dd>${prix(z.frais)}</dd></div>
                <div><dt>Minimum</dt><dd>${prix(z.minimum)}</dd></div>
                <div><dt>Chez vous vers</dt><dd>${heureAsap()}</dd></div>
              </dl>
            </div>
            <div class="details">
              <div class="champ"><label for="etage">Étage</label><input id="etage" value="${esc(etat.details.etage || "")}" /></div>
              <div class="champ"><label for="sonnette">Nom sur la sonnette</label><input id="sonnette" value="${esc(etat.details.sonnette || "")}" /></div>
              <div class="champ"><label for="code">Code d'entrée <span class="facultatif">facultatif</span></label><input id="code" /></div>
              <div class="champ champ-large"><label for="note-livreur">Pour le livreur <span class="facultatif">facultatif</span></label><input id="note-livreur" maxlength="140" /></div>
            </div>`
          : ""
      }
      ${
        horsZone
          ? `<div class="verdict verdict-hors" role="status">
              <p class="verdict-titre">${esc(a.rue)}, ${a.npa} ${a.ville} est hors de notre zone de livraison.</p>
              <p>Vous pouvez commander et passer prendre votre commande au restaurant, Route de Chancy 132.</p>
              <button type="button" class="bouton-second" data-action="mode" data-mode="retrait">Passer en retrait</button>
            </div>`
          : ""
      }`;
  } else {
    bloc = `
      <div class="verdict verdict-ok">
        <p class="verdict-titre">${icone("repere")} Route de Chancy 132, 1213 Onex</p>
        <dl class="chiffres">
          <div><dt>Prête vers</dt><dd>${heureAsap()}</dd></div>
          <div><dt>Paiement</dt><dd class="petit">en ligne ou au comptoir</dd></div>
        </dl>
      </div>`;
  }
  const quand = pret
    ? `<fieldset class="quand">
        <legend>Pour quand ?</legend>
        <label class="option"><input type="radio" name="quand" value="asap" ${etat.quand === "asap" ? "checked" : ""}/> <span>Dès que possible, vers ${heureAsap()}</span></label>
        <label class="option"><input type="radio" name="quand" value="plus-tard" ${etat.quand === "plus-tard" ? "checked" : ""}/> <span>Plus tard</span></label>
        ${
          etat.quand === "plus-tard"
            ? `<div class="creneau">
                <div class="champ"><label for="jour">Jour</label><select id="jour"><option>Aujourd'hui</option><option>Mercredi 11.11</option><option>Jeudi 12.11</option><option>Vendredi 13.11</option><option>Samedi 14.11</option><option>Mardi 17.11</option></select></div>
                <div class="champ"><label for="heure">Heure</label><select id="heure">${Array.from({ length: 13 }, (_, i) => `<option>${heure(19 * 60 + 45 + i * 15)}</option>`).join("")}</select></div>
              </div>`
            : ""
        }
      </fieldset>`
    : "";
  return `
  <section class="accueil">
    <figure class="accueil-photo"><img src="../img/hero.jpg" alt="Pizzas, pâtes et burger de La Ferme vus du dessus" /></figure>
    <div class="accueil-panneau">
      <h1>Livraison ou retrait ?</h1>
      <div class="choix-mode" role="radiogroup" aria-label="Mode">
        <button type="button" role="radio" aria-checked="${etat.mode === "livraison"}" data-action="mode" data-mode="livraison">
          <span class="choix-titre">Livraison</span><span class="choix-sous">par les livreurs du restaurant</span>
        </button>
        <button type="button" role="radio" aria-checked="${etat.mode === "retrait"}" data-action="mode" data-mode="retrait">
          <span class="choix-titre">À emporter</span><span class="choix-sous">Route de Chancy 132, Onex</span>
        </button>
      </div>
      ${bloc}
      ${quand}
      ${horsZone ? "" : `<a class="bouton-principal ${pret ? "" : "inactif"}" href="#carte" ${pret ? "" : 'aria-disabled="true"'}>Voir la carte</a>`}
      <p class="connexion">Déjà un compte ? <a href="#accueil">Se connecter</a> pour retrouver vos adresses.</p>
    </div>
  </section>`;
}

function lignePlat(p) {
  const rupture = RUPTURES[p.id];
  const media = p.photo
    ? `<img src="../img/${p.photo}.jpg" alt="" loading="lazy" />`
    : `<span class="sans-photo" aria-hidden="true">${esc(nomCourt(p))}</span>`;
  return `<li class="plat ${p.photo ? "a-photo" : "sans-image"} ${rupture ? "epuise" : ""}">
    <button type="button" class="plat-btn" data-action="fiche" data-id="${p.id}" ${rupture ? "disabled" : ""}>
      <span class="plat-media">${media}</span>
      <span class="plat-txt">
        <span class="plat-nom">${esc(nomCourt(p))}</span>
        <span class="plat-desc">${esc(p.description)}</span>
        ${rupture ? `<span class="plat-rupture">${rupture}</span>` : ""}
      </span>
      <span class="plat-prix">${prix(p.prixPropose)}</span>
      ${rupture ? "" : `<span class="plat-ajout" aria-hidden="true">${icone("plus")}</span>`}
    </button>
  </li>`;
}

function resumeMode() {
  if (etat.mode === "retrait") return `<strong>À emporter</strong><span>Route de Chancy 132, prête vers ${heureAsap()}</span>`;
  const a = etat.adresse;
  return `<strong>Livraison vers ${heureAsap()}</strong><span>${a ? esc(a.rue) : "Adresse à choisir"}</span>`;
}

function vueCarte() {
  const q = (etat.recherche || "").toLowerCase();
  const sections = CATEGORIES.map(([cat, titre]) => {
    // Plats avec photo en tête de chaque catégorie, en attendant le classement par ventes réelles.
    const liste = plats.filter((p) => p.categorie === cat && (!q || (p.nom + " " + p.description).toLowerCase().includes(q)));
    if (!liste.length) return "";
    const ancre = "cat-" + cat.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    return `<section class="categorie" id="${ancre}" aria-labelledby="${ancre}-t">
      <h2 id="${ancre}-t">${titre}</h2>
      ${cat === "Pizzas" ? `<p class="cat-note">Ajoutez ou retirez des ingrédients sur chaque pizza.</p>` : ""}
      ${liste.some((p) => p.photo) ? `<ul class="plats">${liste.filter((p) => p.photo).map(lignePlat).join("")}</ul>` : ""}
      ${liste.some((p) => !p.photo) ? `<ul class="plats plats-texte">${liste.filter((p) => !p.photo).map(lignePlat).join("")}</ul>` : ""}
    </section>`;
  }).join("");
  return `
  <div class="page-carte">
    <div class="carte-outils">
      <div class="recherche">${icone("recherche")}<input type="search" id="recherche" placeholder="Chercher un plat" aria-label="Chercher un plat" value="${esc(etat.recherche || "")}"/></div>
      <nav class="cats" aria-label="Catégories">${CATEGORIES.map(([cat, titre]) => `<a href="#cat-${cat.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}" data-action="ancre">${titre}</a>`).join("")}</nav>
    </div>
    <div class="carte-corps">
      <div class="carte-liste">${sections || `<p class="vide">Aucun plat ne correspond à « ${esc(etat.recherche)} ».</p>`}</div>
      <aside class="panier-col" aria-label="Votre commande">${panierContenu()}</aside>
    </div>
    ${nbArticles() ? `<a class="barre-panier" href="#panier"><span class="barre-nb">${nbArticles()}</span><span class="barre-txt">Voir le panier${totaux().manque ? `<small>Encore ${chf(totaux().manque)} pour le minimum</small>` : ""}</span><span class="barre-total">${chf(sousTotal())}</span></a>` : ""}
  </div>`;
}

function lignesPanier(modifiable) {
  return etat.panier
    .map((l, i) => {
      const p = parId[l.id];
      const opts = [
        l.choix ? `<li>${esc(l.choix)}</li>` : "",
        ...l.retraits.map((r) => `<li>Sans ${esc(r.toLowerCase())}</li>`),
        ...l.ajouts.map((a) => `<li>+ ${esc(a.toLowerCase())} <span class="opt-prix">${prix(prixSupp[a])}</span></li>`),
        l.note ? `<li class="opt-note">« ${esc(l.note)} »</li>` : "",
      ].join("");
      return `<li class="ligne">
        <div class="ligne-haut">
          <span class="ligne-nom">${esc(nomCourt(p))}</span>
          <span class="ligne-prix">${prix(prixLigne(l))}</span>
        </div>
        ${opts ? `<ul class="ligne-opts">${opts}</ul>` : ""}
        ${
          modifiable
            ? `<div class="qte" aria-label="Quantité">
                <button type="button" data-action="qte" data-i="${i}" data-d="-1" aria-label="Retirer un">${icone("moins")}</button>
                <span>${l.qte}</span>
                <button type="button" data-action="qte" data-i="${i}" data-d="1" aria-label="Ajouter un">${icone("plus")}</button>
              </div>`
            : `<span class="ligne-qte">× ${l.qte}</span>`
        }
      </li>`;
    })
    .join("");
}

function totaux() {
  const st = sousTotal();
  const z = zone();
  const total = st + frais();
  const manque = z ? Math.max(0, z.minimum - st) : 0;
  return { st, total, manque, z };
}

function panierContenu(pleinePage) {
  const { st, total, manque, z } = totaux();
  if (!etat.panier.length) {
    return `<h2 class="panier-titre">Votre commande</h2>
      <div class="panier-mode">${resumeMode()} <a href="#accueil">Modifier</a></div>
      <p class="vide">Votre panier est vide. Touchez un plat pour l'ajouter.</p>`;
  }
  return `<h2 class="panier-titre">Votre commande</h2>
    <div class="panier-mode">${resumeMode()} <a href="#accueil">Modifier</a></div>
    <ul class="lignes">${lignesPanier(true)}</ul>
    <dl class="sommes">
      <div><dt>Sous-total</dt><dd>${chf(st)}</dd></div>
      ${z ? `<div><dt>Livraison</dt><dd>${chf(z.frais)}</dd></div>` : ""}
      <div class="somme-totale"><dt>Total</dt><dd>${chf(total)}</dd></div>
    </dl>
    ${
      manque
        ? `<div class="minimum" role="status"><p>Encore <strong>${chf(manque)}</strong> pour le minimum de livraison (${prix(z.minimum)}).</p><span class="jauge"><span style="width:${Math.round((st / z.minimum) * 100)}%"></span></span></div>
          <span class="bouton-principal inactif" aria-disabled="true">Commander</span>`
        : `<a class="bouton-principal" href="#commande">Commander, ${chf(total)}</a>`
    }
    ${pleinePage ? `<a class="lien-retour" href="#carte">Ajouter d'autres plats</a>` : ""}`;
}

function vuePanier() {
  return `<div class="page-panier"><a class="retour" href="#carte">${icone("retour")} Carte</a>${panierContenu(true)}</div>`;
}

function vueFiche(id) {
  const p = parId[id];
  const f = etat.fiche || (etat.fiche = { id, qte: 1, retraits: [], ajouts: [], choix: null, note: "", tous: false });
  const pates = p.groupes.includes("g2");
  const supp = p.groupes.includes("g1");
  const suppAffiches = f.tous ? groupes.g1.choix : groupes.g1.choix.slice(0, 8);
  const unite = p.prixPropose + f.ajouts.reduce((s, a) => s + prixSupp[a], 0);
  const manqueChoix = pates && !f.choix;
  const provenance = [
    ...p.provenancesConnues.map((t) => `<li>${esc(t.replace(/ \(carte de la salle.*\)$/, ""))}</li>`),
    ...p.provenancesManquantes.map((t) => `<li class="a-completer">${esc(t[0].toUpperCase() + t.slice(1))} : provenance à compléter</li>`),
  ].join("");
  return `
  <div class="fiche-fond" data-action="fermer-fiche"></div>
  <div class="fiche" role="dialog" aria-modal="true" aria-labelledby="fiche-nom">
    <button type="button" class="fiche-fermer" data-action="fermer-fiche" aria-label="Fermer">${icone("fermer")}</button>
    <div class="fiche-media">${p.photo ? `<img src="../img/${p.photo}.jpg" alt="${esc(nomCourt(p))}" />` : `<span class="sans-photo grand" aria-hidden="true">${esc(nomCourt(p))}</span>`}</div>
    <div class="fiche-corps">
      <div class="fiche-tete">
        <h2 id="fiche-nom">${esc(nomCourt(p))}</h2>
        <span class="fiche-prix">${prix(p.prixPropose)}</span>
      </div>
      <p class="fiche-desc">${esc(p.description)}</p>
      <div class="fiche-infos">
        ${provenance ? `<div><h3>Provenance</h3><ul>${provenance}</ul></div>` : ""}
        <div><h3>Allergènes</h3><p>Demandez-nous au <a href="tel:+41227921689">022 792 16 89</a></p></div>
      </div>
      ${
        pates
          ? `<fieldset class="groupe">
              <legend>Vos pâtes <span class="obligatoire">obligatoire</span></legend>
              ${groupes.g2.choix.map((c) => `<label class="option"><input type="radio" name="pates" value="${c.nom}" data-action="choix" ${f.choix === c.nom ? "checked" : ""}/> <span>${c.nom}</span></label>`).join("")}
            </fieldset>`
          : ""
      }
      ${
        p.retraits.length
          ? `<fieldset class="groupe">
              <legend>Retirer <span class="gratuit">gratuit</span></legend>
              <div class="options-grille">${p.retraits.map((r) => `<label class="option"><input type="checkbox" data-action="retrait" value="${esc(r)}" ${f.retraits.includes(r) ? "checked" : ""}/> <span>Sans ${esc(r.toLowerCase())}</span></label>`).join("")}</div>
            </fieldset>`
          : ""
      }
      ${
        supp
          ? `<fieldset class="groupe">
              <legend>Ajouter <span class="gratuit">jusqu'à 5, ${f.ajouts.length} choisi${f.ajouts.length > 1 ? "s" : ""}</span></legend>
              <div class="options-grille">${suppAffiches
                .map((c) => {
                  const coche = f.ajouts.includes(c.nom);
                  return `<label class="option ${!coche && f.ajouts.length >= 5 ? "bloque" : ""}"><input type="checkbox" data-action="ajout" value="${esc(c.nom)}" ${coche ? "checked" : ""} ${!coche && f.ajouts.length >= 5 ? "disabled" : ""}/> <span>${esc(c.nom)}</span><span class="opt-prix">${c.prix ? "+" + prix(c.prix) : "offert"}</span></label>`;
                })
                .join("")}</div>
              ${f.tous ? "" : `<button type="button" class="lien" data-action="tous-supp">Voir les ${groupes.g1.choix.length} suppléments</button>`}
            </fieldset>`
          : ""
      }
      <div class="champ"><label for="note-plat">Note pour la cuisine <span class="facultatif">facultatif</span></label><input id="note-plat" maxlength="80" value="${esc(f.note)}" /></div>
    </div>
    <div class="fiche-pied">
      <div class="qte">
        <button type="button" data-action="fiche-qte" data-d="-1" aria-label="Un de moins">${icone("moins")}</button>
        <span>${f.qte}</span>
        <button type="button" data-action="fiche-qte" data-d="1" aria-label="Un de plus">${icone("plus")}</button>
      </div>
      <button type="button" class="bouton-principal ${manqueChoix ? "inactif" : ""}" data-action="ajouter" ${manqueChoix ? 'aria-disabled="true"' : ""}>${manqueChoix ? "Choisissez vos pâtes" : `Ajouter, ${chf(unite * f.qte)}`}</button>
    </div>
  </div>`;
}

function vueCommande() {
  const { st, total, z } = totaux();
  const a = etat.adresse;
  const retrait = etat.mode === "retrait";
  const paiements = [
    ["twint", "TWINT", ""],
    ["apple", "Apple Pay", ""],
    ["carte", "Carte de crédit ou de débit", ""],
    ...(retrait ? [["comptoir", "Au comptoir, au retrait", ""]] : []),
  ];
  return `
  <div class="page-commande">
    <a class="retour" href="#carte">${icone("retour")} Carte</a>
    <h1>Finaliser la commande</h1>
    <div class="commande-grille">
      <form class="commande-form" onsubmit="return false">
        <section class="etape">
          <h2><span class="etape-n">1</span> ${retrait ? "Retrait" : "Livraison"}</h2>
          <div class="recap-mode">
            ${
              retrait
                ? `<p><strong>Route de Chancy 132, 1213 Onex</strong></p><p>Prête vers ${heureAsap()}</p>`
                : `<p><strong>${esc(a.rue)}, ${a.npa} ${a.ville}</strong></p><p>${esc(etat.details.etage || "")} étage, sonnette ${esc(etat.details.sonnette || "")}</p><p>Vers ${heureAsap()}</p>`
            }
            <a href="#accueil">Modifier</a>
          </div>
        </section>
        <section class="etape">
          <h2><span class="etape-n">2</span> Vos coordonnées</h2>
          <div class="details deux">
            <div class="champ"><label for="prenom">Prénom</label><input id="prenom" autocomplete="given-name" value="Claire" /></div>
            <div class="champ"><label for="nom">Nom</label><input id="nom" autocomplete="family-name" value="Rochat" /></div>
            <div class="champ"><label for="tel">Téléphone</label><input id="tel" type="tel" autocomplete="tel" value="079 123 45 67" /><p class="aide">${retrait ? "Si votre commande a du retard, on vous appelle." : "Le livreur vous appelle s'il ne trouve pas l'entrée."}</p></div>
            <div class="champ"><label for="email">E-mail</label><input id="email" type="email" autocomplete="email" value="claire.rochat@exemple.ch" /><p class="aide">Pour la confirmation et le suivi de la commande.</p></div>
          </div>
          <label class="option case-compte"><input type="checkbox" ${etat.compte ? "checked" : ""} data-action="compte"/> <span><strong>Garder mes adresses et mes commandes</strong><br/>Un compte est créé avec cet e-mail. Pour vous reconnecter, vous recevez un code, sans mot de passe.</span></label>
        </section>
        <section class="etape">
          <h2><span class="etape-n">3</span> Paiement</h2>
          <div class="paiements" role="radiogroup">
            ${paiements.map(([v, t]) => `<label class="option paiement"><input type="radio" name="paiement" value="${v}" data-action="paiement" ${etat.paiement === v ? "checked" : ""}/> <span>${t}</span></label>`).join("")}
          </div>
          ${
            etat.paiement === "carte"
              ? `<div class="stripe-simule"><div class="champ"><label>Numéro de carte</label><input placeholder="1234 1234 1234 1234" /></div><div class="details"><div class="champ"><label>Expiration</label><input placeholder="MM / AA" /></div><div class="champ"><label>CVC</label><input placeholder="123" /></div></div></div>`
              : etat.paiement === "twint"
              ? `<p class="aide">Vous validez le paiement dans l'application TWINT, puis vous revenez ici.</p>`
              : ""
          }
        </section>
        <p class="mentions">En commandant, vous acceptez les <a href="#commande">conditions générales</a>. Vos données : <a href="#commande">confidentialité</a>.</p>
        <a class="bouton-principal" href="#suivi">${etat.paiement === "comptoir" ? "Commander, je paie au retrait" : `Payer ${chf(total)}`}</a>
      </form>
      <aside class="commande-recap" aria-label="Récapitulatif">
        <h2>Récapitulatif</h2>
        <ul class="lignes">${lignesPanier(false)}</ul>
        <a class="lien" href="#panier">Modifier le panier</a>
        <dl class="sommes">
          <div><dt>Sous-total</dt><dd>${chf(st)}</dd></div>
          ${z ? `<div><dt>Livraison</dt><dd>${chf(z.frais)}</dd></div>` : ""}
          <div class="somme-totale"><dt>Total</dt><dd>${chf(total)}</dd></div>
          <div class="tva"><dt>dont TVA 2,6 %</dt><dd>${chf((total * 2.6) / 102.6)}</dd></div>
        </dl>
      </aside>
    </div>
  </div>`;
}

function vueSuivi() {
  const retrait = etat.mode === "retrait";
  const etapes = retrait
    ? [["Reçue", "19h06"], ["Acceptée", "19h08"], ["En préparation", ""], ["Prête au comptoir", ""], ["Retirée", ""]]
    : [["Reçue", "19h06"], ["Acceptée", "19h08"], ["En préparation", ""], ["En route", ""], ["Livrée", ""]];
  const courante = 2;
  const { total } = totaux();
  return `
  <div class="page-suivi">
    <p class="suivi-num">Commande 037, ${esc("Claire")}</p>
    <h1>${retrait ? "Prête vers" : "Chez vous vers"} <span class="suivi-heure">19h45</span></h1>
    <p class="suivi-change">Le restaurant a confirmé l'heure : 19h45 au lieu de ${heureAsap()}.</p>
    <ol class="etapes">
      ${etapes
        .map(([t, h], i) => `<li class="${i < courante ? "fait" : i === courante ? "en-cours" : ""}" ${i === courante ? 'aria-current="step"' : ""}><span class="puce">${i < courante ? icone("ok") : ""}</span><span class="etape-t">${t}</span><span class="etape-h">${h}</span></li>`)
        .join("")}
    </ol>
    <p class="suivi-info">Un e-mail vous prévient à chaque étape et si l'heure change.</p>
    <section class="suivi-detail">
      <h2>Votre commande</h2>
      <ul class="lignes">${lignesPanier(false)}</ul>
      <dl class="sommes"><div class="somme-totale"><dt>Payé avec TWINT</dt><dd>${chf(total)}</dd></div></dl>
      <p>Une question ? <a href="tel:+41227921689">022 792 16 89</a></p>
    </section>
  </div>`;
}

// ---------- Rendu et événements ----------

const app = document.getElementById("app");

function route() {
  const h = location.hash.slice(1) || "accueil";
  const [vue, arg] = h.split("/");
  return { vue, arg };
}

function rendre() {
  const { vue, arg } = route();
  let html;
  if (vue === "carte" || vue === "plat") html = vueCarte();
  else if (vue === "panier") html = vuePanier();
  else if (vue === "commande") html = etat.panier.length ? vueCommande() : vueCarte();
  else if (vue === "suivi") html = vueSuivi();
  else html = vueAccueil();
  const fiche = vue === "plat" && parId[arg] ? vueFiche(arg) : "";
  app.innerHTML = `
    <header class="tete">
      <a class="logo" href="#accueil"><img src="../img/logo.png" alt="La Ferme, accueil" /></a>
      ${vue !== "accueil" && vue !== "suivi" ? `<a class="tete-mode" href="#accueil">${resumeMode()}</a>` : ""}
      <a class="tete-compte" href="#accueil">${icone("compte")}<span>Se connecter</span></a>
    </header>
    <main class="vue vue-${vue}">${html}</main>
    ${fiche}`;
  document.body.classList.toggle("fiche-ouverte", !!fiche);
  document.body.dataset.vue = vue;
  sauver();
}

app.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "mode") {
    etat.mode = el.dataset.mode;
    rendre();
  } else if (a === "choisir-adresse") {
    etat.adresse = ADRESSES[Number(el.dataset.i)];
    etat.saisie = etat.adresse.rue;
    rendre();
  } else if (a === "effacer-adresse") {
    etat.adresse = null;
    etat.saisie = "";
    rendre();
    document.getElementById("adresse").focus();
  } else if (a === "fiche") {
    etat.fiche = null;
    location.hash = "plat/" + el.dataset.id;
  } else if (a === "fermer-fiche") {
    etat.fiche = null;
    location.hash = "carte";
  } else if (a === "fiche-qte") {
    etat.fiche.qte = Math.max(1, etat.fiche.qte + Number(el.dataset.d));
    rendreFiche();
  } else if (a === "tous-supp") {
    etat.fiche.tous = true;
    rendreFiche();
  } else if (a === "ajouter") {
    const f = etat.fiche;
    if (parId[f.id].groupes.includes("g2") && !f.choix) return;
    etat.panier.push({ id: f.id, qte: f.qte, retraits: f.retraits, ajouts: f.ajouts, choix: f.choix, note: f.note });
    etat.fiche = null;
    location.hash = "carte";
  } else if (a === "qte") {
    const l = etat.panier[Number(el.dataset.i)];
    l.qte += Number(el.dataset.d);
    if (l.qte < 1) etat.panier.splice(Number(el.dataset.i), 1);
    rendre();
  } else if (a === "ancre") {
    ev.preventDefault();
    document.querySelector(el.getAttribute("href")).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
});

app.addEventListener("change", (ev) => {
  const el = ev.target;
  const a = el.dataset.action;
  const f = etat.fiche;
  if (el.name === "quand") {
    etat.quand = el.value;
    rendre();
  } else if (a === "choix") {
    f.choix = el.value;
    rendreFiche();
  } else if (a === "retrait") {
    f.retraits = el.checked ? [...f.retraits, el.value] : f.retraits.filter((x) => x !== el.value);
  } else if (a === "ajout") {
    f.ajouts = el.checked ? [...f.ajouts, el.value] : f.ajouts.filter((x) => x !== el.value);
    rendreFiche();
  } else if (a === "paiement") {
    etat.paiement = el.value;
    rendre();
  } else if (a === "compte") {
    etat.compte = el.checked;
  }
});

app.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.id === "adresse") {
    etat.saisie = el.value;
    etat.adresse = null;
    rendre();
    const i = document.getElementById("adresse");
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  } else if (el.id === "recherche") {
    etat.recherche = el.value;
    rendre();
    const i = document.getElementById("recherche");
    i.focus();
    i.setSelectionRange(i.value.length, i.value.length);
  } else if (el.id === "note-plat") {
    etat.fiche.note = el.value;
  } else if (["etage", "sonnette"].includes(el.id)) {
    etat.details[el.id] = el.value;
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && route().vue === "plat") {
    etat.fiche = null;
    location.hash = "carte";
  }
});

function rendreFiche() {
  const zones = [".fiche", ".fiche-corps"].map((sel) => document.querySelector(sel)?.scrollTop || 0);
  rendre();
  [".fiche", ".fiche-corps"].forEach((sel, i) => {
    const n = document.querySelector(sel);
    if (n) n.scrollTop = zones[i];
  });
}

let vuePrecedente = route().vue;
window.addEventListener("hashchange", () => {
  const { vue } = route();
  const resteSurCarte = [vuePrecedente, vue].every((v) => v === "carte" || v === "plat");
  vuePrecedente = vue;
  rendre();
  if (!resteSurCarte) window.scrollTo(0, 0);
});
rendre();

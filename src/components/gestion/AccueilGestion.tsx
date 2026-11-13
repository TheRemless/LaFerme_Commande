"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReglagesAlertes, useAlertes } from "@/components/gestion/alertes";
import { useCarte } from "@/components/gestion/contexte-carte";
import { GROUPES_VISIBLES } from "@/components/gestion/navigation";
import { CarteChiffre, Chargement, demanderOuverture, EtatErreur, IconeGestion, montant, nombre } from "@/components/gestion/ui";
import type { Alerte, DonneesAccueil, EtatRestaurant } from "@/lib/accueil-gestion";
import type { EtatQuota } from "@/lib/courriel/quota";
import { heureDe } from "@/lib/heures";
import { heureTexte, jourTexte } from "@/lib/service";

// Accueil du back-office : la journée en un coup d'œil (vague 3). Dans l'ordre : ce qui attend un geste
// (alertes), les commandes du moment, le service en cours contre le même service la semaine passée,
// l'état du restaurant, puis le plan des rubriques. Relu toutes les 20 secondes par le centre d'alertes de la
// coque (src/components/gestion/alertes.tsx), qui porte aussi les alertes sur les autres pages.

// Au-delà, « et n autres » : la liste filtrée les montre toutes.
const COMMANDES_MONTREES = 6;

export function AccueilGestion() {
  const { carte } = useCarte();
  const centre = useAlertes();
  const { donnees: d, erreur, recharger } = centre?.lecture ?? { donnees: null, erreur: null, recharger: () => {} };

  return (
    <div className="bo-accueil">
      {erreur && !d && <EtatErreur texte={erreur} reessayer={recharger} />}
      {!d && !erreur && <Chargement lignes={4} libelle="Chargement de la journée…" />}
      {d && (
        <>
          <p className="bo-accueil-maj">
            {d.service === "midi" ? "Service de midi" : "Service du soir"}, mis à jour à {heureDe(d.maintenant)}
            {erreur ? ". Dernière lecture ratée, nouvel essai dans 20 secondes" : ""}.
          </p>
          <Alertes alertes={d.alertes} />
          <section aria-labelledby="accueil-commandes">
            <h2 id="accueil-commandes" className="bo-accueil-titre">
              Commandes
            </h2>
            {d.commandes ? (
              <div className="bo-chiffres">
                <CarteChiffre
                  libelle="À accepter"
                  valeur={nombre(d.commandes.a_accepter)}
                  aide={d.commandes.plus_ancienne ? `La plus ancienne attend depuis ${depuis(d.commandes.plus_ancienne, d.maintenant)}.` : "Rien n'attend."}
                  lien={{ href: "/tablette", texte: "Ouvrir la tablette" }}
                />
                <CarteChiffre libelle="En cours" valeur={nombre(d.commandes.en_cours)} aide={`Dont ${nombre(d.commandes.pretes)} prête${d.commandes.pretes > 1 ? "s" : ""}.`} />
                <CarteChiffre
                  libelle="Après l'heure promise"
                  valeur={nombre(d.commandes.en_retard.length)}
                  aide={d.commandes.en_retard.length ? `N° ${d.commandes.en_retard.map((c) => c.numero).join(", ")}.` : "Aucune."}
                />
                <CarteChiffre libelle="Pour un autre jour" valeur={nombre(d.commandes.a_l_avance)} aide="Commandes à l'avance, pas encore acceptées." />
              </div>
            ) : (
              <p className="aide">File des commandes indisponible.</p>
            )}
          </section>
          <section aria-labelledby="accueil-ventes">
            <h2 id="accueil-ventes" className="bo-accueil-titre">
              {d.service === "midi" ? "Ce midi" : "Ce soir"}
            </h2>
            {d.ventes ? (
              <div className="bo-chiffres">
                <CarteChiffre
                  libelle="Ventes"
                  valeur={montant(d.ventes.periode.ttc_centimes)}
                  unite="CHF"
                  comparaison={{ valeur: d.ventes.periode.ttc_centimes, reference: d.ventes.comparaison.ttc_centimes, contre: contre(d) }}
                />
                <CarteChiffre
                  libelle="Commandes"
                  valeur={nombre(d.ventes.periode.commandes)}
                  comparaison={{ valeur: d.ventes.periode.commandes, reference: d.ventes.comparaison.commandes, contre: contre(d) }}
                />
                <CarteChiffre
                  libelle="Panier moyen"
                  valeur={montant(d.ventes.periode.panier_moyen_centimes)}
                  unite="CHF"
                  comparaison={{ valeur: d.ventes.periode.panier_moyen_centimes, reference: d.ventes.comparaison.panier_moyen_centimes, contre: contre(d) }}
                />
                <CarteChiffre
                  libelle="Livraisons"
                  valeur={nombre(d.ventes.periode.livraison.commandes)}
                  aide={`${nombre(d.ventes.periode.retrait.commandes)} à emporter, ${nombre(d.ventes.periode.refusees.commandes)} refusée${d.ventes.periode.refusees.commandes > 1 ? "s" : ""}.`}
                />
              </div>
            ) : (
              <p className="aide">Ventes indisponibles.</p>
            )}
          </section>
          <section aria-labelledby="accueil-restaurant">
            <h2 id="accueil-restaurant" className="bo-accueil-titre">
              Restaurant
            </h2>
            {d.restaurant ? <Restaurant r={d.restaurant} quota={d.quota} /> : <p className="aide">État du restaurant indisponible.</p>}
          </section>
        </>
      )}
      <section aria-labelledby="accueil-plan">
        <h2 id="accueil-plan" className="bo-accueil-titre">
          Rubriques
        </h2>
        {carte && (
          <p className={carte.bloquants > 0 ? "ges-bloquants" : "ges-ok"} role="status">
            {carte.bloquants > 0
              ? `${carte.bloquants} plat${carte.bloquants > 1 ? "s" : ""} bloque${carte.bloquants > 1 ? "nt" : ""} la mise en ligne`
              : "Rien ne bloque la mise en ligne"}
          </p>
        )}
        <div className="bo-plan">
          {GROUPES_VISIBLES.slice(1).map((g, i) => (
            <section key={g.titre} className="bo-plan-groupe" aria-labelledby={`bo-plan-${i}`}>
              <h3 id={`bo-plan-${i}`}>{g.titre}</h3>
              <ul>
                {g.rubriques.map((r) => (
                  <li key={r.href}>
                    <Link href={r.href} className="bo-plan-lien">
                      <IconeGestion nom={r.icone} />
                      <span>
                        <strong>{r.titre}</strong>
                        <span className="bo-plan-resume">{r.resume}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="aide">Chaque modification est enregistrée dans le journal.</p>
      </section>
    </div>
  );
}

function Alertes({ alertes }: { alertes: Alerte[] }) {
  const [reglages, setReglages] = useState(false);
  // Le panneau reste à la même place quand une alerte arrive ou se règle : il ne se referme pas sous les doigts.
  return (
    <>
      <ListeAlertes alertes={alertes} regler={() => setReglages(true)} />
      {reglages && <ReglagesAlertes onFermer={() => setReglages(false)} />}
    </>
  );
}

function ListeAlertes({ alertes, regler: ouvrir }: { alertes: Alerte[]; regler: () => void }) {
  const regler = (
    <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={ouvrir}>
      Régler les alertes
    </button>
  );
  if (alertes.length === 0)
    return (
      <div className="bo-alertes-entete">
        <p className="bo-accueil-calme">Rien ne demande votre attention.</p>
        {regler}
      </div>
    );
  return (
    <section aria-labelledby="accueil-alertes" className="bo-alertes">
      <div className="bo-alertes-entete">
        <h2 id="accueil-alertes" className="bo-accueil-titre">
          À régler ({alertes.length})
        </h2>
        {regler}
      </div>
      <ul>
        {alertes.map((a) => (
          <li key={a.cle} data-niveau={a.niveau}>
            <div>
              <p className="bo-alerte-titre">
                {a.niveau === "bloquant" && <span className="bo-alerte-niveau">Maintenant</span>}
                {a.titre}
              </p>
              {(a.detail || a.depuis) && (
                <p className="bo-alerte-detail">
                  {a.detail}
                  {a.depuis ? `${a.detail ? " " : ""}Depuis ${a.commandes ? jourEtHeure(a.depuis) : heureDe(a.depuis)}.` : ""}
                </p>
              )}
              {a.commandes && <CommandesAlerte alerte={a} />}
            </div>
            {a.geste && (
              <a className="bo-bouton bo-bouton-second bo-bouton-petit" href={a.geste.href}>
                {a.geste.texte}
              </a>
            )}
            {a.liste && (
              <Link className="bo-bouton bo-bouton-second bo-bouton-petit" href={a.liste.href}>
                {a.liste.texte}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Chaque commande ouvre sa fiche dans Commandes (sans son numéro dans l'adresse) ; son jour est écrit, car les
// numéros repartent à 1 chaque jour.
function CommandesAlerte({ alerte }: { alerte: Alerte }) {
  const router = useRouter();
  const liste = alerte.commandes ?? [];
  const reste = liste.length - COMMANDES_MONTREES;
  return (
    <ul className="bo-alerte-commandes" aria-label={`Commandes concernées : ${alerte.titre}`}>
      {liste.slice(0, COMMANDES_MONTREES).map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="bo-alerte-commande"
            onClick={() => {
              demanderOuverture({ type: "commande", cle: c.id });
              router.push("/gestion/commandes");
            }}
          >
            N° {c.numero}, {jourTexte(c.jour)}
          </button>
        </li>
      ))}
      {reste > 0 && <li className="bo-alerte-reste">et {reste} autre{reste > 1 ? "s" : ""}</li>}
    </ul>
  );
}

function jourEtHeure(iso: string): string {
  const jour = new Intl.DateTimeFormat("fr-CH", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zurich" }).format(new Date(iso));
  return `le ${jour} à ${heureDe(iso)}`;
}

function Restaurant({ r, quota }: { r: EtatRestaurant; quota: EtatQuota | null }) {
  const lignes: string[] = [];
  const l = r.livraison;
  if (l.etat === "ouvert") lignes.push(`Ouvert : livraison et à emporter${r.retard_minutes ? `, retard de ${r.retard_minutes} min annoncé aux clients` : ""}.`);
  else if (l.etat === "pause") lignes.push(`Commandes en ligne en pause${l.jusqua ? ` jusqu'à ${heureDe(l.jusqua)}` : ", sans heure de fin"}.`);
  else if (l.etat === "livraison-fermee") lignes.push(`Livraison fermée, à emporter ${r.retrait.etat === "ouvert" ? "ouvert" : "fermé"}.`);
  else if (l.etat === "ferme") lignes.push(`Fermé. Prochain créneau : ${jourTexte(l.prochain.date)} à ${heureTexte(l.prochain.minutes)}.`);
  else if (l.etat === "fermeture")
    lignes.push(`Fermé du ${jourTexte(l.fermeture.debut)} au ${jourTexte(l.fermeture.fin)}${l.reouverture ? `, réouverture le ${jourTexte(l.reouverture)}` : ""}.`);
  else lignes.push("Aucun créneau ouvert dans les jours à venir : vérifiez les horaires.");
  for (const z of r.zones_fermees) lignes.push(`Zone ${z.numero} fermée${z.jusqua ? ` jusqu'à ${heureDe(z.jusqua)}` : ""}.`);
  return (
    <div className="bo-restaurant">
      <ul>
        {lignes.map((t) => (
          <li key={t}>{t}</li>
        ))}
        <li>
          {r.ruptures.length === 0
            ? "Aucun plat en rupture."
            : `En rupture : ${r.ruptures.map((p) => (p.jusqu_au ? `${p.nom} (jusqu'au ${jourTexte(p.jusqu_au)})` : p.nom)).join(", ")}.`}
        </li>
        <li>
          {quota
            ? `E-mails : ${nombre(quota.envoyes)} sur ${nombre(quota.plafond)} aujourd'hui${quota.refuses > 0 ? `, ${nombre(quota.refuses)} pas partis (limite atteinte)` : ""}.`
            : "E-mails : compteur indisponible."}
        </li>
      </ul>
      <Link className="lien" href="/gestion/horaires">
        Horaires, zones et fermetures
      </Link>
    </div>
  );
}

/** « vendredi soir dernier » : le même service, le même jour de la semaine passée (pilotage_ventes). */
function contre(d: DonneesAccueil): string {
  const jour = jourTexte(d.ventes!.comparaison.debut).split(" ")[0];
  return `${jour} ${d.service} dernier`;
}

function depuis(iso: string, maintenant: string): string {
  const m = Math.max(0, Math.round((new Date(maintenant).getTime() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "moins d'une minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

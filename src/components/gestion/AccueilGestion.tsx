"use client";

import Link from "next/link";
import { useCarte } from "@/components/gestion/contexte-carte";
import { GROUPES_VISIBLES } from "@/components/gestion/navigation";
import { CarteChiffre, Chargement, EtatErreur, IconeGestion, montant, nombre, useRelecture } from "@/components/gestion/ui";
import type { Alerte, DonneesAccueil, EtatRestaurant } from "@/lib/accueil-gestion";
import { heureDe } from "@/lib/heures";
import { heureTexte, jourTexte } from "@/lib/service";

// Accueil du back-office : la journée en un coup d'œil (vague 3). Dans l'ordre : ce qui attend un geste
// (alertes), les commandes du moment, le service en cours contre le même service la semaine passée,
// l'état du restaurant, puis le plan des rubriques. Relu toutes les 20 secondes tant que la page est visible.

type Reponse = DonneesAccueil & { alertes: Alerte[] };
const RELECTURE_MS = 20_000;

export function AccueilGestion() {
  const { carte } = useCarte();
  const { donnees: d, erreur, recharger } = useRelecture<Reponse>(
    async (signal) => {
      const r = await fetch("/api/gestion/accueil", { cache: "no-store", signal });
      if (r.status === 401) {
        window.location.reload();
        throw new Error("Session terminée.");
      }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    [],
    { intervalleMs: RELECTURE_MS, messageErreur: "Les chiffres du jour n'ont pas pu être chargés." },
  );
  const charger = recharger;

  return (
    <div className="bo-accueil">
      {erreur && !d && <EtatErreur texte={erreur} reessayer={charger} />}
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
                  libelle="Livraisons et retraits"
                  valeur={`${nombre(d.ventes.periode.livraison.commandes)} et ${nombre(d.ventes.periode.retrait.commandes)}`}
                  aide={`${nombre(d.ventes.periode.refusees.commandes)} refusée${d.ventes.periode.refusees.commandes > 1 ? "s" : ""}.`}
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
            {d.restaurant ? <Restaurant r={d.restaurant} /> : <p className="aide">État du restaurant indisponible.</p>}
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
  if (alertes.length === 0) return <p className="bo-accueil-calme">Rien ne demande votre attention.</p>;
  return (
    <section aria-labelledby="accueil-alertes" className="bo-alertes">
      <h2 id="accueil-alertes" className="bo-accueil-titre">
        À régler ({alertes.length})
      </h2>
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
                  {a.depuis ? `${a.detail ? " " : ""}Depuis ${heureDe(a.depuis)}.` : ""}
                </p>
              )}
            </div>
            {a.geste && (
              <a className="bo-bouton bo-bouton-second bo-bouton-petit" href={a.geste.href}>
                {a.geste.texte}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Restaurant({ r }: { r: EtatRestaurant }) {
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

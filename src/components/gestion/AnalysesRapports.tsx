"use client";

// Analyses des Rapports (vague 3, bo-pilotage) : plats et catégories, carte de chaleur, zones et clients,
// livreurs. Tout vient de GET /api/gestion/pilotage/analyses (pilotage_analyses et stats_livreurs) : rien n'est
// recalculé ici, sauf des parts en pour cent et des moyennes par jour pour l'affichage.
import { useCallback, useEffect, useRef, useState } from "react";
import { CarteChiffre, Chargement, EtatErreur, EtatVide, montant, nombre, type Periode } from "@/components/gestion/ui";
import type { Analyses, Service } from "@/lib/pilotage";

export type PartieAnalyses = "plats" | "heures" | "zones" | "livreurs";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const pourcent = (part: number, tout: number) => (tout ? `${Math.round((part / tout) * 100)} %` : "0 %");

export function AnalysesRapports({ periode, service, partie }: { periode: Periode; service: Service | null; partie: PartieAnalyses }) {
  const [donnees, setDonnees] = useState<Analyses | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const demande = useRef(0);

  const charger = useCallback(async () => {
    const n = ++demande.current;
    setErreur(null);
    setDonnees(null);
    const q = new URLSearchParams({ periode: "choisie", debut: periode.debut, fin: periode.fin });
    if (service) q.set("service", service);
    try {
      const r = await fetch(`/api/gestion/pilotage/analyses?${q}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (n !== demande.current) return;
      if (!r.ok) throw new Error(String((d as { erreur?: string }).erreur ?? "Les analyses ne répondent pas."));
      setDonnees(d as Analyses);
    } catch (e) {
      if (n !== demande.current) return;
      setErreur(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Pas de connexion. Vérifiez le réseau et réessayez.");
    }
  }, [periode, service]);

  useEffect(() => {
    charger();
  }, [charger]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!donnees) return <Chargement lignes={6} libelle="Calcul des analyses…" />;
  if (partie === "plats") return <Plats a={donnees} />;
  if (partie === "heures") return <Heures a={donnees} />;
  if (partie === "zones") return <ZonesClients a={donnees} />;
  return <Livreurs a={donnees} service={service} />;
}

function Plats({ a }: { a: Analyses }) {
  const [tout, setTout] = useState(false);
  if (a.plats.length === 0) return <EtatVide titre="Aucun plat vendu sur cette période." texte="Choisissez une autre période ou un autre service." />;
  const liste = tout ? a.plats : a.plats.slice(0, 20);
  return (
    <div className="rap-deux">
      <section aria-labelledby="ana-plats">
        <h2 id="ana-plats">Ventes par plat</h2>
        <p className="aide">Lignes vendues, suppléments compris, sans les frais de livraison. Les mieux vendus d&apos;abord.</p>
        <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="ana-plats">
        <table className="rap-table">
          <thead>
            <tr>
              <th scope="col">Plat</th>
              <th scope="col" className="rap-nb">Quantité</th>
              <th scope="col" className="rap-nb">CHF</th>
              <th scope="col" className="rap-nb">Part</th>
            </tr>
          </thead>
          <tbody>
            {liste.map((p) => (
              <tr key={p.slug}>
                <td>
                  {p.nom}
                  <span className="ana-discret">, {p.categorie}</span>
                </td>
                <td className="rap-nb">{nombre(p.qte)}</td>
                <td className="rap-nb">{montant(p.ttc_centimes)}</td>
                <td className="rap-nb">{pourcent(p.ttc_centimes, a.ventes_plats_centimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {a.plats.length > 20 && (
          <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit ana-plus" onClick={() => setTout(!tout)}>
            {tout ? "Afficher les 20 premiers" : `Afficher les ${a.plats.length} plats`}
          </button>
        )}
      </section>
      <section aria-labelledby="ana-categories">
        <h2 id="ana-categories">Par catégorie</h2>
        <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="ana-categories">
        <table className="rap-table">
          <thead>
            <tr>
              <th scope="col">Catégorie</th>
              <th scope="col" className="rap-nb">Quantité</th>
              <th scope="col" className="rap-nb">CHF</th>
              <th scope="col" className="rap-nb">Part</th>
            </tr>
          </thead>
          <tbody>
            {a.categories.map((c) => (
              <tr key={c.categorie}>
                <td>{c.categorie}</td>
                <td className="rap-nb">{nombre(c.qte)}</td>
                <td className="rap-nb">{montant(c.ttc_centimes)}</td>
                <td className="rap-nb">{pourcent(c.ttc_centimes, a.ventes_plats_centimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

// Carte de chaleur : commandes en moyenne par jour, pour chaque jour de la semaine et heure de service.
// Une seule teinte (béton), du papier au béton sombre en cinq marches ; le nombre est écrit dans chaque case.
function Heures({ a }: { a: Analyses }) {
  if (a.heures.length === 0) return <EtatVide titre="Aucune commande sur cette période." texte="Choisissez une autre période ou un autre service." />;
  const heures = [...new Set(a.heures.map((h) => h.heure))].sort((x, y) => x - y);
  const debut = heures[0];
  const fin = heures[heures.length - 1];
  const plage = Array.from({ length: fin - debut + 1 }, (_, i) => debut + i);
  const moyenne = (j: number, h: number) => {
    const c = a.heures.find((x) => x.jour === j && x.heure === h);
    return c && c.jours ? c.commandes / c.jours : 0;
  };
  const max = Math.max(...a.heures.map((c) => (c.jours ? c.commandes / c.jours : 0)), 0.0001);
  const marche = (v: number) => (v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  const pointe = a.heures.reduce((m, c) => ((c.jours ? c.commandes / c.jours : 0) > (m.jours ? m.commandes / m.jours : 0) ? c : m), a.heures[0]);
  return (
    <section aria-labelledby="ana-heures">
      <h2 id="ana-heures">Quand les commandes arrivent</h2>
      <p className="aide">
        Commandes en moyenne par jour, à l&apos;heure de service (heure promise, sinon heure de commande). Pointe : {JOURS[pointe.jour].toLowerCase()} de {pointe.heure}h à {pointe.heure + 1}h, {nombre(pointe.jours ? pointe.commandes / pointe.jours : 0)} commandes en moyenne.
      </p>
      <div className="ana-chaleur-cadre" tabIndex={0} role="region" aria-labelledby="ana-heures">
        <table className="ana-chaleur">
          <caption className="sr-only">Commandes en moyenne par jour de la semaine et par heure</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Jour</span>
              </th>
              {plage.map((h) => (
                <th key={h} scope="col">
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <tr key={j}>
                <th scope="row">{JOURS[j]}</th>
                {plage.map((h) => {
                  const v = moyenne(j, h);
                  return (
                    <td key={h} data-marche={marche(v)} title={`${JOURS[j]} ${h}h : ${v.toFixed(1)} commandes en moyenne`}>
                      {v === 0 ? "" : v < 10 ? v.toFixed(1) : nombre(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ana-legende" aria-hidden="true">
        Moins <span data-marche="1" /> <span data-marche="2" /> <span data-marche="3" /> <span data-marche="4" /> <span data-marche="5" /> Plus
      </p>
    </section>
  );
}

function ZonesClients({ a }: { a: Analyses }) {
  const c = a.clients;
  return (
    <div className="ana-pile">
      <section aria-labelledby="ana-clients">
        <h2 id="ana-clients">Nouveaux clients et fidèles</h2>
        <div className="bo-chiffres">
          <CarteChiffre libelle="Clients" valeur={nombre(c.clients)} aide={`${nombre(c.revenus_dans_la_periode)} ont commandé au moins deux fois sur la période.`} />
          <CarteChiffre libelle="Nouveaux" valeur={nombre(c.nouveaux)} aide={`${nombre(c.nouveaux_commandes)} commandes, CHF ${montant(c.nouveaux_ttc_centimes)}`} />
          <CarteChiffre libelle="Fidèles" valeur={nombre(c.fideles)} aide={`${nombre(c.fideles_commandes)} commandes, CHF ${montant(c.fideles_ttc_centimes)}`} />
        </div>
        <p className="aide">Un client est reconnu à son adresse e-mail. Nouveau : aucune commande avant la période. Aucun nom ne sort de la base.</p>
      </section>
      <section aria-labelledby="ana-zones">
        <h2 id="ana-zones">Livraisons par zone</h2>
        {a.zones.length === 0 ? (
          <p className="aide">Aucune livraison sur la période.</p>
        ) : (
          <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="ana-zones">
          <table className="rap-table">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col" className="rap-nb">Commandes</th>
                <th scope="col" className="rap-nb">CHF</th>
                <th scope="col" className="rap-nb">Frais encaissés</th>
                <th scope="col" className="rap-nb">Panier moyen</th>
              </tr>
            </thead>
            <tbody>
              {a.zones.map((z) => (
                <tr key={z.zone ?? "sans"}>
                  <td>{z.zone === null ? "Sans zone" : (z.nom ?? `Zone ${z.zone}`)}</td>
                  <td className="rap-nb">{nombre(z.commandes)}</td>
                  <td className="rap-nb">{montant(z.ttc_centimes)}</td>
                  <td className="rap-nb">{montant(z.frais_centimes)}</td>
                  <td className="rap-nb">{montant(z.panier_moyen_centimes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Livreurs({ a, service }: { a: Analyses; service: Service | null }) {
  const l = a.livreurs ?? [];
  return (
    <section aria-labelledby="ana-livreurs">
      <h2 id="ana-livreurs">Livreurs</h2>
      <p className="aide">
        Chiffres de la rubrique Livreurs, sur toute la journée{service ? " (le choix du service ne s'applique pas ici)" : ""}. Temps : du départ à la livraison. Retard : après l&apos;heure promise.
      </p>
      {l.length === 0 ? (
        <p className="aide">Aucune livraison attribuée sur la période.</p>
      ) : (
        <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="ana-livreurs">
        <table className="rap-table">
          <thead>
            <tr>
              <th scope="col">Livreur</th>
              <th scope="col" className="rap-nb">Livraisons</th>
              <th scope="col" className="rap-nb">Livrées</th>
              <th scope="col" className="rap-nb">Client absent</th>
              <th scope="col" className="rap-nb">Problèmes</th>
              <th scope="col" className="rap-nb">Temps moyen</th>
              <th scope="col" className="rap-nb">Retard moyen</th>
            </tr>
          </thead>
          <tbody>
            {l.map((x) => (
              <tr key={x.livreur_id}>
                <td>
                  {x.nom}
                  {!x.actif && <span className="ana-discret">, retiré</span>}
                </td>
                <td className="rap-nb">{nombre(x.livraisons)}</td>
                <td className="rap-nb">{nombre(x.livrees)}</td>
                <td className="rap-nb">{nombre(x.client_absent)}</td>
                <td className="rap-nb">{nombre(x.problemes)}</td>
                <td className="rap-nb">{x.minutes_moyennes === null ? "" : `${Math.round(x.minutes_moyennes)} min`}</td>
                <td className="rap-nb">{x.retard_moyen_minutes === null ? "" : `${Math.round(x.retard_moyen_minutes)} min`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

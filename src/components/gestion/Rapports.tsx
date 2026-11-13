"use client";

// Rapports du back-office (vague 3, bo-pilotage) : le tableau des ventes d'une période, comparé à la période
// d'avant. Tous les chiffres viennent de la base (pilotage_ventes, docs/pilotage.md) : rien n'est recalculé ici.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CarteChiffre,
  Chargement,
  EtatErreur,
  EtatVide,
  SelecteurPeriode,
  documentCsv,
  dureeJours,
  montant,
  nombre,
  periodeComparaison,
  periodeDe,
  nomFichierCsv,
  Onglets,
  telechargerCsv,
  type Periode,
} from "@/components/gestion/ui";
import { jourGeneveDe } from "@/lib/heures";
import type { Service, Synthese, TableauVentes } from "@/lib/pilotage";
import { jourTexte } from "@/lib/service";
import { AnalysesRapports, type PartieAnalyses } from "./AnalysesRapports";
import "./rapports.css";

const ONGLETS = [
  { cle: "ventes", titre: "Ventes" },
  { cle: "plats", titre: "Plats" },
  { cle: "heures", titre: "Heures" },
  { cle: "zones", titre: "Zones et clients" },
  { cle: "livreurs", titre: "Livreurs" },
];

type Jour = TableauVentes["jours"][number];

const SERVICES: { cle: Service | null; libelle: string }[] = [
  { cle: null, libelle: "Toute la journée" },
  { cle: "midi", libelle: "Midi" },
  { cle: "soir", libelle: "Soir" },
];

const court = (j: string) => `${j.slice(8, 10)}.${j.slice(5, 7)}`;
const pourcent = (part: number, tout: number) => (tout ? `${Math.round((part / tout) * 100)} %` : "0 %");

// « vendredi 6 novembre » pour un jour, « du 01.11 au 30.11 » pour une période.
function libellePeriode(p: Periode): string {
  return p.debut === p.fin ? jourTexte(p.debut) : `du ${court(p.debut)} au ${court(p.fin)}`;
}

// Ce à quoi on compare, dans une phrase : « vendredi 6 novembre », « les 7 jours d'avant ».
function libelleContre(c: Periode): string {
  const n = dureeJours(c);
  return n === 1 ? jourTexte(c.debut) : `les ${n} jours d'avant`;
}

// Haut de l'échelle arrondi pour des graduations lisibles : 23'083 francs donne 25'000.
function hautEchelle(maxCentimes: number): number {
  const francs = Math.max(1, maxCentimes / 100);
  const pas = 10 ** Math.floor(Math.log10(francs)) / 2;
  return Math.ceil(francs / pas) * pas * 100;
}

async function lire(p: Periode, comparaison: Periode, service: Service | null): Promise<TableauVentes> {
  const q = new URLSearchParams({ periode: "choisie", debut: p.debut, fin: p.fin, comp_debut: comparaison.debut, comp_fin: comparaison.fin });
  if (service) q.set("service", service);
  const r = await fetch(`/api/gestion/pilotage/ventes?${q}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String((d as { erreur?: string }).erreur ?? "Les chiffres ne répondent pas."));
  return d as TableauVentes;
}

export function Rapports() {
  const [periode, setPeriode] = useState<Periode>(() => periodeDe("7jours", jourGeneveDe(new Date())));
  const [service, setService] = useState<Service | null>(null);
  const [onglet, setOnglet] = useState("ventes");
  const [tableau, setTableau] = useState<TableauVentes | null>(null);
  const [joursAvant, setJoursAvant] = useState<Jour[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const demande = useRef(0);
  const comparaison = periodeComparaison(periode);

  const charger = useCallback(async () => {
    const n = ++demande.current;
    setErreur(null);
    setTableau(null);
    const comp = periodeComparaison(periode);
    try {
      // La période d'avant est lue une seconde fois pour avoir ses jours (traits du graphique).
      const [t, avant] = await Promise.all([lire(periode, comp, service), lire(comp, periodeComparaison(comp), service)]);
      if (n !== demande.current) return;
      setTableau(t);
      setJoursAvant(avant.jours);
    } catch (e) {
      if (n !== demande.current) return;
      setErreur(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Pas de connexion. Vérifiez le réseau et réessayez.");
    }
  }, [periode, service]);

  useEffect(() => {
    charger();
  }, [charger]);

  const contre = libelleContre(comparaison);
  const p = tableau?.periode;
  const c = tableau?.comparaison;

  return (
    <div className="rap">
      <div className="rap-filtres">
        <SelecteurPeriode valeur={periode} onChange={setPeriode} maxJours={366} libelle="Période" />
        <fieldset className="rap-service">
          <legend>Service</legend>
          {SERVICES.map((s) => (
            <label key={s.libelle} className={service === s.cle ? "rap-service-choisi" : undefined}>
              <input type="radio" name="rap-service" checked={service === s.cle} onChange={() => setService(s.cle)} />
              {s.libelle}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="aide">
        {libellePeriode(periode)}
        {service ? `, ${service === "midi" ? "le midi" : "le soir"}` : ""}, comparé {comparaison.debut === comparaison.fin ? `au ${contre}` : `aux ${dureeJours(comparaison)} jours d'avant (${libellePeriode(comparaison)})`}.
        Une commande compte au jour de service où elle est servie (jusqu&apos;à 5h du matin).
      </p>

      <Onglets onglets={ONGLETS} actif={onglet} onChange={setOnglet} libelle="Parties des rapports">
      {onglet !== "ventes" ? (
        <AnalysesRapports periode={periode} service={service} partie={onglet as PartieAnalyses} />
      ) : erreur ? (
        <EtatErreur texte={erreur} reessayer={charger} />
      ) : !p || !c ? (
        <Chargement lignes={6} libelle="Calcul des chiffres…" />
      ) : p.commandes === 0 && p.refusees.commandes === 0 ? (
        <EtatVide titre="Aucune commande sur cette période." texte="Choisissez une autre période ou un autre service." />
      ) : (
        <>
          <section aria-labelledby="rap-chiffres">
            <h2 id="rap-chiffres">L&apos;essentiel</h2>
            <div className="bo-chiffres">
              <CarteChiffre libelle="Ventes" valeur={montant(p.ttc_centimes)} unite="CHF" comparaison={{ valeur: p.ttc_centimes, reference: c.ttc_centimes, contre }} aide={`Hors TVA : CHF ${montant(p.ht_centimes)}`} />
              <CarteChiffre libelle="Commandes" valeur={nombre(p.commandes)} comparaison={{ valeur: p.commandes, reference: c.commandes, contre }} />
              <CarteChiffre libelle="Panier moyen" valeur={montant(p.panier_moyen_centimes)} unite="CHF" comparaison={{ valeur: p.panier_moyen_centimes, reference: c.panier_moyen_centimes, contre }} />
              <CarteChiffre libelle="Net après remboursements" valeur={montant(p.net_ttc_centimes)} unite="CHF" comparaison={{ valeur: p.net_ttc_centimes, reference: c.net_ttc_centimes, contre }} />
            </div>
            <div className="bo-chiffres">
              <CarteChiffre libelle="En livraison" valeur={pourcent(p.livraison.commandes, p.commandes)} aide={`${nombre(p.livraison.commandes)} commandes, frais encaissés CHF ${montant(p.frais_centimes)}`} />
              <CarteChiffre libelle="Payé en ligne" valeur={pourcent(p.en_ligne.commandes, p.commandes)} aide={`Au comptoir : ${nombre(p.comptoir.commandes)} commandes, CHF ${montant(p.comptoir.ttc_centimes)}`} />
              <CarteChiffre libelle="Refusées" valeur={nombre(p.refusees.commandes)} comparaison={{ valeur: p.refusees.commandes, reference: c.refusees.commandes, contre }} aide={`CHF ${montant(p.refusees.ttc_centimes)} non vendus${p.annulees_client?.commandes ? `. Et ${nombre(p.annulees_client.commandes)} annulée${p.annulees_client.commandes > 1 ? "s" : ""} par le client, à part` : ""}`} />
              <CarteChiffre
                libelle="Comptoir pas encore encaissé"
                valeur={nombre(p.a_encaisser)}
                aide={p.a_encaisser ? `CHF ${montant(p.a_encaisser_centimes)} à encaisser` : "Tout est encaissé."}
                lien={p.a_encaisser ? { href: "/gestion/commandes", texte: "Voir les commandes" } : undefined}
              />
            </div>
          </section>

          {tableau.jours.length > 1 && <VentesParJour jours={tableau.jours} avant={joursAvant} contre={contre} />}

          <div className="rap-deux">
            <section aria-labelledby="rap-refus">
              <h2 id="rap-refus">Pourquoi des commandes ont été refusées</h2>
              {p.refusees.motifs.length === 0 ? (
                <p className="aide">Aucun refus sur la période.</p>
              ) : (
                <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="rap-refus">
                <table className="rap-table">
                  <thead>
                    <tr>
                      <th scope="col">Motif</th>
                      <th scope="col" className="rap-nb">Commandes</th>
                      <th scope="col" className="rap-nb">CHF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.refusees.motifs.map((m) => (
                      <tr key={m.motif}>
                        <td>{m.motif}</td>
                        <td className="rap-nb">{nombre(m.commandes)}</td>
                        <td className="rap-nb">{montant(m.ttc_centimes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </section>

            <section aria-labelledby="rap-remb">
              <h2 id="rap-remb">Remboursements</h2>
              <Remboursements s={p} />
            </section>
          </div>

          <section aria-labelledby="rap-tva">
            <h2 id="rap-tva">TVA par taux</h2>
            <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="rap-tva">
            <table className="rap-table">
              <thead>
                <tr>
                  <th scope="col">Taux</th>
                  <th scope="col" className="rap-nb">Ventes TTC</th>
                  <th scope="col" className="rap-nb">Remboursé</th>
                  <th scope="col" className="rap-nb">Net TTC</th>
                  <th scope="col" className="rap-nb">TVA nette</th>
                  <th scope="col" className="rap-nb">Net hors TVA</th>
                </tr>
              </thead>
              <tbody>
                {p.tva.map((t) => (
                  <tr key={t.taux_pourcent}>
                    <td>{t.taux_pourcent} %</td>
                    <td className="rap-nb">{montant(t.ttc_centimes)}</td>
                    <td className="rap-nb">{montant(-t.rembourse_centimes)}</td>
                    <td className="rap-nb">{montant(t.net_ttc_centimes)}</td>
                    <td className="rap-nb">{montant(t.net_tva_centimes)}</td>
                    <td className="rap-nb">{montant(t.net_ht_centimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="aide">
              Pour la fiduciaire : <a href="/gestion/export">Export comptable</a>.
            </p>
          </section>
        </>
      )}
      </Onglets>
    </div>
  );
}

function Remboursements({ s }: { s: Synthese }) {
  const r = s.remboursements;
  return (
    <>
      <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="rap-remb">
      <table className="rap-table">
        <tbody>
          <tr>
            <th scope="row">Faits</th>
            <td className="rap-nb">{nombre(r.faits)}</td>
            <td className="rap-nb">CHF {montant(r.faits_centimes)}</td>
          </tr>
          <tr>
            <th scope="row">dont en ligne</th>
            <td />
            <td className="rap-nb">CHF {montant(r.faits_en_ligne_centimes)}</td>
          </tr>
          <tr>
            <th scope="row">dont rendus en espèces</th>
            <td />
            <td className="rap-nb">CHF {montant(r.faits_especes_centimes)}</td>
          </tr>
          <tr>
            <th scope="row">Pas encore confirmés par Stripe</th>
            <td className="rap-nb">{nombre(r.en_cours)}</td>
            <td className="rap-nb">CHF {montant(r.en_cours_centimes)}</td>
          </tr>
        </tbody>
      </table>
      </div>
      {r.echecs_ouverts > 0 ? (
        <p className="rap-attention" role="note">
          {nombre(r.echecs_ouverts)} remboursement{r.echecs_ouverts > 1 ? "s" : ""} en échec, tous jours confondus (CHF {montant(r.echecs_ouverts_centimes)}) : le client n&apos;a pas reçu son argent. À reprendre depuis la fiche de la commande.
        </p>
      ) : (
        <p className="aide">Aucun remboursement en échec.</p>
      )}
    </>
  );
}

// Ventes TTC par jour : barres pour la période, trait pour le jour correspondant de la période d'avant.
// Une seule échelle. Chaque barre se lit au survol, au doigt et au clavier ; le tableau donne les mêmes chiffres.
function VentesParJour({ jours, avant, contre }: { jours: Jour[]; avant: Jour[]; contre: string }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const H = 180;
  const HAUT = 12;
  const BAS = 24;
  const GAUCHE = 64;
  // Largeur fixe du dessin : le texte garde sa taille quel que soit le nombre de jours.
  const pas = Math.max(10, Math.floor(880 / jours.length));
  const L = GAUCHE + pas * jours.length + 8;
  const max = hautEchelle(Math.max(1, ...jours.map((j) => j.ttc_centimes), ...avant.map((j) => j.ttc_centimes)));
  const y = (v: number) => HAUT + (H - HAUT - BAS) * (1 - v / max);
  const graduations = [0, max / 2, max];
  const etiquettes = new Set([0, Math.floor((jours.length - 1) / 2), jours.length - 1]);
  const largeur = Math.max(2, Math.min(48, pas - 4));
  const jSurvol = survol === null ? null : jours[survol];

  function csv() {
    // Montants en francs sans séparateur de milliers : le tableur les lit comme des nombres.
    const chf = (c: number) => (c / 100).toFixed(2);
    telechargerCsv(
      nomFichierCsv("ventes par jour", jours[jours.length - 1].jour),
      documentCsv([
        ["Jour", "Commandes", "Ventes TTC CHF", "Refusées", `Ventes TTC CHF, ${contre}`],
        ...jours.map((j, i) => [j.jour, j.commandes, chf(j.ttc_centimes), j.refusees, avant[i] ? chf(avant[i].ttc_centimes) : ""]),
      ]),
    );
  }

  return (
    <section aria-labelledby="rap-jours" className="rap-jours">
      <h2 id="rap-jours">Ventes par jour</h2>
      <p className="rap-legende" aria-hidden="true">
        <span className="rap-legende-barre" /> Cette période
        <span className="rap-legende-trait" /> {contre.charAt(0).toUpperCase() + contre.slice(1)}
      </p>
      <div className="rap-graphe" tabIndex={0} role="region" aria-labelledby="rap-jours" onMouseLeave={() => setSurvol(null)}>
        <svg viewBox={`0 0 ${L} ${H}`} role="img" aria-label={`Ventes TTC par jour, ${jours.length} jours. Les chiffres sont aussi dans le tableau ci-dessous.`}>
          {graduations.map((g) => (
            <g key={g}>
              <line x1={GAUCHE} x2={L} y1={y(g)} y2={y(g)} className="rap-grille" />
              <text x={GAUCHE - 6} y={y(g) + 4} className="rap-axe" textAnchor="end">
                {montant(g).replace(/\.00$/, "")}
              </text>
            </g>
          ))}
          {jours.map((j, i) => {
            const x = GAUCHE + i * pas + (pas - largeur) / 2;
            const a = avant[i];
            return (
              <g
                key={j.jour}
                tabIndex={0}
                role="button"
                aria-label={`${jourTexte(j.jour)} : CHF ${montant(j.ttc_centimes)}, ${j.commandes} commandes${a ? ` ; ${jourTexte(a.jour)} : CHF ${montant(a.ttc_centimes)}` : ""}`}
                onMouseEnter={() => setSurvol(i)}
                onFocus={() => setSurvol(i)}
                onBlur={() => setSurvol(null)}
                onClick={() => setSurvol(i)}
                className={survol === i ? "rap-jour rap-jour-actif" : "rap-jour"}
              >
                {/* Zone de touche plus grande que la barre. */}
                <rect x={GAUCHE + i * pas} y={HAUT} width={pas} height={H - HAUT - BAS} className="rap-cible" />
                {j.ttc_centimes > 0 && <rect x={x} y={y(j.ttc_centimes)} width={largeur} height={y(0) - y(j.ttc_centimes)} rx={2} className="rap-barre" />}
                {a && <line x1={x - 1} x2={x + largeur + 1} y1={y(a.ttc_centimes)} y2={y(a.ttc_centimes)} className="rap-trait" />}
                {etiquettes.has(i) && (
                  <text x={x + largeur / 2} y={H - 6} className="rap-axe" textAnchor="middle">
                    {court(j.jour)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {jSurvol && survol !== null && (
          <div className="rap-bulle" role="status" style={{ left: `${((GAUCHE + survol * pas + pas / 2) / L) * 100}%` }}>
            <strong>{jourTexte(jSurvol.jour)}</strong>
            <span>
              CHF {montant(jSurvol.ttc_centimes)}, {nombre(jSurvol.commandes)} commande{jSurvol.commandes > 1 ? "s" : ""}
              {jSurvol.refusees ? `, ${jSurvol.refusees} refusée${jSurvol.refusees > 1 ? "s" : ""}` : ""}
            </span>
            {avant[survol] && (
              <span className="rap-bulle-avant">
                {jourTexte(avant[survol].jour)} : CHF {montant(avant[survol].ttc_centimes)}
              </span>
            )}
          </div>
        )}
      </div>
      <details className="rap-details">
        <summary>Voir le tableau jour par jour</summary>
        <div className="rap-defile" tabIndex={0} role="region" aria-labelledby="rap-jours">
        <table className="rap-table">
          <thead>
            <tr>
              <th scope="col">Jour</th>
              <th scope="col" className="rap-nb">Commandes</th>
              <th scope="col" className="rap-nb">Ventes TTC</th>
              <th scope="col" className="rap-nb">Refusées</th>
              <th scope="col" className="rap-nb">{contre}</th>
            </tr>
          </thead>
          <tbody>
            {jours.map((j, i) => (
              <tr key={j.jour}>
                <td>{jourTexte(j.jour)}</td>
                <td className="rap-nb">{nombre(j.commandes)}</td>
                <td className="rap-nb">{montant(j.ttc_centimes)}</td>
                <td className="rap-nb">{nombre(j.refusees)}</td>
                <td className="rap-nb">{avant[i] ? montant(avant[i].ttc_centimes) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={csv}>
          Télécharger ce tableau (CSV)
        </button>
      </details>
      {dureeJours({ debut: jours[0].jour, fin: jours[jours.length - 1].jour }) > 62 && (
        <p className="aide">Sur une longue période, le tableau jour par jour se lit mieux que le graphique.</p>
      )}
    </section>
  );
}

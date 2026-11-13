"use client";

// Onglet « Temps » des Rapports (vague 3, bo-pilotage) : temps réels contre temps promis. Répond à « pourquoi
// vendredi à 20h tout est parti en retard : four, cuisine ou livreurs ? ». Chiffres de pilotage_temps (base),
// rien de recalculé ici.
import { useCallback, useEffect, useRef, useState } from "react";
import { CarteChiffre, Chargement, EtatErreur, EtatVide, nombre, type Periode } from "@/components/gestion/ui";
import type { Service, TempsReels } from "@/lib/pilotage";

const POSTE = { pizza: "Four à pizza", cuisine: "Cuisine" } as const;
const min = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${String(v).replace(".", ",")} min`);
const part = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "0 %");

export function TempsRapports({ periode, service }: { periode: Periode; service: Service | null }) {
  const [t, setT] = useState<TempsReels | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const demande = useRef(0);

  const charger = useCallback(async () => {
    const n = ++demande.current;
    setErreur(null);
    setT(null);
    const q = new URLSearchParams({ periode: "choisie", debut: periode.debut, fin: periode.fin });
    if (service) q.set("service", service);
    try {
      const r = await fetch(`/api/gestion/pilotage/temps?${q}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (n !== demande.current) return;
      if (!r.ok) throw new Error(String((d as { erreur?: string }).erreur ?? "Les temps ne répondent pas."));
      setT(d as TempsReels);
    } catch (e) {
      if (n !== demande.current) return;
      setErreur(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Pas de connexion. Vérifiez le réseau et réessayez.");
    }
  }, [periode, service]);

  useEffect(() => {
    charger();
  }, [charger]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!t) return <Chargement lignes={6} libelle="Calcul des temps…" />;
  if (t.acceptation.commandes === 0) return <EtatVide titre="Aucune commande acceptée sur cette période." texte="Choisissez une autre période ou un autre service." />;

  const liv = t.ponctualite.livraison;
  const ret = t.ponctualite.retrait;
  // L'heure la plus en retard, pour la phrase d'en-tête.
  const pire = t.heures.filter((h) => h.commandes >= 3).sort((a, b) => b.en_retard / b.commandes - a.en_retard / a.commandes)[0];

  return (
    <div className="ana-pile">
      <section aria-labelledby="tps-essentiel">
        <h2 id="tps-essentiel">Temps réels contre temps promis</h2>
        {pire && pire.en_retard > 0 && (
          <p className="aide">
            Le créneau le plus en retard : {pire.heure}h, {part(pire.en_retard, pire.commandes)} des commandes après l&apos;heure promise. Four {min(pire.pizza_mediane_min) || "sans mesure"}, cuisine{" "}
            {min(pire.cuisine_mediane_min) || "sans mesure"}, route {min(pire.route_mediane_min) || "sans mesure"} (médianes).
          </p>
        )}
        <div className="bo-chiffres">
          <CarteChiffre libelle="Acceptation" valeur={min(t.acceptation.mediane_min)} aide={`Médiane ; 9 commandes sur 10 en moins de ${min(t.acceptation.p90_min)}.`} />
          {liv && (
            <CarteChiffre
              libelle="Livraisons à l'heure"
              valeur={part(liv.a_l_heure, liv.commandes)}
              aide={`${nombre(liv.en_retard)} en retard sur ${nombre(liv.commandes)}, dont ${nombre(liv.plus_de_10)} de plus de 10 min. Retard médian ${min(liv.retard_median_min)}.`}
            />
          )}
          {ret && (
            <CarteChiffre
              libelle="Retraits prêts à l'heure"
              valeur={part(ret.a_l_heure, ret.commandes)}
              aide={`${nombre(ret.en_retard)} en retard sur ${nombre(ret.commandes)}, dont ${nombre(ret.plus_de_10)} de plus de 10 min.`}
            />
          )}
          {liv?.route_mediane_min !== null && liv?.route_mediane_min !== undefined && (
            <CarteChiffre libelle="Route" valeur={min(liv.route_mediane_min)} aide="Médiane, du départ du livreur à la livraison." />
          )}
        </div>
      </section>

      <section aria-labelledby="tps-postes">
        <h2 id="tps-postes">Préparation par poste</h2>
        {t.postes.length === 0 ? (
          <p className="aide">Aucun temps de poste mesuré sur la période.</p>
        ) : (
          <table className="rap-table">
            <thead>
              <tr>
                <th scope="col">Poste</th>
                <th scope="col" className="rap-nb">Commandes</th>
                <th scope="col" className="rap-nb">Médiane</th>
                <th scope="col" className="rap-nb">9 sur 10 en moins de</th>
                <th scope="col" className="rap-nb">Heure « Prête » déduite</th>
              </tr>
            </thead>
            <tbody>
              {t.postes.map((p) => (
                <tr key={p.station}>
                  <td>{POSTE[p.station] ?? p.station}</td>
                  <td className="rap-nb">{nombre(p.commandes)}</td>
                  <td className="rap-nb">{min(p.mediane_min)}</td>
                  <td className="rap-nb">{min(p.p90_min)}</td>
                  <td className="rap-nb">{part(p.deduites, p.commandes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="aide">
          Des premiers tickets à « Prête » sur le poste. Heure déduite : le poste n&apos;a pas touché « Prête », l&apos;heure vient du statut de la commande (moins précise).
        </p>
      </section>

      <section aria-labelledby="tps-heures">
        <h2 id="tps-heures">Heure par heure</h2>
        {t.heures.length === 0 ? (
          <p className="aide">Aucune commande terminée avec une heure promise.</p>
        ) : (
          <table className="rap-table">
            <thead>
              <tr>
                <th scope="col">Heure promise</th>
                <th scope="col" className="rap-nb">Commandes</th>
                <th scope="col" className="rap-nb">En retard</th>
                <th scope="col" className="rap-nb">Four</th>
                <th scope="col" className="rap-nb">Cuisine</th>
                <th scope="col" className="rap-nb">Route</th>
              </tr>
            </thead>
            <tbody>
              {t.heures.map((h) => (
                <tr key={h.heure}>
                  <td>
                    de {h.heure}h à {h.heure === 23 ? "minuit" : `${h.heure + 1}h`}
                  </td>
                  <td className="rap-nb">{nombre(h.commandes)}</td>
                  <td className="rap-nb">
                    {nombre(h.en_retard)} ({part(h.en_retard, h.commandes)})
                  </td>
                  <td className="rap-nb">{min(h.pizza_mediane_min)}</td>
                  <td className="rap-nb">{min(h.cuisine_mediane_min)}</td>
                  <td className="rap-nb">{min(h.route_mediane_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="aide">Médianes. Une commande est en retard quand elle est prête (retrait) ou livrée (livraison) après l&apos;heure promise au client.</p>
      </section>
    </div>
  );
}

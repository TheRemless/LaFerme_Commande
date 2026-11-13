"use client";

import { useEffect, useId, useState } from "react";
import { useConfirmer, useNotifier } from "@/components/gestion/ui";
import { jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { depuisHeureGeneve, heureTexte, instantGeneve, jourTexte } from "@/lib/service";

// Dans la fiche d'une zone (rubrique Livraison et horaires) : les services où elle est livrée et la fermeture
// jusqu'à une heure (neige, livreur malade). Route /api/gestion/service, doc docs/zones-services.md.

type ZoneOps = { numero: number; nom: string; services?: ("midi" | "soir")[]; fermee_jusqu_a?: string | null; fermee_motif?: string | null };

const URL = "/api/gestion/service";

export function ZoneOperations({ zone, recharger }: { zone: ZoneOps; recharger: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const ids = useId();
  const services = zone.services ?? ["midi", "soir"];
  const fermeeJusqua = zone.fermee_jusqu_a && new Date(zone.fermee_jusqu_a).getTime() > Date.now() ? zone.fermee_jusqu_a : null;
  // À l'heure de réouverture, la fiche se redessine d'elle-même (la page ne se relit pas seule).
  const [, redessiner] = useState(0);
  useEffect(() => {
    if (!fermeeJusqua) return;
    const t = window.setTimeout(() => redessiner((n) => n + 1), Math.min(new Date(fermeeJusqua).getTime() - Date.now() + 1000, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [fermeeJusqua]);
  const [jour, setJour] = useState(() => jourGeneveDe(new Date()));
  const [heure, setHeure] = useState("21:00");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(corps: Record<string, unknown>, ok: string): Promise<boolean> {
    setEnvoi(true);
    const r = await poster(URL, corps);
    setEnvoi(false);
    if (!r.ok) {
      notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
      return false;
    }
    notifier({ texte: ok, ton: "succes" });
    await recharger();
    return true;
  }

  async function basculer(service: "midi" | "soir") {
    const suivant = services.includes(service) ? services.filter((s) => s !== service) : [...services, service];
    if (suivant.length === 0) {
      notifier({ texte: "Au moins un service. Pour ne plus livrer cette zone, décochez « Zone ouverte à la livraison ».", ton: "erreur" });
      return;
    }
    await envoyer({ type: "zone-services", numero: zone.numero, services: suivant }, `${zone.nom} : ${suivant.length === 2 ? "midi et soir" : `le ${suivant[0]} seulement`}.`);
  }

  async function fermer() {
    setErreur(null);
    const fin = depuisHeureGeneve(`${jour}T${heure}`);
    if (!fin || fin.getTime() <= Date.now()) return setErreur("Choisissez une heure à venir.");
    if (motif.trim().length < 2) return setErreur("Indiquez un motif. Le client peut le lire : jamais un nom.");
    const quand = `${jour === jourGeneveDe(new Date()) ? "" : `${jourTexte(jour)}, `}${heureTexte(instantGeneve(fin).minutes)}`;
    const ok = await confirmer({
      titre: `Fermer ${zone.nom} jusqu'à ${quand} ?`,
      texte: "Les clients de cette zone ne peuvent plus commander en livraison, même pour plus tard, jusqu'à cette heure. Le retrait reste ouvert.",
      oui: `Fermer ${zone.nom}`,
      danger: true,
    });
    if (!ok) return;
    if (await envoyer({ type: "zone-fermer", numero: zone.numero, jusqua: fin.toISOString(), motif: motif.trim() }, `${zone.nom} fermée jusqu'à ${quand}.`)) setMotif("");
  }

  return (
    <div className="bo-zone-ops">
      <fieldset className="bo-zone-services">
        <legend>Livrée</legend>
        {(["midi", "soir"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={services.includes(s) ? "bo-zone-case bo-zone-case-oui" : "bo-zone-case"}
            aria-pressed={services.includes(s)}
            disabled={envoi}
            onClick={() => basculer(s)}
          >
            {s === "midi" ? "Midi" : "Soir"}
          </button>
        ))}
      </fieldset>
      {fermeeJusqua ? (
        <div className="bo-zone-fermee" role="status">
          <p>
            <strong>Fermée jusqu&apos;à {heureTexte(instantGeneve(new Date(fermeeJusqua)).minutes)}</strong>
            {jourGeneveDe(new Date(fermeeJusqua)) !== jourGeneveDe(new Date()) ? `, ${jourTexte(jourGeneveDe(new Date(fermeeJusqua)))}` : ""}
            {zone.fermee_motif ? ` : ${zone.fermee_motif}` : ""}
          </p>
          <button
            type="button"
            className="bo-bouton bo-bouton-second"
            disabled={envoi}
            onClick={() => envoyer({ type: "zone-rouvrir", numero: zone.numero }, `${zone.nom} rouverte.`)}
          >
            Rouvrir maintenant
          </button>
        </div>
      ) : (
        <details className="bo-zone-fermer">
          <summary>Fermer cette zone pour quelques heures</summary>
          {/* Pas de <form> : la fiche de zone en est déjà un (un formulaire dans un formulaire est ignoré par le
              navigateur, et le bouton enregistrerait la zone). Entrée dans un champ ferme la zone, pas la fiche. */}
          <div
            className="bo-zone-fermer-form"
            role="group"
            aria-label={`Fermer ${zone.nom} jusqu'à une heure`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                fermer();
              }
            }}
          >
            <div className="bo-zone-fermer-champs">
              <label htmlFor={`${ids}-jour`}>Jusqu&apos;au</label>
              <input id={`${ids}-jour`} type="date" value={jour} min={jourGeneveDe(new Date())} onChange={(e) => setJour(e.target.value)} />
              <label htmlFor={`${ids}-heure`}>à</label>
              <input id={`${ids}-heure`} type="time" step={900} value={heure} onChange={(e) => setHeure(e.target.value)} />
            </div>
            <label htmlFor={`${ids}-motif`}>Motif, lu par les clients</label>
            <input id={`${ids}-motif`} value={motif} maxLength={120} placeholder="Neige" onChange={(e) => setMotif(e.target.value)} aria-describedby={erreur ? `${ids}-erreur` : undefined} />
            {erreur && (
              <p id={`${ids}-erreur`} className="aide-forte" role="alert">
                {erreur}
              </p>
            )}
            <button type="button" className="bo-bouton bo-bouton-second" disabled={envoi} onClick={fermer}>
              Fermer jusqu&apos;à cette heure
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

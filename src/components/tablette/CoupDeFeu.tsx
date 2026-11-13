"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReglagesCoupDeFeu } from "@/lib/coup-de-feu-regles";
import { heureDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { resumeCoupDeFeu } from "./rush";

// Coup de feu depuis la tablette (vague 3) : en deux gestes, choisir la durée puis confirmer l'heure de fin. Le
// reste (retard, commandes par créneau) suit les valeurs proposées du back-office. Fin en un geste.
// Bloc caché pour l'équipe de service tant que coup_de_feu_par_equipe est faux, sauf pour dire qu'un coup de feu
// lancé par le gérant est en cours.

type Applique = Partial<Record<"retard_minutes" | "livraison_fermee" | "capacite_livraisons_par_creneau" | "capacite_retraits_par_creneau", number | boolean>>;
type Etat = {
  en_cours: { debut: string; jusqua: string; applique: Applique } | null;
  defaut: ReglagesCoupDeFeu;
  autorise: boolean;
};

const DUREES = [30, 60, 120];
const duree = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);

export function CoupDeFeu({ onChange }: { onChange: () => Promise<void> }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [choix, setChoix] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const rep = await fetch("/api/tablette/coup-de-feu", { cache: "no-store" }).catch(() => null);
    if (rep?.ok) setEtat(await rep.json());
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function agir(corps: Record<string, unknown>) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/tablette/coup-de-feu", corps);
    if (r.ok) setEtat(r.donnees as unknown as Etat);
    else setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    setChoix(null);
    await onChange();
    setEnvoi(false);
  }

  if (!etat || (!etat.autorise && !etat.en_cours)) return null;
  const d = etat.defaut;
  const e = etat.en_cours;

  return (
    <div className="tab-bloc tab-coup-de-feu">
      <h2>Coup de feu</h2>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      {e ? (
        <>
          <p aria-live="polite">
            <strong>En cours jusqu&apos;à {heureDe(e.jusqua)}.</strong>{" "}
            {resumeCoupDeFeu({
              retard: e.applique.retard_minutes as number | undefined,
              livraisons: e.applique.capacite_livraisons_par_creneau as number | undefined,
              retraits: e.applique.capacite_retraits_par_creneau as number | undefined,
              fermee: e.applique.livraison_fermee === true,
            })}
            . Tout revient seul à la fin.
          </p>
          {etat.autorise && (
            <button type="button" className="bouton-principal" disabled={envoi} onClick={() => agir({ action: "finir" })}>
              Fin du coup de feu
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            {resumeCoupDeFeu({ retard: d.retard_minutes, livraisons: d.capacite_livraison, retraits: d.capacite_retrait, fermee: d.livraison_fermee })}. Tout
            revient seul à la fin.
          </p>
          <div className="boutons-ligne" role="group" aria-label="Durée du coup de feu">
            {[...new Set([...DUREES, d.duree_minutes])]
              .sort((a, b) => a - b)
              .map((m) => (
                <button key={m} type="button" className={choix === m ? "bouton-principal" : "bouton-second"} aria-pressed={choix === m} disabled={envoi} onClick={() => setChoix(m)}>
                  {duree(m)}
                </button>
              ))}
          </div>
          {choix !== null && (
            <div className="boutons-ligne">
              <button type="button" className="bouton-principal" disabled={envoi} onClick={() => agir({ action: "lancer", ...d, duree_minutes: choix })}>
                Lancer jusqu&apos;à {heureDe(new Date(Date.now() + choix * 60_000))}
              </button>
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => setChoix(null)}>
                Annuler
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

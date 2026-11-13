"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useGardeModifications } from "@/components/gestion/ui/Garde";
import type { Reponse } from "@/lib/requete-client";

// Formulaires du back-office. Un champ = libellé visible, aide sous le libellé, erreur sous le champ,
// tout relié pour les lecteurs d'écran. useFormulaire tient les valeurs, vérifie au départ, enregistre,
// garde les saisies non enregistrées et montre « Enregistré » quelques secondes.

type PropsChamp = {
  libelle: string;
  aide?: React.ReactNode;
  erreur?: string | null;
  facultatif?: boolean;
  /** Le champ lui-même, avec les attributs à poser (id, aria-describedby, aria-invalid). */
  children: (a: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => React.ReactNode;
};

export function Champ({ libelle, aide, erreur, facultatif, children }: PropsChamp) {
  const id = useId();
  const decrit = [aide ? `${id}-aide` : "", erreur ? `${id}-erreur` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="bo-champ">
      <label htmlFor={id}>
        {libelle}
        {facultatif && <span className="bo-facultatif"> (facultatif)</span>}
      </label>
      {aide && (
        <p id={`${id}-aide`} className="bo-champ-aide">
          {aide}
        </p>
      )}
      {children({ id, "aria-describedby": decrit, "aria-invalid": erreur ? true : undefined })}
      {erreur && (
        <p id={`${id}-erreur`} className="bo-champ-erreur">
          {erreur}
        </p>
      )}
    </div>
  );
}

export type EtatEnvoi = "repos" | "envoi" | "enregistre" | "erreur";
type Erreurs<T> = Partial<Record<keyof T, string>>;

export type OptionsFormulaire<T> = {
  /** Erreurs par champ ; un objet vide veut dire « bon ». Vérifié à l'envoi puis à chaque changement. */
  valider?: (v: T) => Erreurs<T>;
  /** L'écriture (souvent poster(...)). Une réponse en erreur garde les saisies et affiche le message. */
  enregistrer: (v: T) => Promise<Reponse>;
  /** Après un enregistrement réussi (recharger la liste, notifier). */
  apres?: (r: Reponse, v: T) => void;
};

export function useFormulaire<T extends Record<string, unknown>>(initiales: T, o: OptionsFormulaire<T>) {
  const [valeurs, setValeurs] = useState<T>(initiales);
  const [reference, setReference] = useState<T>(initiales);
  const [erreurs, setErreurs] = useState<Erreurs<T>>({});
  const [etat, setEtat] = useState<EtatEnvoi>("repos");
  const [message, setMessage] = useState<string | null>(null);
  const tente = useRef(false);
  const options = useRef(o);
  options.current = o;

  // Les valeurs de départ changent (autre fiche, rechargement) : on repart d'elles.
  const cleInitiales = JSON.stringify(initiales);
  const referenceJson = useRef(cleInitiales);
  useEffect(() => {
    // Le parent recharge après un enregistrement et renvoie ce qu'on vient d'écrire : rien à remettre,
    // et « Enregistré. » reste affiché.
    if (cleInitiales === referenceJson.current) return;
    referenceJson.current = cleInitiales;
    setValeurs(JSON.parse(cleInitiales));
    setReference(JSON.parse(cleInitiales));
    setErreurs({});
    setEtat("repos");
    setMessage(null);
    tente.current = false;
  }, [cleInitiales]);

  const modifie = useMemo(() => JSON.stringify(valeurs) !== JSON.stringify(reference), [valeurs, reference]);
  useGardeModifications(modifie);

  // « Enregistré » s'efface au bout de quatre secondes, ou dès qu'on modifie.
  useEffect(() => {
    if (etat !== "enregistre") return;
    const t = setTimeout(() => setEtat("repos"), 4000);
    return () => clearTimeout(t);
  }, [etat]);

  const changer = useCallback(<K extends keyof T>(cle: K, v: T[K]) => {
    setValeurs((x) => {
      const suivant = { ...x, [cle]: v };
      if (tente.current) setErreurs(options.current.valider?.(suivant) ?? {});
      return suivant;
    });
    setEtat((e) => (e === "enregistre" ? "repos" : e));
  }, []);

  const soumettre = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      tente.current = true;
      const err = options.current.valider?.(valeurs) ?? {};
      setErreurs(err);
      if (Object.keys(err).length > 0) {
        setEtat("erreur");
        setMessage("Corrigez les champs signalés.");
        // Le focus va au premier champ faux.
        const racine = (e?.currentTarget as HTMLElement | undefined) ?? document;
        requestAnimationFrame(() => racine.querySelector<HTMLElement>('.bo-champ [aria-invalid="true"]')?.focus());
        return;
      }
      setEtat("envoi");
      setMessage(null);
      const r = await options.current.enregistrer(valeurs);
      if (!r.ok) {
        setEtat("erreur");
        setMessage(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
        return;
      }
      setReference(valeurs);
      referenceJson.current = JSON.stringify(valeurs);
      setEtat("enregistre");
      options.current.apres?.(r, valeurs);
    },
    [valeurs],
  );

  const reinitialiser = useCallback(() => {
    setValeurs(reference);
    setErreurs({});
    setEtat("repos");
    setMessage(null);
    tente.current = false;
  }, [reference]);

  return { valeurs, changer, erreurs, etat, message, modifie, soumettre, reinitialiser };
}

/** Pied d'un formulaire : « Enregistrer » (désactivé sans changement), « Annuler les changements », et l'état. */
export function BarreEnregistrer({
  etat,
  message,
  modifie,
  libelle = "Enregistrer",
  reinitialiser,
}: {
  etat: EtatEnvoi;
  message: string | null;
  modifie: boolean;
  libelle?: string;
  reinitialiser?: () => void;
}) {
  return (
    <div className="bo-barre-enregistrer">
      <button type="submit" className="bo-bouton bo-bouton-principal" disabled={etat === "envoi" || !modifie} aria-disabled={etat === "envoi" || !modifie}>
        {etat === "envoi" ? "Enregistrement…" : libelle}
      </button>
      {modifie && reinitialiser && etat !== "envoi" && (
        <button type="button" className="bo-bouton bo-bouton-discret" onClick={reinitialiser}>
          Annuler les changements
        </button>
      )}
      <p className="bo-barre-etat" role={etat === "erreur" ? "alert" : "status"} data-etat={etat}>
        {etat === "enregistre" ? "Enregistré." : etat === "erreur" ? message : modifie ? "Changements non enregistrés." : ""}
      </p>
    </div>
  );
}

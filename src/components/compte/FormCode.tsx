"use client";

import { poster } from "@/lib/requete-client";
import { useEffect, useId, useRef, useState } from "react";

// Connexion par code à 6 chiffres (8 pour le personnel). Deux départs : un e-mail tapé (page Compte), ou le jeton d'une
// commande (suivi, case « créer mon compte ») : l'e-mail est alors celui de la commande, jamais affiché ici.

// api : routes du personnel pour la tablette, celles des clients sinon.
type Props = { jeton?: string; titreBouton?: string; onConnecte: () => void; api?: { code: string; connexion: string }; chiffres?: 6 | 8 };

const API_CLIENTS = { code: "/api/compte/code", connexion: "/api/compte/connexion" };


export function FormCode({ jeton, titreBouton = "Me connecter", onConnecte, api = API_CLIENTS, chiffres = 6 }: Props) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [etape, setEtape] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [codePreversion, setCodePreversion] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champCode = useRef<HTMLInputElement>(null);
  // Bouton actif une fois la page prise en main par React. Un appui plus tôt envoyait le formulaire au
  // navigateur, qui rechargeait la page sans demander de code (vu dans les tests sur un poste chargé).
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);

  useEffect(() => {
    if (etape === "code") champCode.current?.focus();
  }, [etape]);

  async function demander(e?: React.FormEvent) {
    e?.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await poster(api.code, jeton ? { jeton } : { email });
    setEnvoi(false);
    if (!r.ok) {
      setErreur(String(r.donnees.erreur ?? "Le code n'est pas parti. Réessayez."));
      return;
    }
    setCodePreversion(typeof r.donnees.codePreversion === "string" ? r.donnees.codePreversion : null);
    setCode("");
    setEtape("code");
  }

  async function verifier(e: React.FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await poster(api.connexion, jeton ? { jeton, code } : { email, code });
    if (r.ok) {
      onConnecte();
      return;
    }
    setEnvoi(false);
    setErreur(String(r.donnees.erreur ?? "Code incorrect ou expiré."));
    champCode.current?.focus();
  }

  const alerte = erreur && (
    <p className="panier-alerte" role="alert">
      {erreur}
    </p>
  );

  if (etape === "email") {
    return (
      <form className="form-code" onSubmit={demander}>
        {!jeton && (
          <div className="champ">
            <label htmlFor={`${ids}-email`}>E-mail</label>
            <input
              id={`${ids}-email`}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={120}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
        {alerte}
        <button type="submit" className="bouton-principal" disabled={!pret || envoi || (!jeton && email.trim().length < 5)}>
          {envoi ? "Un instant…" : "Recevoir un code"}
        </button>
      </form>
    );
  }

  return (
    <form className="form-code" onSubmit={verifier}>
      <p className="aide-forte" role="status">
        {jeton ? "Code envoyé à l'e-mail de la commande." : `Code envoyé à ${email.trim().toLowerCase()}.`} Il est valable 10 minutes.
      </p>
      {codePreversion && (
        <p className="note-preversion">
          Préversion : aucun e-mail ne part. Votre code est <strong>{codePreversion}</strong>.
        </p>
      )}
      <div className="champ">
        <label htmlFor={`${ids}-code`}>Code à {chiffres} chiffres</label>
        <input
          ref={champCode}
          id={`${ids}-code`}
          className={chiffres === 8 ? "saisie-code saisie-code-8" : "saisie-code"}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern={`[0-9]{${chiffres}}`}
          maxLength={chiffres}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, chiffres))}
        />
      </div>
      {alerte}
      <button type="submit" className="bouton-principal" disabled={envoi || code.length !== chiffres}>
        {envoi ? "Un instant…" : titreBouton}
      </button>
      <div className="liens-code">
        <button type="button" className="lien" onClick={() => demander()} disabled={envoi}>
          Renvoyer un code
        </button>
        {!jeton && (
          <button
            type="button"
            className="lien"
            onClick={() => {
              setEtape("email");
              setErreur(null);
            }}
          >
            Changer d&apos;e-mail
          </button>
        )}
      </div>
    </form>
  );
}

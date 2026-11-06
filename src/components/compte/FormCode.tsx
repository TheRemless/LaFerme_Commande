"use client";

import { useEffect, useId, useRef, useState } from "react";

// Connexion par code à 6 chiffres. Deux départs : un e-mail tapé (page Compte), ou le jeton d'une
// commande (suivi, case « créer mon compte ») : l'e-mail est alors celui de la commande, jamais affiché ici.

type Props = { jeton?: string; titreBouton?: string; onConnecte: () => void };

async function poster(url: string, corps: unknown): Promise<{ ok: boolean; donnees: Record<string, unknown> }> {
  try {
    const rep = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    return { ok: rep.ok, donnees: (await rep.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, donnees: { erreur: "Pas de connexion. Vérifiez le réseau et réessayez." } };
  }
}

export function FormCode({ jeton, titreBouton = "Me connecter", onConnecte }: Props) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [etape, setEtape] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [codePreversion, setCodePreversion] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (etape === "code") champCode.current?.focus();
  }, [etape]);

  async function demander(e?: React.FormEvent) {
    e?.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await poster("/api/compte/code", jeton ? { jeton } : { email });
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
    const r = await poster("/api/compte/connexion", jeton ? { jeton, code } : { email, code });
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
        <button type="submit" className="bouton-principal" disabled={envoi || (!jeton && email.trim().length < 5)}>
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
        <label htmlFor={`${ids}-code`}>Code à 6 chiffres</label>
        <input
          ref={champCode}
          id={`${ids}-code`}
          className="saisie-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>
      {alerte}
      <button type="submit" className="bouton-principal" disabled={envoi || code.length !== 6}>
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

"use client";

import { useEffect, useId, useState } from "react";
import { LIBELLES_COMPTES, ROLES_COMPTES, type PlanComptes, type RoleCompte } from "@/lib/export-cresus";
import { jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import "./export.css";

type Format = "commandes" | "jours" | "cresus";
const FORMATS: [Format, string, string][] = [
  ["commandes", "Une ligne par commande", "Fichier CSV pour un tableur, puis le total par taux de TVA."],
  ["jours", "Une ligne par jour", "Fichier CSV : ventes, remboursements et TVA de chaque jour."],
  ["cresus", "Écritures pour Crésus", "Fichier texte à importer dans Crésus Comptabilité, avec le plan de comptes ci-dessous."],
];

const AIDES: Partial<Record<RoleCompte, string>> = {
  caisse: "Espèces au comptoir, et commandes au comptoir dont le moyen n'a pas été noté.",
  stripe: "Paiements en ligne. Le site ne distingue pas TWINT des cartes : Stripe verse les deux ensemble.",
  ventes: "Ventes hors TVA, à 2,6 % (à l'emporter et livraison).",
  livraison: "Frais de livraison hors TVA.",
  remboursements: "Remboursements faits aux clients, hors TVA.",
};

// Export comptable : ventes par commande ou par jour (CSV), écritures pour Crésus, et le plan de comptes.
export function GestionExport() {
  const auj = jourGeneveDe(new Date());
  const [debut, setDebut] = useState(`${auj.slice(0, 7)}-01`);
  const [fin, setFin] = useState(auj);
  const [format, setFormat] = useState<Format>("commandes");
  const [erreur, setErreur] = useState<string | null>(null);
  const ids = useId();

  // Par requête : une période invalide ou une session terminée affiche un message, pas un faux fichier.
  async function telecharger() {
    setErreur(null);
    const suite = format === "commandes" ? "" : `&format=${format}`;
    try {
      const rep = await fetch(`/api/gestion/export?debut=${encodeURIComponent(debut)}&fin=${encodeURIComponent(fin)}${suite}`);
      if (!rep.ok) {
        const r = (await rep.json().catch(() => ({}))) as { erreur?: string };
        return setErreur(r.erreur ?? "Export impossible.");
      }
      const url = URL.createObjectURL(await rep.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = rep.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "la-ferme-export";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErreur("Pas de connexion. Réessayez.");
    }
  }
  return (
    <>
      <section className="ges-bloc">
        <h2>Export comptable</h2>
        <p>
          Ventes encaissées sur la période (payées en ligne ou au comptoir) et remboursements faits. Sans nom ni adresse de client. Les commandes refusées
          ou annulées n&apos;y sont pas.
        </p>
        <div className="details deux">
          <div className="champ">
            <label htmlFor="export-debut">Du</label>
            <input id="export-debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor="export-fin">Au</label>
            <input id="export-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
          </div>
        </div>
        <fieldset className="bo-export-formats">
          <legend>Fichier</legend>
          {FORMATS.map(([v, titre, aide]) => (
            <label key={v}>
              <input type="radio" name={`${ids}-format`} checked={format === v} onChange={() => setFormat(v)} aria-describedby={`${ids}-${v}`} />
              <span>
                <strong>{titre}</strong>
                <span id={`${ids}-${v}`} className="aide">
                  {aide}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="bouton-principal" onClick={telecharger}>
          {format === "cresus" ? "Télécharger pour Crésus" : "Télécharger le fichier CSV"}
        </button>
        {erreur && (
          <p className="panier-alerte" role="alert">
            {erreur}
          </p>
        )}
      </section>
      <PlanCresus />
    </>
  );
}

function PlanCresus() {
  const [plan, setPlan] = useState<PlanComptes | null>(null);
  const [comptes, setComptes] = useState<Record<RoleCompte, string> | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    fetch("/api/gestion/export/plan")
      .then((r) => (r.ok ? (r.json() as Promise<PlanComptes>) : Promise.reject()))
      .then((p) => {
        setPlan(p);
        setComptes(p.comptes);
      })
      .catch(() => setMessage({ ok: false, texte: "Plan de comptes pas lu. Rechargez la page." }));
  }, []);

  async function enregistrer(ev: React.FormEvent) {
    ev.preventDefault();
    if (!comptes) return;
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/export/plan", { comptes });
    if (r.ok) {
      const p = r.donnees as unknown as PlanComptes;
      setPlan(p);
      setComptes(p.comptes);
      setMessage({ ok: true, texte: "Plan de comptes enregistré." });
    } else {
      setMessage({ ok: false, texte: String(r.donnees.erreur ?? "Pas enregistré.") });
    }
    setEnvoi(false);
  }

  return (
    <section className="ges-bloc">
      <h2>Plan de comptes pour Crésus</h2>
      {plan && !plan.confirme && (
        <p className="bo-export-a-confirmer">
          Comptes proposés, à confirmer avec la personne qui tient la comptabilité. Ils doivent exister dans le plan comptable de Crésus, sinon l&apos;import
          les refuse.
        </p>
      )}
      <p className="aide">
        Chaque jour donne des écritures simples, un compte au débit et un au crédit : les ventes hors TVA, les frais de livraison et la TVA, par moyen
        d&apos;encaissement, puis les remboursements. Les frais de Stripe n&apos;y sont pas : ils se voient sur les versements de Stripe.
      </p>
      {comptes && (
        <form className="bo-export-plan" onSubmit={enregistrer} noValidate>
          {ROLES_COMPTES.map((r) => (
            <div className="champ" key={r}>
              <label htmlFor={`plan-${r}`}>{LIBELLES_COMPTES[r]}</label>
              <input
                id={`plan-${r}`}
                inputMode="numeric"
                maxLength={10}
                value={comptes[r]}
                onChange={(e) => setComptes({ ...comptes, [r]: e.target.value })}
                aria-describedby={AIDES[r] ? `plan-${r}-aide` : undefined}
              />
              {AIDES[r] && (
                <span id={`plan-${r}-aide`} className="aide">
                  {AIDES[r]}
                </span>
              )}
            </div>
          ))}
          <button type="submit" className="bouton-second" disabled={envoi}>
            {envoi ? "Enregistrement…" : plan?.confirme ? "Enregistrer le plan" : "Confirmer ces comptes"}
          </button>
        </form>
      )}
      {message && (
        <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
          {message.texte}
        </p>
      )}
    </section>
  );
}

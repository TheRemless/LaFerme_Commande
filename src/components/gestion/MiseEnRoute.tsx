"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { Chargement, EtatErreur, useRelecture, type Relecture } from "@/components/gestion/ui";
import type { Etape, MiseEnRoute } from "@/lib/mise-en-route-etapes";

// Mise en route (vague 3, bo-socle) : les étapes du lancement, cochées d'après l'état réel. Une seule lecture pour
// la coque (place dans le menu, nombre d'étapes restantes) et pour la page. Gérant seulement.

const Ctx = createContext<Relecture<MiseEnRoute> | null>(null);
const RELECTURE_MS = 60_000;

/** null hors du fournisseur ou quand il est éteint (responsable de service). */
export const useMiseEnRoute = () => useContext(Ctx);

export function FournisseurMiseEnRoute({ actif, children }: { actif: boolean; children: React.ReactNode }) {
  const lecture = useRelecture<MiseEnRoute>(
    async (signal) => {
      const r = await fetch("/api/gestion/mise-en-route", { cache: "no-store", signal });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    [],
    { intervalleMs: RELECTURE_MS, actif, messageErreur: "L'état de la mise en route n'a pas pu être lu." },
  );
  return <Ctx.Provider value={actif ? lecture : null}>{children}</Ctx.Provider>;
}

export function PageMiseEnRoute() {
  const lecture = useMiseEnRoute();
  const d = lecture?.donnees ?? null;
  if (!lecture) return null;
  if (!d) return lecture.erreur ? <EtatErreur texte={lecture.erreur} reessayer={lecture.recharger} /> : <Chargement lignes={6} libelle="Lecture de l'état du restaurant…" />;
  // La première étape à faire est ouverte ; les autres se déplient au besoin.
  const premiere = d.etapes.find((e) => !e.faite)?.cle;
  return (
    <div className="bo-mer">
      <div className="bo-mer-tete">
        <p className="bo-mer-compte" role="status">
          {d.finie ? "Tout est prêt pour le premier service." : `${d.faites} étape${d.faites > 1 ? "s" : ""} faite${d.faites > 1 ? "s" : ""} sur ${d.total}.`}
        </p>
        <p className="aide">Chaque étape se coche seule quand le réglage est fait. Relu toutes les minutes.</p>
        <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={lecture.recharger}>
          Relire maintenant
        </button>
      </div>
      <ol className="bo-mer-etapes">
        {d.etapes.map((e) => (
          <EtapeMiseEnRoute key={e.cle} etape={e} ouverte={e.cle === premiere} />
        ))}
      </ol>
    </div>
  );
}

function EtapeMiseEnRoute({ etape: e, ouverte }: { etape: Etape; ouverte: boolean }) {
  return (
    <li className="bo-mer-etape" data-faite={e.faite || undefined}>
      <details open={ouverte}>
        <summary>
          <span className="bo-mer-marque" aria-hidden="true">
            {e.faite ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : null}
          </span>
          <span className="bo-mer-titre">
            <strong>{e.titre}</strong>
            <span className="bo-mer-etat">
              <span className="sr-only">{e.faite ? "Fait. " : "À faire. "}</span>
              {e.etat}
            </span>
          </span>
        </summary>
        <div className="bo-mer-corps">
          <ol className="bo-mer-marche">
            {e.marche.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ol>
          {e.guide && <p className="aide">{e.guide}</p>}
          {e.liens.length > 0 && (
            <p className="bo-mer-liens">
              {e.liens.map((l) =>
                l.href.startsWith("/gestion") ? (
                  <Link key={l.href} className="bo-bouton bo-bouton-second bo-bouton-petit" href={l.href}>
                    {l.texte}
                  </Link>
                ) : (
                  <a key={l.href} className="bo-bouton bo-bouton-second bo-bouton-petit" href={l.href}>
                    {l.texte}
                  </a>
                ),
              )}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

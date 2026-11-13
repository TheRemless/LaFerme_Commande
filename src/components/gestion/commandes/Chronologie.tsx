"use client";

import { auteur, evenementTexte, heureCourte, jourCourt, type Evenement } from "@/components/gestion/commandes/libelles";

// Chronologie d'une commande : un jour par groupe, l'heure à gauche. Provisoire : bo-socle ajoute au kit une
// pièce de même forme ({ quand, titre, detail?, par? }), qui la remplacera.

export function Chronologie({ evenements }: { evenements: Evenement[] }) {
  if (evenements.length === 0) return <p className="bo-etat-texte">Rien n&apos;est encore arrivé à cette commande.</p>;
  const jours: { jour: string; lignes: Evenement[] }[] = [];
  for (const e of evenements) {
    const j = jourCourt(e.le);
    if (jours.at(-1)?.jour !== j) jours.push({ jour: j, lignes: [] });
    jours.at(-1)!.lignes.push(e);
  }
  return (
    <div className="bo-chrono">
      {jours.map((g) => (
        <section key={g.jour} aria-label={g.jour}>
          <h4 className="bo-chrono-jour">{g.jour}</h4>
          <ol className="bo-chrono-liste">
            {g.lignes.map((e, i) => {
              const t = evenementTexte(e);
              return (
                <li key={`${e.le}-${i}`}>
                  <time dateTime={e.le}>{heureCourte(e.le)}</time>
                  <div>
                    <p className="bo-chrono-titre">{t.titre}</p>
                    {t.detail && <p className="bo-chrono-detail">{t.detail}</p>}
                    {e.par && <p className="bo-chrono-par">{auteur(e.par)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

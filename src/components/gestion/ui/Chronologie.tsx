// Chronologie d'une fiche (commande, réclamation, client) : une liste datée d'événements, regroupés par jour,
// l'heure à gauche, le plus récent en haut. Pur affichage : la rubrique fournit les événements.
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { jourTexte } from "@/lib/service";

export type Evenement = {
  /** Clé stable (id en base). */
  cle: string;
  /** Instant ISO. */
  quand: string;
  titre: string;
  detail?: React.ReactNode;
  /** Qui l'a fait (« Léa », « Client », « Stripe », « Fin automatique »). */
  par?: string;
  /** Mise en avant d'un événement qui compte (refus, remboursement, réclamation). */
  important?: boolean;
};

export function Chronologie({ evenements, ordre = "recent-d-abord", vide = "Rien pour l'instant." }: { evenements: Evenement[]; ordre?: "recent-d-abord" | "ancien-d-abord"; vide?: string }) {
  if (evenements.length === 0) return <p className="aide">{vide}</p>;
  const tries = [...evenements].sort((a, b) => (ordre === "recent-d-abord" ? b.quand.localeCompare(a.quand) : a.quand.localeCompare(b.quand)));
  const jours: { jour: string; liste: Evenement[] }[] = [];
  for (const e of tries) {
    const j = jourGeneveDe(e.quand);
    if (jours.at(-1)?.jour !== j) jours.push({ jour: j, liste: [] });
    jours.at(-1)!.liste.push(e);
  }
  return (
    <div className="bo-chrono">
      {jours.map((j) => (
        <section key={j.jour} aria-label={jourTexte(j.jour)}>
          <p className="bo-chrono-jour">{jourTexte(j.jour)}</p>
          <ol>
            {j.liste.map((e) => (
              <li key={e.cle} data-important={e.important || undefined}>
                <time dateTime={e.quand}>{heureDe(e.quand)}</time>
                <div>
                  <p className="bo-chrono-titre">
                    {e.titre}
                    {e.par && <span className="bo-chrono-par">, {e.par}</span>}
                  </p>
                  {e.detail && <div className="bo-chrono-detail">{e.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

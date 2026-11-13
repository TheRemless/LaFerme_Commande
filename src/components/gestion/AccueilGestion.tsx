"use client";

import Link from "next/link";
import { useCarte } from "@/components/gestion/contexte-carte";
import { GROUPES_VISIBLES } from "@/components/gestion/navigation";
import { IconeGestion } from "@/components/gestion/ui/icones";

// Accueil du back-office. Première version (coque, vague 3) : ce qui bloque la mise en ligne et le plan
// des rubriques. Le tableau de bord du jour (service, commandes, ventes, alertes) le remplace ensuite.
export function AccueilGestion() {
  const { carte } = useCarte();
  return (
    <>
      {carte && (
        <p className={carte.bloquants > 0 ? "ges-bloquants" : "ges-ok"} role="status">
          {carte.bloquants > 0
            ? `${carte.bloquants} plat${carte.bloquants > 1 ? "s" : ""} bloque${carte.bloquants > 1 ? "nt" : ""} la mise en ligne`
            : "Rien ne bloque la mise en ligne"}
        </p>
      )}
      <p className="aide">Chaque modification est enregistrée dans le journal.</p>
      <div className="bo-plan">
        {GROUPES_VISIBLES.slice(1).map((g, i) => (
          <section key={g.titre} className="bo-plan-groupe" aria-labelledby={`bo-plan-${i}`}>
            <h2 id={`bo-plan-${i}`}>{g.titre}</h2>
            <ul>
              {g.rubriques.map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="bo-plan-lien">
                    <IconeGestion nom={r.icone} />
                    <span>
                      <strong>{r.titre}</strong>
                      <span className="bo-plan-resume">{r.resume}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

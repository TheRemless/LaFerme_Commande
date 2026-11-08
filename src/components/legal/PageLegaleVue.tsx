import type { ReactNode } from "react";
import type { PageLegale } from "@/lib/legal/types";

// Les passages entre crochets sont des informations à fournir : surlignés pour la relecture.
function avecTrous(t: string): ReactNode[] {
  return t.split(/(\[[^\]]+\])/g).map((m, i) => (m.startsWith("[") ? <mark key={i}>{m.slice(1, -1)}</mark> : m));
}

export function PageLegaleVue({ page, ebauche }: { page: PageLegale; ebauche: boolean }) {
  return (
    <article className="legal">
      {ebauche && (
        <p className="legal-ebauche" role="note">
          Ébauche à faire relire par un professionnel, pas encore en vigueur. Les passages surlignés sont à compléter.
        </p>
      )}
      <h1>{page.titre}</h1>
      <p className="aide">{page.misAJour}</p>
      {page.sections.map((s) => (
        <section key={s.titre}>
          <h2>{s.titre}</h2>
          {s.contenu.map((c, i) =>
            Array.isArray(c) ? (
              <ul key={i}>
                {c.map((x) => (
                  <li key={x}>{avecTrous(x)}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{avecTrous(c)}</p>
            ),
          )}
        </section>
      ))}
    </article>
  );
}

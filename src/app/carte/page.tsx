import { EnTete } from "@/components/EnTete";
import { Plat } from "@/components/Plat";
import { chargerCarte } from "@/lib/carte";

// La carte change dans le back-office sans redéploiement : lecture à chaque requête.
export const dynamic = "force-dynamic";

export default async function PageCarte() {
  const { categories, source } = await chargerCarte();
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const aValider = categories.some((c) => c.plats.some((p) => p.prix_a_valider));
  // Diagnostic temporaire des previews : noms (jamais valeurs) des variables Supabase reçues.
  const variablesSupabase = preversion
    ? Object.keys(process.env).filter((k) => k.includes("SUPABASE")).sort().join(",") || "aucune"
    : undefined;
  return (
    <>
      <EnTete />
      {preversion && aValider && (
        <p className="bandeau-preversion" role="note">
          Préversion : prix proposés, en attente de validation.
        </p>
      )}
      {/* data-source dit d'où vient la carte (Supabase ou base embarquée), pour vérifier une preview. */}
      <main className="page-carte" data-source={source} data-variables-supabase={variablesSupabase}>
        <nav className="cats" aria-label="Catégories">
          {categories.map((c) => (
            <a key={c.slug} href={`#${c.slug}`}>
              {c.nom}
            </a>
          ))}
        </nav>
        <div className="carte-liste">
          {categories.map((c, i) => {
            const avecPhoto = c.plats.filter((p) => p.photo);
            const sansPhoto = c.plats.filter((p) => !p.photo);
            return (
              <section key={c.slug} id={c.slug} className="categorie" aria-labelledby={`${c.slug}-titre`}>
                <h2 id={`${c.slug}-titre`}>{c.nom}</h2>
                {avecPhoto.length > 0 && (
                  <ul className="plats">
                    {avecPhoto.map((p, j) => (
                      <Plat key={p.slug} plat={p} prioritaire={i === 0 && j < 4} />
                    ))}
                  </ul>
                )}
                {sansPhoto.length > 0 && (
                  <ul className="plats plats-texte">
                    {sansPhoto.map((p) => (
                      <Plat key={p.slug} plat={p} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}

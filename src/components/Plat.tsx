import Image from "next/image";
import type { LignePlat } from "@/lib/carte";
import { prixCourt } from "@/lib/prix";

// Les pizzas s'appellent « Pizza Margherita » en base, « Margherita » à l'écran sous le titre Pizzas.
export function nomAffiche(plat: Pick<LignePlat, "nom" | "categorie_slug">): string {
  if (plat.categorie_slug !== "pizzas") return plat.nom;
  const n = plat.nom.replace(/^Pizza /, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function Plat({ plat, prioritaire }: { plat: LignePlat; prioritaire?: boolean }) {
  const epuise = plat.rupture_motif !== null;
  const nom = nomAffiche(plat);
  return (
    <li className={`plat ${plat.photo ? "a-photo" : "sans-image"} ${epuise ? "epuise" : ""}`} data-slug={plat.slug}>
      <div className="plat-carte">
        {plat.photo && (
          <span className="plat-media">
            <Image
              src={`/plats/${plat.photo}`}
              alt=""
              fill
              sizes="(min-width: 1280px) 22vw, (min-width: 900px) 28vw, 50vw"
              priority={prioritaire}
            />
          </span>
        )}
        <span className="plat-txt">
          <span className="plat-nom">{nom}</span>
          {plat.description && <span className="plat-desc">{plat.description}</span>}
          {epuise && <span className="plat-rupture">{plat.rupture_motif}</span>}
        </span>
        <span className="plat-prix">{prixCourt(plat.prix_centimes)}</span>
      </div>
    </li>
  );
}

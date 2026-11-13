// Carte de chiffre : un nombre, ce qu'il compte, et sa comparaison (« +12 % contre vendredi dernier »).
// L'écart est écrit en toutes lettres, jamais porté par la seule couleur. Aucun calcul ici : les chiffres
// viennent du serveur (bo-pilotage), la carte ne fait que les montrer.
import Link from "next/link";
import { ecartPourcent, ecartTexte } from "@/components/gestion/ui/format";

export function CarteChiffre({
  libelle,
  valeur,
  unite,
  comparaison,
  aide,
  lien,
}: {
  libelle: string;
  /** Déjà mis en forme (nombre(), montant()). */
  valeur: string;
  /** « CHF », « commandes »… */
  unite?: string;
  /** Valeurs brutes pour l'écart, et ce à quoi on compare (« vendredi dernier »). */
  comparaison?: { valeur: number; reference: number; contre: string };
  aide?: string;
  /** Le geste qui va avec (« Voir les commandes »). */
  lien?: { href: string; texte: string };
}) {
  const e = comparaison ? ecartPourcent(comparaison.valeur, comparaison.reference) : null;
  const sens = e === null ? null : e > 0 ? "hausse" : e < 0 ? "baisse" : "stable";
  return (
    <div className="bo-chiffre">
      <p className="bo-chiffre-libelle">{libelle}</p>
      <p className="bo-chiffre-valeur">
        {unite === "CHF" && <span className="bo-chiffre-unite">CHF </span>}
        {valeur}
        {unite && unite !== "CHF" && <span className="bo-chiffre-unite"> {unite}</span>}
      </p>
      {comparaison && (
        <p className="bo-chiffre-ecart" data-sens={sens ?? undefined}>
          {e === null ? `Rien ${comparaison.contre}` : `${ecartTexte(e)} contre ${comparaison.contre}`}
        </p>
      )}
      {aide && <p className="bo-chiffre-aide">{aide}</p>}
      {lien && (
        <Link className="bo-chiffre-lien" href={lien.href}>
          {lien.texte}
        </Link>
      )}
    </div>
  );
}

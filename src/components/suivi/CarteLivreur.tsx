/* eslint-disable @next/next/no-img-element -- tuiles d'un service externe, déjà à la bonne taille : pas d'optimisation Next. */
import { rayonPrecision, tuilesAutour, type PositionSuivi } from "@/lib/carte-livreur";
import { heureDe } from "@/lib/heures";

// Position du livreur au suivi, seulement pendant que la commande du client est en cours de livraison (la base
// ne renvoie rien sinon, et rien n'est dit). Rendue côté serveur, mise à jour par l'actualisation du suivi (20 s). Pas de point
// pour l'adresse du client : la carte ne montre que le livreur.
export function CarteLivreur({ position }: { position: PositionSuivi }) {
  const { tuiles, x, y } = tuilesAutour(position.lat, position.lon);
  const rayon = rayonPrecision(position.precision, position.lat);
  return (
    <figure className="carte-livreur">
      <div className="carte-livreur-cadre" role="img" aria-label="Carte du quartier, avec notre livreur au centre.">
        <div className="carte-livreur-tuiles" style={{ left: `calc(50% - ${x.toFixed(1)}px)`, top: `calc(50% - ${y.toFixed(1)}px)` }}>
          {tuiles.map((t) => (
            <img key={t.url} src={t.url} alt="" width={256} height={256} referrerPolicy="no-referrer" style={{ left: t.gauche, top: t.haut }} />
          ))}
        </div>
        {rayon !== null && <span className="carte-livreur-precision" style={{ width: rayon * 2, height: rayon * 2 }} aria-hidden="true" />}
        <span className="carte-livreur-point" aria-hidden="true" />
        <span className="carte-livreur-source">© Data: swisstopo</span>
      </div>
      <figcaption>Notre livreur est en route vers chez vous. Position relevée à {heureDe(position.le)}.</figcaption>
    </figure>
  );
}

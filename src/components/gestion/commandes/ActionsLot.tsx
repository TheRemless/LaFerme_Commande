"use client";

import { useRef, useState } from "react";
import type { LigneCommande } from "@/components/gestion/commandes/ListeCommandes";
import {
  BarreEnregistrer,
  Champ,
  montant,
  useConfirmer,
  useFormulaire,
  useNotifier,
} from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Annuler plusieurs commandes d'un coup (« on ferme plus tôt », « la cuisine ne suit plus ») : un seul motif,
// une confirmation, puis chaque commande passe par le même geste qu'une à une (agir() de la tablette :
// état revérifié, remboursement complet d'une commande payée en ligne, e-mail, ticket « ANNULÉE »).
// Une commande qui a changé entre-temps est laissée telle quelle et nommée dans le résultat.

export function AnnulerLot({
  lignes,
  fait,
}: {
  lignes: LigneCommande[];
  fait: () => void;
}) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const [refusees, setRefusees] = useState<string[]>([]);
  const echecsDernier = useRef<string[]>([]);
  const payees = lignes.filter(
    (l) => l.moyen_paiement === "en_ligne" && l.statut_paiement === "paye",
  );
  const aRembourser = payees.reduce(
    (t, l) => t + l.total_centimes - l.rembourse_centimes,
    0,
  );
  const f = useFormulaire(
    { motif: "" },
    {
      valider: (v) =>
        v.motif.trim().length >= 3
          ? {}
          : {
              motif:
                "Écrivez un motif (3 caractères au moins). Chaque client le reçoit.",
            },
      enregistrer: async (v) => {
        const ok = await confirmer({
          titre: `Annuler ${lignes.length} commande${lignes.length > 1 ? "s" : ""} ?`,
          texte: payees.length
            ? `${payees.length} payée${payees.length > 1 ? "s" : ""} en ligne, remboursée${payees.length > 1 ? "s" : ""} en entier (CHF ${montant(aRembourser)} en tout). Chaque client reçoit le motif par e-mail. Cela ne se défait pas.`
            : "Chaque client reçoit le motif par e-mail. Cela ne se défait pas.",
          oui: `Annuler ${lignes.length} commande${lignes.length > 1 ? "s" : ""}`,
          danger: true,
        });
        if (!ok)
          return {
            ok: false,
            statut: 0,
            donnees: { erreur: "Rien n'est annulé." },
          };
        const echecs: string[] = [];
        for (const l of lignes) {
          const r = await poster("/api/gestion/commandes", {
            action: "annuler",
            id: l.id,
            motif: v.motif,
            de: l.statut,
          });
          if (!r.ok) echecs.push(`n° ${l.numero}`);
        }
        echecsDernier.current = echecs;
        setRefusees(echecs);
        const n = lignes.length - echecs.length;
        if (n === 0)
          return {
            ok: false,
            statut: 409,
            donnees: {
              erreur: "Aucune n'est annulée : elles ont changé entre-temps.",
            },
          };
        return {
          ok: true,
          statut: 200,
          donnees: {
            message: `${n} commande${n > 1 ? "s" : ""} annulée${n > 1 ? "s" : ""}.`,
          },
        };
      },
      apres: (r) => {
        notifier({ texte: String(r.donnees.message), ton: "succes" });
        // Tout est passé : on ferme. Sinon on reste ouvert pour nommer celles qui ont changé.
        if (echecsDernier.current.length === 0) fait();
      },
    },
  );
  return (
    <div className="bo-fiche-sections">
      <ul className="bo-fiche-liste">
        {lignes.map((l) => (
          <li key={l.id}>
            n° {l.numero}, {l.client_prenom} {l.client_nom}, CHF{" "}
            {montant(l.total_centimes)}
          </li>
        ))}
      </ul>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ
          libelle="Motif d'annulation"
          aide="Chaque client le reçoit par e-mail, par exemple : « Nous fermons plus tôt ce soir. »"
          erreur={f.erreurs.motif}
        >
          {(a) => (
            <input
              {...a}
              maxLength={200}
              value={f.valeurs.motif}
              onChange={(e) => f.changer("motif", e.target.value)}
            />
          )}
        </Champ>
        <BarreEnregistrer
          etat={f.etat}
          message={f.message}
          modifie={f.modifie}
          reinitialiser={f.reinitialiser}
          libelle="Annuler ces commandes"
        />
      </form>
      {refusees.length > 0 && (
        <p className="bo-champ-erreur" role="alert">
          Pas annulées (elles ont changé entre-temps, rouvrez-les une à une) :{" "}
          {refusees.join(", ")}.
        </p>
      )}
    </div>
  );
}

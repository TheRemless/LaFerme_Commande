"use client";

import { useCallback, useEffect, useState } from "react";
import { jourCourt } from "@/components/gestion/commandes/libelles";
import { BarreEnregistrer, Champ, Chargement, EtatErreur, montant, useFormulaire, useNotifier } from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Cagnotte d'un client au back-office (vague 3, client-compte) : solde, historique (gagné, utilisé, expiré, retiré,
// ajusté) et ajustement manuel par le gérant, avec un motif. Tout est journalisé en base.

type Mouvement = { type: string; montant_centimes: number; numero: number | null; motif: string | null; par: string | null; cree_le: string };
type Donnees = { solde_centimes: number; expire_le: string | null; mouvements: Mouvement[] };

const TYPES: Record<string, string> = {
  gain: "Gagné",
  utilise: "Utilisé",
  rendu: "Rendu (commande annulée ou remboursée)",
  retrait: "Retiré (commande remboursée)",
  expire: "Expiré",
  ajustement: "Ajusté",
  parrainage_parrain: "Parrainage, crédit du parrain",
  parrainage_filleul: "Parrainage, bienvenue du filleul",
};

// Expiration un an plus tard : avec l'année.
function dateAvecAnnee(jour: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${jour}T12:00:00Z`));
}

export function CagnotteClient({ email, gerant }: { email: string; gerant: boolean }) {
  const [donnees, setDonnees] = useState<Donnees | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/clients/cagnotte", { action: "fiche", email });
    if (r.ok) {
      setDonnees(r.donnees as unknown as Donnees | null);
      setErreur(null);
    } else setErreur(String(r.donnees.erreur ?? "La cagnotte ne se charge pas."));
  }, [email]);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (donnees === undefined) return <Chargement />;
  if (donnees === null) return <p className="bo-etat-texte">Pas de compte pour cet e-mail : la cagnotte va avec un compte client.</p>;

  return (
    <div className="bo-fiche-sections">
      <section aria-labelledby="fcl-cagnotte">
        <h3 id="fcl-cagnotte">Solde</h3>
        <p>
          <strong>CHF {montant(donnees.solde_centimes)}</strong>
          {donnees.expire_le ? <span className="bo-champ-aide">, expire le {dateAvecAnnee(donnees.expire_le)} sans nouvelle commande</span> : null}
        </p>
      </section>
      {gerant && <Ajustement email={email} solde={donnees.solde_centimes} apres={charger} />}
      <section aria-labelledby="fcl-cagnotte-historique">
        <h3 id="fcl-cagnotte-historique">Historique</h3>
        {donnees.mouvements.length === 0 ? (
          <p className="bo-etat-texte">Rien encore.</p>
        ) : (
          <table className="bo-fiche-lignes">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Mouvement</th>
                <th scope="col" className="bo-nombre">
                  CHF
                </th>
              </tr>
            </thead>
            <tbody>
              {donnees.mouvements.map((m, i) => (
                <tr key={`${m.cree_le}-${i}`}>
                  <td>{jourCourt(m.cree_le)}</td>
                  <td>
                    {TYPES[m.type] ?? m.type}
                    {m.numero ? `, commande ${m.numero}` : ""}
                    {m.motif ? <span className="bo-champ-aide"> : {m.motif}</span> : null}
                    {m.par ? <span className="bo-champ-aide"> ({m.par})</span> : null}
                  </td>
                  <td className="bo-nombre">
                    {m.montant_centimes > 0 ? "+" : "−"}
                    {montant(Math.abs(m.montant_centimes))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Ajustement({ email, solde, apres }: { email: string; solde: number; apres: () => Promise<void> }) {
  const notifier = useNotifier();
  const f = useFormulaire(
    { sens: "ajouter", chf: "", motif: "" },
    {
      valider: (v) => {
        const c = Math.round(Number(v.chf.replace(",", ".")) * 100);
        const erreurs: Record<string, string> = {};
        if (!Number.isFinite(c) || c <= 0 || c > 10000) erreurs.chf = "De CHF 0.01 à CHF 100.";
        else if (v.sens === "retirer" && c > solde) erreurs.chf = "Le retrait dépasse le solde.";
        if (v.motif.trim().length < 3) erreurs.motif = "Écrivez pourquoi (3 caractères au moins).";
        return erreurs;
      },
      enregistrer: (v) => {
        const c = Math.round(Number(v.chf.replace(",", ".")) * 100);
        return poster("/api/gestion/clients/cagnotte", {
          action: "ajuster",
          email,
          montant_centimes: v.sens === "retirer" ? -c : c,
          motif: v.motif.trim(),
        });
      },
      apres: async (r, v) => {
        // Solde réel renvoyé par la base : une retenue pour une commande remboursée a pu jouer en même temps.
        const c = Math.round(Number(v.chf.replace(",", ".")) * 100) * (v.sens === "retirer" ? -1 : 1);
        const reel = Number(r.donnees.solde_centimes);
        const retenu = solde + c - reel;
        notifier({
          texte:
            Number.isFinite(reel) && retenu > 0
              ? `Cagnotte ajustée. Nouveau solde CHF ${montant(reel)}, dont CHF ${montant(retenu)} retenus pour une commande remboursée.`
              : "Cagnotte ajustée.",
          ton: "succes",
        });
        f.reinitialiser();
        await apres();
      },
    },
  );
  return (
    <section aria-labelledby="fcl-cagnotte-ajuster">
      <h3 id="fcl-cagnotte-ajuster">Ajuster</h3>
      <form onSubmit={f.soumettre} noValidate className="bo-fiche-form">
        <Champ libelle="Sens">
          {(a) => (
            <select {...a} value={f.valeurs.sens} onChange={(e) => f.changer("sens", e.target.value)}>
              <option value="ajouter">Ajouter</option>
              <option value="retirer">Retirer</option>
            </select>
          )}
        </Champ>
        <Champ libelle="Montant (CHF)" erreur={f.erreurs.chf}>
          {(a) => <input {...a} inputMode="decimal" value={f.valeurs.chf} onChange={(e) => f.changer("chf", e.target.value)} />}
        </Champ>
        <Champ libelle="Motif" aide="Le client le voit dans ses données s'il les demande." erreur={f.erreurs.motif}>
          {(a) => <input {...a} maxLength={200} value={f.valeurs.motif} onChange={(e) => f.changer("motif", e.target.value)} />}
        </Champ>
        <BarreEnregistrer etat={f.etat} message={f.message} modifie={f.modifie} reinitialiser={f.reinitialiser} libelle="Ajuster la cagnotte" />
      </form>
    </section>
  );
}

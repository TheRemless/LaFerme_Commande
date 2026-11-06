"use client";

import { poster } from "@/lib/requete-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { adresseTexte, type Adresse, type Details } from "@/lib/adresse";
import { lireChoix } from "@/lib/choix";
import type { Recommande } from "@/lib/comptes/recommander";
import { panierVide, remplacerPanier } from "@/lib/panier-local";
import { prixChf } from "@/lib/prix";

export type DonneesEspace = {
  compte: { email: string; prenom: string; nom: string; telephone: string };
  adresses: { id: string; adresse: Adresse; details: Partial<Details> }[];
  commandes: { id: string; numero: number; cree_le: string; mode: "livraison" | "retrait"; statut: string; total_centimes: number; jeton_suivi: string; lignes: { nom: string; qte: number }[] }[];
  sessions_actives: number;
};

const STATUTS: Record<string, string> = {
  nouvelle: "Reçue",
  acceptee: "Acceptée",
  en_preparation: "En préparation",
  prete: "Prête",
  partie: "En route",
  terminee: "Terminée",
  refusee: "Refusée",
};

function dateTexte(iso: string): string {
  return new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}


function Recommander({ commandeId }: { commandeId: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "confirmer" | "envoi" | Recommande | { erreur: string }>("repos");

  async function lancer(remplacer = false) {
    // Un panier en cours n'est jamais écrasé sans accord.
    if (!remplacer && !panierVide()) return setEtat("confirmer");
    setEtat("envoi");
    const r = await poster("/api/compte/recommander", { commande: commandeId });
    if (r.statut === 401) return router.refresh();
    if (!r.ok) return setEtat({ erreur: String(r.donnees.erreur ?? "Impossible pour le moment. Réessayez.") });
    const rec = r.donnees as unknown as Recommande;
    if (rec.lignes.length > 0) remplacerPanier(rec.lignes);
    // Rien à signaler : on part directement. Sinon on dit d'abord ce qui a changé.
    if (rec.retirees.length === 0 && rec.prix.length === 0) return router.push(lireChoix() ? "/carte" : "/");
    setEtat(rec);
  }

  if (etat === "confirmer") {
    return (
      <div className="recommande" role="status">
        <p>Votre panier contient déjà des plats. Les remplacer par cette commande&nbsp;?</p>
        <div className="boutons-ligne">
          <button type="button" className="bouton-second" onClick={() => lancer(true)}>
            Remplacer mon panier
          </button>
          <button type="button" className="lien" onClick={() => setEtat("repos")}>
            Garder mon panier
          </button>
        </div>
      </div>
    );
  }
  if (etat === "repos" || etat === "envoi") {
    return (
      <button type="button" className="bouton-second" onClick={() => lancer()} disabled={etat === "envoi"}>
        {etat === "envoi" ? "Un instant…" : "Recommander la même chose"}
      </button>
    );
  }
  if ("erreur" in etat) {
    return (
      <p className="panier-alerte" role="alert">
        {etat.erreur}
      </p>
    );
  }
  const choix = lireChoix();
  return (
    <div className="recommande" role="status">
      <ul>
        {etat.retirees.map((l, i) => (
          <li key={`r${i}`}>
            On a laissé de côté {l.nom}. {l.raison}
          </li>
        ))}
        {etat.prix.map((l, i) => (
          <li key={`p${i}`}>
            Le prix de {l.nom} est passé de {prixChf(l.avant_centimes)} à {prixChf(l.apres_centimes)}.
          </li>
        ))}
      </ul>
      {etat.lignes.length > 0 ? (
        <>
          <p>Le reste est dans votre panier.</p>
          <Link className="bouton-principal" href={choix ? "/carte" : "/"}>
            {choix ? "Voir le panier" : "Choisir livraison ou à emporter"}
          </Link>
        </>
      ) : (
        <Link className="bouton-second" href="/">
          Voir la carte du jour
        </Link>
      )}
    </div>
  );
}

export function EspaceCompte({ donnees, preversion }: { donnees: DonneesEspace; preversion: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [profil, setProfil] = useState({ prenom: donnees.compte.prenom, nom: donnees.compte.nom, telephone: donnees.compte.telephone });
  const [profilEtat, setProfilEtat] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function action(url: string, corps: unknown, ensuite: () => void) {
    setEnvoi(true);
    setErreur(null);
    const r = await poster(url, corps);
    setEnvoi(false);
    if (r.statut === 401) return router.refresh();
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Impossible pour le moment. Réessayez."));
    ensuite();
  }

  // Par fetch plutôt qu'un lien direct : une session expirée renvoie à la connexion au lieu de
  // télécharger le message d'erreur comme fichier.
  async function telecharger() {
    setEnvoi(true);
    setErreur(null);
    try {
      const rep = await fetch("/api/compte/export");
      if (rep.status === 401) return router.refresh();
      if (!rep.ok) return setErreur("Le fichier n'est pas prêt. Réessayez.");
      const nom = rep.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "la-ferme-mes-donnees.json";
      const url = URL.createObjectURL(await rep.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErreur("Pas de connexion. Vérifiez le réseau et réessayez.");
    } finally {
      setEnvoi(false);
    }
  }

  async function enregistrerProfil(e: React.FormEvent) {
    e.preventDefault();
    setProfilEtat(null);
    const r = await poster("/api/compte/profil", profil);
    if (r.statut === 401) return router.refresh();
    setProfilEtat(r.ok ? "Enregistré." : String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
  }

  const champ = (cle: keyof typeof profil) => ({
    id: `${ids}-${cle}`,
    value: profil[cle],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setProfil({ ...profil, [cle]: e.target.value }),
    required: true,
  });

  return (
    <div className="espace">
      <h1>{donnees.compte.prenom ? `Bonjour ${donnees.compte.prenom}` : "Votre compte"}</h1>
      {erreur && (
        <p className="panier-alerte" role="alert">
          {erreur}
        </p>
      )}
      <div className="espace-grille">
        <section className="espace-commandes" aria-labelledby={`${ids}-commandes`}>
          <h2 id={`${ids}-commandes`}>Vos commandes</h2>
          {donnees.commandes.length === 0 ? (
            <div className="espace-vide">
              <p>Pas encore de commande avec ce compte.</p>
              <Link className="bouton-principal" href="/">
                Commander
              </Link>
            </div>
          ) : (
            <ol className="historique">
              {donnees.commandes.map((c) => (
                <li key={c.id} className="ancienne">
                  <p className="ancienne-num" aria-hidden="true">
                    {c.numero}
                  </p>
                  <div className="ancienne-corps">
                    <h3>
                      <span className="sr-only">Commande {c.numero}, </span>
                      {dateTexte(c.cree_le)}
                    </h3>
                    <p className="ancienne-meta">
                      {c.mode === "livraison" ? "Livraison" : "À emporter"}, {STATUTS[c.statut] ?? c.statut}, {prixChf(c.total_centimes)}
                    </p>
                    <ul className="ancienne-lignes">
                      {c.lignes.map((l, i) => (
                        <li key={i}>
                          {l.qte} × {l.nom}
                        </li>
                      ))}
                    </ul>
                    <div className="ancienne-actions">
                      <Recommander commandeId={c.id} />
                      <Link className="lien" href={`/suivi/${c.jeton_suivi}`}>
                        Suivre la commande
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="espace-cote">
          <section className="espace-bloc" aria-labelledby={`${ids}-adresses`}>
            <h2 id={`${ids}-adresses`}>Vos adresses</h2>
            {donnees.adresses.length === 0 ? (
              <p className="aide">Les adresses de vos livraisons s&apos;ajoutent ici toutes seules.</p>
            ) : (
              <ul className="adresses">
                {donnees.adresses.map((a) => (
                  <li key={a.id}>
                    <span>
                      <strong>{adresseTexte(a.adresse)}</strong>
                      {a.details.sonnette && <small>Sonnette {a.details.sonnette}</small>}
                    </span>
                    <button
                      type="button"
                      className="lien"
                      disabled={envoi}
                      onClick={() => action("/api/compte/adresses", { supprimer: a.id }, () => router.refresh())}
                      aria-label={`Retirer ${adresseTexte(a.adresse)}`}
                    >
                      Retirer
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="espace-bloc" aria-labelledby={`${ids}-coord`}>
            <h2 id={`${ids}-coord`}>Vos coordonnées</h2>
            <form className="form-profil" onSubmit={enregistrerProfil}>
              <div className="champ">
                <label htmlFor={`${ids}-prenom`}>Prénom</label>
                <input {...champ("prenom")} autoComplete="given-name" maxLength={60} />
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-nom`}>Nom</label>
                <input {...champ("nom")} autoComplete="family-name" maxLength={60} />
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-telephone`}>Téléphone</label>
                <input {...champ("telephone")} type="tel" autoComplete="tel" maxLength={20} />
              </div>
              <div className="champ">
                <label htmlFor={`${ids}-email`}>E-mail</label>
                <input id={`${ids}-email`} value={donnees.compte.email} readOnly aria-describedby={`${ids}-email-aide`} />
                <p className="aide" id={`${ids}-email-aide`}>
                  Pour changer d&apos;e-mail, créez un compte avec la nouvelle adresse.
                </p>
              </div>
              <button type="submit" className="bouton-second">
                Enregistrer
              </button>
              {profilEtat && (
                <p className="aide-forte" role="status">
                  {profilEtat}
                </p>
              )}
            </form>
          </section>

          <section className="espace-bloc" aria-labelledby={`${ids}-connexion`}>
            <h2 id={`${ids}-connexion`}>Connexion</h2>
            <p className="aide">
              Connecté sur {donnees.sessions_actives} appareil{donnees.sessions_actives > 1 ? "s" : ""}.
            </p>
            <div className="boutons-ligne">
              <button type="button" className="bouton-second" disabled={envoi} onClick={() => action("/api/compte/deconnexion", {}, () => router.refresh())}>
                Me déconnecter
              </button>
              <button
                type="button"
                className="bouton-second"
                disabled={envoi}
                onClick={() => action("/api/compte/deconnexion", { partout: true }, () => router.refresh())}
              >
                Déconnecter tous mes appareils
              </button>
            </div>
          </section>

          <section className="espace-bloc" aria-labelledby={`${ids}-donnees`}>
            <h2 id={`${ids}-donnees`}>Vos données</h2>
            <p className="aide">Téléchargez dans un fichier tout ce que nous gardons sur vous.</p>
            <button type="button" className="bouton-second" disabled={envoi} onClick={telecharger}>
              Télécharger mes données
            </button>
            <div className="zone-suppression">
              <h3>Supprimer mon compte</h3>
              <p className="aide">
                Votre profil, vos adresses et vos connexions sont effacés. Les commandes déjà passées restent dans la comptabilité du restaurant, sans
                lien avec un compte.
              </p>
              <label className="option">
                <input type="checkbox" checked={confirmer} onChange={(e) => setConfirmer(e.target.checked)} />
                <span>Je veux supprimer mon compte</span>
              </label>
              <button
                type="button"
                className="bouton-supprimer"
                disabled={!confirmer || envoi}
                onClick={() => action("/api/compte/supprimer", { confirmer: true }, () => router.refresh())}
              >
                Supprimer définitivement
              </button>
            </div>
          </section>
          {preversion && <p className="note-preversion">Préversion : comptes de test, enregistrés dans la base du restaurant.</p>}
        </div>
      </div>
    </div>
  );
}

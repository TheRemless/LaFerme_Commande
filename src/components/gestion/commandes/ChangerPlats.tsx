"use client";

import { useEffect, useId, useState } from "react";
import { FichePlat } from "@/components/carte/FichePlat";
import { montant, useConfirmer, useNotifier } from "@/components/gestion/ui";
import type { Categorie, LignePlat } from "@/lib/carte";
import { nomClient } from "@/lib/nom-plat";
import type { Catalogue, LignePanier } from "@/lib/panier";
import { poster } from "@/lib/requete-client";

// Le client appelle pour changer sa commande (vague 3, bo-commandes ; décision du chef du 14.11.2026). Gérant ou
// responsable. Le serveur recalcule tout (prix de la base) et choisit ce qui est permis : à encaisser, le total
// change ; payée et moins chère, remboursement ; payée et plus chère, lien de paiement par défaut, ou complément à
// la porte ou au retrait. Jamais de débit sans l'accord du client.

export type DifferenceFiche = {
  valeur_centimes: number;
  lignes: {
    slug: string;
    nom: string;
    qte: number;
    choix: Record<string, string[]>;
    retraits: string[];
    note: string;
    total_centimes: number;
  }[];
  modifications: {
    id: string;
    statut: string;
    reglement: string;
    difference_centimes: number;
    total_centimes: number;
    par: string;
    cree_le: string;
  }[];
  complements: {
    id: string;
    montant_centimes: number;
    moyen: string;
    statut: string;
    moyen_encaissement: string | null;
    encaisse_par: string | null;
  }[];
};
type Apercu =
  | { ok: false; message: string }
  | {
      ok: true;
      valeur: number;
      total: number;
      difference: number;
      reglements: string[];
      ajouts: string[];
      retires: string[];
      paye: boolean;
    };

function nouvelleCle(): string {
  return `diff-${crypto.randomUUID()}`;
}

function cleLigne(l: LignePanier): string {
  return JSON.stringify([l.slug, l.choix, l.retraits, l.note]);
}

export function ChangerPlats({
  commande,
  statut,
  mode,
  difference,
  apres,
}: {
  commande: string;
  statut: string;
  mode: "livraison" | "retrait";
  difference: DifferenceFiche;
  apres: () => Promise<void>;
}) {
  const ids = useId();
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  const enAttente = difference.modifications.find(
    (m) => m.statut === "en_attente",
  );
  const [ouvert, setOuvert] = useState(false);
  const [carte, setCarte] = useState<{
    categories: Categorie[];
    catalogue: Catalogue;
  } | null>(null);
  const [categorie, setCategorie] = useState("");
  const [plat, setPlat] = useState<LignePlat | null>(null);
  const [lignes, setLignes] = useState<LignePanier[]>([]);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [reglement, setReglement] = useState("lien");
  const [cle, setCle] = useState(nouvelleCle);
  const [envoi, setEnvoi] = useState(false);
  const [lien, setLien] = useState<string | null>(null);

  async function ouvrir() {
    setOuvert(true);
    setLien(null);
    setCle(nouvelleCle());
    setLignes(
      difference.lignes.map((l) => ({
        slug: l.slug,
        qte: l.qte,
        choix: l.choix ?? {},
        retraits: l.retraits ?? [],
        note: l.note ?? "",
      })),
    );
    if (!carte) {
      const r = await poster("/api/gestion/commandes", { action: "carte" });
      if (r.ok) {
        const d = r.donnees as {
          categories: Categorie[];
          catalogue: Catalogue;
        };
        setCarte(d);
        setCategorie(d.categories[0]?.slug ?? "");
      }
    }
  }

  // Aperçu du serveur à chaque changement : nouveau total, différence, ce qui est permis pour la payer.
  useEffect(() => {
    if (!ouvert || lignes.length === 0) {
      setApercu(null);
      return;
    }
    let annule = false;
    const t = setTimeout(async () => {
      const r = await poster("/api/gestion/commandes", {
        action: "apercu_plats",
        id: commande,
        lignes,
      });
      if (!annule) setApercu(r.donnees as Apercu);
    }, 250);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [ouvert, lignes, commande]);

  function quantite(i: number, delta: number) {
    setLignes((avant) =>
      avant.flatMap((x, j) =>
        j !== i
          ? [x]
          : x.qte + delta <= 0
            ? []
            : [{ ...x, qte: Math.min(20, x.qte + delta) }],
      ),
    );
  }

  function ajouter(l: LignePanier) {
    setLignes((avant) => {
      const i = avant.findIndex((x) => cleLigne(x) === cleLigne(l));
      return i < 0
        ? [...avant, l]
        : avant.map((x, j) =>
            j === i ? { ...x, qte: Math.min(20, x.qte + l.qte) } : x,
          );
    });
    setPlat(null);
  }

  const choisi = apercu?.ok
    ? apercu.reglements.length > 1
      ? reglement
      : apercu.reglements[0]
    : null;

  async function enregistrer() {
    if (!apercu?.ok || !choisi) return;
    const d = apercu.difference;
    const texte =
      choisi === "lien"
        ? `Un lien de paiement de CHF ${montant(d)} part au client. La modification passe en cuisine dès le paiement reçu.`
        : choisi === "porte"
          ? `CHF ${montant(d)} à encaisser à la livraison, en plus. Les ajouts partent en cuisine maintenant.`
          : choisi === "comptoir"
            ? `CHF ${montant(d)} à encaisser au retrait, en plus. Les ajouts partent en cuisine maintenant.`
            : choisi === "remboursement"
              ? `CHF ${montant(-d)} remboursés au client. Cela ne se défait pas.`
              : `Nouveau total CHF ${montant(apercu.total)}.`;
    const ok = await confirmer({
      titre: "Enregistrer la modification ?",
      texte,
      oui: "Enregistrer la modification",
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster("/api/gestion/commandes", {
      action: "modifier_plats",
      id: commande,
      cle,
      de: statut,
      lignes,
      reglement: choisi,
    });
    setEnvoi(false);
    const res = r.donnees as {
      ok?: boolean;
      message?: string;
      lien?: string;
      erreur?: string;
    };
    notifier({
      texte: res.message ?? res.erreur ?? "Pas enregistré.",
      ton: r.ok && res.ok ? "succes" : "erreur",
    });
    if (r.ok && res.ok) {
      setLien(res.lien ?? null);
      if (!res.lien) setOuvert(false);
      await apres();
    }
  }

  async function abandonner(id: string) {
    const ok = await confirmer({
      titre: "Abandonner cette modification ?",
      texte:
        "Le lien de paiement ne marchera plus. La commande reste comme avant.",
      oui: "Abandonner",
    });
    if (!ok) return;
    const r = await poster("/api/gestion/commandes", {
      action: "abandonner_modification",
      modification: id,
    });
    const res = r.donnees as { message?: string; erreur?: string };
    notifier({
      texte: res.message ?? res.erreur ?? "",
      ton: r.ok ? "succes" : "erreur",
    });
    if (r.ok) await apres();
  }

  return (
    <section aria-labelledby={`${ids}-titre`}>
      <h3 id={`${ids}-titre`}>Changer les plats</h3>
      {enAttente && (
        <div className="bo-fiche-form">
          <p>
            Lien de paiement envoyé :{" "}
            <strong>CHF {montant(enAttente.difference_centimes)}</strong> à
            payer par le client. La modification passe en cuisine dès le
            paiement reçu.
          </p>
          <button
            type="button"
            className="bo-bouton bo-bouton-second bo-bouton-petit"
            onClick={() => abandonner(enAttente.id)}
          >
            Abandonner la modification
          </button>
        </div>
      )}
      {difference.complements.length > 0 && (
        <ul className="bo-fiche-liste">
          {difference.complements.map((k) => (
            <li key={k.id}>
              Complément CHF {montant(k.montant_centimes)},{" "}
              {k.moyen === "en_ligne"
                ? "payé par le lien"
                : k.moyen === "porte"
                  ? "à la livraison"
                  : "au retrait"}
              ,{" "}
              {k.statut === "encaisse"
                ? `encaissé${k.moyen_encaissement === "especes" ? " en espèces" : k.moyen_encaissement === "carte" ? " par carte" : ""}`
                : "à encaisser"}
            </li>
          ))}
        </ul>
      )}
      {lien && (
        <div className="bo-fiche-form">
          <label htmlFor={`${ids}-lien`}>
            Lien de paiement à envoyer au client
          </label>
          <input
            id={`${ids}-lien`}
            readOnly
            value={lien}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="bo-bouton bo-bouton-second bo-bouton-petit"
            onClick={() =>
              navigator.clipboard
                ?.writeText(lien)
                .then(() => notifier({ texte: "Lien copié.", ton: "succes" }))
            }
          >
            Copier le lien
          </button>
        </div>
      )}
      {!enAttente && !ouvert && (
        <button
          type="button"
          className="bo-bouton bo-bouton-second"
          onClick={ouvrir}
        >
          Changer les plats
        </button>
      )}
      {!enAttente && ouvert && (
        <div className="bo-fiche-form">
          <ul className="bo-fiche-liste" aria-label="Plats de la commande">
            {lignes.map((l, i) => (
              <li key={cleLigne(l)} className="bo-plat-ligne">
                <span>
                  {nomClient(
                    carte?.catalogue.plats[l.slug]?.nom ??
                      difference.lignes.find((x) => x.slug === l.slug)?.nom ??
                      l.slug,
                    carte?.catalogue.plats[l.slug]?.station === "pizza",
                  )}
                  {Object.values(l.choix).flat().length > 0 && (
                    <span className="bo-champ-aide">
                      {" "}
                      {Object.values(l.choix).flat().join(", ")}
                    </span>
                  )}
                  {l.retraits.length > 0 && (
                    <span className="bo-champ-aide">
                      {" "}
                      sans {l.retraits.join(", ")}
                    </span>
                  )}
                </span>
                <span className="bo-plat-qte">
                  <button
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    aria-label={`Un de moins : ${l.slug}`}
                    onClick={() => quantite(i, -1)}
                  >
                    −
                  </button>
                  <span>{l.qte}</span>
                  <button
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    aria-label={`Un de plus : ${l.slug}`}
                    onClick={() => quantite(i, 1)}
                  >
                    +
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {carte && (
            <>
              <div
                className="bo-filtres-ligne"
                role="group"
                aria-label="Ajouter un plat"
              >
                {carte.categories.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    className="bo-bouton bo-bouton-second bo-bouton-petit"
                    aria-pressed={categorie === c.slug}
                    onClick={() => setCategorie(c.slug)}
                  >
                    {c.nom}
                  </button>
                ))}
              </div>
              <ul className="bo-fiche-liste bo-plats-choix">
                {(
                  carte.categories.find((c) => c.slug === categorie)?.plats ??
                  []
                ).map((p) => (
                  <li key={p.slug}>
                    <button
                      type="button"
                      className="bo-bouton bo-bouton-discret bo-bouton-petit"
                      onClick={() => setPlat(p)}
                    >
                      + {nomClient(p.nom, p.categorie_slug === "pizzas")}, CHF{" "}
                      {montant(p.prix_centimes)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {apercu && !apercu.ok && (
            <p className="bo-champ-erreur" role="alert">
              {apercu.message}
            </p>
          )}
          {apercu?.ok && (
            <>
              <p>
                Avant CHF {montant(apercu.valeur)}, après CHF{" "}
                {montant(apercu.total)}
                {apercu.difference !== 0 &&
                  `, différence ${apercu.difference > 0 ? "+" : "−"}CHF ${montant(Math.abs(apercu.difference))}`}
                .
              </p>
              {apercu.reglements.length > 1 ? (
                <fieldset className="bo-fiche-form">
                  <legend>Le client paie la différence</legend>
                  {apercu.reglements.map((r) => (
                    <label key={r}>
                      <input
                        type="radio"
                        name={`${ids}-reglement`}
                        value={r}
                        checked={reglement === r}
                        onChange={() => setReglement(r)}
                      />{" "}
                      {r === "lien"
                        ? "Par un lien de paiement (e-mail, ou à lui envoyer)"
                        : r === "porte"
                          ? "À la livraison, en espèces ou par carte"
                          : "Au retrait, en espèces ou par carte"}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="bo-champ-aide">
                  {apercu.reglements[0] === "remboursement"
                    ? `CHF ${montant(-apercu.difference)} seront remboursés au client.`
                    : apercu.paye
                      ? "Même montant : rien à payer ni à rembourser."
                      : `Nouveau total à encaisser ${mode === "livraison" ? "à la livraison" : "au retrait"} : CHF ${montant(apercu.total)}.`}
                </p>
              )}
            </>
          )}
          <div className="bo-fiche-boutons">
            <button
              type="button"
              className="bo-bouton bo-bouton-principal"
              disabled={!apercu?.ok || envoi}
              onClick={enregistrer}
            >
              Enregistrer la modification
            </button>
            <button
              type="button"
              className="bo-bouton bo-bouton-discret"
              onClick={() => setOuvert(false)}
            >
              Fermer sans changer
            </button>
          </div>
        </div>
      )}
      {plat && carte && (
        <FichePlat
          plat={plat}
          catalogue={carte.catalogue}
          preversion={false}
          onAjouter={ajouter}
          onFermer={() => setPlat(null)}
        />
      )}
    </section>
  );
}

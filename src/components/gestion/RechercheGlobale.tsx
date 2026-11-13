"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GROUPES_VISIBLES, type Rubrique } from "@/components/gestion/navigation";
import { IconeGestion, montant, Touches, useDiffere, useRaccourci } from "@/components/gestion/ui";
import { demanderOuverture, type CibleOuverture } from "@/components/gestion/ui/ouverture";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { normaliser, type ResultatsRecherche } from "@/lib/recherche-texte";
import { jourTexte } from "@/lib/service";

// Recherche globale (⌘K ou Ctrl+K, ou le bouton « Recherche » de l'en-tête) : une commande par numéro, un client
// par nom ou téléphone, un plat, une rubrique. Flèches pour choisir, Entrée pour ouvrir, Échap pour fermer.

type Choix = { id: string; groupe: string; titre: string; detail: string; aller: () => void };

const STATUTS: Record<string, string> = {
  nouvelle: "à accepter",
  acceptee: "acceptée",
  en_preparation: "en préparation",
  prete: "prête",
  partie: "partie",
  terminee: "terminée",
  refusee: "refusée",
};

export function RechercheGlobale() {
  const [ouverte, setOuverte] = useState(false);
  useRaccourci("mod+k", () => setOuverte(true), "Chercher une commande, un client, un plat");
  return (
    <>
      <button type="button" className="bo-chercher" onClick={() => setOuverte(true)} aria-haspopup="dialog">
        <IconeGestion nom="chercher" />
        <span>Recherche</span>
        <span className="bo-chercher-touches" aria-hidden="true">
          <Touches touches="mod+k" />
        </span>
      </button>
      {ouverte && <Fenetre fermer={() => setOuverte(false)} />}
    </>
  );
}

function Fenetre({ fermer }: { fermer: () => void }) {
  const router = useRouter();
  const id = useId();
  const boite = useRef<HTMLDialogElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const qd = useDiffere(q.trim(), 200);
  const [res, setRes] = useState<ResultatsRecherche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actif, setActif] = useState(0);
  const sequence = useRef(0);

  // Le focus revient où il était (le bouton « Recherche », ou le champ d'où l'on a tapé ⌘K).
  useEffect(() => {
    const retour = document.activeElement;
    const d = boite.current!;
    if (!d.open) d.showModal();
    champ.current?.focus();
    return () => {
      if (retour instanceof HTMLElement && retour.isConnected) retour.focus();
    };
  }, []);

  // La dernière frappe gagne : une réponse plus ancienne arrivée en retard est jetée.
  useEffect(() => {
    const n = ++sequence.current;
    if (qd.length < 2 && !/^\d+$/.test(qd)) {
      setRes(null);
      setErreur(null);
      return;
    }
    poster("/api/gestion/recherche", { q: qd }).then((r) => {
      if (n !== sequence.current) return;
      if (r.statut === 401) return window.location.reload();
      if (!r.ok) return setErreur(String(r.donnees.erreur ?? "La recherche n'a pas répondu. Réessayez."));
      setErreur(null);
      setRes(r.donnees as ResultatsRecherche);
      setActif(0);
    });
  }, [qd]);

  const aller = (href: string, cible?: CibleOuverture) => () => {
    if (cible) demanderOuverture(cible);
    fermer();
    router.push(href);
  };

  const choix = useMemo<Choix[]>(() => {
    const l: Choix[] = [];
    const n = normaliser(q.trim());
    const rubriques: Rubrique[] = n ? GROUPES_VISIBLES.flatMap((g) => g.rubriques).filter((r) => normaliser(`${r.titre} ${r.resume}`).includes(n)) : [];
    for (const c of res?.commandes ?? [])
      l.push({
        id: `c-${c.id}`,
        groupe: "Commandes",
        titre: `N° ${c.numero}, ${c.client}`,
        detail: `${c.mode === "livraison" ? "Livraison" : "À emporter"}, ${STATUTS[c.statut] ?? c.statut}, ${jourTexte(jourGeneveDe(c.quand))} à ${heureDe(c.quand)}, CHF ${montant(c.total_centimes)}`,
        aller: aller("/gestion/commandes", { type: "commande", cle: c.id }),
      });
    for (const c of res?.clients ?? [])
      l.push({
        id: `k-${c.email}`,
        groupe: "Clients",
        titre: c.nom,
        detail: `${c.commandes} commande${c.commandes > 1 ? "s" : ""}${c.telephone ? `, ${c.telephone}` : ""}`,
        aller: aller("/gestion/clients", { type: "client", cle: c.email }),
      });
    for (const p of res?.plats ?? [])
      l.push({ id: `p-${p.slug}`, groupe: "Plats", titre: p.nom, detail: p.rupture ? "En rupture" : "À la carte", aller: aller("/gestion/carte", { type: "plat", cle: p.slug }) });
    for (const r of rubriques.slice(0, 5)) l.push({ id: `r-${r.href}`, groupe: "Rubriques", titre: r.titre, detail: r.resume, aller: aller(r.href) });
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, q]);

  const actifSur = Math.min(actif, Math.max(choix.length - 1, 0));
  const groupes = [...new Set(choix.map((c) => c.groupe))];
  const cherche = q.trim().length > 0;

  return (
    <dialog
      ref={boite}
      className="bo-boite bo-recherche-globale"
      aria-label="Recherche dans le back-office"
      onCancel={(e) => {
        e.preventDefault();
        fermer();
      }}
      onClick={(e) => {
        if (e.target === boite.current) fermer();
      }}
    >
      <div className="bo-recherche-globale-cadre">
        <div className="bo-recherche-globale-champ">
          <IconeGestion nom="chercher" />
          <input
            ref={champ}
            type="search"
            role="combobox"
            aria-expanded={choix.length > 0}
            aria-controls={`${id}-liste`}
            aria-activedescendant={choix.length ? `${id}-${choix[actifSur].id}` : undefined}
            aria-label="Numéro de commande, nom, téléphone, plat ou rubrique"
            placeholder="Numéro, nom, téléphone, plat ou rubrique"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Échap ferme tout de suite (un champ de recherche se viderait d'abord).
              if (e.key === "Escape") {
                e.preventDefault();
                fermer();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (choix.length) setActif((actifSur + (e.key === "ArrowDown" ? 1 : -1) + choix.length) % choix.length);
              } else if (e.key === "Enter" && choix[actifSur]) {
                e.preventDefault();
                choix[actifSur].aller();
              }
            }}
          />
        </div>
        <div className="bo-recherche-globale-resultats">
          {erreur && (
            <p className="bo-champ-erreur" role="alert">
              {erreur}
            </p>
          )}
          <ul id={`${id}-liste`} role="listbox" aria-label="Résultats">
            {groupes.map((g) => (
              <li key={g} role="presentation">
                <p className="bo-recherche-groupe" aria-hidden="true">
                  {g}
                </p>
                <ul role="group" aria-label={g}>
                  {choix
                    .filter((c) => c.groupe === g)
                    .map((c) => {
                      const i = choix.indexOf(c);
                      return (
                        <li
                          key={c.id}
                          id={`${id}-${c.id}`}
                          role="option"
                          aria-selected={i === actifSur}
                          onMouseMove={() => setActif(i)}
                          onClick={c.aller}
                        >
                          <span className="bo-recherche-titre">{c.titre}</span>
                          <span className="bo-recherche-detail">{c.detail}</span>
                        </li>
                      );
                    })}
                </ul>
              </li>
            ))}
          </ul>
          <p className="bo-recherche-etat" role="status">
            {!cherche ? "Une commande par son numéro, un client par son nom ou son téléphone, un plat, une rubrique." : choix.length === 0 && res ? `Rien ne correspond à « ${q.trim()} ».` : ""}
          </p>
        </div>
      </div>
    </dialog>
  );
}

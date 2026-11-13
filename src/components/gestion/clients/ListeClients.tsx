"use client";

import { useState } from "react";
import { FicheClient } from "@/components/gestion/clients/FicheClient";
import { MARQUE } from "@/components/gestion/clients/libelles";
import { jourCourt } from "@/components/gestion/commandes/libelles";
import {
  ErreurLisible,
  montant,
  PanneauLateral,
  TableauDonnees,
  useDiffere,
  useOuverture,
  useRelecture,
  type Colonne,
  type Tri,
} from "@/components/gestion/ui";
import { poster } from "@/lib/requete-client";

// Liste des clients (vague 3, bo-commandes) : un client est un e-mail, avec ou sans compte. La base regroupe,
// trie et pagine (clients_gestion) ; la recherche et l'e-mail partent en POST, jamais dans une adresse.

export type LigneClient = {
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
  commandes: number;
  refusees: number;
  depense_centimes: number;
  panier_moyen_centimes: number | null;
  premiere_le: string;
  derniere_le: string;
  compte: boolean;
  marque: "surveiller" | "bloque" | null;
  notes: number;
};
type Page = { total: number; lignes: LigneClient[] };

const PAR_PAGE = 50;

const COLONNES: Colonne<LigneClient>[] = [
  {
    cle: "nom",
    titre: "Client",
    valeur: (l) => `${l.prenom} ${l.nom}`,
    triable: true,
    fixe: true,
  },
  { cle: "telephone", titre: "Téléphone", valeur: (l) => l.telephone },
  {
    cle: "email",
    titre: "E-mail",
    valeur: (l) => l.email,
    cacheeParDefaut: true,
  },
  {
    cle: "commandes",
    titre: "Commandes",
    valeur: (l) => l.commandes,
    triable: true,
    nombre: true,
  },
  {
    cle: "depense",
    titre: "Dépensé CHF",
    valeur: (l) => montant(l.depense_centimes),
    triable: true,
    nombre: true,
  },
  {
    cle: "panier",
    titre: "Panier moyen CHF",
    valeur: (l) =>
      l.panier_moyen_centimes ? montant(l.panier_moyen_centimes) : "",
    nombre: true,
    cacheeParDefaut: true,
  },
  {
    cle: "derniere",
    titre: "Dernière commande",
    valeur: (l) => jourCourt(l.derniere_le),
    triable: true,
  },
  {
    cle: "compte",
    titre: "Compte",
    valeur: (l) => (l.compte ? "Oui" : "Invité"),
  },
  {
    cle: "marque",
    titre: "Marque",
    valeur: (l) => (l.marque ? MARQUE[l.marque] : ""),
    cacheeParDefaut: true,
  },
  {
    cle: "refusees",
    titre: "Refusées",
    valeur: (l) => (l.refusees ? l.refusees : ""),
    nombre: true,
    cacheeParDefaut: true,
  },
  {
    cle: "notes",
    titre: "Notes",
    valeur: (l) => (l.notes ? l.notes : ""),
    nombre: true,
    cacheeParDefaut: true,
  },
];

// Le serveur trie le nom dans l'ordre alphabétique, le reste du plus grand au plus petit.
function triPermis(t: Tri): Tri {
  return { cle: t.cle, sens: t.cle === "nom" ? "asc" : "desc" };
}

export function ListeClients() {
  const [recherche, setRecherche] = useState("");
  const q = useDiffere(recherche.trim(), 300);
  const [tri, setTri] = useState<Tri>({ cle: "derniere", sens: "desc" });
  const [page, setPage] = useState(1);
  const [avecCompte, setAvecCompte] = useState(false);
  const [marque, setMarque] = useState("");
  const [inactif, setInactif] = useState("");
  // Fiche ouverte : depuis une ligne, ou depuis la recherche globale (⌘K) qui ne donne que l'e-mail.
  const [ouvert, setOuvert] = useState<{ email: string; titre: string } | null>(
    null,
  );
  useOuverture("client", (email) => setOuvert({ email, titre: "Client" }));

  const corps = (extra: Record<string, unknown> = {}) => ({
    action: "liste",
    ...(q ? { recherche: q } : {}),
    tri: tri.cle,
    ...(avecCompte ? { avec_compte: true } : {}),
    ...(marque ? { marque } : {}),
    ...(inactif ? { inactif_jours: Number(inactif) } : {}),
    page,
    par_page: PAR_PAGE,
    ...extra,
  });
  const courant = corps();
  const { donnees, erreur, chargement, recharger } = useRelecture<Page>(
    async () => {
      const r = await poster("/api/gestion/clients", courant);
      if (!r.ok)
        throw new ErreurLisible(
          String(r.donnees.erreur ?? "La liste n'a pas pu être chargée."),
        );
      return r.donnees as unknown as Page;
    },
    [courant],
    { intervalleMs: 3_600_000 },
  );

  async function toutes(): Promise<LigneClient[]> {
    const lignes: LigneClient[] = [];
    for (let p = 1; p <= 50; p += 1) {
      const r = await poster(
        "/api/gestion/clients",
        corps({ page: p, par_page: 100 }),
      );
      if (!r.ok)
        throw new Error(String(r.donnees.erreur ?? "Export impossible."));
      const d = r.donnees as unknown as Page;
      lignes.push(...d.lignes);
      if (lignes.length >= d.total || d.lignes.length === 0) break;
    }
    return lignes;
  }

  const filtresActifs = avecCompte || !!marque || !!inactif;
  return (
    <div className="bo-commandes">
      <TableauDonnees<LigneClient>
        titre="Clients"
        colonnes={COLONNES}
        lignes={donnees?.lignes ?? null}
        cleLigne={(l) => l.email}
        chargement={chargement && donnees !== null}
        erreur={erreur}
        onReessayer={recharger}
        tri={tri}
        onTri={(t) => {
          setTri(triPermis(t));
          setPage(1);
        }}
        pagination={{
          page,
          parPage: PAR_PAGE,
          total: donnees?.total ?? 0,
          onPage: setPage,
        }}
        recherche={{
          valeur: recherche,
          onChange: (v) => {
            setRecherche(v);
            setPage(1);
          },
          libelle: "Nom, téléphone ou e-mail",
        }}
        filtres={
          <div className="bo-filtres-ligne">
            <label className="bo-case">
              <input
                type="checkbox"
                checked={avecCompte}
                onChange={(e) => {
                  setAvecCompte(e.target.checked);
                  setPage(1);
                }}
              />{" "}
              Avec compte
            </label>
            <label>
              Marque
              <select
                value={marque}
                onChange={(e) => {
                  setMarque(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Toutes</option>
                <option value="surveiller">À surveiller</option>
                <option value="bloque">Bloqué</option>
              </select>
            </label>
            <label>
              Sans commande depuis
              <select
                value={inactif}
                onChange={(e) => {
                  setInactif(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Peu importe</option>
                <option value="30">30 jours</option>
                <option value="60">60 jours</option>
                <option value="90">90 jours</option>
              </select>
            </label>
          </div>
        }
        onOuvrir={(l) =>
          setOuvert({ email: l.email, titre: `${l.prenom} ${l.nom}` })
        }
        csv={{ toutes }}
        memoire="clients"
        vide={
          q || filtresActifs
            ? {
                titre: "Aucun client ne correspond.",
                texte: "Essayez un autre nom ou effacez les filtres.",
              }
            : {
                titre: "Aucun client pour l'instant.",
                texte: "Chaque client apparaît ici dès sa première commande.",
              }
        }
      />
      {ouvert && (
        <PanneauLateral
          large
          titre={ouvert.titre}
          sousTitre={ouvert.email}
          onFermer={() => setOuvert(null)}
        >
          <FicheClient email={ouvert.email} onChange={recharger} />
        </PanneauLateral>
      )}
    </div>
  );
}

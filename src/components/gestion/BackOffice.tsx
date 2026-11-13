"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FournisseurCarte, useCarte } from "@/components/gestion/contexte-carte";
import { GROUPES, rubriqueDe, type Rubrique } from "@/components/gestion/navigation";
import { IconeGestion } from "@/components/gestion/ui/icones";
import { poster } from "@/lib/requete-client";

// Coque du back-office (vague 3) : barre latérale groupée, en-tête de la rubrique, contenu.
// Large sur ordinateur, rail d'icônes sur tablette en portrait (ou au choix), tiroir sur téléphone.
// Le contrôle du gérant est fait côté serveur dans src/app/gestion/layout.tsx ; chaque API revérifie.

type Menu = "auto" | "large" | "etroit";
const CLE_MENU = "laferme.gestion.menu";

export function BackOffice({ nom, children }: { nom: string; children: React.ReactNode }) {
  return (
    <FournisseurCarte>
      <Coque nom={nom}>{children}</Coque>
    </FournisseurCarte>
  );
}

function Coque({ nom, children }: { nom: string; children: React.ReactNode }) {
  const chemin = usePathname();
  const router = useRouter();
  const { rubrique, groupe } = rubriqueDe(chemin);
  const [menu, setMenu] = useState<Menu>("auto");
  const [tiroir, setTiroir] = useState(false);
  // Ce qu'on voit vraiment : « auto » vaut large dès 1024 px, étroit en dessous (tablette en portrait).
  const [ordinateur, setOrdinateur] = useState(true);
  const large = menu === "auto" ? ordinateur : menu === "large";
  const boutonMenu = useRef<HTMLButtonElement>(null);
  const fermerTiroir = useRef<HTMLButtonElement>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  const focusApres = useRef<"tiroir" | "menu" | "titre" | null>(null);
  const [erreurSortie, setErreurSortie] = useState<string | null>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem(CLE_MENU);
      if (m === "large" || m === "etroit") setMenu(m);
    } catch {}
  }, []);

  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const suivre = () => setOrdinateur(m.matches);
    suivre();
    m.addEventListener("change", suivre);
    return () => m.removeEventListener("change", suivre);
  }, []);

  // Le tiroir se referme à chaque changement de rubrique ; le focus passe au titre de la nouvelle rubrique.
  const tiroirOuvert = useRef(false);
  tiroirOuvert.current = tiroir;
  useEffect(() => {
    if (!tiroirOuvert.current) return;
    focusApres.current = "titre";
    setTiroir(false);
  }, [chemin]);

  // Le focus suit le tiroir, une fois le rendu fait (le contenu n'est plus inerte) : dedans à l'ouverture,
  // sur « Menu » à la fermeture, sur le titre de la rubrique si on vient d'en changer. Rien au premier rendu.
  const basculerTiroir = useCallback((ouvrir: boolean) => {
    focusApres.current = ouvrir ? "tiroir" : "menu";
    setTiroir(ouvrir);
  }, []);
  useEffect(() => {
    const cible = focusApres.current;
    focusApres.current = null;
    if (cible === "tiroir") fermerTiroir.current?.focus();
    else if (cible === "menu") boutonMenu.current?.focus();
    else if (cible === "titre") titre.current?.focus();
  }, [tiroir]);

  useEffect(() => {
    if (!tiroir) return;
    const echap = (e: KeyboardEvent) => e.key === "Escape" && basculerTiroir(false);
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [tiroir, basculerTiroir]);

  function changerMenu() {
    const suivant = large ? "etroit" : "large";
    setMenu(suivant);
    try {
      localStorage.setItem(CLE_MENU, suivant);
    } catch {}
  }

  async function deconnecter() {
    setErreurSortie(null);
    const r = await poster("/api/personnel/deconnexion", {});
    if (!r.ok) return setErreurSortie(String(r.donnees.erreur ?? "Déconnexion impossible. Réessayez."));
    router.refresh();
  }

  return (
    <div className="bo" data-menu={menu} data-tiroir={tiroir ? "ouvert" : undefined}>
      <aside className="bo-cote" id="bo-menu" aria-label="Menu du back-office">
        <div className="bo-marque">
          <span className="bo-marque-nom">La Ferme</span>
          <span className="bo-marque-sous">Back-office</span>
          <button ref={fermerTiroir} type="button" className="bo-tiroir-fermer" onClick={() => basculerTiroir(false)} aria-label="Fermer le menu">
            <IconeGestion nom="fermer" />
          </button>
        </div>
        <nav className="bo-nav" aria-label="Rubriques">
          {GROUPES.map((g) => (
            <div key={g.titre} className="bo-groupe">
              <p className="bo-groupe-titre">{g.titre}</p>
              <ul>
                {g.rubriques.map((r) => (
                  <LienRubrique key={r.href} rubrique={r} courante={r.href === rubrique.href} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="bo-pied">
          <a className="bo-lien" href="/tablette" title="Tablette">
            <IconeGestion nom="tablette" />
            <span className="bo-libelle">Tablette</span>
          </a>
          <button type="button" className="bo-lien" onClick={deconnecter} title={`Se déconnecter (${nom})`}>
            <IconeGestion nom="sortir" />
            <span className="bo-libelle">
              Se déconnecter <span className="bo-qui">{nom}</span>
            </span>
          </button>
          {erreurSortie && (
            <p className="bo-erreur-pied" role="alert">
              {erreurSortie}
            </p>
          )}
          <button type="button" className="bo-lien bo-replier" onClick={changerMenu} title={large ? "Réduire le menu" : "Agrandir le menu"}>
            <IconeGestion nom={large ? "replier" : "deplier"} />
            <span className="bo-libelle">{large ? "Réduire le menu" : "Agrandir le menu"}</span>
          </button>
        </div>
      </aside>
      <button type="button" className="bo-voile" tabIndex={-1} aria-hidden="true" onClick={() => basculerTiroir(false)} />
      {/* Tiroir ouvert : le reste de la page est inerte (ni clic ni Tab), comme derrière une fenêtre. */}
      <div className="bo-corps" inert={tiroir || undefined}>
        <header className="bo-tete">
          <button ref={boutonMenu} type="button" className="bo-bouton-menu" aria-controls="bo-menu" aria-expanded={tiroir} onClick={() => basculerTiroir(true)}>
            <IconeGestion nom="menu" />
            <span>Menu</span>
          </button>
          <div className="bo-titre">
            <p className="bo-titre-groupe">{groupe.titre}</p>
            <h1 ref={titre} tabIndex={-1}>
              {rubrique.titre}
            </h1>
          </div>
        </header>
        <main id="contenu" className="gestion bo-contenu">
          {children}
        </main>
      </div>
    </div>
  );
}

function LienRubrique({ rubrique, courante }: { rubrique: Rubrique; courante: boolean }) {
  const { carte } = useCarte();
  // Badges : ce qui attend le gérant dans la rubrique (vague 3 : d'autres viendront, commandes à traiter, alertes).
  const badge = rubrique.href === "/gestion/carte" && carte && carte.bloquants > 0 ? carte.bloquants : null;
  // Le nom du lien reste celui de la rubrique ; le badge est lu comme description.
  const idBadge = `bo-badge-${rubrique.href.replace(/\W+/g, "-")}`;
  return (
    <li>
      <Link
        className="bo-lien"
        href={rubrique.href}
        aria-current={courante ? "page" : undefined}
        aria-describedby={badge !== null ? idBadge : undefined}
        title={rubrique.titre}
      >
        <IconeGestion nom={rubrique.icone} />
        <span className="bo-libelle">{rubrique.titre}</span>
        {badge !== null && (
          <span className="bo-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </Link>
      {badge !== null && (
        <span id={idBadge} className="sr-only">
          {badge} {badge > 1 ? "plats bloquent" : "plat bloque"} la mise en ligne
        </span>
      )}
    </li>
  );
}

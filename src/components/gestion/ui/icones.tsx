// Pictogrammes au trait du back-office (24 × 24, trait de 1,75). Décoratifs : le texte voisin porte le sens.
// Pour un bouton sans texte visible, donner un aria-label au bouton, jamais à l'icône.
const TRACES = {
  accueil: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v11h12V9" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  commandes: (
    <>
      <path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21Z" />
      <path d="M10 8h4M10 12h4" />
    </>
  ),
  carte: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
      <path d="M9 8h6" />
    </>
  ),
  jour: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="1" />
      <path d="M4 10h16M9 3v4M15 3v4" />
      <path d="m12 12.5.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3Z" />
    </>
  ),
  supplements: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  importer: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  exporter: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  journal: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  horaires: (
    <>
      <path d="M3 7h11v9H3Z" />
      <path d="M14 10h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  imprimante: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" rx="1" />
      <path d="M7 14h10v6H7Z" />
    </>
  ),
  equipe: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.9-3.2 3-4.8 5.5-4.8s4.6 1.6 5.5 4.8" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17 14.4c1.7.6 2.9 2.1 3.5 4.6" />
    </>
  ),
  clients: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
    </>
  ),
  rapports: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  cloture: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="1" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="m9.5 15 1.8 1.8 3.2-3.3" />
    </>
  ),
  livreurs: (
    <>
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8.5 17h6l2-6h-4M14 6h2.5l2 5M6 17l3-6h4" />
    </>
  ),
  promotions: (
    <>
      <path d="M4 4h7l9 9-7 7-9-9Z" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </>
  ),
  tablette: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M11 18h2" />
    </>
  ),
  sortir: (
    <>
      <path d="M10 4H5v16h5" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chercher: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  fermer: <path d="M6 6l12 12M18 6 6 18" />,
  replier: <path d="M14.5 6 8.5 12l6 6" />,
  deplier: <path d="m9.5 6 6 6-6 6" />,
} as const;

export type NomIconeGestion = keyof typeof TRACES;

export function IconeGestion({ nom }: { nom: NomIconeGestion }) {
  return (
    <svg className="bo-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRACES[nom]}
    </svg>
  );
}

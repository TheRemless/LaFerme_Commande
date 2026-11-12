// Pictogrammes au trait, repris de la maquette Béton. Toujours décoratifs : le texte voisin porte le sens.
const TRACES = {
  repere: (
    <>
      <path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  fermer: <path d="M6 6l12 12M18 6 6 18" />,
  loupe: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  ok: <path d="m5 12.5 4.5 4.5L19 7" />,
  compte: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
} as const;

export function Icone({ nom }: { nom: keyof typeof TRACES }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      {TRACES[nom]}
    </svg>
  );
}

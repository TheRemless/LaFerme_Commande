import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { ADRESSE_SITE, DESCRIPTION_SITE, INDEXABLE, OPEN_GRAPH, PRIVE } from "@/lib/site";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--police-archivo",
  display: "swap",
});

// Titre relu au lot 8a, description et Open Graph au lot 8e (redaction-fr, faits du registre).
// L'image de partage est src/app/opengraph-image.jpg (photo du shooting pro), le manifeste src/app/manifest.ts.
export const metadata: Metadata = {
  metadataBase: new URL(ADRESSE_SITE),
  title: "La Ferme, livraison et à emporter",
  description: DESCRIPTION_SITE,
  applicationName: "La Ferme",
  robots: INDEXABLE ? { index: true, follow: true } : PRIVE,
  openGraph: {
    ...OPEN_GRAPH,
    title: "La Ferme, livraison et à emporter",
    description: DESCRIPTION_SITE,
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: { title: "La Ferme", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f4f2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={archivo.variable}>
      <body>
        {/* Premier arrêt au clavier : passer l'en-tête et les catégories. */}
        <a className="evitement" href="#contenu">
          Aller au contenu
        </a>
        {children}
      </body>
    </html>
  );
}

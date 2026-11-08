import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--police-archivo",
  display: "swap",
});

// Titre relu (redaction-fr, lot 8a). Description, Open Graph et indexation : lot 8e.
export const metadata: Metadata = {
  title: "La Ferme, livraison et à emporter",
  robots: { index: false, follow: false },
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

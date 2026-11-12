import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Préversions seulement : vérifie que le module d'image (sharp) se charge et travaille sur Netlify,
// puisque l'envoi de photo du back-office ne s'essaie pas sur une préversion. Image générée, rien d'écrit.
// Chargement dynamique : si le module manque dans la fonction, la réponse dit pourquoi au lieu d'un 500 nu.
export async function GET() {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") return new NextResponse(null, { status: 404 });
  const t = performance.now();
  try {
    const { default: sharp } = await import("sharp");
    const { preparerPhoto } = await import("@/lib/photo-envoi");
    const source = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 111, g: 111, b: 113 } } }).jpeg().toBuffer();
    const r = await preparerPhoto(source);
    return NextResponse.json(
      { ok: r.ok, taille: r.ok ? `${r.photo.largeur}x${r.photo.hauteur}` : r.erreur, ms: Math.round(performance.now() - t), sharp: sharp.versions.sharp },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, erreur: e instanceof Error ? e.message.slice(0, 1500) : String(e), plateforme: `${process.platform}-${process.arch}` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

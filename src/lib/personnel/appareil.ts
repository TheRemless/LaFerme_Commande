// Libellé court d'un appareil de l'équipe (« iPad, Safari »), tiré du navigateur à la connexion. Rien de plus :
// ni version, ni modèle précis, ni empreinte. Sert au gérant à reconnaître la tablette de la cuisine ou le
// téléphone d'un livreur dans Équipe.
export function libelleAppareil(ua: string | null | undefined): string {
  const u = ua ?? "";
  const appareil = /iPad/.test(u)
    ? "iPad"
    : /iPhone/.test(u)
      ? "iPhone"
      : /Android/.test(u)
        ? /Mobile/.test(u)
          ? "Téléphone Android"
          : "Tablette Android"
        : /Macintosh|Mac OS X/.test(u)
          ? "Mac"
          : /Windows/.test(u)
            ? "PC Windows"
            : /Linux/.test(u)
              ? "Linux"
              : "Appareil";
  const navigateur = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /(Chrome|CriOS)\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : null;
  return navigateur ? `${appareil}, ${navigateur}` : appareil;
}

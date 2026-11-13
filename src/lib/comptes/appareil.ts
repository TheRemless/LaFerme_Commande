// Nom court d'un appareil connecté, tiré de l'en-tête User-Agent : navigateur et système, rien d'autre (ni
// version, ni modèle). Sert seulement à la liste « Vos appareils » du compte.
export function libelleAppareil(ua: string | null | undefined): string {
  const u = ua ?? "";
  const nav = /Edg\//.test(u)
    ? "Edge"
    : /OPR\/|Opera/.test(u)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(u)
        ? "Firefox"
        : /CriOS\/|Chrome\//.test(u)
          ? "Chrome"
          : /Safari\//.test(u)
            ? "Safari"
            : null;
  const os = /iPhone/.test(u)
    ? "iPhone"
    : /iPad/.test(u)
      ? "iPad"
      : /Android/.test(u)
        ? "Android"
        : /Macintosh|Mac OS X/.test(u)
          ? "Mac"
          : /Windows/.test(u)
            ? "Windows"
            : /Linux/.test(u)
              ? "Linux"
              : null;
  if (!nav && !os) return "Navigateur inconnu";
  return `${nav ?? "Navigateur"} sur ${os ?? "un appareil"}`;
}

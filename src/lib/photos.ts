// Photos du shooting pro (public/plats). Seules celles-ci peuvent être choisies dans le back-office.
// Un test vérifie que la liste suit le dossier.
export const PHOTOS = ["4saison.jpg", "cheeseburger.jpg", "chiacchiere.jpg", "lasagne.jpg", "linguineaifruttidimare.jpg", "margherita.jpg", "melanzana.jpg", "missitalia.jpg", "paccheriallanorma.jpg", "pannacotta.jpg", "prosciuto.jpg", "rigatoniallapeppino.jpg", "salade-melee.jpg", "spaghettialpesto.jpg", "tartare.jpg", "tiramisu.jpg", "vegetarienne.jpg"] as const;

// Photos gardées dans le dossier (le back-office et la base peuvent encore les nommer) mais jamais montrées
// aux clients. La salade mêlée ne vient pas du shooting sur béton (audit design, D01).
export const PHOTOS_RETIREES: readonly string[] = ["salade-melee.jpg"];

// Photos où le plat est posé sur une ardoise : l'assiette est petite dans le carré de la carte, on resserre (audit design, D22).
export const PHOTOS_SERREES: readonly string[] = ["cheeseburger.jpg", "tartare.jpg", "tiramisu.jpg"];

// Photo envoyée depuis le back-office : stockée en base, servie par /photos/<id>.jpg (src/app/photos).
const ENVOYEE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

export function estPhotoEnvoyee(photo: unknown): photo is string {
  return typeof photo === "string" && ENVOYEE.test(photo);
}

// Adresse d'une photo de plat, qu'elle vienne du shooting (public/plats) ou du back-office.
export function urlPhoto(photo: string): string {
  return estPhotoEnvoyee(photo) ? `/photos/${photo}` : `/plats/${photo}`;
}

// Clé d'un geste (remboursement, manque signalé) : la même tant que le geste n'a pas abouti, pour qu'un double
// appui ou une reprise après coupure ne rembourse pas deux fois. Doit passer /^[A-Za-z0-9-]{8,80}$/ côté serveur.
export function nouvelleCle(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

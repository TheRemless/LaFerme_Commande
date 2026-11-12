import { etatService, type ConfigService, type Mode } from "@/lib/service";

// Heure annoncée au client pour « dès que possible », recalculée au moment où la commande a été passée :
// la même que « Chez vous vers » de l'accueil. Elle reste affichée (paiement, suivi, e-mail) jusqu'à
// l'heure confirmée par le restaurant (rapport client mystère, CM-05). null si rien à annoncer.
export function estimationAsap(
  config: ConfigService,
  c: { quand_type: string; mode: Mode; zone_numero: number | null; cree_le: string },
): number | null {
  if (c.quand_type !== "asap") return null;
  const zone = c.mode === "livraison" ? config.zones.find((z) => z.numero === c.zone_numero) : undefined;
  if (c.mode === "livraison" && !zone) return null;
  // Une commande enregistrée a déjà passé le contrôle de l'heure : on prend les bornes les plus larges.
  // Sans la pause du moment : une pause décidée après la commande ne change pas l'heure annoncée.
  const e = etatService({ ...config, pause: undefined }, new Date(c.cree_le), c.mode, zone, true);
  return e.etat === "ouvert" ? e.desQuePossible : null;
}

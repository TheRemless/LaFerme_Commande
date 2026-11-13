// Sons de la tablette (vague 3) : chaque alerte a le sien, pour savoir sans regarder ce qui se passe.
// - Nouvelle commande : deux notes, répétées toutes les 4 s tant qu'une commande attend, toutes les 2 s au-delà de
//   3 minutes d'attente.
// - Commande en retard : trois notes graves rapprochées, une fois par commande.
// - Imprimante ou livraison en difficulté : deux notes qui descendent, une fois par problème.
// - Annulation par le client : une note grave et longue (Tablette.tsx, depuis #115).
// Le navigateur n'autorise le son qu'après un geste (« Commencer le service »).

function note(ctx: AudioContext, frequence: number, debut: number, duree: number, volume = 0.35) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = frequence;
  o.type = "square";
  g.gain.setValueAtTime(0.0001, debut);
  g.gain.exponentialRampToValueAtTime(volume, debut + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, debut + duree);
  o.connect(g).connect(ctx.destination);
  o.start(debut);
  o.stop(debut + duree + 0.02);
}

export function sonnerRetard(ctx: AudioContext) {
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) note(ctx, 392, t + i * 0.18, 0.12);
}

export function sonnerProbleme(ctx: AudioContext) {
  const t = ctx.currentTime;
  note(ctx, 740, t, 0.3);
  note(ctx, 494, t + 0.34, 0.4);
}

// Ce qui est apparu depuis la dernière fois. Au premier appel (chargement de la page), tout est marqué vu sans
// sonner : on ne sonne pas pour ce qui était déjà là.
export function nouveaux(vus: { current: Set<string> | null }, cles: string[]): string[] {
  if (vus.current === null) {
    vus.current = new Set(cles);
    return [];
  }
  const neufs = cles.filter((c) => !vus.current!.has(c));
  neufs.forEach((c) => vus.current!.add(c));
  return neufs;
}

// Acceptation en série : les commandes à accepter qu'on peut prendre d'un geste, chacune à son heure proposée.
// Une allergie ou un avertissement (adresse, créneau) se lit d'abord : ces commandes restent à accepter une par une.
export function acceptablesEnSerie<T extends { allergie?: string; avertissement?: string | null }>(commandes: T[]): { serie: T[]; aLire: T[] } {
  const aLire = commandes.filter((c) => !!c.allergie?.trim() || !!c.avertissement);
  return { serie: commandes.filter((c) => !aLire.includes(c)), aLire };
}

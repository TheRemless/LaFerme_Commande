// Envoi JSON depuis le navigateur vers les routes du site. Une coupure réseau donne un message clair.
export type Reponse = { ok: boolean; statut: number; donnees: Record<string, unknown> };

export async function poster(url: string, corps: unknown): Promise<Reponse> {
  try {
    const rep = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    return { ok: rep.ok, statut: rep.status, donnees: (await rep.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, statut: 0, donnees: { erreur: "Pas de connexion. Vérifiez le réseau et réessayez." } };
  }
}

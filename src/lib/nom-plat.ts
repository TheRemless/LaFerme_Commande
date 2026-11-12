// Nom d'un plat vu par le client (CM-22) : les pizzas s'appellent « Pizza Margherita » en base,
// « Margherita » sous le titre Pizzas de la carte. Le suivi, l'e-mail et le compte reprennent le nom
// de la carte. Les tickets de cuisine gardent le nom complet.
export function nomClient(nom: string, pizza: boolean): string {
  if (!pizza) return nom;
  const n = nom.replace(/^Pizza /, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
}

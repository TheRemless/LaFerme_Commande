// Prix suisses : « 18.– » pour un montant rond, « 4.50 » sinon, « CHF 21.50 » pour un total.

export function prixCourt(centimes: number): string {
  return centimes % 100 === 0 ? `${centimes / 100}.–` : (centimes / 100).toFixed(2);
}

// Dans une phrase : « CHF 100 » pour un montant rond, « CHF 99.50 » sinon, avec une espace insécable.
export function prixPhrase(centimes: number): string {
  return `CHF\u00a0${centimes % 100 === 0 ? centimes / 100 : (centimes / 100).toFixed(2)}`;
}

export function prixChf(centimes: number): string {
  return `CHF ${(centimes / 100).toFixed(2)}`;
}

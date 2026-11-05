// Prix suisses : « 18.– » pour un montant rond, « 4.50 » sinon, « CHF 21.50 » pour un total.

export function prixCourt(centimes: number): string {
  return centimes % 100 === 0 ? `${centimes / 100}.–` : (centimes / 100).toFixed(2);
}

export function prixChf(centimes: number): string {
  return `CHF ${(centimes / 100).toFixed(2)}`;
}

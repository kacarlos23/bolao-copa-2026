export const MAX_FUNDRAISING_CENTS = 100_000_000;

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBrlCents(amountCents: number) {
  return brlFormatter.format(amountCents / 100);
}

export function centsToBrlInput(amountCents: number) {
  return (amountCents / 100).toFixed(2).replace('.', ',');
}

export function parseBrlInputToCents(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const [reais, fraction = ''] = normalized.split(/[.,]/);
  const amountCents = Number(reais) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amountCents) &&
    amountCents >= 0 &&
    amountCents <= MAX_FUNDRAISING_CENTS
    ? amountCents
    : null;
}

export const FUNDRAISING_PRIZE_DISTRIBUTION = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
] as const;

export type FundraisingPrize = {
  place: (typeof FUNDRAISING_PRIZE_DISTRIBUTION)[number]['place'];
  percentage: (typeof FUNDRAISING_PRIZE_DISTRIBUTION)[number]['percentage'];
  amountCents: number;
};

/**
 * Splits the confirmed fundraising amount in integer cents. Each prize is
 * individually truncated to two decimal places, so fractional cents are never
 * rounded up or paid out.
 */
export function calculateFundraisingPrizes(amountCents: number): FundraisingPrize[] {
  return FUNDRAISING_PRIZE_DISTRIBUTION.map(({ place, percentage }) => ({
    place,
    percentage,
    amountCents: Math.trunc((amountCents * percentage) / 100),
  }));
}

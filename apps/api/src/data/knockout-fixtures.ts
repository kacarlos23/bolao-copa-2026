export type KnockoutStageValue =
  | 'ROUND_OF_32'
  | 'ROUND_OF_16'
  | 'QUARTER_FINAL'
  | 'SEMI_FINAL'
  | 'THIRD_PLACE'
  | 'FINAL';

export interface KnockoutFixtureSeed {
  matchNumber: number;
  stage: KnockoutStageValue;
  startsAt: string;
  homeSource: string;
  awaySource: string;
}

export const knockoutFixtureSeeds: KnockoutFixtureSeed[] = [
  { matchNumber: 73, stage: 'ROUND_OF_32', startsAt: '2026-06-28T19:00:00Z', homeSource: '2A', awaySource: '2B' },
  { matchNumber: 74, stage: 'ROUND_OF_32', startsAt: '2026-06-29T20:30:00Z', homeSource: '1E', awaySource: '3*' },
  { matchNumber: 75, stage: 'ROUND_OF_32', startsAt: '2026-06-30T01:00:00Z', homeSource: '1F', awaySource: '2C' },
  { matchNumber: 76, stage: 'ROUND_OF_32', startsAt: '2026-06-29T17:00:00Z', homeSource: '1C', awaySource: '2F' },
  { matchNumber: 77, stage: 'ROUND_OF_32', startsAt: '2026-06-30T21:00:00Z', homeSource: '1I', awaySource: '3*' },
  { matchNumber: 78, stage: 'ROUND_OF_32', startsAt: '2026-06-30T17:00:00Z', homeSource: '2E', awaySource: '2I' },
  { matchNumber: 79, stage: 'ROUND_OF_32', startsAt: '2026-07-01T01:00:00Z', homeSource: '1A', awaySource: '3*' },
  { matchNumber: 80, stage: 'ROUND_OF_32', startsAt: '2026-07-01T16:00:00Z', homeSource: '1L', awaySource: '3*' },
  { matchNumber: 81, stage: 'ROUND_OF_32', startsAt: '2026-07-02T00:00:00Z', homeSource: '1D', awaySource: '3*' },
  { matchNumber: 82, stage: 'ROUND_OF_32', startsAt: '2026-07-01T20:00:00Z', homeSource: '1G', awaySource: '3*' },
  { matchNumber: 83, stage: 'ROUND_OF_32', startsAt: '2026-07-02T23:00:00Z', homeSource: '2K', awaySource: '2L' },
  { matchNumber: 84, stage: 'ROUND_OF_32', startsAt: '2026-07-02T19:00:00Z', homeSource: '1H', awaySource: '2J' },
  { matchNumber: 85, stage: 'ROUND_OF_32', startsAt: '2026-07-03T03:00:00Z', homeSource: '1B', awaySource: '3*' },
  { matchNumber: 86, stage: 'ROUND_OF_32', startsAt: '2026-07-03T22:00:00Z', homeSource: '1J', awaySource: '2H' },
  { matchNumber: 87, stage: 'ROUND_OF_32', startsAt: '2026-07-04T01:30:00Z', homeSource: '1K', awaySource: '3*' },
  { matchNumber: 88, stage: 'ROUND_OF_32', startsAt: '2026-07-03T18:00:00Z', homeSource: '2D', awaySource: '2G' },
  { matchNumber: 89, stage: 'ROUND_OF_16', startsAt: '2026-07-04T21:00:00Z', homeSource: 'W74', awaySource: 'W77' },
  { matchNumber: 90, stage: 'ROUND_OF_16', startsAt: '2026-07-04T17:00:00Z', homeSource: 'W73', awaySource: 'W75' },
  { matchNumber: 91, stage: 'ROUND_OF_16', startsAt: '2026-07-05T20:00:00Z', homeSource: 'W76', awaySource: 'W78' },
  { matchNumber: 92, stage: 'ROUND_OF_16', startsAt: '2026-07-06T00:00:00Z', homeSource: 'W79', awaySource: 'W80' },
  { matchNumber: 93, stage: 'ROUND_OF_16', startsAt: '2026-07-06T19:00:00Z', homeSource: 'W83', awaySource: 'W84' },
  { matchNumber: 94, stage: 'ROUND_OF_16', startsAt: '2026-07-07T00:00:00Z', homeSource: 'W81', awaySource: 'W82' },
  { matchNumber: 95, stage: 'ROUND_OF_16', startsAt: '2026-07-07T16:00:00Z', homeSource: 'W86', awaySource: 'W88' },
  { matchNumber: 96, stage: 'ROUND_OF_16', startsAt: '2026-07-07T20:00:00Z', homeSource: 'W85', awaySource: 'W87' },
  { matchNumber: 97, stage: 'QUARTER_FINAL', startsAt: '2026-07-09T20:00:00Z', homeSource: 'W89', awaySource: 'W90' },
  { matchNumber: 98, stage: 'QUARTER_FINAL', startsAt: '2026-07-10T19:00:00Z', homeSource: 'W93', awaySource: 'W94' },
  { matchNumber: 99, stage: 'QUARTER_FINAL', startsAt: '2026-07-11T21:00:00Z', homeSource: 'W91', awaySource: 'W92' },
  { matchNumber: 100, stage: 'QUARTER_FINAL', startsAt: '2026-07-12T01:00:00Z', homeSource: 'W95', awaySource: 'W96' },
  { matchNumber: 101, stage: 'SEMI_FINAL', startsAt: '2026-07-14T19:00:00Z', homeSource: 'W97', awaySource: 'W98' },
  { matchNumber: 102, stage: 'SEMI_FINAL', startsAt: '2026-07-15T19:00:00Z', homeSource: 'W99', awaySource: 'W100' },
  { matchNumber: 103, stage: 'THIRD_PLACE', startsAt: '2026-07-18T21:00:00Z', homeSource: 'L101', awaySource: 'L102' },
  { matchNumber: 104, stage: 'FINAL', startsAt: '2026-07-19T19:00:00Z', homeSource: 'W101', awaySource: 'W102' },
];

export const firstKnockoutStartsAt = new Date(
  Math.min(...knockoutFixtureSeeds.map((fixture) => new Date(fixture.startsAt).getTime())),
);

import crypto from 'node:crypto';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('MIGRATION_TEST_DATABASE_URL deve apontar para um banco PostgreSQL isolado.');
}

const suffix = crypto.randomBytes(6).toString('hex');
const id = (name) => `constraint-test-${name}-${suffix}`;
const now = new Date('2026-07-14T12:00:00.000Z');
const client = new Client({ connectionString: databaseUrl, application_name: 'constraint-test' });
let negativeAssertions = 0;
let connected = false;

async function expectConstraint(name, statement, values, allowedCodes) {
  await client.query(`SAVEPOINT "${name}"`);
  try {
    await client.query(statement, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT "${name}"`);
    if (!allowedCodes.includes(error.code)) throw error;
    negativeAssertions += 1;
    return;
  }
  throw new Error(`${name} deveria ter sido rejeitado por constraint.`);
}

try {
  await client.connect();
  connected = true;
  await client.query('BEGIN');

  await client.query(
    `INSERT INTO "Competition" ("id","slug","name","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$4)`,
    [id('competition'), id('competition-slug'), 'Constraint test', now],
  );
  for (const season of ['a', 'b']) {
    await client.query(
      `INSERT INTO "CompetitionSeason"
       ("id","competitionId","slug","name","timezone","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'America/Sao_Paulo',$5,$5)`,
      [
        id(`season-${season}`),
        id('competition'),
        id(`season-slug-${season}`),
        `Season ${season}`,
        now,
      ],
    );
    await client.query(
      `INSERT INTO "Stage"
       ("id","seasonId","slug","name","type","order","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'KNOCKOUT',1,$5,$5)`,
      [
        id(`stage-${season}`),
        id(`season-${season}`),
        id(`stage-slug-${season}`),
        `Stage ${season}`,
        now,
      ],
    );
  }

  await expectConstraint(
    'round_cross_season',
    `INSERT INTO "Round"
     ("id","seasonId","stageId","name","order","createdAt","updatedAt")
     VALUES ($1,$2,$3,'Invalid round',1,$4,$4)`,
    [id('round-invalid'), id('season-b'), id('stage-a'), now],
    ['23503'],
  );

  for (const season of ['a', 'b']) {
    await client.query(
      `INSERT INTO "Round"
       ("id","seasonId","stageId","name","order","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,1,$5,$5)`,
      [
        id(`round-${season}`),
        id(`season-${season}`),
        id(`stage-${season}`),
        `Round ${season}`,
        now,
      ],
    );
  }

  await client.query(
    `INSERT INTO "Pool" ("id","slug","name","createdAt","updatedAt")
     VALUES ($1,$2,'Pool constraint test',$3,$3)`,
    [id('pool'), id('pool-slug'), now],
  );
  await client.query(
    `INSERT INTO "PoolSeason" ("id","poolId","seasonId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$4)`,
    [id('pool-season-a'), id('pool'), id('season-a'), now],
  );
  await client.query(
    `INSERT INTO "User"
     ("id","username","usernameLower","nickname","passwordHash","createdAt","updatedAt")
     VALUES ($1,$2,$2,'Constraint User','not-a-real-password',$3,$3)`,
    [id('user'), id('username'), now],
  );
  for (const team of ['home', 'away', 'other']) {
    await client.query(
      `INSERT INTO "Team" ("id","externalId","name","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$4)`,
      [id(`team-${team}`), id(`team-external-${team}`), team, now],
    );
  }
  for (const team of ['home', 'away']) {
    await client.query(
      `INSERT INTO "SeasonTeam" ("id","seasonId","teamId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$4)`,
      [id(`season-team-a-${team}`), id('season-a'), id(`team-${team}`), now],
    );
  }
  await client.query(
    `INSERT INTO "SeasonTeam" ("id","seasonId","teamId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$4)`,
    [id('season-team-b-other'), id('season-b'), id('team-other'), now],
  );

  await expectConstraint(
    'tie_cross_season_stage',
    `INSERT INTO "Tie"
     ("id","seasonId","stageId","roundId","key","order","teamAId","teamBId","expectedLegs","provenance","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'invalid-cross-season',1,$5,$6,1,'constraint-test',$7,$7)`,
    [
      id('tie-cross-season'),
      id('season-b'),
      id('stage-a'),
      id('round-a'),
      id('team-home'),
      id('team-away'),
      now,
    ],
    ['23503', '23514'],
  );
  await expectConstraint(
    'tie_team_outside_season',
    `INSERT INTO "Tie"
     ("id","seasonId","stageId","roundId","key","order","teamAId","teamBId","expectedLegs","provenance","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'invalid-team',1,$5,$6,1,'constraint-test',$7,$7)`,
    [
      id('tie-invalid-team'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('team-home'),
      id('team-other'),
      now,
    ],
    ['23503'],
  );
  await expectConstraint(
    'tie_invalid_leg_count',
    `INSERT INTO "Tie"
     ("id","seasonId","stageId","roundId","key","order","teamAId","teamBId","expectedLegs","provenance","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'invalid-legs',1,$5,$6,3,'constraint-test',$7,$7)`,
    [
      id('tie-invalid-legs'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('team-home'),
      id('team-away'),
      now,
    ],
    ['23514'],
  );
  await expectConstraint(
    'tie_decided_without_winner',
    `INSERT INTO "Tie"
     ("id","seasonId","stageId","roundId","key","order","teamAId","teamBId","expectedLegs","status","decisionMethod","provenance","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'invalid-decision',1,$5,$6,1,'DECIDED','AGGREGATE','constraint-test',$7,$7)`,
    [
      id('tie-invalid-decision'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('team-home'),
      id('team-away'),
      now,
    ],
    ['23514'],
  );
  await client.query(
    `INSERT INTO "Tie"
     ("id","seasonId","stageId","roundId","key","order","teamAId","teamBId","expectedLegs","provenance","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'valid-single-leg',1,$5,$6,1,'constraint-test',$7,$7)`,
    [
      id('tie-a'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('team-home'),
      id('team-away'),
      now,
    ],
  );
  await client.query(
    `INSERT INTO "ProviderEntityMapping"
     ("id","provider","entityType","externalId","internalId","seasonId","createdAt","updatedAt")
     VALUES ($1,'constraint-provider','TIE',$2,$3,$4,$5,$5)`,
    [id('tie-mapping'), id('tie-external'), id('tie-a'), id('season-a'), now],
  );
  await client.query(
    `INSERT INTO "MatchDay"
     ("id","date","firstMatchStartsAt","predictionsCloseAt","status","seasonId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'OPEN',$5,$2,$2)`,
    [
      id('match-day-a'),
      now,
      new Date('2026-07-14T15:00:00.000Z'),
      new Date('2026-07-14T14:55:00.000Z'),
      id('season-a'),
    ],
  );
  await client.query(
    `INSERT INTO "Match"
     ("id","externalId","matchDayId","seasonId","stageId","roundId","tieId","legNumber","homeTeamId","awayTeamId","startsAt","status","regulationHomeScore","regulationAwayScore","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'FINISHED',1,0,$11,$11)`,
    [
      id('tie-match-a'),
      id('tie-match-external-a'),
      id('match-day-a'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('tie-a'),
      id('team-home'),
      id('team-away'),
      new Date('2026-07-14T15:00:00.000Z'),
      now,
    ],
  );
  await expectConstraint(
    'tie_duplicate_leg',
    `INSERT INTO "Match"
     ("id","externalId","matchDayId","seasonId","stageId","roundId","tieId","legNumber","homeTeamId","awayTeamId","startsAt","status","regulationHomeScore","regulationAwayScore","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'FINISHED',0,1,$11,$11)`,
    [
      id('tie-match-duplicate'),
      id('tie-match-external-duplicate'),
      id('match-day-a'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('tie-a'),
      id('team-away'),
      id('team-home'),
      new Date('2026-07-14T16:00:00.000Z'),
      now,
    ],
    ['23505'],
  );
  await expectConstraint(
    'tie_match_wrong_team',
    `INSERT INTO "Match"
     ("id","externalId","matchDayId","seasonId","stageId","roundId","tieId","legNumber","homeTeamId","awayTeamId","startsAt","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'SCHEDULED',$11,$11)`,
    [
      id('tie-match-wrong-team'),
      id('tie-match-external-wrong-team'),
      id('match-day-a'),
      id('season-a'),
      id('stage-a'),
      id('round-a'),
      id('tie-a'),
      id('team-home'),
      id('team-other'),
      new Date('2026-07-14T17:00:00.000Z'),
      now,
    ],
    ['23514'],
  );
  await client.query(
    `INSERT INTO "MatchDay"
     ("id","date","firstMatchStartsAt","predictionsCloseAt","status","seasonId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'OPEN',$5,$2,$2)`,
    [
      id('match-day-b'),
      now,
      new Date('2026-07-14T15:00:00.000Z'),
      new Date('2026-07-14T14:55:00.000Z'),
      id('season-b'),
    ],
  );
  await client.query(
    `INSERT INTO "Match"
     ("id","externalId","matchDayId","seasonId","homeTeamId","awayTeamId","startsAt","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'SCHEDULED',$8,$8)`,
    [
      id('match-b'),
      id('match-external-b'),
      id('match-day-b'),
      id('season-b'),
      id('team-home'),
      id('team-away'),
      new Date('2026-07-14T15:00:00.000Z'),
      now,
    ],
  );

  await expectConstraint(
    'prediction_cross_season',
    `INSERT INTO "Prediction"
     ("id","userId","matchId","poolSeasonId","predictedHomeScore","predictedAwayScore","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,1,0,$5,$5)`,
    [id('prediction-invalid'), id('user'), id('match-b'), id('pool-season-a'), now],
    ['23514'],
  );
  await expectConstraint(
    'ranking_cross_season',
    `INSERT INTO "RankingSnapshot"
     ("id","userId","seasonId","poolSeasonId","points","finalPoints","exactScores","resultHits","oneGoalHits","rank","calculatedAt")
     VALUES ($1,$2,$3,$4,0,0,0,0,0,1,$5)`,
    [id('ranking-invalid'), id('user'), id('season-b'), id('pool-season-a'), now],
    ['23514'],
  );

  await client.query('ROLLBACK');
  process.stdout.write(
    `Constraints PostgreSQL aprovadas: ${negativeAssertions} cruzamentos rejeitados; transacao revertida.\n`,
  );
} finally {
  if (connected) {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

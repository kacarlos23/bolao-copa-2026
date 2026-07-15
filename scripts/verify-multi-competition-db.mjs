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
       VALUES ($1,$2,$3,$4,'LEAGUE',1,$5,$5)`,
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
  for (const team of ['home', 'away']) {
    await client.query(
      `INSERT INTO "Team" ("id","externalId","name","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$4)`,
      [id(`team-${team}`), id(`team-external-${team}`), team, now],
    );
  }
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

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://bolao_admin:LaCQvzNf0yoZa8uvrfNslzQXmDk9IURMKaSsyaUXQaoa@localhost:5433/bolao_copa_2026?schema=public'
    }
  }
});

(async () => {
  try {
    // Test connection
    console.log('Testing database connection...');
    const userCount = await prisma.user.count();
    console.log(`✓ Connected! Found ${userCount} users\n`);

    // Check scores
    const scoreCount = await prisma.predictionScore.count();
    console.log(`Total scores in database: ${scoreCount}`);

    // Check matches
    const matchCount = await prisma.match.count();
    console.log(`Total matches in database: ${matchCount}\n`);

    // Get a user with scores and their match data
    const userWithScores = await prisma.user.findFirst({
      where: { role: 'USER', status: 'ACTIVE' },
      select: {
        id: true,
        nickname: true,
        scores: {
          take: 5,
          orderBy: { calculatedAt: 'desc' },
          select: {
            id: true,
            points: true,
            scoreType: true,
            calculatedAt: true,
            match: {
              select: {
                id: true,
                homeTeamId: true,
                awayTeamId: true,
                homeTeam: { select: { name: true, code: true } },
                awayTeam: { select: { name: true, code: true } },
                homeScore: true,
                awayScore: true,
                finalHomeScore: true,
                finalAwayScore: true,
                status: true,
              }
            }
          }
        }
      }
    });

    if (userWithScores) {
      console.log(`\nUser: ${userWithScores.nickname}`);
      console.log(`Scores found: ${userWithScores.scores.length}`);

      if (userWithScores.scores.length > 0) {
        console.log(`\nFirst score:
  - Points: ${userWithScores.scores[0].points}
  - Type: ${userWithScores.scores[0].scoreType}
  - Match ID: ${userWithScores.scores[0].match?.id || 'NULL'}
  - Home Team: ${userWithScores.scores[0].match?.homeTeam?.name || 'NULL'}
  - Away Team: ${userWithScores.scores[0].match?.awayTeam?.name || 'NULL'}
  - Result: ${userWithScores.scores[0].match?.finalHomeScore ?? '-'}-${userWithScores.scores[0].match?.finalAwayScore ?? '-'}`);
      }
    } else {
      console.log('\nNo users found with scores');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();

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
    console.log('Testing ranking query...\n');

    const users = await prisma.user.findMany({
      where: { role: 'USER', status: 'ACTIVE' },
      take: 1,
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        scores: {
          orderBy: { calculatedAt: 'desc' },
          take: 5,
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            calculatedAt: true,
            match: {
              select: {
                id: true,
                homeTeam: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    metadata: true,
                  },
                },
                awayTeam: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    metadata: true,
                  },
                },
                homeScore: true,
                awayScore: true,
                finalHomeScore: true,
                finalAwayScore: true,
                status: true,
              },
            },
          },
        },
        knockoutScores: {
          orderBy: { calculatedAt: 'desc' },
          take: 5,
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            calculatedAt: true,
            fixture: {
              select: {
                id: true,
                homeTeam: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    metadata: true,
                  },
                },
                awayTeam: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    metadata: true,
                  },
                },
                homeScore: true,
                awayScore: true,
                finalHomeScore: true,
                finalAwayScore: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (users.length > 0) {
      const user = users[0];
      console.log(`User: ${user.nickname}`);
      console.log(`Scores count: ${user.scores.length}`);
      console.log(`KnockoutScores count: ${user.knockoutScores.length}\n`);

      if (user.scores.length > 0) {
        const score = user.scores[0];
        console.log('First Score:');
        console.log(`  Points: ${score.points}`);
        console.log(`  Type: ${score.scoreType}`);
        console.log(`  Match: ${score.match ? 'PRESENT' : 'NULL'}`);
        if (score.match) {
          console.log(`  - Home: ${score.match.homeTeam?.name || 'NULL'} vs ${score.match.awayTeam?.name || 'NULL'}`);
          console.log(`  - Result: ${score.match.finalHomeScore ?? '-'}-${score.match.finalAwayScore ?? '-'}`);
        }
      }

      // Now test the lastFiveMatches structure
      const allScores = [...user.scores, ...user.knockoutScores].sort(
        (a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
      );
      const lastFiveScores = allScores.slice(0, 5).reverse();
      const lastFiveMatches = lastFiveScores.map((score) => ({
        score: score.points,
        match: score.match || score.fixture,
      }));

      console.log(`\nLast Five Matches Structure:`);
      console.log(`Count: ${lastFiveMatches.length}`);
      lastFiveMatches.forEach((m, i) => {
        console.log(`  [${i}] score=${m.score}, match=${m.match ? 'YES' : 'NO'}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
})();

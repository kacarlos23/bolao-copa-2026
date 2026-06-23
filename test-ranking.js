const fetch = require('node-fetch');

(async () => {
  try {
    const response = await fetch('http://localhost:3001/ranking');
    const data = await response.json();
    
    if (data.ranking && data.ranking.length > 0) {
      const firstRow = data.ranking[0];
      console.log('✓ Ranking data retrieved successfully');
      console.log(`  - Player: ${firstRow.nickname}`);
      console.log(`  - Points: ${firstRow.points}`);
      console.log(`  - Last 5 scores: ${firstRow.lastFive.join(',')}`);
      
      if (firstRow.lastFiveMatches && firstRow.lastFiveMatches.length > 0) {
        console.log('  - Last 5 Matches structure: ✓ Present');
        const match = firstRow.lastFiveMatches[0];
        if (match.match) {
          console.log(`    - Match data available: ✓`);
          console.log(`    - Home team: ${match.match.homeTeam?.name || 'N/A'}`);
          console.log(`    - Away team: ${match.match.awayTeam?.name || 'N/A'}`);
          console.log(`    - Result: ${match.match.finalHomeScore ?? '-'}-${match.match.finalAwayScore ?? '-'}`);
        }
      } else {
        console.log('  - Last 5 Matches: ✗ Not found (check if match data exists)');
      }
    } else {
      console.log('✗ No ranking data returned');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
})();

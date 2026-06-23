// Test the LastFive component rendering logic

const testValues = [3, 7, 3, 1, 3];
const testMatches = [
  {
    score: 3,
    match: {
      homeTeam: { name: 'Portugal', code: 'PT', metadata: { iso2: 'pt' } },
      awayTeam: { name: 'Uzbekistan', code: 'UZ', metadata: { iso2: 'uz' } },
      finalHomeScore: 5,
      finalAwayScore: 0,
      status: 'FINISHED'
    }
  },
  {
    score: 7,
    match: {
      homeTeam: { name: 'Brazil', code: 'BR', metadata: { iso2: 'br' } },
      awayTeam: { name: 'Mexico', code: 'MX', metadata: { iso2: 'mx' } },
      finalHomeScore: 3,
      finalAwayScore: 2,
      status: 'FINISHED'
    }
  },
  {
    score: 3,
    match: {
      homeTeam: { name: 'France', code: 'FR', metadata: { iso2: 'fr' } },
      awayTeam: { name: 'Germany', code: 'DE', metadata: { iso2: 'de' } },
      finalHomeScore: 2,
      finalAwayScore: 1,
      status: 'FINISHED'
    }
  },
  {
    score: 1,
    match: {
      homeTeam: { name: 'Spain', code: 'ES', metadata: { iso2: 'es' } },
      awayTeam: { name: 'Italy', code: 'IT', metadata: { iso2: 'it' } },
      finalHomeScore: 1,
      finalAwayScore: 1,
      status: 'FINISHED'
    }
  },
  {
    score: 3,
    match: {
      homeTeam: { name: 'Netherlands', code: 'NL', metadata: { iso2: 'nl' } },
      awayTeam: { name: 'Belgium', code: 'BE', metadata: { iso2: 'be' } },
      finalHomeScore: 2,
      finalAwayScore: 0,
      status: 'FINISHED'
    }
  }
];

console.log('=== Testing LastFive Component Logic ===\n');

// Simulate the component logic
const padded = [...testValues.slice(-5)];
while (padded.length < 5) padded.unshift(-1);

const paddedMatches = testMatches ? [...testMatches.slice(-5)] : [];
while (paddedMatches.length < 5) paddedMatches.unshift(undefined);

console.log(`Values: ${testValues.length} items`);
console.log(`Matches: ${testMatches.length} items`);
console.log(`Padded Values: ${padded.length} items`);
console.log(`Padded Matches: ${paddedMatches.length} items\n`);

// Check each badge
padded.forEach((value, index) => {
  const match = paddedMatches[index];
  console.log(`Badge ${index}:`);
  console.log(`  Value: ${value}`);
  console.log(`  Match present: ${match ? 'YES' : 'NO'}`);
  if (match && match.match) {
    console.log(`  Match data: ${match.match.homeTeam?.name} vs ${match.match.awayTeam?.name}`);
    console.log(`  Result: ${match.match.finalHomeScore}-${match.match.finalAwayScore}`);
  } else if (match) {
    console.log(`  Match object exists but no match.match property`);
    console.log(`  Match object keys:`, Object.keys(match));
  }
  console.log();
});

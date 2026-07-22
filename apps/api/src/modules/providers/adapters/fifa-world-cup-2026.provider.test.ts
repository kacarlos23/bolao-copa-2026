import { describe, expect, it, vi } from 'vitest';
import {
  FifaWorldCup2026Provider,
  parseFifaWorldCup2026Payload,
} from './fifa-world-cup-2026.provider.js';

function team(index: number) {
  const code = `T${String(index).padStart(2, '0')}`;
  return {
    IdTeam: String(10_000 + index),
    IdCountry: code,
    TeamName: [{ Locale: 'pt-BR', Description: `Seleção ${index}` }],
    Abbreviation: code,
    PictureUrl: `https://fixture.invalid/${code}.png`,
  };
}

function payload() {
  return {
    Results: Array.from({ length: 104 }, (_, index) => {
      const matchNumber = index + 1;
      const home = team(index % 48);
      const away = team((index + 1) % 48);
      return {
        IdMatch: String(400_000_000 + matchNumber),
        IdStage: matchNumber <= 72 ? 'group-stage' : 'knockout-stage',
        MatchNumber: matchNumber,
        Date: new Date(Date.UTC(2026, 5, 1, index)).toISOString(),
        TimeDefined: true,
        MatchStatus: 0,
        ResultType: 1,
        StageName: [
          { Locale: 'pt-BR', Description: matchNumber <= 72 ? 'Primeira fase' : 'Mata-mata' },
        ],
        GroupName: matchNumber <= 72 ? [{ Locale: 'pt-BR', Description: 'Grupo A' }] : [],
        Home: home,
        Away: away,
        HomeTeamScore: 2,
        AwayTeamScore: 1,
        HomeTeamPenaltyScore: null,
        AwayTeamPenaltyScore: null,
        Winner: home.IdTeam,
        Stadium: {
          Name: [{ Locale: 'pt-BR', Description: 'Estádio oficial' }],
          CityName: [{ Locale: 'pt-BR', Description: 'Cidade-sede' }],
          IdCountry: 'USA',
        },
      };
    }),
  };
}

describe('FIFA World Cup 2026 official provider', () => {
  it('separa as 72 partidas genericas dos 32 jogos do chaveamento legado', () => {
    const parsed = parseFifaWorldCup2026Payload(payload(), new Date('2026-08-01T00:00:00Z'));

    expect(parsed.teams).toHaveLength(48);
    expect(parsed.schedule).toHaveLength(72);
    expect(parsed.results).toHaveLength(72);
    expect(parsed.legacyKnockout).toHaveLength(32);
    expect(parsed.schedule[0]).toMatchObject({
      groupName: 'A',
      venue: { name: 'Estádio oficial', city: 'Cidade-sede', countryCode: 'USA' },
    });
    expect(parsed.legacyKnockout[0]).toMatchObject({
      matchNumber: 73,
      status: 'FINISHED',
      homeScore: 2,
      awayScore: 1,
    });
  });

  it('faz uma unica coleta por clique e registra checksum da resposta oficial', async () => {
    const bytes = Buffer.from(JSON.stringify(payload()));
    const fetchOfficial = vi.fn().mockResolvedValue(bytes);
    const provider = new FifaWorldCup2026Provider(fetchOfficial);

    const [teams, schedule, evidence, knockout] = await Promise.all([
      provider.syncTeams({ seasonId: 'world-cup-2026' }),
      provider.syncSchedule({ seasonId: 'world-cup-2026' }),
      provider.snapshotEvidence(),
      provider.legacyKnockoutUpdates(),
    ]);

    expect(fetchOfficial).toHaveBeenCalledTimes(1);
    expect(teams).toHaveLength(48);
    expect(schedule).toHaveLength(72);
    expect(knockout).toHaveLength(32);
    expect(evidence).toMatchObject({
      provider: 'fifa-official',
      competition: 'world-cup',
      collectionTimezone: 'UTC',
      sourceOffset: '+00:00',
      byteLength: bytes.byteLength,
    });
    expect(evidence.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

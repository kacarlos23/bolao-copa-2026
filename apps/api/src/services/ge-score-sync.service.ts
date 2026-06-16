import { MatchStatus, Prisma } from '@prisma/client';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { prisma } from '../prisma.js';
import {
  ensureKnockoutInfrastructure,
  recalculateKnockoutScoresForFixture,
  syncOfficialKnockoutParticipants,
} from './knockout.service.js';
import { recalculateScoresForMatch, refreshRankingSnapshot } from './ranking.service.js';
import {
  shouldIgnoreScoreRegression,
  statusAllowedByKickoff,
} from './score-sync.logic.js';

const GE_COPA_URL = 'https://ge.globo.com/futebol/copa-do-mundo/';
const GE_URLS = ['https://ge.globo.com/', GE_COPA_URL];
export const GE_SCORE_SCRAPE_POLL_MS = 5 * 60_000;
const TOP_SCORERS_SETTING_KEY = 'cup.topScorers';

interface ScrapedScore {
  sourceUrl?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status?: string;
  startsAt?: Date;
  winnerTeam?: string;
}

interface ScrapedTopScorer {
  rank: number;
  playerName: string;
  position: string | null;
  teamName: string;
  imageUrl: string | null;
  teamFlagUrl: string | null;
  goals: number;
}

export interface GeScoreSyncResult {
  startedAt: string;
  finishedAt: string;
  scraped: number;
  topScorers: number | null;
  changedEntries: number;
  updatedMatches: number;
  updatedKnockoutFixtures: number;
}

let activeRun: Promise<GeScoreSyncResult> | null = null;

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function decodeHtml(value: string) {
  return value
    .replace(/\\u([\dA-Fa-f]{4})/g, (_match, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(startDate?: string, startHour?: string) {
  if (!startDate) return undefined;
  const iso = `${startDate}T${startHour || '00:00:00'}-03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstMatch(content: string, pattern: RegExp) {
  const match = content.match(pattern);
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function firstInt(content: string, pattern: RegExp) {
  const value = firstMatch(content, pattern);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractObjectsAfterProperty(html: string, property: string) {
  const objects: unknown[] = [];
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const propertyIndex = html.indexOf(property, searchFrom);
    if (propertyIndex === -1) break;

    const braceStart = html.indexOf('{', propertyIndex + property.length);
    if (braceStart === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = braceStart; index < html.length; index += 1) {
      const char = html[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = html.slice(braceStart, index + 1);
          try {
            objects.push(JSON.parse(candidate));
          } catch {
            // GE mixes regular scripts and JSON fragments; invalid candidates are expected.
          }
          searchFrom = index + 1;
          break;
        }
      }
    }

    if (searchFrom <= propertyIndex) searchFrom = propertyIndex + property.length;
  }

  return objects;
}

function toNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function statusFromGe(value?: string) {
  const normalized = normalizeName(value || '');
  if (
    ['encerrado', 'encerrada', 'fimdejogo', 'finalizado', 'finalizada'].some((text) =>
      normalized.includes(text),
    )
  ) {
    return MatchStatus.FINISHED;
  }
  if (['andamento', 'aovivo', 'intervalo', 'tempo'].some((text) => normalized.includes(text))) {
    return MatchStatus.LIVE;
  }
  if (['adiado'].some((text) => normalized.includes(text))) return MatchStatus.POSTPONED;
  if (['cancelado'].some((text) => normalized.includes(text))) return MatchStatus.CANCELLED;
  return MatchStatus.SCHEDULED;
}

function scoreFromMatchObject(match: any): ScrapedScore | null {
  const homeName = match?.homeTeam?.name || match?.homeTeam?.popularName;
  const awayName = match?.awayTeam?.name || match?.awayTeam?.popularName;
  const directHomeScore = toNumber(match?.homeTeam?.score);
  const directAwayScore = toNumber(match?.awayTeam?.score);
  const boardHomeScore = toNumber(match?.scoreboard?.home);
  const boardAwayScore = toNumber(match?.scoreboard?.away);
  const homeScore = directHomeScore ?? boardHomeScore;
  const awayScore = directAwayScore ?? boardAwayScore;

  if (!homeName || !awayName || homeScore == null || awayScore == null) return null;

  const explicitWinner =
    (match?.homeTeam?.winner === true ? homeName : null) ??
    (match?.awayTeam?.winner === true ? awayName : null) ??
    match?.winner?.name ??
    match?.winnerTeam?.name;
  const winnerTeam =
    explicitWinner ??
    (homeScore > awayScore ? homeName : awayScore > homeScore ? awayName : undefined);

  return {
    homeTeam: homeName,
    awayTeam: awayName,
    homeScore,
    awayScore,
    status: match.status,
    startsAt: parseDate(match.startDate, match.startHour),
    sourceUrl: match.url,
    winnerTeam,
  };
}

async function scrapeGeScores() {
  const scores = new Map<string, ScrapedScore>();

  for (const url of GE_URLS) {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`GE respondeu ${response.status} para ${url}`);

    const html = await response.text();
    const matchObjects = extractObjectsAfterProperty(html, '"match"');

    for (const matchObject of matchObjects) {
      const score = scoreFromMatchObject(matchObject);
      if (!score) continue;
      scores.set(
        `${normalizeName(score.homeTeam)}:${normalizeName(score.awayTeam)}:${score.homeScore}:${score.awayScore}`,
        {
          ...score,
          sourceUrl: score.sourceUrl || url,
        },
      );
    }
  }

  return [...scores.values()];
}

function parseTopScorersFromHtml(html: string) {
  const sectionStart = html.indexOf('<section class="artilharia-wrapper"');
  if (sectionStart === -1) return [];

  const sectionEnd = html.indexOf('</section>', sectionStart);
  if (sectionEnd === -1) return [];

  const section = html.slice(sectionStart, sectionEnd);
  return section
    .split('<div class="ranking-item-wrapper">')
    .slice(1)
    .map((item): ScrapedTopScorer | null => {
      const rank = firstInt(item, /<div class="ranking-item">\s*([^<]+?)\s*<\/div>/i);
      const playerName = firstMatch(item, /<div class="jogador-nome">\s*([^<]+?)\s*<\/div>/i);
      const position = firstMatch(item, /<div class="jogador-posicao">\s*([^<]+?)\s*<\/div>/i);
      const goals = firstInt(item, /<div class="jogador-gols">\s*([^<]+?)\s*<\/div>/i);
      const imageUrl = firstMatch(item, /<div class="jogador-foto">[\s\S]*?<img\s+src="([^"]+)"/i);
      const teamFlagUrl = firstMatch(
        item,
        /<div class="jogador-escudo">[\s\S]*?<img\s+src="([^"]+)"/i,
      );
      const teamName = firstMatch(
        item,
        /<div class="jogador-escudo">[\s\S]*?<img[^>]+alt="([^"]+)"/i,
      );

      if (!rank || !playerName || goals == null) return null;

      return {
        rank,
        playerName,
        position,
        teamName: teamName ?? '',
        imageUrl,
        teamFlagUrl,
        goals,
      };
    })
    .filter((scorer): scorer is ScrapedTopScorer => Boolean(scorer));
}

async function scrapeGeTopScorers() {
  const response = await fetch(GE_COPA_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`GE respondeu ${response.status} para ${GE_COPA_URL}`);

  const html = await response.text();
  return parseTopScorersFromHtml(html);
}

async function saveTopScorers(topScorers: ScrapedTopScorer[]) {
  const value = JSON.parse(
    JSON.stringify({
      source: GE_COPA_URL,
      syncedAt: new Date().toISOString(),
      topScorers,
    }),
  ) as Prisma.InputJsonValue;

  await prisma.appSetting.upsert({
    where: { key: TOP_SCORERS_SETTING_KEY },
    update: { value },
    create: { key: TOP_SCORERS_SETTING_KEY, value },
  });
}

async function listCandidateMatches() {
  const now = Date.now();
  const windowStart = new Date(now - 12 * 60 * 60 * 1000);
  const windowEnd = new Date(now + 36 * 60 * 60 * 1000);

  return prisma.match.findMany({
    where: {
      startsAt: { gte: windowStart, lte: windowEnd },
      status: { notIn: [MatchStatus.CANCELLED, MatchStatus.POSTPONED] },
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { startsAt: 'asc' },
  });
}

async function applyScore(score: ScrapedScore) {
  const candidates = await listCandidateMatches();
  const home = normalizeName(score.homeTeam);
  const away = normalizeName(score.awayTeam);
  const match = candidates.find(
    (candidate) =>
      normalizeName(candidate.homeTeam.name) === home &&
      normalizeName(candidate.awayTeam.name) === away,
  );

  if (!match) return applyKnockoutScore(score);

  const status = statusAllowedByKickoff(statusFromGe(score.status), match.startsAt);
  if (shouldIgnoreScoreRegression(match.status, status)) {
    return {
      updated: false,
      changed: false,
      reason: 'FINISHED_MATCH_NOT_REGRESSED',
      matchId: match.id,
      teams: `${match.homeTeam.name} x ${match.awayTeam.name}`,
      score: `${match.finalHomeScore}-${match.finalAwayScore}`,
      status: match.status,
    };
  }
  const homeScore = status === MatchStatus.SCHEDULED ? null : score.homeScore;
  const awayScore = status === MatchStatus.SCHEDULED ? null : score.awayScore;
  const changed =
    match.homeScore !== homeScore ||
    match.awayScore !== awayScore ||
    match.status !== status ||
    (status === MatchStatus.FINISHED &&
      (match.finalHomeScore !== score.homeScore || match.finalAwayScore !== score.awayScore));
  const data: Prisma.MatchUpdateInput = {
    homeScore,
    awayScore,
    status,
    lastSyncedAt: new Date(),
    rawPayload: {
      ...(match.rawPayload &&
      typeof match.rawPayload === 'object' &&
      !Array.isArray(match.rawPayload)
        ? match.rawPayload
        : {}),
      geScore: {
        homeTeam: score.homeTeam,
        awayTeam: score.awayTeam,
        homeScore: score.homeScore,
        awayScore: score.awayScore,
        status: score.status,
        sourceUrl: score.sourceUrl,
        syncedAt: new Date().toISOString(),
      },
    },
  };

  if (status === MatchStatus.FINISHED) {
    data.finalHomeScore = score.homeScore;
    data.finalAwayScore = score.awayScore;
  }

  await prisma.match.update({ where: { id: match.id }, data });
  if (changed) {
    await recalculateScoresForMatch(match.id, { refreshRanking: false });
    await ensureKnockoutInfrastructure();
  }

  return {
    updated: true,
    changed,
    matchId: match.id,
    teams: `${match.homeTeam.name} x ${match.awayTeam.name}`,
    score: homeScore == null || awayScore == null ? null : `${homeScore}-${awayScore}`,
    status,
  };
}

async function applyKnockoutScore(score: ScrapedScore) {
  const now = Date.now();
  const [fixtures, teams] = await Promise.all([
    prisma.knockoutFixture.findMany({
      where: {
        startsAt: {
          gte: new Date(now - 12 * 60 * 60 * 1000),
          lte: new Date(now + 36 * 60 * 60 * 1000),
        },
        status: { notIn: [MatchStatus.CANCELLED, MatchStatus.POSTPONED] },
      },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.team.findMany(),
  ]);
  const homeName = normalizeName(score.homeTeam);
  const awayName = normalizeName(score.awayTeam);
  const homeTeam = teams.find((team) => normalizeName(team.name) === homeName);
  const awayTeam = teams.find((team) => normalizeName(team.name) === awayName);
  if (!homeTeam || !awayTeam) return { updated: false, reason: 'MATCH_NOT_FOUND', score };

  const fixture = fixtures.find((candidate) => {
    if (candidate.homeTeam && candidate.awayTeam) {
      return (
        normalizeName(candidate.homeTeam.name) === homeName &&
        normalizeName(candidate.awayTeam.name) === awayName
      );
    }
    return score.startsAt
      ? Math.abs(candidate.startsAt.getTime() - score.startsAt.getTime()) <= 6 * 60 * 60 * 1000
      : false;
  });
  if (!fixture) return { updated: false, reason: 'MATCH_NOT_FOUND', score };

  const status = statusFromGe(score.status);
  if (shouldIgnoreScoreRegression(fixture.status, status)) {
    return {
      updated: false,
      changed: false,
      reason: 'FINISHED_MATCH_NOT_REGRESSED',
      knockoutFixtureId: fixture.id,
      score: `${fixture.finalHomeScore}-${fixture.finalAwayScore}`,
      status: fixture.status,
    };
  }
  const winnerTeamName = score.winnerTeam;
  const winnerTeam = winnerTeamName
    ? teams.find((team) => normalizeName(team.name) === normalizeName(winnerTeamName))
    : score.homeScore > score.awayScore
      ? homeTeam
      : score.awayScore > score.homeScore
        ? awayTeam
        : null;
  const changed =
    fixture.homeTeamId !== homeTeam.id ||
    fixture.awayTeamId !== awayTeam.id ||
    fixture.homeScore !== score.homeScore ||
    fixture.awayScore !== score.awayScore ||
    fixture.status !== status ||
    (status === MatchStatus.FINISHED &&
      (fixture.finalHomeScore !== score.homeScore || fixture.finalAwayScore !== score.awayScore));
  await prisma.knockoutFixture.update({
    where: { id: fixture.id },
    data: {
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      winnerTeamId:
        status === MatchStatus.FINISHED ? (winnerTeam?.id ?? null) : fixture.winnerTeamId,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      finalHomeScore: status === MatchStatus.FINISHED ? score.homeScore : fixture.finalHomeScore,
      finalAwayScore: status === MatchStatus.FINISHED ? score.awayScore : fixture.finalAwayScore,
      status,
      lastSyncedAt: new Date(),
      rawPayload: {
        geScore: {
          homeTeam: score.homeTeam,
          awayTeam: score.awayTeam,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          winnerTeam: score.winnerTeam,
          status: score.status,
          sourceUrl: score.sourceUrl,
          syncedAt: new Date().toISOString(),
        },
      },
    },
  });
  if (changed) {
    await recalculateKnockoutScoresForFixture(fixture.id, { refreshRanking: false });
    if (status === MatchStatus.FINISHED) await syncOfficialKnockoutParticipants();
  }

  return {
    updated: true,
    changed,
    knockoutFixtureId: fixture.id,
    teams: `${homeTeam.name} x ${awayTeam.name}`,
    score: `${score.homeScore}-${score.awayScore}`,
    status,
  };
}

interface ChangedSyncResult {
  changed: true;
  matchId?: string;
  knockoutFixtureId?: string;
}

function isChangedResult(result: unknown): result is ChangedSyncResult {
  return Boolean(
    result && typeof result === 'object' && 'changed' in result && result.changed === true,
  );
}

async function notifyApiRealtime(results: unknown[]) {
  const changed = results.filter(isChangedResult);
  if (!changed.length) return;

  const ranking = await refreshRankingSnapshot();
  const response = await fetch(
    `http://127.0.0.1:${config.PORT}/api/internal/realtime/sync-completed`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-events-secret': config.INTERNAL_EVENTS_SECRET ?? config.SESSION_SECRET,
      },
      body: JSON.stringify({
        ranking,
        updatedMatchIds: changed.flatMap((result) => (result.matchId ? [result.matchId] : [])),
        updatedKnockoutFixtureIds: changed.flatMap((result) =>
          result.knockoutFixtureId ? [result.knockoutFixtureId] : [],
        ),
        updatedAt: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) throw new Error(`API interna respondeu ${response.status}`);
}

async function runGeScoreScrapeCore(requestedByUserId?: string | null) {
  const startedAt = new Date();
  try {
    const scores = await scrapeGeScores();
    const topScorers = await scrapeGeTopScorers().catch((error) => {
      logger.warn({ error }, 'GE top scorers scrape failed');
      return null;
    });
    const results = [];
    for (const score of scores) {
      results.push(await applyScore(score));
    }
    if (topScorers) await saveTopScorers(topScorers);
    await notifyApiRealtime(results).catch((error) => {
      logger.warn({ error }, 'Realtime API notification failed');
    });

    let changedEntries = 0;
    let updatedMatches = 0;
    let updatedKnockoutFixtures = 0;
    for (const result of results) {
      if (!isChangedResult(result)) continue;
      changedEntries += 1;
      if ('matchId' in result && typeof result.matchId === 'string') updatedMatches += 1;
      if (
        'knockoutFixtureId' in result &&
        typeof result.knockoutFixtureId === 'string'
      ) {
        updatedKnockoutFixtures += 1;
      }
    }

    const summary: GeScoreSyncResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      scraped: scores.length,
      topScorers: topScorers?.length ?? null,
      changedEntries,
      updatedMatches,
      updatedKnockoutFixtures,
    };

    await prisma.apiSyncLog.create({
      data: {
        source: 'ge.globo.com:copa',
        status: 'SUCCESS',
        startedAt,
        finishedAt: new Date(summary.finishedAt),
        details: JSON.parse(
          JSON.stringify({
            scraped: scores.length,
            results,
            topScorers: topScorers?.length ?? null,
            requestedByUserId: requestedByUserId ?? null,
          }),
        ) as Prisma.InputJsonValue,
      },
    });

    logger.info({ requestedByUserId, ...summary }, 'GE scrape finished');
    return summary;
  } catch (error) {
    await prisma.apiSyncLog.create({
      data: {
        source: 'ge.globo.com:copa',
        status: 'FAILED',
        startedAt,
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : 'Erro desconhecido',
        details: JSON.parse(
          JSON.stringify({ requestedByUserId: requestedByUserId ?? null }),
        ) as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

export async function runGeScoreScrapeOnce(options: { requestedByUserId?: string | null } = {}) {
  if (!activeRun) {
    activeRun = runGeScoreScrapeCore(options.requestedByUserId).finally(() => {
      activeRun = null;
    });
  }

  return activeRun;
}

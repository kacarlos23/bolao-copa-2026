import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompetitionCapabilities, CompetitionDto, SeasonDto } from '@bolao/shared';
import { api, errorMessage, LatestRequest } from '../api';

export type Capability = 'LEAGUE' | 'GROUPS' | 'KNOCKOUT' | 'TWO_LEGS';

export function mergeCapabilities(
  competition?: CompetitionCapabilities | null,
  season?: CompetitionCapabilities | null,
): CompetitionCapabilities {
  return { ...(competition ?? {}), ...(season ?? {}) };
}

export function normalizeCapabilities(
  competition?: CompetitionCapabilities | null,
  season?: CompetitionCapabilities | null,
) {
  const source = mergeCapabilities(competition, season);
  const values = new Set<Capability>();
  if (source.format) values.add(source.format);
  if (source.groupStage || source.format === 'GROUPS') values.add('GROUPS');
  if (source.knockoutBracket || source.knockout || source.format === 'KNOCKOUT')
    values.add('KNOCKOUT');
  if (source.format === 'LEAGUE') values.add('LEAGUE');
  if (source.twoLegs || source.format === 'TWO_LEGS') values.add('TWO_LEGS');
  if (source.twoLegs || source.format === 'TWO_LEGS') values.add('KNOCKOUT');
  return values;
}

interface CompetitionContextValue {
  competitions: CompetitionDto[];
  seasons: SeasonDto[];
  competition: CompetitionDto | null;
  season: SeasonDto | null;
  capabilityConfig: CompetitionCapabilities;
  capabilities: ReadonlySet<Capability>;
  uiEnabled: boolean;
  loading: boolean;
  error: string;
  selectCompetition: (competitionId: string) => Promise<void>;
  selectSeason: (seasonId: string) => void;
  retry: () => void;
}

const CompetitionContext = createContext<CompetitionContextValue | null>(null);

export function CompetitionProvider({
  children,
  initialCompetitionSlug,
  userRole = 'USER',
}: {
  children: ReactNode;
  initialCompetitionSlug?: string | null;
  userRole?: 'USER' | 'ADMIN';
}) {
  const [competitions, setCompetitions] = useState<CompetitionDto[]>([]);
  const [seasons, setSeasons] = useState<SeasonDto[]>([]);
  const [competition, setCompetition] = useState<CompetitionDto | null>(null);
  const [season, setSeason] = useState<SeasonDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uiEnabled, setUiEnabled] = useState(true);
  const [reload, setReload] = useState(0);
  const competitionRequest = useRef(new LatestRequest()).current;
  const featureRequest = useRef(new LatestRequest()).current;
  const loadingSequence = useRef(0);

  async function loadUiFeature(
    selected: CompetitionDto,
    selectedSeason: SeasonDto | null,
  ) {
    const selectedCapabilities = mergeCapabilities(
      selected.capabilities,
      selectedSeason?.capabilities,
    );
    if (
      !selectedSeason ||
      userRole === 'ADMIN' ||
      selectedCapabilities.workspace === 'WORLD_CUP_LEGACY'
    ) {
      featureRequest.cancel();
      setUiEnabled(true);
      return;
    }
    const feature = await featureRequest.run((signal) =>
      api
        .seasonUiFeature(selectedSeason.id, signal)
        .catch(() => ({ uiEnabled: false })),
    );
    if (feature) setUiEnabled(feature.uiEnabled);
  }

  async function loadSeasons(selected: CompetitionDto, preferredSeasonId?: string | null) {
    const currentLoading = ++loadingSequence.current;
    setLoading(true);
    setError('');
    try {
      const result = await competitionRequest.run((signal) =>
        api.competitionSeasons(selected.slug, signal),
      );
      if (!result) return;
      const preferred = result.seasons.find((item) => item.id === preferredSeasonId);
      const active = result.seasons.find((item) => item.status === 'ACTIVE');
      const nextSeason = preferred ?? active ?? result.seasons[0] ?? null;
      setSeasons(result.seasons);
      setCompetition(selected);
      setSeason(nextSeason);
      await loadUiFeature(selected, nextSeason);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('bolao:selected-competition', selected.id);
        if (nextSeason) window.localStorage.setItem('bolao:selected-season', nextSeason.id);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      if (currentLoading === loadingSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .competitions()
      .then(async (result) => {
        if (!active) return;
        setCompetitions(result.competitions);
        const preferredId =
          typeof window !== 'undefined'
            ? window.localStorage.getItem('bolao:selected-competition')
            : null;
        const preferredSeasonId =
          typeof window !== 'undefined'
            ? window.localStorage.getItem('bolao:selected-season')
            : null;
        const selected =
          result.competitions.find((item) => item.slug === initialCompetitionSlug) ??
          result.competitions.find((item) => item.id === preferredId) ??
          result.competitions[0];
        if (selected) await loadSeasons(selected, preferredSeasonId);
        else setLoading(false);
      })
      .catch((cause) => {
        if (active) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      competitionRequest.cancel();
      featureRequest.cancel();
    };
  }, [competitionRequest, reload]);

  async function selectCompetition(competitionId: string) {
    const selected = competitions.find((item) => item.id === competitionId);
    if (!selected || selected.id === competition?.id) return;
    await loadSeasons(selected);
  }

  function selectSeason(seasonId: string) {
    const selected = seasons.find((item) => item.id === seasonId);
    if (!selected) return;
    const currentLoading = ++loadingSequence.current;
    setSeason(selected);
    setLoading(true);
    void loadUiFeature(competition!, selected).finally(() => {
      if (currentLoading === loadingSequence.current) setLoading(false);
    });
    if (typeof window !== 'undefined')
      window.localStorage.setItem('bolao:selected-season', selected.id);
  }

  const capabilityConfig = mergeCapabilities(competition?.capabilities, season?.capabilities);

  return (
    <CompetitionContext.Provider
      value={{
        competitions,
        seasons,
        competition,
        season,
        capabilityConfig,
        capabilities: normalizeCapabilities(competition?.capabilities, season?.capabilities),
        uiEnabled,
        loading,
        error,
        selectCompetition,
        selectSeason,
        retry: () => setReload((value) => value + 1),
      }}
    >
      {children}
    </CompetitionContext.Provider>
  );
}

export function useCompetition() {
  const context = useContext(CompetitionContext);
  if (!context) throw new Error('useCompetition deve ser usado dentro de CompetitionProvider.');
  return context;
}

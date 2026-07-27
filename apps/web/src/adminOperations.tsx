import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  api,
  type CompetitionFeatureFlags,
  type GenericMatch,
  type SeasonSyncResponse,
} from './api';
import { errorMessage, request } from './services/api-client';
import { civilDateKey, prioritizeAdminMatches } from './adminOperations.logic';
import { FundraisingAdmin } from './features/admin/FundraisingAdmin';
import { theme } from './theme/tokens';

type PoolSeason = {
  id: string;
  scoringRuleSetVersionId: string | null;
  pool: { name: string; slug: string };
};
type Season = {
  id: string;
  name: string;
  timezone?: string;
  status: string;
  rounds: unknown[];
  poolSeasons: PoolSeason[];
  _count: { matches: number; teams: number };
  featureFlags: CompetitionFeatureFlags;
  featureFlagsState: 'VALID' | 'MISSING' | 'INVALID' | 'RESTORED_DRAFT';
  nextJob: { id: string; type: string; status: string; createdAt: string } | null;
  refresh: {
    available: boolean;
    providers: Array<{
      providerKey: string;
      priority: number;
      enabledTypes: string[];
      cadenceSeconds: number;
      timeoutMs: number;
      includeProfiles: boolean;
      source: string;
      provenance: string;
      schedule: {
        cadenceSeconds: number;
        mode: 'LIVE' | 'SCHEDULED_NEAR' | 'IDLE';
        nextRunAt: string;
        due: boolean;
      } | null;
    }>;
    lastRun: {
      provider: string;
      status: string;
      source: string;
      collectedAt: string | null;
      checksum: string | null;
      startedAt: string;
      finishedAt: string | null;
    } | null;
  };
};
type Preview = {
  previewId: string;
  affectedCount: number;
  confirmation: string;
  expiresAt: string;
  preview: unknown;
};
type AdminJob = {
  id: string;
  type: string;
  status: string;
  processedCount: number;
  affectedCount: number;
  errorCode?: string | null;
};

function operationKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function Button({
  label,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'warn';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === 'warn' && styles.warnButton, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, tone === 'warn' && styles.warnText]}>{label}</Text>
    </Pressable>
  );
}

function Module({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.module}>
      <Text role="heading" aria-level={3} style={styles.title}>
        {title}
      </Text>
      <Text style={styles.copy}>{description}</Text>
      {children}
    </View>
  );
}

export function AdminOperationsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [poolSeasonId, setPoolSeasonId] = useState('');
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [matches, setMatches] = useState<GenericMatch[]>([]);
  const [divergences, setDivergences] = useState<{
    quarantine: unknown[];
    overrides: unknown[];
    mappings: unknown[];
    runs: unknown[];
  }>({ quarantine: [], overrides: [], mappings: [], runs: [] });
  const [auditCount, setAuditCount] = useState(0);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState('Reprocessamento operacional validado pelo administrador');
  const [competitionReason, setCompetitionReason] = useState(
    'Atualizacao operacional completa da competicao via painel administrativo',
  );
  const [matchId, setMatchId] = useState('');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [liveStatus, setLiveStatus] = useState<'LIVE' | 'FINISHED'>('LIVE');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refreshResult, setRefreshResult] = useState<SeasonSyncResponse | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSeason = useMemo(
    () => seasons.find((item) => item.id === seasonId),
    [seasonId, seasons],
  );
  const selectedPool =
    selectedSeason?.poolSeasons.find((item) => item.id === poolSeasonId) ??
    selectedSeason?.poolSeasons[0];
  const selectedMatch = useMemo(
    () => matches.find((item) => item.id === matchId),
    [matchId, matches],
  );
  const prioritizedMatches = useMemo(
    () => prioritizeAdminMatches(matches, new Date(), selectedSeason?.timezone),
    [matches, selectedSeason?.timezone],
  );
  const todayMatchCount = useMemo(() => {
    const timezone = selectedSeason?.timezone ?? 'America/Sao_Paulo';
    const today = civilDateKey(new Date(), timezone);
    return matches.filter((match) => civilDateKey(new Date(match.startsAt), timezone) === today)
      .length;
  }, [matches, selectedSeason?.timezone]);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const overview = await request<{ seasons: Season[] }>('/api/admin/overview');
      setSeasons(overview.seasons);
      const nextSeasonId = seasonId || overview.seasons[0]?.id || '';
      const nextSeason = overview.seasons.find((item) => item.id === nextSeasonId);
      const nextPoolId = poolSeasonId || nextSeason?.poolSeasons[0]?.id || '';
      setSeasonId(nextSeasonId);
      setPoolSeasonId(nextPoolId);
      if (nextSeasonId) {
        const suffix = `?seasonId=${encodeURIComponent(nextSeasonId)}${nextPoolId ? `&poolSeasonId=${encodeURIComponent(nextPoolId)}` : ''}`;
        const matchPageCount = Math.max(1, Math.ceil((nextSeason?._count.matches ?? 0) / 100));
        const [nextDivergences, nextJobs, audit, nextHealth, nextMatchPages] = await Promise.all([
          request<typeof divergences>(
            `/api/admin/divergences?seasonId=${encodeURIComponent(nextSeasonId)}`,
          ),
          request<{ jobs: AdminJob[] }>(`/api/admin/jobs${suffix}`),
          request<{ logs: unknown[] }>(`/api/admin/audit${suffix}`),
          request<Record<string, unknown>>(`/api/admin/health${suffix}`),
          Promise.all(
            Array.from({ length: matchPageCount }, (_, index) =>
              api.seasonMatches(nextSeasonId, { page: index + 1, pageSize: 100 }),
            ),
          ),
        ]);
        const nextMatches = prioritizeAdminMatches(
          nextMatchPages.flatMap((page) => page.matches),
          new Date(),
          nextSeason?.timezone,
        ) as GenericMatch[];
        setDivergences(nextDivergences);
        setJobs(nextJobs.jobs);
        setAuditCount(audit.logs.length);
        setHealth(nextHealth);
        setMatches(nextMatches);
        setMatchId((current) =>
          nextMatches.some((match) => match.id === current) ? current : (nextMatches[0]?.id ?? ''),
        );
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function previewReprocess() {
    if (!selectedSeason || !selectedPool?.scoringRuleSetVersionId) return;
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const result = await request<Preview>('/api/admin/reprocess/preview', {
        method: 'POST',
        idempotencyKey: operationKey('reprocess-preview'),
        body: JSON.stringify({
          seasonId: selectedSeason.id,
          poolSeasonId: selectedPool.id,
          ruleSetVersionId: selectedPool.scoringRuleSetVersionId,
          targets: ['SCORES', 'RANKING', 'ACHIEVEMENTS'],
          justification: reason,
        }),
      });
      setPreview(result);
      setConfirmation('');
      setMessage(`Previa pronta: ${result.affectedCount} registros no escopo.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function applyReprocess() {
    if (!preview || !selectedSeason || !selectedPool?.scoringRuleSetVersionId) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/admin/reprocess', {
        method: 'POST',
        idempotencyKey: operationKey('reprocess-apply'),
        body: JSON.stringify({
          seasonId: selectedSeason.id,
          poolSeasonId: selectedPool.id,
          ruleSetVersionId: selectedPool.scoringRuleSetVersionId,
          targets: ['SCORES', 'RANKING', 'ACHIEVEMENTS'],
          justification: reason,
          previewId: preview.previewId,
          confirmation,
        }),
      });
      setPreview(null);
      setConfirmation('');
      setMessage('Job idempotente enfileirado.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function refreshCompetitionData() {
    if (!selectedSeason) return;
    setBusy(true);
    setError('');
    setMessage('');
    setRefreshResult(null);
    try {
      const result = await api.adminRefreshCompetitionData(
        selectedSeason.id,
        competitionReason,
        true,
      );
      setRefreshResult(result);
      setMessage(
        `${selectedSeason.name}: ${result.status === 'UPDATED' ? 'dados reconciliados' : 'fonte já estava reconciliada'}; ${result.changedMatches} jogo(s), ${result.updatedProfiles ?? 0} perfil(is), ${result.runs.length} etapa(s).`,
      );
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveLiveResult() {
    if (!selectedSeason || !selectedMatch) return;
    const home = Number(homeScore);
    const away = Number(awayScore);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      setError('Informe placares validos.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.adminSetLiveMatchResult(selectedSeason.id, selectedMatch.id, {
        status: liveStatus,
        homeScore: home,
        awayScore: away,
        justification: competitionReason,
      });
      setMessage('Placar registrado e ranking recalculado em tempo real.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function jobAction(job: AdminJob, action: 'pause' | 'resume' | 'retry') {
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/jobs/${job.id}/${action}`, {
        method: 'POST',
        idempotencyKey: operationKey(`job-${action}`),
        body: JSON.stringify({
          justification: `${
            action === 'pause' ? 'Pausa' : action === 'resume' ? 'Retomada' : 'Reexecucao'
          } operacional solicitada apos inspecao do impacto`,
        }),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel} accessibilityLabel="Operacao segura da plataforma">
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>ADMINISTRAÇÃO</Text>
          <Text style={styles.heading}>Central de operação segura</Text>
        </View>
        {busy ? (
          <ActivityIndicator color={theme.color.accent} />
        ) : (
          <Button label="Atualizar" onPress={() => void load()} />
        )}
      </View>
      <Text style={styles.copy}>
        Toda aplicacao usa CSRF, justificativa, chave idempotente, escopo de temporada e trilha
        before/after. O papel global nao cria membership no bolao.
      </Text>
      <ScrollView
        horizontal
        contentContainerStyle={styles.seasons}
        showsHorizontalScrollIndicator={false}
      >
        {seasons.map((season) => (
          <Pressable
            key={season.id}
            accessibilityRole="button"
            accessibilityState={{ selected: season.id === seasonId }}
            onPress={() => {
              setSeasonId(season.id);
              setPoolSeasonId(season.poolSeasons[0]?.id ?? '');
              setPreview(null);
              setRefreshResult(null);
            }}
            style={[styles.season, season.id === seasonId && styles.selected]}
          >
            <Text style={styles.seasonName}>{season.name}</Text>
            <Text style={styles.meta}>
              {season.status} - {season._count.matches} jogos
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {selectedSeason?.poolSeasons.length ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.seasons}
          showsHorizontalScrollIndicator={false}
          accessibilityLabel="Bolões da temporada"
        >
          {selectedSeason.poolSeasons.map((poolSeason) => (
            <Pressable
              key={poolSeason.id}
              accessibilityRole="button"
              accessibilityState={{ selected: poolSeason.id === selectedPool?.id }}
              onPress={() => {
                setPoolSeasonId(poolSeason.id);
                setPreview(null);
              }}
              style={[styles.season, poolSeason.id === selectedPool?.id && styles.selected]}
            >
              <Text style={styles.seasonName}>{poolSeason.pool.name}</Text>
              <Text style={styles.meta}>{poolSeason.id}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.grid}>
        <Module
          title="Temporadas e rodadas"
          description={`${selectedSeason?.rounds.length ?? 0} rodadas. Arquivamento e logico e exige preview.`}
        />
        <Module
          title="Import / sync"
          description={`${divergences.runs.length} execuções recentes. A fonte é escolhida pela configuração da competição, sem lógica específica no painel.`}
        />
        <Module
          title="Mappings e quarantine"
          description={`${divergences.quarantine.length} divergencias pendentes; a resolucao valida o alvo dentro da mesma temporada.`}
        />
        <Module
          title="Overrides de partida"
          description={`${divergences.overrides.length} overrides visíveis, com provenance manual e rollback explícito.`}
        />
        <Module
          title="Rule sets"
          description={`Versao fixada: ${selectedPool?.scoringRuleSetVersionId ?? 'nao configurada'}. Alteracao e bloqueada apos o primeiro palpite.`}
        />
        <Module
          title="Usuarios"
          description="Papel, bloqueio e revogacao de sessao sao independentes das memberships sociais."
        />
        <Module
          title="Auditoria"
          description={`${auditCount} eventos carregados com actor, requestId, seasonId, poolSeasonId, justificativa e before/after.`}
        />
        <Module
          title="Saude"
          description={
            health
              ? `Provider, SSE, conexao, ranking e backup inspecionados em ${(health.checkedAt as string) ?? 'agora'}.`
              : 'Aguardando diagnostico.'
          }
        />
      </View>
      <FundraisingAdmin seasonId={selectedSeason?.id ?? ''} poolSeasonId={selectedPool?.id ?? ''} />
      <Module
        title="Atualizar informações da competição"
        description={
          selectedSeason?.refresh.available
            ? `Busca agora em ${selectedSeason.refresh.providers.map((provider) => provider.providerKey).join(', ')} e reconcilia ${selectedSeason.refresh.providers.flatMap((provider) => provider.enabledTypes).join(', ')}. A ação não habilita leitura, escrita, UI pública ou sync automático.`
            : 'Esta temporada ainda não possui uma fonte de atualização configurada.'
        }
      >
        {selectedSeason?.refresh.providers.map((provider) => (
          <View key={provider.providerKey} style={styles.provider}>
            <Text style={styles.seasonName}>{provider.providerKey}</Text>
            <Text style={styles.meta}>
              prioridade {provider.priority} · base {provider.cadenceSeconds}s · timeout{' '}
              {provider.timeoutMs}ms
            </Text>
            <Text style={styles.meta}>{provider.source}</Text>
            <Text style={styles.meta}>
              {provider.schedule
                ? `${provider.schedule.mode} · próximo job ${new Date(
                    provider.schedule.nextRunAt,
                  ).toLocaleString('pt-BR')}`
                : 'Scheduler inativo para o status atual'}
            </Text>
          </View>
        ))}
        {selectedSeason ? (
          <Text style={styles.copy}>
            Canário atual — leitura: {selectedSeason.featureFlags.readEnabled ? 'on' : 'off'};
            escrita: {selectedSeason.featureFlags.writeEnabled ? 'on' : 'off'}; UI:{' '}
            {selectedSeason.featureFlags.uiEnabled ? 'on' : 'off'}; automático:{' '}
            {selectedSeason.featureFlags.syncEnabled ? 'on' : 'off'}. Registro:{' '}
            {selectedSeason.featureFlagsState}.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Justificativa da atualizacao da competicao"
          value={competitionReason}
          onChangeText={setCompetitionReason}
          style={styles.input}
          placeholder="Justificativa (minimo 10 caracteres)"
          placeholderTextColor={theme.color.textMuted}
        />
        <View style={styles.actions}>
          <Button
            label={
              selectedSeason ? `Buscar e atualizar ${selectedSeason.name}` : 'Buscar e atualizar'
            }
            onPress={() => void refreshCompetitionData()}
            disabled={
              busy || !selectedSeason?.refresh.available || competitionReason.trim().length < 10
            }
          />
        </View>
        {refreshResult ? (
          <View style={styles.report} accessibilityLabel="Relatório da atualização da competição">
            <Text style={styles.seasonName}>
              Relatório {refreshResult.status} —{' '}
              {new Date(refreshResult.lastSyncedAt).toLocaleString('pt-BR')}
            </Text>
            {refreshResult.runs.map((run) => (
              <View key={run.runId} style={styles.run}>
                <Text style={styles.seasonName}>
                  {run.type} · {run.status}
                </Text>
                <Text style={styles.meta}>
                  {run.counts.fetched} lidos · {run.counts.inserted} inseridos ·{' '}
                  {run.counts.updated} atualizados · {run.counts.unchanged} iguais ·{' '}
                  {run.counts.quarantined} em quarentena
                </Text>
                <Text style={styles.meta}>{run.source}</Text>
                <Text style={styles.hash}>
                  coleta {new Date(run.collectedAt).toLocaleString('pt-BR')} · sha256{' '}
                  {run.checksum || 'indisponível'}
                </Text>
              </View>
            ))}
            {refreshResult.evidence?.map(({ provider, details }) => (
              <View key={`evidence:${provider}`} style={styles.run}>
                <Text style={styles.seasonName}>Evidência oficial · {provider}</Text>
                <Text style={styles.meta}>
                  coleta{' '}
                  {details.collectedAt
                    ? new Date(details.collectedAt).toLocaleString('pt-BR')
                    : 'não informada'}{' '}
                  · fuso {details.collectionTimezone ?? details.timezone ?? 'não informado'}{' '}
                  {details.sourceOffset ?? ''}
                </Text>
                <Text style={styles.hash}>
                  snapshot sha256 {details.checksum ?? 'indisponível'}
                </Text>
                {[
                  ...(details.artifacts ?? []),
                  ...(details.documents ?? []).map((document) => ({
                    source: document.url,
                    checksum: document.checksum,
                    byteLength: document.bytes,
                  })),
                ].map((artifact) => (
                  <View key={`${provider}:${artifact.source}`}>
                    <Text style={styles.meta}>{artifact.source}</Text>
                    <Text style={styles.hash}>
                      {artifact.byteLength} bytes · sha256 {artifact.checksum}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
            {refreshResult.warnings?.map((warning) => (
              <Text key={`${warning.provider}:${warning.scope}`} style={styles.warning}>
                Aviso {warning.provider} / {warning.scope}: {warning.message}
              </Text>
            ))}
            <Text style={refreshResult.featureFlagsUnchanged ? styles.success : styles.error}>
              {refreshResult.featureFlagsUnchanged
                ? 'Flags preservadas: nenhuma liberação pública foi feita.'
                : 'Atenção: as flags mudaram durante a operação; revise a auditoria.'}
            </Text>
          </View>
        ) : null}
      </Module>
      <Module
        title="Placar ao vivo"
        description={
          selectedMatch
            ? `${todayMatchCount ? `${todayMatchCount} jogo(s) de hoje em prioridade. ` : ''}${selectedMatch.homeTeam.name} x ${selectedMatch.awayTeam.name}`
            : 'Selecione uma partida para registrar placar manual.'
        }
      >
        <ScrollView
          horizontal
          contentContainerStyle={styles.seasons}
          showsHorizontalScrollIndicator={false}
        >
          {prioritizedMatches.slice(0, 80).map((match) => (
            <Pressable
              key={match.id}
              accessibilityRole="button"
              accessibilityState={{ selected: match.id === matchId }}
              onPress={() => {
                setMatchId(match.id);
                setHomeScore(String(match.homeScore ?? match.finalHomeScore ?? ''));
                setAwayScore(String(match.awayScore ?? match.finalAwayScore ?? ''));
              }}
              style={[styles.season, match.id === matchId && styles.selected]}
            >
              <Text style={styles.seasonName}>
                {match.homeTeam.name} x {match.awayTeam.name}
              </Text>
              <Text style={styles.meta}>
                {match.status} -{' '}
                {new Date(match.startsAt).toLocaleString('pt-BR', {
                  timeZone: selectedSeason?.timezone ?? 'America/Sao_Paulo',
                })}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.scoreRow}>
          <TextInput
            accessibilityLabel="Placar mandante"
            value={homeScore}
            onChangeText={setHomeScore}
            keyboardType="number-pad"
            style={[styles.input, styles.scoreInput]}
            placeholder="Casa"
            placeholderTextColor={theme.color.textMuted}
          />
          <TextInput
            accessibilityLabel="Placar visitante"
            value={awayScore}
            onChangeText={setAwayScore}
            keyboardType="number-pad"
            style={[styles.input, styles.scoreInput]}
            placeholder="Fora"
            placeholderTextColor={theme.color.textMuted}
          />
        </View>
        <View style={styles.actions}>
          <Button
            label={liveStatus === 'LIVE' ? 'Status: ao vivo' : 'Status: final'}
            onPress={() => setLiveStatus(liveStatus === 'LIVE' ? 'FINISHED' : 'LIVE')}
          />
          <Button
            label="Registrar placar"
            tone="warn"
            onPress={() => void saveLiveResult()}
            disabled={busy || !selectedMatch || competitionReason.trim().length < 10}
          />
        </View>
      </Module>
      <Module
        title="Reprocessamento versionado"
        description="A previa conta o impacto. A execucao assincrona e interrompida se a versao de regras mudar."
      >
        <TextInput
          accessibilityLabel="Justificativa da operacao"
          value={reason}
          onChangeText={setReason}
          style={styles.input}
          placeholder="Justificativa (minimo 10 caracteres)"
          placeholderTextColor={theme.color.textMuted}
        />
        <View style={styles.actions}>
          <Button
            label="Gerar dry-run"
            onPress={() => void previewReprocess()}
            disabled={busy || !selectedPool?.scoringRuleSetVersionId || reason.trim().length < 10}
          />
        </View>
        {preview ? (
          <View style={styles.confirm}>
            <Text style={styles.copy}>
              Digite exatamente: <Text style={styles.code}>{preview.confirmation}</Text>
            </Text>
            <TextInput
              accessibilityLabel="Confirmacao reforcada"
              value={confirmation}
              onChangeText={setConfirmation}
              style={styles.input}
              autoCapitalize="characters"
            />
            <Button
              label={`Confirmar ${preview.affectedCount} registros`}
              tone="warn"
              onPress={() => void applyReprocess()}
              disabled={busy || confirmation !== preview.confirmation}
            />
          </View>
        ) : null}
      </Module>
      <Module
        title="Jobs"
        description="Pausa cooperativa e reexecucao limitada; nenhuma execucao concorrente usa a mesma chave."
      >
        {!jobs.length ? <Text style={styles.meta}>Nenhum job no escopo selecionado.</Text> : null}
        {jobs.map((job) => (
          <View key={job.id} style={styles.job}>
            <View>
              <Text style={styles.seasonName}>{job.type}</Text>
              <Text style={styles.meta}>
                {job.status} - {job.processedCount}/{job.affectedCount}
              </Text>
              {job.errorCode ? <Text style={styles.jobError}>{job.errorCode}</Text> : null}
            </View>
            <View style={styles.actions}>
              {['QUEUED', 'RUNNING'].includes(job.status) ? (
                <Button label="Pausar" tone="warn" onPress={() => void jobAction(job, 'pause')} />
              ) : null}
              {job.status === 'PAUSED' ? (
                <Button label="Retomar" onPress={() => void jobAction(job, 'resume')} />
              ) : null}
              {job.status === 'FAILED' ? (
                <Button label="Reexecutar" onPress={() => void jobAction(job, 'retry')} />
              ) : null}
            </View>
          </View>
        ))}
      </Module>
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: theme.space.lg,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.md,
    justifyContent: 'space-between',
    padding: theme.space.lg,
  },
  kicker: {
    color: theme.color.accent,
    fontSize: theme.font.size.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heading: {
    color: theme.color.text,
    fontSize: theme.font.size.xl,
    fontWeight: '900',
    marginTop: theme.space.xs,
  },
  copy: { color: theme.color.textMuted, lineHeight: 20 },
  seasons: { gap: theme.space.sm, paddingBottom: theme.space.xs },
  season: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minHeight: 62,
    minWidth: 190,
    padding: theme.space.md,
  },
  selected: { backgroundColor: theme.color.accentMuted, borderColor: theme.color.accent },
  seasonName: { color: theme.color.text, fontWeight: '800' },
  meta: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  module: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexGrow: 1,
    gap: theme.space.sm,
    minWidth: 240,
    padding: theme.space.lg,
  },
  title: { color: theme.color.text, fontSize: 16, fontWeight: '900' },
  input: {
    backgroundColor: theme.color.canvas,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.text,
    minHeight: theme.touchTarget,
    outlineColor: theme.color.focus,
    padding: theme.space.md,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  button: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderColor: theme.color.accent,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  buttonText: { color: theme.color.accentInk, fontWeight: '900' },
  warnButton: { backgroundColor: theme.color.warningMuted, borderColor: theme.color.warning },
  warnText: { color: theme.color.warning },
  disabled: { opacity: 0.45 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scoreInput: { flex: 1, minWidth: 120 },
  confirm: {
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
    gap: theme.space.sm,
    paddingTop: theme.space.md,
  },
  provider: {
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
    paddingTop: theme.space.sm,
  },
  report: {
    borderTopColor: theme.color.borderStrong,
    borderTopWidth: 1,
    gap: theme.space.sm,
    paddingTop: theme.space.md,
  },
  run: {
    borderLeftColor: theme.color.success,
    borderLeftWidth: 2,
    gap: 3,
    paddingLeft: theme.space.sm,
  },
  hash: { color: theme.color.textSubtle, fontFamily: 'monospace', fontSize: 11 },
  code: { color: theme.color.warning, fontFamily: 'monospace', fontWeight: '900' },
  job: {
    alignItems: 'center',
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    justifyContent: 'space-between',
    paddingTop: theme.space.sm,
  },
  success: {
    backgroundColor: theme.color.successMuted,
    borderColor: theme.color.success,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.success,
    fontWeight: '700',
    padding: theme.space.md,
  },
  warning: { color: theme.color.warning, fontWeight: '700' },
  jobError: { color: theme.color.danger, fontSize: 11, fontWeight: '800', marginTop: 3 },
  error: {
    backgroundColor: theme.color.dangerMuted,
    borderColor: theme.color.danger,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: theme.color.danger,
    fontWeight: '700',
    padding: theme.space.md,
  },
});

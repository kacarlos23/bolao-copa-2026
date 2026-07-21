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
import { api, type GenericMatch } from './api';
import { errorMessage, request } from './services/api-client';
import { civilDateKey, prioritizeAdminMatches } from './adminOperations.logic';

type PoolSeason = { id: string; scoringRuleSetVersionId: string | null; pool: { name: string } };
type Season = {
  id: string;
  name: string;
  timezone?: string;
  status: string;
  rounds: unknown[];
  poolSeasons: PoolSeason[];
  _count: { matches: number; teams: number };
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
      <Text style={styles.title}>{title}</Text>
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
        );
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
    try {
      const result = await api.adminRefreshCompetitionData(
        selectedSeason.id,
        competitionReason,
        true,
      );
      setMessage(
        `Dados atualizados: ${result.changedMatches} jogo(s), ${result.updatedProfiles ?? 0} perfil(is), ${result.runs.length} etapa(s).`,
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

  async function jobAction(job: AdminJob, action: 'pause' | 'retry') {
    setBusy(true);
    setError('');
    try {
      await request(`/api/admin/jobs/${job.id}/${action}`, {
        method: 'POST',
        idempotencyKey: operationKey(`job-${action}`),
        body: JSON.stringify({
          justification: `${action === 'pause' ? 'Pausa' : 'Reexecucao'} operacional solicitada apos inspecao do impacto`,
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
          <Text style={styles.kicker}>ETAPA 8</Text>
          <Text style={styles.heading}>Central de operacao segura</Text>
        </View>
        {busy ? (
          <ActivityIndicator color="#34d17b" />
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
            onPress={() => {
              setSeasonId(season.id);
              setPoolSeasonId(season.poolSeasons[0]?.id ?? '');
              setPreview(null);
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
      <View style={styles.grid}>
        <Module
          title="Temporadas e rodadas"
          description={`${selectedSeason?.rounds.length ?? 0} rodadas. Arquivamento e logico e exige preview.`}
        />
        <Module
          title="Import / sync"
          description={`${divergences.runs.length} execucoes recentes. Use o botao abaixo para atualizar tudo pela CBF.`}
        />
        <Module
          title="Mappings e quarantine"
          description={`${divergences.quarantine.length} divergencias pendentes; a resolucao valida o alvo dentro da mesma temporada.`}
        />
        <Module
          title="Overrides de partida"
          description={`${divergences.overrides.length} overrides visiveis, com provenance manual e rollback explicito.`}
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
      <Module
        title="Atualizar dados da competicao"
        description="Executa CBF oficial em uma acao: equipes, tabela, placares, resultados, classificacao e perfis de jogadores."
      >
        <TextInput
          accessibilityLabel="Justificativa da atualizacao da competicao"
          value={competitionReason}
          onChangeText={setCompetitionReason}
          style={styles.input}
          placeholder="Justificativa (minimo 10 caracteres)"
          placeholderTextColor="#7e95af"
        />
        <View style={styles.actions}>
          <Button
            label="Atualizar dados da competicao"
            onPress={() => void refreshCompetitionData()}
            disabled={busy || !selectedSeason || competitionReason.trim().length < 10}
          />
        </View>
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
            placeholderTextColor="#7e95af"
          />
          <TextInput
            accessibilityLabel="Placar visitante"
            value={awayScore}
            onChangeText={setAwayScore}
            keyboardType="number-pad"
            style={[styles.input, styles.scoreInput]}
            placeholder="Fora"
            placeholderTextColor="#7e95af"
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
          placeholderTextColor="#7e95af"
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
        {jobs.map((job) => (
          <View key={job.id} style={styles.job}>
            <View>
              <Text style={styles.seasonName}>{job.type}</Text>
              <Text style={styles.meta}>
                {job.status} - {job.processedCount}/{job.affectedCount}
              </Text>
            </View>
            <View style={styles.actions}>
              {['QUEUED', 'RUNNING'].includes(job.status) ? (
                <Button label="Pausar" tone="warn" onPress={() => void jobAction(job, 'pause')} />
              ) : null}
              {['PAUSED', 'FAILED'].includes(job.status) ? (
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
    backgroundColor: 'rgba(2,36,76,.82)',
    borderColor: '#315b83',
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kicker: { color: '#58e09a', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  heading: { color: '#f5f9ff', fontSize: 22, fontWeight: '900' },
  copy: { color: '#b5c5d9', lineHeight: 20 },
  seasons: { gap: 8 },
  season: { borderColor: '#315b83', borderRadius: 12, borderWidth: 1, minWidth: 190, padding: 12 },
  selected: { backgroundColor: 'rgba(52,209,123,.12)', borderColor: '#34d17b' },
  seasonName: { color: '#f5f9ff', fontWeight: '800' },
  meta: { color: '#8fa5bd', fontSize: 12, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  module: {
    backgroundColor: '#08284b',
    borderColor: '#254d75',
    borderRadius: 13,
    borderWidth: 1,
    flexGrow: 1,
    gap: 8,
    minWidth: 240,
    padding: 13,
  },
  title: { color: '#f5f9ff', fontSize: 16, fontWeight: '900' },
  input: {
    backgroundColor: '#061d38',
    borderColor: '#315b83',
    borderRadius: 10,
    borderWidth: 1,
    color: '#f5f9ff',
    minHeight: 42,
    padding: 11,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#34d17b',
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  buttonText: { color: '#031c27', fontWeight: '900' },
  warnButton: { backgroundColor: 'transparent', borderColor: '#f0ba55', borderWidth: 1 },
  warnText: { color: '#f0c773' },
  disabled: { opacity: 0.45 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scoreInput: { minWidth: 120 },
  confirm: { borderTopColor: '#254d75', borderTopWidth: 1, gap: 9, paddingTop: 10 },
  code: { color: '#f0c773', fontFamily: 'monospace', fontWeight: '900' },
  job: {
    alignItems: 'center',
    borderTopColor: '#254d75',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 9,
  },
  success: { color: '#69e7a4', fontWeight: '700' },
  error: { color: '#ff8878', fontWeight: '700' },
});

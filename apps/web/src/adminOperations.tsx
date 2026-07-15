import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { errorMessage, request } from './services/api-client';

type PoolSeason = { id: string; scoringRuleSetVersionId: string | null; pool: { name: string } };
type Season = { id: string; name: string; status: string; rounds: unknown[]; poolSeasons: PoolSeason[]; _count: { matches: number; teams: number } };
type Preview = { previewId: string; affectedCount: number; confirmation: string; expiresAt: string; preview: unknown };
type AdminJob = { id: string; type: string; status: string; processedCount: number; affectedCount: number; errorCode?: string | null };

function operationKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function Button({ label, onPress, disabled, tone = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'warn' }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.button, tone === 'warn' && styles.warnButton, disabled && styles.disabled]}><Text style={[styles.buttonText, tone === 'warn' && styles.warnText]}>{label}</Text></Pressable>;
}

function Module({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <View style={styles.module}><Text style={styles.title}>{title}</Text><Text style={styles.copy}>{description}</Text>{children}</View>;
}

export function AdminOperationsPanel() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [poolSeasonId, setPoolSeasonId] = useState('');
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [divergences, setDivergences] = useState<{ quarantine: unknown[]; overrides: unknown[]; mappings: unknown[]; runs: unknown[] }>({ quarantine: [], overrides: [], mappings: [], runs: [] });
  const [auditCount, setAuditCount] = useState(0);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState('Reprocessamento operacional validado pelo administrador');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedSeason = useMemo(() => seasons.find((item) => item.id === seasonId), [seasonId, seasons]);
  const selectedPool = selectedSeason?.poolSeasons.find((item) => item.id === poolSeasonId) ?? selectedSeason?.poolSeasons[0];

  async function load() {
    setBusy(true); setError('');
    try {
      const overview = await request<{ seasons: Season[] }>('/api/admin/overview');
      setSeasons(overview.seasons);
      const nextSeasonId = seasonId || overview.seasons[0]?.id || '';
      const nextSeason = overview.seasons.find((item) => item.id === nextSeasonId);
      const nextPoolId = poolSeasonId || nextSeason?.poolSeasons[0]?.id || '';
      setSeasonId(nextSeasonId); setPoolSeasonId(nextPoolId);
      if (nextSeasonId) {
        const suffix = `?seasonId=${encodeURIComponent(nextSeasonId)}${nextPoolId ? `&poolSeasonId=${encodeURIComponent(nextPoolId)}` : ''}`;
        const [nextDivergences, nextJobs, audit, nextHealth] = await Promise.all([
          request<typeof divergences>(`/api/admin/divergences?seasonId=${encodeURIComponent(nextSeasonId)}`),
          request<{ jobs: AdminJob[] }>(`/api/admin/jobs${suffix}`),
          request<{ logs: unknown[] }>(`/api/admin/audit${suffix}`),
          request<Record<string, unknown>>(`/api/admin/health${suffix}`),
        ]);
        setDivergences(nextDivergences); setJobs(nextJobs.jobs); setAuditCount(audit.logs.length); setHealth(nextHealth);
      }
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  async function previewReprocess() {
    if (!selectedSeason || !selectedPool?.scoringRuleSetVersionId) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const result = await request<Preview>('/api/admin/reprocess/preview', {
        method: 'POST', idempotencyKey: operationKey('reprocess-preview'),
        body: JSON.stringify({ seasonId: selectedSeason.id, poolSeasonId: selectedPool.id, ruleSetVersionId: selectedPool.scoringRuleSetVersionId, targets: ['SCORES', 'RANKING', 'ACHIEVEMENTS'], justification: reason }),
      });
      setPreview(result); setConfirmation(''); setMessage(`Prévia pronta: ${result.affectedCount} registros no escopo.`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  async function applyReprocess() {
    if (!preview || !selectedSeason || !selectedPool?.scoringRuleSetVersionId) return;
    setBusy(true); setError('');
    try {
      await request('/api/admin/reprocess', {
        method: 'POST', idempotencyKey: operationKey('reprocess-apply'),
        body: JSON.stringify({ seasonId: selectedSeason.id, poolSeasonId: selectedPool.id, ruleSetVersionId: selectedPool.scoringRuleSetVersionId, targets: ['SCORES', 'RANKING', 'ACHIEVEMENTS'], justification: reason, previewId: preview.previewId, confirmation }),
      });
      setPreview(null); setConfirmation(''); setMessage('Job idempotente enfileirado.'); await load();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  async function jobAction(job: AdminJob, action: 'pause' | 'retry') {
    setBusy(true); setError('');
    try {
      await request(`/api/admin/jobs/${job.id}/${action}`, { method: 'POST', idempotencyKey: operationKey(`job-${action}`), body: JSON.stringify({ justification: `${action === 'pause' ? 'Pausa' : 'Reexecução'} operacional solicitada após inspeção do impacto` }) });
      await load();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return <View style={styles.panel} accessibilityLabel="Operação segura da plataforma">
    <View style={styles.header}><View><Text style={styles.kicker}>ETAPA 8</Text><Text style={styles.heading}>Central de operação segura</Text></View>{busy ? <ActivityIndicator color="#34d17b" /> : <Button label="Atualizar" onPress={() => void load()} />}</View>
    <Text style={styles.copy}>Toda aplicação usa CSRF, justificativa, chave idempotente, escopo de temporada, preview e trilha before/after. O papel global não cria membership no bolão.</Text>
    <ScrollView horizontal contentContainerStyle={styles.seasons} showsHorizontalScrollIndicator={false}>{seasons.map((season) => <Pressable key={season.id} onPress={() => { setSeasonId(season.id); setPoolSeasonId(season.poolSeasons[0]?.id ?? ''); setPreview(null); }} style={[styles.season, season.id === seasonId && styles.selected]}><Text style={styles.seasonName}>{season.name}</Text><Text style={styles.meta}>{season.status} · {season._count.matches} jogos</Text></Pressable>)}</ScrollView>
    <View style={styles.grid}>
      <Module title="Temporadas e rodadas" description={`${selectedSeason?.rounds.length ?? 0} rodadas. Arquivamento é lógico e exige preview; não existe reset ou exclusão em massa.`} />
      <Module title="Import / sync" description={`${divergences.runs.length} execuções recentes. Apply só é liberado a partir do diff dry-run confirmado.`} />
      <Module title="Mappings e quarantine" description={`${divergences.quarantine.length} divergências pendentes; a resolução valida o alvo dentro da mesma temporada.`} />
      <Module title="Overrides de partida" description={`${divergences.overrides.length} overrides visíveis, com provenance manual e rollback explícito para o estado anterior.`} />
      <Module title="Rule sets" description={`Versão fixada: ${selectedPool?.scoringRuleSetVersionId ?? 'não configurada'}. Alteração é bloqueada após o primeiro palpite.`} />
      <Module title="Usuários" description="Papel, bloqueio e revogação de sessão são independentes das memberships sociais." />
      <Module title="Auditoria" description={`${auditCount} eventos carregados com actor, requestId, seasonId, poolSeasonId, justificativa e before/after.`} />
      <Module title="Saúde" description={health ? `Provider, SSE, conexão, ranking e backup inspecionados em ${(health.checkedAt as string) ?? 'agora'}.` : 'Aguardando diagnóstico.'} />
    </View>
    <Module title="Reprocessamento versionado" description="A prévia conta o impacto. A execução assíncrona é interrompida se a versão de regras mudar.">
      <TextInput accessibilityLabel="Justificativa da operação" value={reason} onChangeText={setReason} style={styles.input} placeholder="Justificativa (mínimo 10 caracteres)" placeholderTextColor="#7e95af" />
      <View style={styles.actions}><Button label="Gerar dry-run" onPress={() => void previewReprocess()} disabled={busy || !selectedPool?.scoringRuleSetVersionId || reason.trim().length < 10} /></View>
      {preview ? <View style={styles.confirm}><Text style={styles.copy}>Digite exatamente: <Text style={styles.code}>{preview.confirmation}</Text></Text><TextInput accessibilityLabel="Confirmação reforçada" value={confirmation} onChangeText={setConfirmation} style={styles.input} autoCapitalize="characters" /><Button label={`Confirmar ${preview.affectedCount} registros`} tone="warn" onPress={() => void applyReprocess()} disabled={busy || confirmation !== preview.confirmation} /></View> : null}
    </Module>
    <Module title="Jobs" description="Pausa cooperativa e reexecução limitada; nenhuma execução concorrente usa a mesma chave.">{jobs.map((job) => <View key={job.id} style={styles.job}><View><Text style={styles.seasonName}>{job.type}</Text><Text style={styles.meta}>{job.status} · {job.processedCount}/{job.affectedCount}</Text></View><View style={styles.actions}>{['QUEUED', 'RUNNING'].includes(job.status) ? <Button label="Pausar" tone="warn" onPress={() => void jobAction(job, 'pause')} /> : null}{['PAUSED', 'FAILED'].includes(job.status) ? <Button label="Reexecutar" onPress={() => void jobAction(job, 'retry')} /> : null}</View></View>)}</Module>
    {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: 'rgba(2,36,76,.82)', borderColor: '#315b83', borderRadius: 18, borderWidth: 1, gap: 14, padding: 18 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, kicker: { color: '#58e09a', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, heading: { color: '#f5f9ff', fontSize: 22, fontWeight: '900' },
  copy: { color: '#b5c5d9', lineHeight: 20 }, seasons: { gap: 8 }, season: { borderColor: '#315b83', borderRadius: 12, borderWidth: 1, minWidth: 190, padding: 12 }, selected: { backgroundColor: 'rgba(52,209,123,.12)', borderColor: '#34d17b' }, seasonName: { color: '#f5f9ff', fontWeight: '800' }, meta: { color: '#8fa5bd', fontSize: 12, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, module: { backgroundColor: '#08284b', borderColor: '#254d75', borderRadius: 13, borderWidth: 1, flexGrow: 1, gap: 8, minWidth: 240, padding: 13 }, title: { color: '#f5f9ff', fontSize: 16, fontWeight: '900' },
  input: { backgroundColor: '#061d38', borderColor: '#315b83', borderRadius: 10, borderWidth: 1, color: '#f5f9ff', minHeight: 42, padding: 11 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { backgroundColor: '#34d17b', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }, buttonText: { color: '#031c27', fontWeight: '900' }, warnButton: { backgroundColor: 'transparent', borderColor: '#f0ba55', borderWidth: 1 }, warnText: { color: '#f0c773' }, disabled: { opacity: .45 },
  confirm: { borderTopColor: '#254d75', borderTopWidth: 1, gap: 9, paddingTop: 10 }, code: { color: '#f0c773', fontFamily: 'monospace', fontWeight: '900' }, job: { alignItems: 'center', borderTopColor: '#254d75', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9 }, success: { color: '#69e7a4', fontWeight: '700' }, error: { color: '#ff8878', fontWeight: '700' },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RankingRowDto } from '@bolao/shared';
import { API_URL, type EngagementDashboard, type RankingAward } from '../../api';
import type { ConnectionStatus } from '../../services/realtime';
import { theme } from '../../theme/tokens';

export type PremiumRankingScope = 'overall' | 'round' | 'month' | 'turn-1' | 'turn-2';
type StatusFilter = 'all' | 'live' | 'final';

const rankingScopeCapability: Record<PremiumRankingScope, 'OVERALL' | 'ROUND' | 'MONTH' | 'TURN'> = {
  overall: 'OVERALL',
  round: 'ROUND',
  month: 'MONTH',
  'turn-1': 'TURN',
  'turn-2': 'TURN',
};

const allRankingScopes = new Set(['OVERALL', 'ROUND', 'MONTH', 'TURN']);

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

function avatarUri(value?: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `${API_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function RankingUserAvatar({ row, size = 44 }: { row: Pick<RankingRowDto, 'nickname' | 'avatarUrl'>; size?: number }) {
  const uri = avatarUri(row.avatarUrl);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return uri ? (
    <Image source={{ uri }} resizeMode="cover" style={[styles.avatar, dimensions]} />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback, dimensions]}>
      <Text style={[styles.avatarInitials, { fontSize: Math.max(11, size * 0.3) }]}>{initials(row.nickname)}</Text>
    </View>
  );
}

export function RankingMovementBadge({ row }: { row: RankingRowDto }) {
  const delta = row.movement?.delta;
  if (delta == null) return <Text style={styles.mutedDash}>—</Text>;
  const tone = delta > 0 ? styles.moveUp : delta < 0 ? styles.moveDown : styles.moveSame;
  return (
    <View style={[styles.moveBadge, tone]} accessibilityLabel={`Movimento ${delta > 0 ? 'subiu' : delta < 0 ? 'caiu' : 'estável'} ${Math.abs(delta)} posições`}>
      <Ionicons name={delta > 0 ? 'arrow-up' : delta < 0 ? 'arrow-down' : 'remove'} size={12} color={delta > 0 ? '#8ff5be' : delta < 0 ? '#ffb0a4' : theme.color.textMuted} />
      <Text style={styles.moveText}>{delta > 0 ? '+' : ''}{delta}</Text>
    </View>
  );
}

export function RankingLastFive({ values }: { values: number[] }) {
  const padded = [...values.slice(-5)];
  while (padded.length < 5) padded.unshift(-1);
  return (
    <View style={styles.formRow} accessibilityLabel={`Últimos resultados: ${values.join(', ') || 'sem resultados'}`}>
      {padded.map((value, index) => (
        <View key={`${index}-${value}`} style={[styles.formDot, value < 0 ? styles.formEmpty : value === 0 ? styles.formMiss : value >= 10 ? styles.formExact : styles.formHit]}>
          <Text style={styles.formText}>{value < 0 ? '·' : value}</Text>
        </View>
      ))}
    </View>
  );
}

function scopeLabel(scope: PremiumRankingScope) {
  return ({ overall: 'Geral', round: 'Rodada', month: 'Mês', 'turn-1': 'Turno 1', 'turn-2': 'Turno 2' } as const)[scope];
}

function formatSyncTime(value: string | null) {
  if (!value) return 'Ainda não sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Horário indisponível';
  return `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

function progressValues(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const current = typeof raw.current === 'number' ? raw.current : raw.complete === true ? 1 : null;
  const target = typeof raw.target === 'number' ? raw.target : raw.complete != null ? 1 : null;
  return current != null && target != null && target > 0 ? { current, target } : null;
}

function useRankingEntrance(key: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let context: { revert: () => void } | undefined;
    let cancelled = false;
    void import('gsap').then(({ gsap }) => {
      if (cancelled) return;
      const root = document.querySelector('[data-premium-ranking="root"]');
      if (!root) return;
      context = gsap.context(() => {
        gsap.from('[data-ranking-enter]', { opacity: 0, y: 12, duration: 0.36, stagger: 0.035, ease: 'power2.out', clearProps: 'opacity,transform' });
      }, root);
    });
    return () => { cancelled = true; context?.revert(); };
  }, [key]);
}

function dataTarget(name: string) {
  return Platform.OS === 'web' ? ({ dataSet: { rankingEnter: name } } as never) : {};
}

function ProfileModal({ row, roundPoints, onClose }: { row: RankingRowDto | null; roundPoints: number; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible={Boolean(row)} onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityViewIsModal style={styles.modalBackdrop}>
        {row ? (
          <View style={styles.profileCard}>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar perfil" onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.color.text} />
            </Pressable>
            <RankingUserAvatar row={row} size={76} />
            <Text role="heading" aria-level={2} style={styles.profileName}>{row.nickname}</Text>
            <Text style={styles.profilePosition}>{row.rank}º lugar · {row.points} pontos</Text>
            <View style={styles.profileStats}>
              <MiniMetric label="Na rodada" value={`${roundPoints} pts`} />
              <MiniMetric label="Exatos" value={String(row.exactScores)} />
              <MiniMetric label="Resultados" value={String(row.resultHits)} />
              <MiniMetric label="Situação" value={row.hasLiveData ? 'Provisória' : 'Definitiva'} />
            </View>
            <RankingLastFive values={row.lastFive} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <View style={styles.miniMetric}><Text style={styles.miniLabel}>{label}</Text><Text style={styles.miniValue}>{value}</Text></View>;
}

function TrophyRoom({ visible, awards, engagement, onClose }: { visible: boolean; awards: RankingAward[]; engagement: EngagementDashboard | null; onClose: () => void }) {
  const [detail, setDetail] = useState<EngagementDashboard['achievements'][number] | null>(null);
  const achieved = engagement?.achievements.filter((item) => item.achievedAt && !item.revokedAt).length ?? 0;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityViewIsModal style={styles.modalBackdrop}>
        <View style={styles.trophyRoom}>
          <View style={styles.roomHeader}>
            <View><Text style={styles.eyebrow}>SALA DE TROFÉUS</Text><Text role="heading" aria-level={2} style={styles.roomTitle}>Temporada & conquistas</Text><Text style={styles.roomSubtitle}>{achieved}/{engagement?.achievements.length ?? 0} conquistas pessoais desbloqueadas</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar Sala de Troféus" onPress={onClose} style={styles.modalCloseStatic}><Ionicons name="close" size={22} color={theme.color.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.roomScroll}>
            <Text style={styles.roomSectionTitle}>Troféus globais da temporada</Text>
            <View style={styles.awardGrid}>
              {awards.map((award) => <GlobalAward key={award.key} award={award} />)}
              {!awards.length ? <EmptyCopy text="Os troféus serão exibidos quando houver dados elegíveis." /> : null}
            </View>
            <Text style={styles.roomSectionTitle}>Suas conquistas</Text>
            <View style={styles.awardGrid}>
              {engagement?.achievements.map((item) => {
                const progress = progressValues(item.progress);
                const unlocked = Boolean(item.achievedAt && !item.revokedAt);
                return (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => setDetail(item)} style={[styles.personalAward, !unlocked && styles.personalLocked, item.isProvisional && styles.provisionalBorder]}>
                    <View style={styles.personalTop}><Ionicons name={unlocked ? 'ribbon' : 'lock-closed'} size={25} color={unlocked ? theme.color.gold : theme.color.textMuted} /><Text style={[styles.rarity, rarityStyle(item.definition.rarity)]}>{rarityLabel(item.definition.rarity)}</Text></View>
                    <Text style={styles.personalTitle}>{item.definition.name}</Text>
                    <Text style={styles.personalDescription}>{item.definition.description}</Text>
                    {progress ? <View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, progress.current / progress.target * 100)}%` }]} /></View><Text style={styles.progressText}>{progress.current}/{progress.target}</Text></View> : null}
                    <Text style={styles.awardState}>{item.isProvisional ? 'Provisória' : unlocked ? 'Conquistada' : item.revokedAt ? 'Recalculada' : 'Em progresso'}</Text>
                  </Pressable>
                );
              })}
              {!engagement?.achievements.length ? <EmptyCopy text="Seu progresso aparecerá após os primeiros palpites elegíveis." /> : null}
            </View>
            <Text style={styles.roomSectionTitle}>Sequências</Text>
            <View style={styles.streakRow}>
              {engagement?.streaks.map((streak) => <MiniMetric key={streak.type} label={streak.type.replaceAll('_', ' ')} value={`${streak.currentCount} atual · ${streak.bestCount} melhor`} />)}
              {!engagement?.streaks.length ? <EmptyCopy text="Nenhuma sequência consolidada ainda." /> : null}
            </View>
          </ScrollView>
        </View>
        {detail ? (
          <View style={styles.detailOverlay} role="dialog" aria-modal>
            <View style={styles.detailCard}><Ionicons name={detail.achievedAt ? 'ribbon' : 'lock-closed'} size={38} color={theme.color.gold} /><Text style={styles.profileName}>{detail.definition.name}</Text><Text style={styles.personalDescription}>{detail.definition.description}</Text><Text style={styles.awardState}>{detail.isProvisional ? 'Progresso provisório' : detail.achievedAt ? 'Conquista consolidada' : 'Objetivo em andamento'}</Text><Pressable accessibilityRole="button" onPress={() => setDetail(null)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Fechar detalhes</Text></Pressable></View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function rarityLabel(value: string) {
  return ({ COMMON: 'Comum', UNCOMMON: 'Rara', RARE: 'Épica', EPIC: 'Épica', LEGENDARY: 'Lendária' } as Record<string, string>)[value.toUpperCase()] ?? value;
}
function rarityStyle(value: string) { const key = value.toUpperCase(); return key === 'LEGENDARY' ? styles.rarityLegendary : key === 'RARE' || key === 'EPIC' ? styles.rarityEpic : key === 'UNCOMMON' ? styles.rarityRare : styles.rarityCommon; }

function GlobalAward({ award }: { award: RankingAward }) {
  return <View style={[styles.globalAward, award.status === 'live' && styles.provisionalBorder]}><View style={styles.personalTop}><Ionicons name="trophy" size={27} color={award.status === 'empty' ? theme.color.textMuted : theme.color.gold} /><Text style={styles.awardState}>{award.status === 'locked' ? 'Definitivo' : award.status === 'live' ? 'Em disputa' : award.status === 'pending' ? 'Aguardando' : 'Sem dados'}</Text></View><Text style={styles.personalTitle}>{award.title}</Text><Text style={styles.personalDescription}>{award.subtitle}</Text>{award.winner ? <View style={styles.winnerRow}><RankingUserAvatar row={{ nickname: award.winner.nickname, avatarUrl: award.winner.avatarUrl ?? null }} size={34} /><View><Text style={styles.winnerName}>{award.winner.nickname}</Text><Text style={styles.progressText}>{award.winner.points} pts · {award.winner.exactScores} exatos</Text></View></View> : <Text style={styles.progressText}>Nenhum vencedor apurado.</Text>}</View>;
}

function EmptyCopy({ text }: { text: string }) { return <Text style={styles.emptyCopy}>{text}</Text>; }

export function PremiumRanking({
  seasonName,
  ranking,
  roundRanking,
  currentUserId,
  scope,
  availableScopes = allRankingScopes,
  onScopeChange,
  connection,
  syncing,
  lastSyncedAt,
  onRefresh,
  awards,
  engagement,
  tieBreakers,
}: {
  seasonName: string;
  ranking: RankingRowDto[];
  roundRanking: RankingRowDto[];
  currentUserId: string;
  scope: PremiumRankingScope;
  availableScopes?: ReadonlySet<string>;
  onScopeChange: (scope: PremiumRankingScope) => void;
  connection: ConnectionStatus;
  syncing: boolean;
  lastSyncedAt: string | null;
  onRefresh: () => void;
  awards: RankingAward[];
  engagement: EngagementDashboard | null;
  tieBreakers: string[];
}) {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [profile, setProfile] = useState<RankingRowDto | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const particleId = useRef(0);
  useRankingEntrance(`${scope}:${ranking.map((row) => `${row.userId}-${row.points}-${row.rank}`).join('|')}`);
  const roundPoints = useMemo(() => new Map(roundRanking.map((row) => [row.userId, row.points])), [roundRanking]);
  const filtered = ranking.filter((row) => row.nickname.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')) && (statusFilter === 'all' || (statusFilter === 'live' ? row.hasLiveData : !row.hasLiveData)));
  const currentIndex = ranking.findIndex((row) => row.userId === currentUserId);
  const current = ranking[currentIndex];
  const above = currentIndex > 0 ? ranking[currentIndex - 1] : null;
  const leader = ranking[0];
  const exactLeader = [...ranking].sort((a, b) => b.exactScores - a.exactScores)[0];
  const average = ranking.length ? ranking.reduce((sum, row) => sum + row.points, 0) / ranking.length : 0;
  const biggestRise = [...ranking].filter((row) => (row.movement?.delta ?? 0) > 0).sort((a, b) => (b.movement?.delta ?? 0) - (a.movement?.delta ?? 0))[0];
  const biggestFall = [...ranking].filter((row) => (row.movement?.delta ?? 0) < 0).sort((a, b) => (a.movement?.delta ?? 0) - (b.movement?.delta ?? 0))[0];
  const roundLeader = [...roundRanking].sort((a, b) => b.points - a.points)[0];
  const bestStreak = engagement ? [...engagement.streaks].sort((a, b) => b.bestCount - a.bestCount)[0] : undefined;

  function football(event?: GestureResponderEvent) {
    if (!event || Platform.OS !== 'web' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const native = event.nativeEvent as unknown as { pageX?: number; pageY?: number };
    if (native.pageX == null || native.pageY == null) return;
    const particle = { id: ++particleId.current, x: native.pageX, y: native.pageY };
    setParticles((items) => [...items.slice(-5), particle]);
    setTimeout(() => setParticles((items) => items.filter((item) => item.id !== particle.id)), 650);
  }

  const liveLabel = syncing ? 'Atualizando' : connection === 'live' ? 'Ao vivo' : connection === 'offline' ? 'Offline' : 'Reconectando';
  return (
    <View {...(Platform.OS === 'web' ? ({ dataSet: { premiumRanking: 'root' } } as never) : {})} style={styles.root}>
      <View {...dataTarget('hero')} style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroCopy}><Text style={styles.eyebrow}>BRASILEIRÃO SÉRIE A · 2026</Text><Text role="heading" aria-level={2} style={styles.heroTitle}>Corrida pelo topo</Text><Text style={styles.heroSubtitle}>{seasonName} · classificação do bolão em tempo real</Text><View style={styles.liveLine}><View style={[styles.liveDot, connection === 'offline' && styles.offlineDot]} /><Text style={styles.liveText}>{liveLabel}</Text><Text style={styles.syncText}>{formatSyncTime(lastSyncedAt)}</Text></View></View>
        <View style={styles.heroActions}>
          <Pressable accessibilityRole="button" disabled={syncing} onPress={(event) => { football(event); onRefresh(); }} style={[styles.primaryButton, syncing && styles.disabled]}><Ionicons name="refresh" size={17} color={theme.color.accentInk} /><Text style={styles.primaryButtonText}>{syncing ? 'Atualizando placares…' : 'Atualizar'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={(event) => { football(event); setRoomOpen(true); }} style={styles.trophyButton}><Ionicons name="trophy" size={18} color={theme.color.gold} /><Text style={styles.trophyButtonText}>Sala de Troféus</Text></Pressable>
        </View>
      </View>

      <View {...dataTarget('filters')} style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail} accessibilityLabel="Período do ranking">{(['overall','round','month','turn-1','turn-2'] as PremiumRankingScope[]).filter((item) => availableScopes.has(rankingScopeCapability[item])).map((item) => <Pressable key={item} aria-pressed={scope === item} accessibilityRole="button" onPress={(event) => { football(event); onScopeChange(item); }} style={[styles.filterChip, scope === item && styles.filterChipActive]}><Text style={[styles.filterText, scope === item && styles.filterTextActive]}>{scopeLabel(item)}</Text></Pressable>)}</ScrollView>
        <View style={styles.searchWrap}><Ionicons name="search" size={17} color={theme.color.textMuted} /><TextInput accessibilityLabel="Buscar participante" placeholder="Buscar participante" placeholderTextColor={theme.color.textMuted} value={search} onChangeText={setSearch} style={styles.searchInput} /></View>
        <View style={styles.statusGroup}>{(['all','live','final'] as StatusFilter[]).map((item) => <Pressable key={item} aria-pressed={statusFilter === item} accessibilityRole="button" onPress={() => setStatusFilter(item)} style={[styles.statusButton, statusFilter === item && styles.statusButtonActive]}><Text style={styles.statusText}>{item === 'all' ? 'Todos' : item === 'live' ? 'Ao vivo' : 'Definitivos'}</Text></Pressable>)}</View>
      </View>

      <View style={styles.statsGrid}>{[
        ['Participantes', String(ranking.length), 'na temporada'],
        ['SUA POSIÇÃO', current ? `${current.rank}º` : '—', current ? `${current.points} pontos` : 'sem dados'],
        ['Pontos do líder', leader ? String(leader.points) : '—', leader?.nickname ?? 'sem líder'],
        ['Distância acima', current && above ? `${Math.max(0, above.points - current.points)} pts` : '—', current && above ? `${Math.max(0, above.points - current.points)} pts para ${above.nickname}` : 'você está no topo'],
        ['Média de pontos', ranking.length ? average.toFixed(1).replace('.', ',') : '—', 'entre participantes'],
        ['Mais placares exatos', exactLeader ? String(exactLeader.exactScores) : '—', exactLeader?.nickname ?? 'sem dados'],
        ['Sua rodada', current ? `${roundPoints.get(current.userId) ?? 0} pts` : '—', scope === 'round' ? 'rodada selecionada' : 'rodada atual'],
      ].map(([label,value,detail]) => <View {...dataTarget('stat')} key={label} style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text><Text style={styles.statDetail}>{detail}</Text></View>)}</View>

      {ranking.length ? <View {...dataTarget('podium')} style={[styles.podium, compact && styles.podiumCompact]}>{[ranking[1], ranking[0], ranking[2]].filter(Boolean).map((row) => <Pressable key={row.userId} accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${row.nickname}, ${row.rank}º lugar`} onPress={(event) => { football(event); setProfile(row); }} style={[styles.podiumCard, row.rank === 1 && styles.podiumFirst, row.userId === currentUserId && styles.currentBorder]}><Text style={styles.medal}>{row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'}</Text><RankingUserAvatar row={row} size={row.rank === 1 ? 72 : 60} /><Text style={styles.podiumName} numberOfLines={1}>{row.nickname}</Text><Text style={styles.podiumPoints}>{row.points} pts</Text><Text style={styles.podiumMeta}>{row.exactScores} exatos · {row.hasLiveData ? 'provisório' : 'definitivo'}</Text><RankingMovementBadge row={row} /><RankingLastFive values={row.lastFive} />{row.userId === currentUserId ? <Text style={styles.youBadge}>VOCÊ</Text> : null}</Pressable>)}</View> : <EmptyCopy text="O ranking aparecerá após os primeiros resultados elegíveis." />}

      <View style={[styles.contentGrid, compact && styles.contentGridCompact]}>
        <View {...dataTarget('table')} style={styles.tablePanel}><View style={styles.panelHead}><View><Text style={styles.eyebrow}>CLASSIFICAÇÃO COMPLETA</Text><Text style={styles.panelTitle}>{filtered.length} participante(s)</Text></View><View><Text style={styles.criteriaTitle}>Critérios de desempate</Text><Text style={styles.panelHint}>{tieBreakers.join(' → ') || 'Critérios vinculados à regra da temporada'}</Text></View></View><ScrollView horizontal showsHorizontalScrollIndicator><View style={styles.table}><RankingHeader />{filtered.map((row) => <Pressable key={row.userId} accessibilityRole="button" onPress={(event) => { football(event); setProfile(row); }} style={[styles.tableRow, row.userId === currentUserId && styles.currentRow, row.rank === 1 && styles.leaderRow]}><Text style={[styles.rankCell, row.rank === 1 && styles.rankLeader]}>{row.rank}º</Text><View style={styles.personCell}><RankingUserAvatar row={row} size={36} /><Text style={styles.personName} numberOfLines={1}>{row.nickname}{row.userId === currentUserId ? ' · Você' : ''}</Text></View><View style={styles.moveCell}><RankingMovementBadge row={row} /></View><Text style={styles.numberCellStrong}>{row.points}</Text><Text style={styles.numberCell}>{roundPoints.get(row.userId) ?? 0}</Text><Text style={styles.numberCell}>{row.exactScores}</Text><Text style={styles.numberCell}>{row.resultHits}</Text><Text style={styles.numberCell}>{row.oneGoalHits}</Text><Text style={styles.numberCell}>{row.misses}</Text><View style={styles.lastFiveCell}><RankingLastFive values={row.lastFive} /></View><View style={styles.stateCell}><View style={[styles.stateDot, row.hasLiveData ? styles.stateLive : styles.stateFinal]} /><Text style={styles.stateText}>{row.hasLiveData ? 'Provisório' : 'Definitivo'}</Text></View></Pressable>)}</View></ScrollView>{!filtered.length ? <EmptyCopy text="Nenhum participante corresponde aos filtros." /> : null}</View>
        <View {...dataTarget('radar')} style={styles.radar}><Text style={styles.eyebrow}>RADAR DO RANKING</Text><Text style={styles.panelTitle}>Quem está no seu caminho</Text><RadarItem icon="flag" label="Líder" row={leader} detail={leader ? `${leader.points} pts` : undefined} /><RadarItem icon="navigate" label="Rival mais próximo" row={above} detail={current && above ? `${Math.max(0, above.points-current.points)} pts à frente` : undefined} /><RadarItem icon="trending-up" label="Maior subida" row={biggestRise} detail={biggestRise ? `+${biggestRise.movement?.delta}` : undefined} /><RadarItem icon="trending-down" label="Maior queda" row={biggestFall} detail={biggestFall ? String(biggestFall.movement?.delta) : undefined} /><RadarItem icon="flash" label={roundLeader ? `Líder da rodada · ${roundLeader.nickname}` : 'Líder da rodada'} row={roundLeader} detail={roundLeader ? `${roundLeader.points} pts` : undefined} /><RadarItem icon="flame" label="Maior sequência" row={bestStreak && current ? current : undefined} detail={bestStreak ? `${bestStreak.bestCount} acertos (seu histórico)` : undefined} /><RadarItem icon="happy" label="Lanterna da resenha" row={ranking.at(-1)} detail="Ainda dá para buscar" /></View>
      </View>
      <ProfileModal row={profile} roundPoints={profile ? roundPoints.get(profile.userId) ?? 0 : 0} onClose={() => setProfile(null)} />
      <TrophyRoom visible={roomOpen} awards={awards} engagement={engagement} onClose={() => setRoomOpen(false)} />
      <View style={styles.particleLayer}>{particles.map((particle) => <Text key={particle.id} style={[styles.particle, { left: particle.x - 10, top: particle.y - 10 }]}>⚽</Text>)}</View>
    </View>
  );
}

function RankingHeader() { return <View style={[styles.tableRow, styles.tableHeader]}><Text style={styles.rankCell}>#</Text><Text style={styles.personCellHeader}>Participante</Text><Text style={styles.moveCellHeader}>Mov.</Text><Text style={styles.numberCellHeader}>Pts</Text><Text style={styles.numberCellHeader}>Rod.</Text><Text style={styles.numberCellHeader}>EX</Text><Text style={styles.numberCellHeader}>RES</Text><Text style={styles.numberCellHeader}>Gols</Text><Text style={styles.numberCellHeader}>Erros</Text><Text style={styles.lastFiveHeader}>Últimos 5</Text><Text style={styles.stateCellHeader}>Situação</Text></View>; }

function RadarItem({ icon, label, row, detail }: { icon: keyof typeof Ionicons.glyphMap; label: string; row?: RankingRowDto | null; detail?: string }) { return <View style={styles.radarItem}><View style={styles.radarIcon}><Ionicons name={icon} size={17} color={theme.color.gold} /></View><View style={styles.radarCopy}><Text style={styles.radarLabel}>{label}</Text><Text style={styles.radarName}>{row?.nickname ?? 'Sem dado disponível'}</Text>{detail ? <Text style={styles.radarDetail}>{detail}</Text> : null}</View>{row ? <RankingUserAvatar row={row} size={34} /> : null}</View>; }

const styles = StyleSheet.create({
  root:{gap:theme.space.xl,width:'100%'}, hero:{backgroundColor:'#052d50',borderColor:'rgba(52,209,123,.35)',borderRadius:22,borderWidth:1,flexDirection:'row',flexWrap:'wrap',gap:18,justifyContent:'space-between',overflow:'hidden',padding:24,position:'relative'},heroGlow:{backgroundColor:'rgba(52,209,123,.12)',borderRadius:180,height:260,position:'absolute',right:-90,top:-130,width:260},heroCopy:{gap:5,maxWidth:650,zIndex:1},eyebrow:{color:theme.color.accent,fontSize:10,fontWeight:'900',letterSpacing:1.3},heroTitle:{color:theme.color.text,fontSize:32,fontWeight:'900',letterSpacing:-.8},heroSubtitle:{color:theme.color.textMuted,fontSize:14},liveLine:{alignItems:'center',flexDirection:'row',flexWrap:'wrap',gap:7,marginTop:8},liveDot:{backgroundColor:theme.color.accent,borderRadius:5,height:9,width:9},offlineDot:{backgroundColor:theme.color.danger},liveText:{color:theme.color.text,fontSize:12,fontWeight:'900'},syncText:{color:theme.color.textMuted,fontSize:11},heroActions:{alignItems:'center',flexDirection:'row',flexWrap:'wrap',gap:9,zIndex:1},primaryButton:{alignItems:'center',backgroundColor:theme.color.accent,borderRadius:10,flexDirection:'row',gap:7,justifyContent:'center',minHeight:44,paddingHorizontal:16},primaryButtonText:{color:theme.color.accentInk,fontSize:12,fontWeight:'900'},disabled:{opacity:.55},trophyButton:{alignItems:'center',borderColor:'rgba(244,214,92,.55)',borderRadius:10,borderWidth:1,flexDirection:'row',gap:7,minHeight:44,paddingHorizontal:14},trophyButtonText:{color:theme.color.gold,fontSize:12,fontWeight:'900'},filters:{alignItems:'center',flexDirection:'row',flexWrap:'wrap',gap:10},filterRail:{gap:6},filterChip:{borderColor:theme.color.border,borderRadius:999,borderWidth:1,justifyContent:'center',minHeight:44,paddingHorizontal:14},filterChipActive:{backgroundColor:theme.color.gold,borderColor:theme.color.gold},filterText:{color:theme.color.textMuted,fontSize:11,fontWeight:'800'},filterTextActive:{color:'#211d08'},searchWrap:{alignItems:'center',borderColor:theme.color.border,borderRadius:10,borderWidth:1,flex:1,flexDirection:'row',gap:7,minHeight:44,minWidth:210,paddingHorizontal:12},searchInput:{color:theme.color.text,flex:1,fontSize:12,minHeight:42,outlineStyle:'none' as never},statusGroup:{borderColor:theme.color.borderMuted,borderRadius:10,borderWidth:1,flexDirection:'row',overflow:'hidden'},statusButton:{justifyContent:'center',minHeight:42,paddingHorizontal:11},statusButtonActive:{backgroundColor:'rgba(52,209,123,.18)'},statusText:{color:theme.color.text,fontSize:10,fontWeight:'800'},statsGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},statCard:{backgroundColor:theme.color.surface,borderColor:theme.color.borderMuted,borderRadius:14,borderWidth:1,flex:1,gap:3,minWidth:150,padding:15},statLabel:{color:theme.color.textMuted,fontSize:10,fontWeight:'800',textTransform:'uppercase'},statValue:{color:theme.color.text,fontSize:23,fontWeight:'900'},statDetail:{color:theme.color.info,fontSize:10},podium:{alignItems:'flex-end',flexDirection:'row',gap:12,justifyContent:'center',paddingTop:16},podiumCompact:{alignItems:'stretch',flexDirection:'column'},podiumCard:{alignItems:'center',backgroundColor:theme.color.surface,borderColor:theme.color.border,borderRadius:18,borderWidth:1,flex:1,gap:7,maxWidth:310,minHeight:235,padding:18},podiumFirst:{backgroundColor:'#103b55',borderColor:theme.color.gold,minHeight:262,paddingTop:24},currentBorder:{borderColor:theme.color.accent,borderWidth:2},medal:{fontSize:27},avatar:{backgroundColor:theme.color.surfaceRaised,borderColor:theme.color.accent,borderWidth:1,overflow:'hidden'},avatarFallback:{alignItems:'center',justifyContent:'center'},avatarInitials:{color:theme.color.text,fontWeight:'900'},podiumName:{color:theme.color.text,fontSize:16,fontWeight:'900',maxWidth:'100%'},podiumPoints:{color:theme.color.gold,fontSize:22,fontWeight:'900'},podiumMeta:{color:theme.color.textMuted,fontSize:10},youBadge:{backgroundColor:theme.color.accent,borderRadius:999,color:theme.color.accentInk,fontSize:9,fontWeight:'900',overflow:'hidden',paddingHorizontal:8,paddingVertical:3},moveBadge:{alignItems:'center',borderRadius:999,flexDirection:'row',gap:2,minHeight:24,paddingHorizontal:7},moveUp:{backgroundColor:'rgba(52,209,123,.16)'},moveDown:{backgroundColor:'rgba(255,136,120,.16)'},moveSame:{backgroundColor:'rgba(184,201,220,.10)'},moveText:{color:theme.color.text,fontSize:10,fontWeight:'900'},mutedDash:{color:theme.color.textMuted,textAlign:'center'},formRow:{flexDirection:'row',gap:4},formDot:{alignItems:'center',borderRadius:10,height:22,justifyContent:'center',width:22},formEmpty:{backgroundColor:'rgba(184,201,220,.08)'},formMiss:{backgroundColor:'rgba(255,136,120,.18)'},formHit:{backgroundColor:'rgba(52,209,123,.18)'},formExact:{backgroundColor:'rgba(244,214,92,.22)'},formText:{color:theme.color.text,fontSize:8,fontWeight:'900'},contentGrid:{alignItems:'flex-start',flexDirection:'row',gap:14},contentGridCompact:{flexDirection:'column'},tablePanel:{backgroundColor:theme.color.surface,borderColor:theme.color.borderMuted,borderRadius:16,borderWidth:1,flex:1,overflow:'hidden',width:'100%'},panelHead:{alignItems:'flex-end',flexDirection:'row',flexWrap:'wrap',gap:10,justifyContent:'space-between',padding:18},panelTitle:{color:theme.color.text,fontSize:18,fontWeight:'900',marginTop:3},criteriaTitle:{color:theme.color.text,fontSize:11,fontWeight:'900',textAlign:'right'},panelHint:{color:theme.color.textMuted,fontSize:10},table:{minWidth:1050},tableRow:{alignItems:'center',borderBottomColor:theme.color.borderMuted,borderBottomWidth:1,flexDirection:'row',minHeight:58,paddingHorizontal:12},tableHeader:{backgroundColor:'rgba(0,20,58,.4)',minHeight:42},currentRow:{backgroundColor:'rgba(52,209,123,.10)',borderLeftColor:theme.color.accent,borderLeftWidth:3},leaderRow:{backgroundColor:'rgba(244,214,92,.06)'},rankCell:{color:theme.color.textMuted,fontSize:12,fontWeight:'900',textAlign:'center',width:42},rankLeader:{color:theme.color.gold},personCell:{alignItems:'center',flexDirection:'row',gap:8,width:200},personCellHeader:{color:theme.color.textMuted,fontSize:9,fontWeight:'900',width:200},personName:{color:theme.color.text,flexShrink:1,fontSize:12,fontWeight:'900'},inlineYou:{backgroundColor:theme.color.accent,borderRadius:999,color:theme.color.accentInk,fontSize:8,fontWeight:'900',overflow:'hidden',paddingHorizontal:5,paddingVertical:2},moveCell:{alignItems:'center',width:58},moveCellHeader:{color:theme.color.textMuted,fontSize:9,fontWeight:'900',textAlign:'center',width:58},numberCell:{color:theme.color.textMuted,fontSize:11,fontWeight:'800',textAlign:'center',width:48},numberCellStrong:{color:theme.color.gold,fontSize:14,fontWeight:'900',textAlign:'center',width:48},numberCellHeader:{color:theme.color.textMuted,fontSize:9,fontWeight:'900',textAlign:'center',width:48},lastFiveCell:{alignItems:'center',width:140},lastFiveHeader:{color:theme.color.textMuted,fontSize:9,fontWeight:'900',textAlign:'center',width:140},stateCell:{alignItems:'center',flexDirection:'row',gap:5,width:95},stateCellHeader:{color:theme.color.textMuted,fontSize:9,fontWeight:'900',textAlign:'center',width:95},stateDot:{borderRadius:4,height:7,width:7},stateLive:{backgroundColor:theme.color.warning},stateFinal:{backgroundColor:theme.color.accent},stateText:{color:theme.color.textMuted,fontSize:9,fontWeight:'800'},radar:{backgroundColor:theme.color.surface,borderColor:theme.color.borderMuted,borderRadius:16,borderWidth:1,gap:8,padding:16,width:310},radarItem:{alignItems:'center',borderTopColor:theme.color.borderMuted,borderTopWidth:1,flexDirection:'row',gap:9,minHeight:62,paddingTop:8},radarIcon:{alignItems:'center',backgroundColor:'rgba(244,214,92,.09)',borderRadius:9,height:34,justifyContent:'center',width:34},radarCopy:{flex:1},radarLabel:{color:theme.color.textMuted,fontSize:9,fontWeight:'800',textTransform:'uppercase'},radarName:{color:theme.color.text,fontSize:12,fontWeight:'900',marginTop:2},radarDetail:{color:theme.color.info,fontSize:9,marginTop:1},emptyCopy:{color:theme.color.textMuted,fontSize:12,lineHeight:18,padding:18},modalBackdrop:{alignItems:'center',backgroundColor:'rgba(0,8,25,.86)',flex:1,justifyContent:'center',padding:16},profileCard:{alignItems:'center',backgroundColor:theme.color.surfaceRaised,borderColor:theme.color.border,borderRadius:18,borderWidth:1,gap:10,maxWidth:480,padding:24,position:'relative',width:'100%'},modalClose:{alignItems:'center',height:44,justifyContent:'center',position:'absolute',right:8,top:8,width:44},profileName:{color:theme.color.text,fontSize:22,fontWeight:'900',textAlign:'center'},profilePosition:{color:theme.color.gold,fontSize:13,fontWeight:'800'},profileStats:{flexDirection:'row',flexWrap:'wrap',gap:8,justifyContent:'center',width:'100%'},miniMetric:{backgroundColor:'rgba(0,20,58,.28)',borderRadius:10,flexGrow:1,minWidth:100,padding:10},miniLabel:{color:theme.color.textMuted,fontSize:9,fontWeight:'800'},miniValue:{color:theme.color.text,fontSize:12,fontWeight:'900',marginTop:3},trophyRoom:{backgroundColor:theme.color.surfaceRaised,borderColor:theme.color.border,borderRadius:20,borderWidth:1,maxHeight:'92%',maxWidth:1120,overflow:'hidden',width:'100%'},roomHeader:{alignItems:'flex-start',borderBottomColor:theme.color.borderMuted,borderBottomWidth:1,flexDirection:'row',justifyContent:'space-between',padding:20},roomTitle:{color:theme.color.text,fontSize:25,fontWeight:'900',marginTop:3},roomSubtitle:{color:theme.color.textMuted,fontSize:11,marginTop:4},modalCloseStatic:{alignItems:'center',height:44,justifyContent:'center',width:44},roomScroll:{gap:12,padding:20},roomSectionTitle:{color:theme.color.text,fontSize:16,fontWeight:'900',marginTop:4},awardGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},globalAward:{backgroundColor:'rgba(0,20,58,.34)',borderColor:theme.color.borderMuted,borderRadius:14,borderWidth:1,flex:1,gap:7,minWidth:240,padding:14},personalAward:{backgroundColor:'rgba(0,20,58,.34)',borderColor:theme.color.borderMuted,borderRadius:14,borderWidth:1,flex:1,gap:7,minWidth:220,padding:14},personalLocked:{opacity:.7},provisionalBorder:{borderColor:theme.color.warning},personalTop:{alignItems:'center',flexDirection:'row',justifyContent:'space-between'},personalTitle:{color:theme.color.text,fontSize:13,fontWeight:'900'},personalDescription:{color:theme.color.textMuted,fontSize:10,lineHeight:15},awardState:{color:theme.color.info,fontSize:9,fontWeight:'900',textTransform:'uppercase'},rarity:{borderRadius:999,fontSize:8,fontWeight:'900',overflow:'hidden',paddingHorizontal:7,paddingVertical:3,textTransform:'uppercase'},rarityCommon:{backgroundColor:'rgba(184,201,220,.15)',color:theme.color.textMuted},rarityRare:{backgroundColor:'rgba(114,183,242,.18)',color:theme.color.info},rarityEpic:{backgroundColor:'rgba(175,110,255,.18)',color:'#d3b3ff'},rarityLegendary:{backgroundColor:'rgba(244,214,92,.18)',color:theme.color.gold},progressTrack:{backgroundColor:'rgba(184,201,220,.12)',borderRadius:4,height:6,overflow:'hidden'},progressFill:{backgroundColor:theme.color.accent,borderRadius:4,height:6},progressText:{color:theme.color.textMuted,fontSize:9,marginTop:3},winnerRow:{alignItems:'center',flexDirection:'row',gap:8},winnerName:{color:theme.color.text,fontSize:11,fontWeight:'900'},streakRow:{flexDirection:'row',flexWrap:'wrap',gap:8},detailOverlay:{alignItems:'center',backgroundColor:'rgba(0,8,25,.72)',bottom:0,justifyContent:'center',left:0,padding:16,position:'absolute',right:0,top:0},detailCard:{alignItems:'center',backgroundColor:theme.color.surfaceRaised,borderColor:theme.color.gold,borderRadius:16,borderWidth:1,gap:12,maxWidth:420,padding:24,width:'100%'},particleLayer:{bottom:0,left:0,pointerEvents:'none' as never,position:Platform.OS === 'web' ? 'fixed' as never : 'absolute',right:0,top:0,zIndex:9999},particle:{fontSize:20,position:'absolute',transform:[{translateY:-16},{rotate:'22deg'}]},
});

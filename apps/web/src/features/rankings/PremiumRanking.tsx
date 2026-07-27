import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RankingRowDto } from '@bolao/shared';
import { API_URL, type EngagementDashboard, type RankingAward } from '../../api';
import {
  Card,
  PrimaryButton,
  ResponsiveContainer,
  SecondaryButton,
  SectionHeader,
  StatusChip,
} from '../../components/DesignSystem';
import type { ConnectionStatus } from '../../services/realtime';
import { theme } from '../../theme/tokens';
import { formatBrlCents } from '../../fundraising';

export type PremiumRankingScope = 'overall' | 'stage' | 'round' | 'month' | 'turn-1' | 'turn-2';
type StatusFilter = 'all' | 'live' | 'final';

const rankingScopeCapability: Record<
  PremiumRankingScope,
  'OVERALL' | 'STAGE' | 'ROUND' | 'MONTH' | 'TURN'
> = {
  overall: 'OVERALL',
  stage: 'STAGE',
  round: 'ROUND',
  month: 'MONTH',
  'turn-1': 'TURN',
  'turn-2': 'TURN',
};

const allRankingScopes = new Set(['OVERALL', 'STAGE', 'ROUND', 'MONTH', 'TURN']);

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function avatarUri(value?: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value)
    ? value
    : `${API_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function RankingUserAvatar({
  row,
  size = 44,
}: {
  row: Pick<RankingRowDto, 'nickname' | 'avatarUrl'>;
  size?: number;
}) {
  const uri = avatarUri(row.avatarUrl);
  const dimensions = { width: size, height: size, borderRadius: size / 2 };
  return uri ? (
    <Image source={{ uri }} resizeMode="cover" style={[styles.avatar, dimensions]} />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback, dimensions]}>
      <Text style={[styles.avatarInitials, { fontSize: Math.max(11, size * 0.3) }]}>
        {initials(row.nickname)}
      </Text>
    </View>
  );
}

export function RankingMovementBadge({ row }: { row: RankingRowDto }) {
  const delta = row.movement?.delta;
  if (delta == null) return <Text style={styles.mutedDash}>—</Text>;
  const tone = delta > 0 ? styles.moveUp : delta < 0 ? styles.moveDown : styles.moveSame;
  return (
    <View
      style={[styles.moveBadge, tone]}
      accessibilityLabel={`Movimento ${delta > 0 ? 'subiu' : delta < 0 ? 'caiu' : 'estável'} ${Math.abs(delta)} posições`}
    >
      <Ionicons
        name={delta > 0 ? 'arrow-up' : delta < 0 ? 'arrow-down' : 'remove'}
        size={12}
        color={delta > 0 ? '#8ff5be' : delta < 0 ? '#ffb0a4' : theme.color.textMuted}
      />
      <Text style={styles.moveText}>
        {delta > 0 ? '+' : ''}
        {delta}
      </Text>
    </View>
  );
}

export function RankingLastFive({ values }: { values: number[] }) {
  const padded = [...values.slice(-5)];
  while (padded.length < 5) padded.unshift(-1);
  return (
    <View
      style={styles.formRow}
      accessibilityLabel={`Últimos resultados: ${values.join(', ') || 'sem resultados'}`}
    >
      {padded.map((value, index) => (
        <View
          key={`${index}-${value}`}
          style={[
            styles.formDot,
            value < 0
              ? styles.formEmpty
              : value === 0
                ? styles.formMiss
                : value >= 10
                  ? styles.formExact
                  : styles.formHit,
          ]}
        >
          <Text style={styles.formText}>{value < 0 ? '·' : value}</Text>
        </View>
      ))}
    </View>
  );
}

function scopeLabel(scope: PremiumRankingScope) {
  return (
    {
      overall: 'Geral',
      stage: 'Fase',
      round: 'Rodada',
      month: 'Mês',
      'turn-1': 'Turno 1',
      'turn-2': 'Turno 2',
    } as const
  )[scope];
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

function ProfileModal({
  row,
  roundPoints,
  onClose,
}: {
  row: RankingRowDto | null;
  roundPoints: number;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={Boolean(row)} onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityViewIsModal style={styles.modalBackdrop}>
        {row ? (
          <View style={styles.profileCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar perfil"
              onPress={onClose}
              style={styles.modalClose}
            >
              <Ionicons name="close" size={22} color={theme.color.text} />
            </Pressable>
            <RankingUserAvatar row={row} size={76} />
            <Text role="heading" aria-level={2} style={styles.profileName}>
              {row.nickname}
            </Text>
            <Text style={styles.profilePosition}>
              {row.rank}º lugar · {row.points} pontos
            </Text>
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
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

function TrophyRoom({
  visible,
  seasonName,
  awards,
  engagement,
  onClose,
}: {
  visible: boolean;
  seasonName: string;
  awards: RankingAward[];
  engagement: EngagementDashboard | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<EngagementDashboard['achievements'][number] | null>(null);
  const achieved =
    engagement?.achievements.filter((item) => item.achievedAt && !item.revokedAt).length ?? 0;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityViewIsModal style={styles.modalBackdrop}>
        <View style={styles.trophyRoom}>
          <View style={styles.roomHeader}>
            <View>
              <Text style={styles.eyebrow}>SALA DE TROFÉUS</Text>
              <Text role="heading" aria-level={2} style={styles.roomTitle}>
                Temporada & conquistas
              </Text>
              <Text style={styles.roomSubtitle}>{seasonName}</Text>
              <Text style={styles.roomSubtitle}>
                {achieved}/{engagement?.achievements.length ?? 0} conquistas pessoais desbloqueadas
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar Sala de Troféus"
              onPress={onClose}
              style={styles.modalCloseStatic}
            >
              <Ionicons name="close" size={22} color={theme.color.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.roomScroll}>
            <Text style={styles.roomSectionTitle}>Troféus globais da temporada</Text>
            <View style={styles.awardGrid}>
              {awards.map((award) => (
                <GlobalAward key={award.key} award={award} />
              ))}
              {!awards.length ? (
                <EmptyCopy text="Os troféus serão exibidos quando houver dados elegíveis." />
              ) : null}
            </View>
            <Text style={styles.roomSectionTitle}>Suas conquistas</Text>
            <View style={styles.awardGrid}>
              {engagement?.achievements.map((item) => {
                const progress = progressValues(item.progress);
                const unlocked = Boolean(item.achievedAt && !item.revokedAt);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => setDetail(item)}
                    style={[
                      styles.personalAward,
                      !unlocked && styles.personalLocked,
                      item.isProvisional && styles.provisionalBorder,
                    ]}
                  >
                    <View style={styles.personalTop}>
                      <Ionicons
                        name={unlocked ? 'ribbon' : 'lock-closed'}
                        size={25}
                        color={unlocked ? theme.color.gold : theme.color.textMuted}
                      />
                      <Text style={[styles.rarity, rarityStyle(item.definition.rarity)]}>
                        {rarityLabel(item.definition.rarity)}
                      </Text>
                    </View>
                    <Text style={styles.personalTitle}>{item.definition.name}</Text>
                    <Text style={styles.personalDescription}>{item.definition.description}</Text>
                    {progress ? (
                      <View>
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              {
                                width: `${Math.min(100, (progress.current / progress.target) * 100)}%`,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.progressText}>
                          {progress.current}/{progress.target}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.awardState}>
                      {item.isProvisional
                        ? 'Provisória'
                        : unlocked
                          ? 'Conquistada'
                          : item.revokedAt
                            ? 'Recalculada'
                            : 'Em progresso'}
                    </Text>
                  </Pressable>
                );
              })}
              {!engagement?.achievements.length ? (
                <EmptyCopy text="Seu progresso aparecerá após os primeiros palpites elegíveis." />
              ) : null}
            </View>
            <Text style={styles.roomSectionTitle}>Sequências</Text>
            <View style={styles.streakRow}>
              {engagement?.streaks.map((streak) => (
                <MiniMetric
                  key={streak.type}
                  label={streak.type.replaceAll('_', ' ')}
                  value={`${streak.currentCount} atual · ${streak.bestCount} melhor`}
                />
              ))}
              {!engagement?.streaks.length ? (
                <EmptyCopy text="Nenhuma sequência consolidada ainda." />
              ) : null}
            </View>
          </ScrollView>
        </View>
        {detail ? (
          <View style={styles.detailOverlay} role="dialog" aria-modal>
            <View style={styles.detailCard}>
              <Ionicons
                name={detail.achievedAt ? 'ribbon' : 'lock-closed'}
                size={38}
                color={theme.color.gold}
              />
              <Text style={styles.profileName}>{detail.definition.name}</Text>
              <Text style={styles.personalDescription}>{detail.definition.description}</Text>
              <Text style={styles.awardState}>
                {detail.isProvisional
                  ? 'Progresso provisório'
                  : detail.achievedAt
                    ? 'Conquista consolidada'
                    : 'Objetivo em andamento'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDetail(null)}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Fechar detalhes</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function rarityLabel(value: string) {
  return (
    (
      {
        COMMON: 'Comum',
        UNCOMMON: 'Rara',
        RARE: 'Épica',
        EPIC: 'Épica',
        LEGENDARY: 'Lendária',
      } as Record<string, string>
    )[value.toUpperCase()] ?? value
  );
}
function rarityStyle(value: string) {
  const key = value.toUpperCase();
  return key === 'LEGENDARY'
    ? styles.rarityLegendary
    : key === 'RARE' || key === 'EPIC'
      ? styles.rarityEpic
      : key === 'UNCOMMON'
        ? styles.rarityRare
        : styles.rarityCommon;
}

function GlobalAward({ award }: { award: RankingAward }) {
  return (
    <View style={[styles.globalAward, award.status === 'live' && styles.provisionalBorder]}>
      <View style={styles.personalTop}>
        <Ionicons
          name="trophy"
          size={27}
          color={award.status === 'empty' ? theme.color.textMuted : theme.color.gold}
        />
        <Text style={styles.awardState}>
          {award.status === 'locked'
            ? 'Definitivo'
            : award.status === 'live'
              ? 'Em disputa'
              : award.status === 'pending'
                ? 'Aguardando'
                : 'Sem dados'}
        </Text>
      </View>
      <Text style={styles.personalTitle}>{award.title}</Text>
      <Text style={styles.personalDescription}>{award.subtitle}</Text>
      {award.winner ? (
        <View style={styles.winnerRow}>
          <RankingUserAvatar
            row={{ nickname: award.winner.nickname, avatarUrl: award.winner.avatarUrl ?? null }}
            size={34}
          />
          <View>
            <Text style={styles.winnerName}>{award.winner.nickname}</Text>
            <Text style={styles.progressText}>
              {award.winner.points} pts · {award.winner.exactScores} exatos
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.progressText}>Nenhum vencedor apurado.</Text>
      )}
    </View>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

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
  fundraisingCents = null,
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
  fundraisingCents?: number | null;
}) {
  const { width } = useWindowDimensions();
  const compact = width < theme.breakpoint.compact;
  const compactRanking = width < theme.breakpoint.content;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [profile, setProfile] = useState<RankingRowDto | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const roundPoints = useMemo(
    () => new Map(roundRanking.map((row) => [row.userId, row.points])),
    [roundRanking],
  );
  const filtered = ranking.filter(
    (row) =>
      row.nickname.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')) &&
      (statusFilter === 'all' || (statusFilter === 'live' ? row.hasLiveData : !row.hasLiveData)),
  );
  const currentIndex = ranking.findIndex((row) => row.userId === currentUserId);
  const current = ranking[currentIndex];
  const above = currentIndex > 0 ? ranking[currentIndex - 1] : null;
  const leader = ranking[0];
  const roundLeader = roundRanking[0];
  const liveLabel = syncing
    ? 'Atualizando'
    : connection === 'live'
      ? 'Ao vivo'
      : connection === 'offline'
        ? 'Offline'
        : 'Reconectando';
  const connectionTone =
    connection === 'offline' ? 'danger' : connection === 'live' && !syncing ? 'success' : 'warning';
  return (
    <ResponsiveContainer style={styles.root}>
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <SectionHeader
          eyebrow={seasonName.toLocaleUpperCase('pt-BR')}
          title="Corrida pelo topo"
          description={`${seasonName} · classificação do bolão em tempo real`}
          level={2}
          action={
            <View style={[styles.heroActions, compact && styles.heroActionsCompact]}>
              <PrimaryButton
                label={syncing ? 'Atualizando placares…' : 'Atualizar'}
                icon="refresh"
                disabled={syncing}
                onPress={onRefresh}
                style={compact ? styles.heroActionCompact : undefined}
              />
              <SecondaryButton
                label="Sala de Troféus"
                icon="trophy-outline"
                onPress={() => setRoomOpen(true)}
                style={compact ? styles.heroActionCompact : undefined}
              />
            </View>
          }
        />
        <View style={styles.liveLine}>
          <StatusChip
            label={liveLabel}
            tone={connectionTone}
            icon={connection === 'offline' ? 'cloud-offline-outline' : 'radio-outline'}
          />
          <Text style={styles.syncText}>{formatSyncTime(lastSyncedAt)}</Text>
        </View>
      </View>

      <View style={[styles.filters, compact && styles.filtersCompact]}>
        <ScrollView
          horizontal
          style={styles.filterScroller}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRail}
          accessibilityLabel="Período do ranking"
        >
          {(['overall', 'stage', 'round', 'month', 'turn-1', 'turn-2'] as PremiumRankingScope[])
            .filter((item) => availableScopes.has(rankingScopeCapability[item]))
            .map((item) => (
              <Pressable
                key={item}
                aria-pressed={scope === item}
                accessibilityRole="button"
                onPress={() => onScopeChange(item)}
                style={[styles.filterChip, scope === item && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, scope === item && styles.filterTextActive]}>
                  {scopeLabel(item)}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
        <View style={[styles.filterControls, compact && styles.filterControlsCompact]}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={17} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel="Buscar participante"
              placeholder="Buscar participante"
              placeholderTextColor={theme.color.textMuted}
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
            />
          </View>
          <View style={[styles.statusGroup, compact && styles.statusGroupCompact]}>
            {(['all', 'live', 'final'] as StatusFilter[]).map((item) => (
              <Pressable
                key={item}
                aria-pressed={statusFilter === item}
                accessibilityRole="button"
                onPress={() => setStatusFilter(item)}
                style={[styles.statusButton, statusFilter === item && styles.statusButtonActive]}
              >
                <Text style={styles.statusText}>
                  {item === 'all' ? 'Todos' : item === 'live' ? 'Ao vivo' : 'Definitivos'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Card style={[styles.summaryPanel, compact && styles.summaryPanelCompact]}>
        <SectionHeader
          eyebrow="SEU DESEMPENHO"
          title={current ? `${current.rank}º lugar · ${current.points} pontos` : 'Sem posição apurada'}
          description={
            current
              ? `Dados consolidados para ${current.nickname} no período selecionado.`
              : 'Sua posição será exibida quando houver resultados elegíveis.'
          }
          level={3}
        />
        <View style={styles.summaryGrid}>
          {[
          ['Participantes', String(ranking.length), 'na temporada'],
          [
            'SUA POSIÇÃO',
            current ? `${current.rank}º` : '—',
            current ? `${current.points} pontos` : 'sem dados',
          ],
          [
            'Pontos do líder',
            leader ? String(leader.points) : '—',
            leader?.nickname ?? 'sem líder',
          ],
          [
            'Distância acima',
            current && above ? `${Math.max(0, above.points - current.points)} pts` : '—',
            current && above
              ? `${Math.max(0, above.points - current.points)} pts para ${above.nickname}`
              : 'você está no topo',
          ],
          [
            'Sua rodada',
            current ? `${roundPoints.get(current.userId) ?? 0} pts` : '—',
            scope === 'round' ? 'rodada selecionada' : 'rodada atual',
          ],
          ].map(([label, value, detail]) => (
          <View key={label} style={[styles.summaryMetric, compact && styles.summaryMetricCompact]}>
              <Text style={styles.summaryLabel}>{label}</Text>
              <Text style={styles.summaryValue}>{value}</Text>
              <Text style={styles.summaryDetail}>{detail}</Text>
          </View>
          ))}
        </View>
        {fundraisingCents != null ? (
          <View style={styles.fundraisingStrip}>
            <View style={styles.fundraisingCopy}>
              <Text style={styles.fundraisingLabel}>Valor arrecadado</Text>
              <Text style={styles.fundraisingDetail}>
                Ação entre amigos para custear a viagem
              </Text>
            </View>
            <Text style={styles.fundraisingValue}>{formatBrlCents(fundraisingCents)}</Text>
          </View>
        ) : null}
      </Card>

      {ranking.length ? (
        <Card style={[styles.podiumSurface, compact && styles.podiumSurfaceCompact]}>
          <View style={styles.podium}>
            {[ranking[1], ranking[0], ranking[2]].filter(Boolean).map((row) => (
              <Pressable
                key={row.userId}
                accessibilityRole="button"
                accessibilityLabel={`Abrir perfil de ${row.nickname}, ${row.rank}º lugar`}
                onPress={() => setProfile(row)}
                style={[
                  styles.podiumItem,
                  row.rank === 1 && styles.podiumFirst,
                  row.userId === currentUserId && styles.currentPodium,
                ]}
              >
                <Text style={[styles.medal, compact && styles.medalCompact]}>
                  {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'}
                </Text>
                <RankingUserAvatar
                  row={row}
                  size={compact ? (row.rank === 1 ? 58 : 48) : row.rank === 1 ? 72 : 60}
                />
                <Text
                  style={[
                    styles.podiumName,
                    compact && styles.podiumNameCompact,
                    row.userId === currentUserId && styles.currentPodiumName,
                  ]}
                  numberOfLines={1}
                >
                  {row.nickname}
                </Text>
                <Text style={[styles.podiumPoints, compact && styles.podiumPointsCompact]}>
                  {row.points} pts
                </Text>
                <Text style={styles.podiumMeta} numberOfLines={1}>
                  {row.exactScores} exatos
                </Text>
                <RankingMovementBadge row={row} />
                {row.userId === currentUserId ? <Text style={styles.youBadge}>VOCÊ</Text> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : (
        <EmptyCopy text="O ranking aparecerá após os primeiros resultados elegíveis." />
      )}

      <View
        testID="ranking-panel"
        accessibilityLabel="Classificação completa"
        style={styles.tablePanel}
      >
        <View style={styles.panelHead}>
          <SectionHeader
            eyebrow="CLASSIFICAÇÃO COMPLETA"
            title={`${filtered.length} participante(s)`}
            level={3}
          />
          <Text style={styles.summaryLabel}>Critérios de desempate</Text>
          <Text style={styles.summaryDetail}>
            {tieBreakers.join(' → ') || 'Vinculados à regra da temporada'} ·{' '}
            {roundLeader
              ? `Líder da rodada · ${roundLeader.nickname} · ${roundLeader.points} pts`
              : 'Líder da rodada ainda não apurado'}
          </Text>
        </View>
        {compactRanking ? (
          <CompactRankingList
            rows={filtered}
            currentUserId={currentUserId}
            roundPoints={roundPoints}
            onOpen={setProfile}
          />
        ) : (
          <DesktopRankingTable
            rows={filtered}
            currentUserId={currentUserId}
            roundPoints={roundPoints}
            onOpen={setProfile}
          />
        )}
        {!filtered.length ? (
          <EmptyCopy text="Nenhum participante corresponde aos filtros." />
        ) : null}
      </View>
      <ProfileModal
        row={profile}
        roundPoints={profile ? (roundPoints.get(profile.userId) ?? 0) : 0}
        onClose={() => setProfile(null)}
      />
      <TrophyRoom
        visible={roomOpen}
        seasonName={seasonName}
        awards={awards}
        engagement={engagement}
        onClose={() => setRoomOpen(false)}
      />
    </ResponsiveContainer>
  );
}

type RankingRowsProps = {
  rows: RankingRowDto[];
  currentUserId: string;
  roundPoints: ReadonlyMap<string, number>;
  onOpen: (row: RankingRowDto) => void;
};

function CompactRankingList({
  rows,
  currentUserId,
  roundPoints,
  onOpen,
}: RankingRowsProps) {
  return (
    <View testID="ranking-list-compact" style={styles.compactList}>
      {rows.map((row) => {
        const current = row.userId === currentUserId;
        return (
          <Pressable
            key={row.userId}
            testID={`ranking-row-${row.userId}`}
            accessibilityRole="button"
            accessibilityLabel={`Abrir perfil de ${row.nickname}, ${row.rank}º lugar, ${row.points} pontos`}
            onPress={() => onOpen(row)}
            style={[
              styles.compactRow,
              row.rank === 1 && styles.leaderRow,
              current && styles.currentRow,
            ]}
          >
            <View style={styles.compactMain}>
              <Text style={[styles.compactRank, row.rank === 1 && styles.rankLeader]}>
                {row.rank}º
              </Text>
              <RankingUserAvatar row={row} size={38} />
              <View style={styles.compactIdentity}>
                <Text
                  style={[styles.compactName, current && styles.currentName]}
                  numberOfLines={1}
                >
                  {row.nickname}
                  {current ? ' · Você' : ''}
                </Text>
                <View style={styles.compactStatusLine}>
                  <StatusChip
                    label={row.hasLiveData ? 'Provisório' : 'Definitivo'}
                    tone={row.hasLiveData ? 'warning' : 'success'}
                  />
                  <RankingMovementBadge row={row} />
                </View>
              </View>
              <View style={styles.compactPoints}>
                <Text style={styles.compactPointsValue}>{row.points}</Text>
                <Text style={styles.compactPointsLabel}>pontos</Text>
              </View>
            </View>
            <View style={styles.compactMetrics}>
              <CompactMetric label="Rod." value={roundPoints.get(row.userId) ?? 0} />
              <CompactMetric label="EX" value={row.exactScores} />
              <CompactMetric label="RES" value={row.resultHits} />
              <CompactMetric label="Gols" value={row.oneGoalHits} />
              <CompactMetric label="Erros" value={row.misses} />
              <View style={styles.compactForm}>
                <Text style={styles.compactMetricLabel}>Últimos 5</Text>
                <RankingLastFive values={row.lastFive} />
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function CompactMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.compactMetric}>
      <Text style={styles.compactMetricLabel}>{label}</Text>
      <Text style={styles.compactMetricValue}>{value}</Text>
    </View>
  );
}

function DesktopRankingTable({
  rows,
  currentUserId,
  roundPoints,
  onOpen,
}: RankingRowsProps) {
  return (
    <View testID="ranking-table-desktop" style={styles.table}>
      <RankingHeader />
      {rows.map((row) => (
        <Pressable
          key={row.userId}
          testID={`ranking-row-${row.userId}`}
          accessibilityRole="button"
          accessibilityLabel={`Abrir perfil de ${row.nickname}, ${row.rank}º lugar, ${row.points} pontos`}
          onPress={() => onOpen(row)}
          style={[
            styles.tableRow,
            row.rank === 1 && styles.leaderRow,
            row.userId === currentUserId && styles.currentRow,
          ]}
        >
          <Text style={[styles.rankCell, row.rank === 1 && styles.rankLeader]}>{row.rank}º</Text>
          <View style={styles.personCell}>
            <RankingUserAvatar row={row} size={36} />
            <Text
              style={[
                styles.personName,
                row.userId === currentUserId && styles.currentName,
              ]}
              numberOfLines={1}
            >
              {row.nickname}
              {row.userId === currentUserId ? ' · Você' : ''}
            </Text>
          </View>
          <View style={styles.moveCell}>
            <RankingMovementBadge row={row} />
          </View>
          <Text style={styles.numberCellStrong}>{row.points}</Text>
          <Text style={styles.numberCell}>{roundPoints.get(row.userId) ?? 0}</Text>
          <Text style={styles.numberCell}>{row.exactScores}</Text>
          <Text style={styles.numberCell}>{row.resultHits}</Text>
          <Text style={styles.numberCell}>{row.oneGoalHits}</Text>
          <Text style={styles.numberCell}>{row.misses}</Text>
          <View style={styles.lastFiveCell}>
            <RankingLastFive values={row.lastFive} />
          </View>
          <View style={styles.stateCell}>
            <View
              style={[styles.stateDot, row.hasLiveData ? styles.stateLive : styles.stateFinal]}
            />
            <Text style={styles.stateText}>
              {row.hasLiveData ? 'Provisório' : 'Definitivo'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function RankingHeader() {
  return (
    <View style={[styles.tableRow, styles.tableHeader]}>
      <Text style={styles.rankCell}>#</Text>
      <Text style={styles.personCellHeader}>Participante</Text>
      <Text style={styles.moveCellHeader}>Mov.</Text>
      <Text style={styles.numberCellHeader}>Pts</Text>
      <Text style={styles.numberCellHeader}>Rod.</Text>
      <Text style={styles.numberCellHeader}>EX</Text>
      <Text style={styles.numberCellHeader}>RES</Text>
      <Text style={styles.numberCellHeader}>Gols</Text>
      <Text style={styles.numberCellHeader}>Erros</Text>
      <Text style={styles.lastFiveHeader}>Últimos 5</Text>
      <Text style={styles.stateCellHeader}>Situação</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: theme.space.xl, width: '100%' },
  hero: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderTopColor: theme.color.accent,
    borderTopWidth: 2,
    gap: theme.space.md,
    padding: theme.space.xl,
  },
  heroCompact: { padding: theme.space.lg },
  eyebrow: { color: theme.color.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  liveLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  syncText: { color: theme.color.textMuted, fontSize: theme.font.size.sm },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
  },
  heroActionsCompact: { width: '100%' },
  heroActionCompact: { flex: 1, minWidth: 132 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.color.accent,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  trophyButton: {
    alignItems: 'center',
    borderColor: 'rgba(244,214,92,.55)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  trophyButtonText: { color: theme.color.gold, fontSize: 12, fontWeight: '900' },
  filters: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md },
  filtersCompact: { alignItems: 'stretch', flexDirection: 'column' },
  filterScroller: { flexGrow: 0, flexShrink: 1, maxWidth: '100%' },
  filterRail: { gap: theme.space.sm },
  filterChip: {
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.lg,
  },
  filterChipActive: { backgroundColor: theme.color.accentMuted, borderColor: theme.color.accent },
  filterText: { color: theme.color.textMuted, fontSize: theme.font.size.sm, fontWeight: '800' },
  filterTextActive: { color: theme.color.accent },
  filterControls: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: theme.space.sm,
    justifyContent: 'flex-end',
    minWidth: 320,
  },
  filterControlsCompact: { alignItems: 'stretch', flexDirection: 'column', minWidth: 0, width: '100%' },
  searchWrap: {
    alignItems: 'center',
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    minWidth: 210,
    paddingHorizontal: theme.space.md,
  },
  searchInput: {
    color: theme.color.text,
    flex: 1,
    fontSize: 12,
    minHeight: 42,
    outlineStyle: 'none' as never,
  },
  statusGroup: {
    borderColor: theme.color.borderMuted,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  statusGroupCompact: { width: '100%' },
  statusButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
  },
  statusButtonActive: { backgroundColor: theme.color.accentMuted },
  statusText: { color: theme.color.text, fontSize: theme.font.size.xs, fontWeight: '800' },
  summaryPanel: { gap: theme.space.xl, padding: theme.space.xl },
  summaryPanelCompact: { gap: theme.space.lg, padding: theme.space.lg },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  summaryMetric: {
    borderLeftColor: theme.color.border,
    borderLeftWidth: 1,
    flex: 1,
    gap: theme.space.xs,
    minWidth: 170,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  summaryMetricCompact: { minWidth: '48%', paddingHorizontal: theme.space.md },
  summaryLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  summaryValue: { color: theme.color.text, fontSize: theme.font.size.xl, fontWeight: '900' },
  summaryDetail: { color: theme.color.textSubtle, fontSize: theme.font.size.xs },
  fundraisingStrip: {
    alignItems: 'center',
    backgroundColor: theme.color.warningMuted,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.lg,
    justifyContent: 'space-between',
    padding: theme.space.lg,
  },
  fundraisingCopy: { flex: 1, minWidth: 190 },
  fundraisingLabel: {
    color: theme.color.warning,
    fontSize: theme.font.size.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  fundraisingDetail: { color: theme.color.textMuted, fontSize: theme.font.size.sm, marginTop: 3 },
  fundraisingValue: { color: theme.color.warning, fontSize: theme.font.size.xl, fontWeight: '900' },
  podiumSurface: {
    backgroundColor: theme.color.surface,
    overflow: 'visible',
    paddingBottom: theme.space.lg,
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.xxl,
  },
  podiumSurfaceCompact: {
    paddingBottom: theme.space.md,
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xl,
  },
  podium: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: theme.space.sm,
    justifyContent: 'center',
  },
  podiumItem: {
    alignItems: 'center',
    flex: 1,
    gap: theme.space.xs,
    maxWidth: 310,
    minWidth: 0,
    paddingHorizontal: theme.space.xs,
    paddingVertical: theme.space.md,
  },
  podiumFirst: {
    paddingBottom: theme.space.xl,
  },
  currentPodium: {
    backgroundColor: theme.color.accentMuted,
    borderRadius: theme.radius.md,
  },
  currentPodiumName: { color: theme.color.accent },
  medal: { fontSize: 27 },
  medalCompact: { fontSize: 21 },
  avatar: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.accent,
    borderWidth: 1,
    overflow: 'hidden',
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: theme.color.text, fontWeight: '900' },
  podiumName: { color: theme.color.text, fontSize: 16, fontWeight: '900', maxWidth: '100%' },
  podiumNameCompact: { fontSize: 11 },
  podiumPoints: { color: theme.color.accent, fontSize: 22, fontWeight: '900' },
  podiumPointsCompact: { fontSize: 16 },
  podiumMeta: { color: theme.color.textMuted, fontSize: 10 },
  youBadge: {
    backgroundColor: theme.color.accent,
    borderRadius: 999,
    color: theme.color.accentInk,
    fontSize: 9,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  moveBadge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 2,
    minHeight: 24,
    paddingHorizontal: 7,
  },
  moveUp: { backgroundColor: 'rgba(52,209,123,.16)' },
  moveDown: { backgroundColor: 'rgba(255,136,120,.16)' },
  moveSame: { backgroundColor: 'rgba(184,201,220,.10)' },
  moveText: { color: theme.color.text, fontSize: 10, fontWeight: '900' },
  mutedDash: { color: theme.color.textMuted, textAlign: 'center' },
  formRow: { flexDirection: 'row', gap: 4 },
  formDot: {
    alignItems: 'center',
    borderRadius: 10,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  formEmpty: { backgroundColor: 'rgba(184,201,220,.08)' },
  formMiss: { backgroundColor: 'rgba(255,136,120,.18)' },
  formHit: { backgroundColor: 'rgba(52,209,123,.18)' },
  formExact: { backgroundColor: 'rgba(244,214,92,.22)' },
  formText: { color: theme.color.text, fontSize: 8, fontWeight: '900' },
  tablePanel: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    width: '100%',
  },
  panelHead: { padding: theme.space.lg },
  panelTitle: { color: theme.color.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  table: { width: '100%' },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: theme.space.md,
  },
  tableHeader: { backgroundColor: theme.color.canvasDeep, minHeight: theme.touchTarget },
  currentRow: {
    backgroundColor: theme.color.accentMuted,
    borderLeftColor: theme.color.accent,
    borderLeftWidth: 3,
  },
  leaderRow: { backgroundColor: theme.color.warningMuted },
  rankCell: {
    color: theme.color.textMuted,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    width: 44,
  },
  rankLeader: { color: theme.color.gold },
  personCell: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: theme.space.sm,
    minWidth: 150,
  },
  personCellHeader: {
    color: theme.color.textMuted,
    flex: 1,
    fontSize: 9,
    fontWeight: '900',
    minWidth: 150,
  },
  personName: { color: theme.color.text, flexShrink: 1, fontSize: 12, fontWeight: '900' },
  currentName: { color: theme.color.accent },
  inlineYou: {
    backgroundColor: theme.color.accent,
    borderRadius: 999,
    color: theme.color.accentInk,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  moveCell: { alignItems: 'center', width: 60 },
  moveCellHeader: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    width: 60,
  },
  numberCell: {
    color: theme.color.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    width: 46,
  },
  numberCellStrong: {
    color: theme.color.gold,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    width: 56,
  },
  numberCellHeader: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    width: 46,
  },
  lastFiveCell: { alignItems: 'center', width: 126 },
  lastFiveHeader: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    width: 126,
  },
  stateCell: { alignItems: 'center', flexDirection: 'row', gap: 5, width: 92 },
  stateCellHeader: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    width: 92,
  },
  stateDot: { borderRadius: 4, height: 7, width: 7 },
  stateLive: { backgroundColor: theme.color.warning },
  stateFinal: { backgroundColor: theme.color.accent },
  stateText: { color: theme.color.textMuted, fontSize: 9, fontWeight: '800' },
  compactList: { width: '100%' },
  compactRow: {
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    gap: theme.space.md,
    minHeight: 118,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
  },
  compactMain: { alignItems: 'center', flexDirection: 'row', gap: theme.space.sm },
  compactRank: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    fontWeight: '900',
    textAlign: 'center',
    width: 34,
  },
  compactIdentity: { flex: 1, gap: theme.space.xs, minWidth: 0 },
  compactName: { color: theme.color.text, fontSize: theme.font.size.md, fontWeight: '900' },
  compactStatusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.xs,
  },
  compactPoints: { alignItems: 'flex-end', minWidth: 54 },
  compactPointsValue: { color: theme.color.accent, fontSize: theme.font.size.lg, fontWeight: '900' },
  compactPointsLabel: { color: theme.color.textSubtle, fontSize: theme.font.size.xs },
  compactMetrics: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    paddingLeft: 42,
  },
  compactMetric: { alignItems: 'center', minWidth: 34 },
  compactMetricLabel: {
    color: theme.color.textSubtle,
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  compactMetricValue: {
    color: theme.color.text,
    fontSize: theme.font.size.sm,
    fontWeight: '900',
    marginTop: 2,
  },
  compactForm: { gap: theme.space.xs, marginLeft: 'auto' },
  emptyCopy: { color: theme.color.textMuted, fontSize: 12, lineHeight: 18, padding: 18 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,8,25,.86)',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    maxWidth: 480,
    padding: 24,
    position: 'relative',
    width: '100%',
  },
  modalClose: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 44,
  },
  profileName: { color: theme.color.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  profilePosition: { color: theme.color.gold, fontSize: 13, fontWeight: '800' },
  profileStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    width: '100%',
  },
  miniMetric: {
    backgroundColor: 'rgba(0,20,58,.28)',
    borderRadius: 10,
    flexGrow: 1,
    minWidth: 100,
    padding: 10,
  },
  miniLabel: { color: theme.color.textMuted, fontSize: 9, fontWeight: '800' },
  miniValue: { color: theme.color.text, fontSize: 12, fontWeight: '900', marginTop: 3 },
  trophyRoom: {
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.border,
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: '92%',
    maxWidth: 1120,
    overflow: 'hidden',
    width: '100%',
  },
  roomHeader: {
    alignItems: 'flex-start',
    borderBottomColor: theme.color.borderMuted,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
  },
  roomTitle: { color: theme.color.text, fontSize: 25, fontWeight: '900', marginTop: 3 },
  roomSubtitle: { color: theme.color.textMuted, fontSize: 11, marginTop: 4 },
  modalCloseStatic: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  roomScroll: { gap: 12, padding: 20 },
  roomSectionTitle: { color: theme.color.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  awardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  globalAward: {
    backgroundColor: 'rgba(0,20,58,.34)',
    borderColor: theme.color.borderMuted,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    minWidth: 240,
    padding: 14,
  },
  personalAward: {
    backgroundColor: 'rgba(0,20,58,.34)',
    borderColor: theme.color.borderMuted,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    minWidth: 220,
    padding: 14,
  },
  personalLocked: { opacity: 0.7 },
  provisionalBorder: { borderColor: theme.color.warning },
  personalTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  personalTitle: { color: theme.color.text, fontSize: 13, fontWeight: '900' },
  personalDescription: { color: theme.color.textMuted, fontSize: 10, lineHeight: 15 },
  awardState: {
    color: theme.color.info,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  rarity: {
    borderRadius: 999,
    fontSize: 8,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    textTransform: 'uppercase',
  },
  rarityCommon: { backgroundColor: 'rgba(184,201,220,.15)', color: theme.color.textMuted },
  rarityRare: { backgroundColor: 'rgba(114,183,242,.18)', color: theme.color.info },
  rarityEpic: { backgroundColor: 'rgba(175,110,255,.18)', color: '#d3b3ff' },
  rarityLegendary: { backgroundColor: 'rgba(244,214,92,.18)', color: theme.color.gold },
  progressTrack: {
    backgroundColor: 'rgba(184,201,220,.12)',
    borderRadius: 4,
    height: 6,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: theme.color.accent, borderRadius: 4, height: 6 },
  progressText: { color: theme.color.textMuted, fontSize: 9, marginTop: 3 },
  winnerRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  winnerName: { color: theme.color.text, fontSize: 11, fontWeight: '900' },
  streakRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,8,25,.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 16,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  detailCard: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderColor: theme.color.gold,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
});

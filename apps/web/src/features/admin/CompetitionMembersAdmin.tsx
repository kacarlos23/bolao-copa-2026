import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errorMessage, type User } from '../../api';
import { theme } from '../../theme/tokens';

type MembershipStatus = 'ACTIVE' | 'INACTIVE' | 'REMOVED';

export function CompetitionMembersAdmin({ poolSeasonId }: { poolSeasonId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [statuses, setStatuses] = useState<Record<string, MembershipStatus>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!poolSeasonId) return;
    setError('');
    try {
      const [userResult, memberResult] = await Promise.all([api.adminUsers(), api.adminPoolSeasonMembers(poolSeasonId)]);
      setUsers(userResult.users);
      setStatuses(Object.fromEntries(memberResult.members.map((item) => [item.userId, item.status])));
      setNicknames(Object.fromEntries(userResult.users.map((user) => [user.id, user.nickname])));
    } catch (cause) { setError(errorMessage(cause)); }
  }
  useEffect(() => { void load(); }, [poolSeasonId]);

  async function setParticipation(userId: string, status: MembershipStatus) {
    setBusyId(`${userId}:membership`); setError('');
    try {
      await api.setAdminPoolSeasonMemberStatus(poolSeasonId, userId, status);
      setStatuses((current) => ({ ...current, [userId]: status }));
      setMessage(status === 'ACTIVE' ? 'Usuário incluído na competição.' : 'Participação atualizada.');
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(''); }
  }
  async function saveNickname(user: User) {
    const nickname = nicknames[user.id]?.trim() ?? '';
    if (nickname.length < 2) { setError('O nickname precisa ter ao menos 2 caracteres.'); return; }
    setBusyId(`${user.id}:nickname`); setError('');
    try { await api.updateAdminUserNickname(user.id, nickname); setMessage('Nickname atualizado.'); await load(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(''); }
  }
  async function resetPassword(user: User) {
    const password = passwords[user.id] ?? '';
    if (password.length < 6) { setError('A nova senha precisa ter ao menos 6 caracteres.'); return; }
    setBusyId(`${user.id}:password`); setError('');
    try { await api.resetAdminUserPassword(user.id, password); setPasswords((current) => ({ ...current, [user.id]: '' })); setMessage('Senha redefinida; as sessões do usuário foram revogadas.'); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(''); }
  }

  return <View style={styles.shell}>
    <Text style={styles.title}>Participantes da competição</Text>
    <Text style={styles.copy}>Criar conta não inclui ninguém automaticamente. Inclua, inative ou remova cada pessoa somente nesta competição.</Text>
    {message ? <Text style={styles.message}>{message}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {users.map((user) => {
      const status = statuses[user.id] ?? 'REMOVED';
      return <View key={user.id} style={styles.user}>
        <View style={styles.userTop}><Text style={styles.name}>{user.nickname}</Text><Text style={styles.status}>{status === 'ACTIVE' ? 'Participando' : status === 'INACTIVE' ? 'Inativo' : 'Fora'}</Text></View>
        <Text style={styles.meta}>{user.username}</Text>
        <View style={styles.row}><TextInput value={nicknames[user.id] ?? ''} onChangeText={(value) => setNicknames((v) => ({ ...v, [user.id]: value }))} style={styles.input} placeholder="Nickname" placeholderTextColor={theme.color.textMuted} /><Action label="Salvar nome" onPress={() => void saveNickname(user)} disabled={Boolean(busyId)} /></View>
        <View style={styles.row}><TextInput secureTextEntry value={passwords[user.id] ?? ''} onChangeText={(value) => setPasswords((v) => ({ ...v, [user.id]: value }))} style={styles.input} placeholder="Nova senha" placeholderTextColor={theme.color.textMuted} /><Action label="Redefinir senha" onPress={() => void resetPassword(user)} disabled={Boolean(busyId)} /></View>
        <View style={styles.actions}>
          <Action label="Incluir / ativar" onPress={() => void setParticipation(user.id, 'ACTIVE')} disabled={Boolean(busyId) || status === 'ACTIVE'} />
          <Action label="Inativar" onPress={() => void setParticipation(user.id, 'INACTIVE')} disabled={Boolean(busyId) || status !== 'ACTIVE'} />
          <Action label="Remover" danger onPress={() => void setParticipation(user.id, 'REMOVED')} disabled={Boolean(busyId) || status === 'REMOVED'} />
        </View>
      </View>;
    })}
  </View>;
}
function Action({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, danger && styles.danger, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  shell: { borderColor: theme.color.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 10, marginTop: 18, padding: 16 }, title: { color: theme.color.text, fontSize: 18, fontWeight: '900' }, copy: { color: theme.color.textMuted, lineHeight: 20 }, user: { borderTopColor: theme.color.borderMuted, borderTopWidth: 1, gap: 8, paddingTop: 12 }, userTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, name: { color: theme.color.text, fontSize: 16, fontWeight: '800' }, meta: { color: theme.color.textMuted, fontSize: 12 }, status: { color: theme.color.accent, fontSize: 12, fontWeight: '800' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, input: { backgroundColor: theme.color.surface, borderColor: theme.color.border, borderRadius: 8, borderWidth: 1, color: theme.color.text, flex: 1, minWidth: 170, paddingHorizontal: 10, paddingVertical: 8 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { backgroundColor: theme.color.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 }, danger: { backgroundColor: '#c73c49' }, disabled: { opacity: .45 }, buttonText: { color: theme.color.accentInk, fontSize: 12, fontWeight: '800' }, message: { color: theme.color.accent, fontWeight: '700' }, error: { color: '#f07078', fontWeight: '700' },
});

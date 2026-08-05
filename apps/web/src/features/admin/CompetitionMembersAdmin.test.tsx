import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompetitionMembersAdmin } from './CompetitionMembersAdmin';

const user = {
  id: 'user-1',
  username: 'alice',
  nickname: 'Alice',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
};

function mockMembership(status: 'ACTIVE' | 'INACTIVE' | 'REMOVED') {
  vi.spyOn(api, 'adminPoolSeasonMembers').mockResolvedValue({
    members: [{ userId: user.id, status }],
  });
}

describe('CompetitionMembersAdmin contribution lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(api, 'adminUsers').mockResolvedValue({ users: [user] });
    mockMembership('REMOVED');
    vi.spyOn(api, 'setAdminPoolSeasonMemberStatus').mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('preserves the legacy direct membership update when contributions are omitted', async () => {
    render(<CompetitionMembersAdmin poolSeasonId="pool-season-1" />);

    await screen.findByText('Alice');
    fireEvent.click(screen.getByText('Incluir / ativar'));

    await waitFor(() =>
      expect(api.setAdminPoolSeasonMemberStatus).toHaveBeenCalledWith(
        'pool-season-1',
        'user-1',
        'ACTIVE',
      ),
    );
  });

  it('confirms the selected first charging round before activating the participant', async () => {
    const previewAccount = vi.fn().mockResolvedValue({
      previewId: 'preview-1',
      confirmation: 'CONFIRMAR CONTA',
    });
    const confirmAccount = vi.fn().mockResolvedValue(undefined);
    render(
      <CompetitionMembersAdmin
        poolSeasonId="pool-season-1"
        contributionsEnabled
        contributionRounds={[
          { order: 20, name: 'Rodada 20' },
          { order: 21, name: 'Rodada 21' },
        ]}
        onPreviewContributionAccount={previewAccount}
        onConfirmContributionAccount={confirmAccount}
      />,
    );

    await screen.findByText('Alice');
    fireEvent.click(screen.getByText('Incluir / ativar'));

    expect(api.setAdminPoolSeasonMemberStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Rodada 20'));
    fireEvent.click(screen.getByText('Revisar alteração'));

    await waitFor(() =>
      expect(previewAccount).toHaveBeenCalledWith({
        userId: 'user-1',
        startRound: 20,
        endRound: null,
      }),
    );
    fireEvent.change(screen.getByLabelText('Confirmação da conta de contribuições'), {
      target: { value: 'CONFIRMAR CONTA' },
    });
    fireEvent.click(screen.getByText('Confirmar e salvar participação'));

    await waitFor(() => expect(confirmAccount).toHaveBeenCalledTimes(1));
    expect(confirmAccount).toHaveBeenCalledWith({
      userId: 'user-1',
      startRound: 20,
      endRound: null,
      previewId: 'preview-1',
      confirmation: 'CONFIRMAR CONTA',
    });
    await waitFor(() => expect(api.setAdminPoolSeasonMemberStatus).toHaveBeenCalledTimes(1));
    expect(confirmAccount.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.setAdminPoolSeasonMemberStatus).mock.invocationCallOrder[0],
    );
  });

  it('requires a final charging round before inactivating a participant', async () => {
    mockMembership('ACTIVE');
    const previewAccount = vi.fn().mockResolvedValue({
      previewId: 'preview-2',
      confirmation: 'CONFIRMAR SAÍDA',
    });
    const confirmAccount = vi.fn().mockResolvedValue(undefined);
    render(
      <CompetitionMembersAdmin
        poolSeasonId="pool-season-1"
        contributionsEnabled
        contributionRounds={[
          { order: 20, name: 'Rodada 20' },
          { order: 21, name: 'Rodada 21' },
        ]}
        contributionAccountsByUserId={{
          'user-1': { startRound: 20, endRound: null },
        }}
        onPreviewContributionAccount={previewAccount}
        onConfirmContributionAccount={confirmAccount}
      />,
    );

    await screen.findByText('Alice');
    fireEvent.click(screen.getByText('Inativar'));

    expect(screen.getByText('Última rodada cobrada')).toBeTruthy();
    expect(api.setAdminPoolSeasonMemberStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Rodada 21'));
    fireEvent.click(screen.getByText('Revisar alteração'));

    await waitFor(() => expect(previewAccount).toHaveBeenCalledWith({ userId: 'user-1', endRound: 21 }));
    fireEvent.change(screen.getByLabelText('Confirmação da conta de contribuições'), {
      target: { value: 'CONFIRMAR SAÍDA' },
    });
    fireEvent.click(screen.getByText('Confirmar e salvar participação'));

    await waitFor(() => expect(confirmAccount).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(api.setAdminPoolSeasonMemberStatus).toHaveBeenCalledWith(
        'pool-season-1',
        'user-1',
        'INACTIVE',
      ),
    );
  });
});

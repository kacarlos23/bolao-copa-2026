import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContributionsAdmin,
  type ContributionMutationConfirmation,
  type ContributionMutationDraft,
  type ContributionsAdminOverview,
} from './ContributionsAdmin';

const overview: ContributionsAdminOverview = {
  poolSeasonId: 'pool-season-1',
  amountPerRoundCents: 1_000,
  defaultStartRound: 20,
  dueThroughRound: 20,
  selectedRoundId: 'round-20',
  totals: {
    paidCents: 1_500,
    dueCents: 2_000,
    outstandingCents: 500,
    advanceCents: 0,
  },
  rounds: [
    { roundId: 'round-20', order: 20, name: 'Rodada 20', startsAt: '2026-08-01T12:00:00.000Z', hasStarted: true },
    { roundId: 'round-21', order: 21, name: 'Rodada 21', startsAt: '2026-08-08T12:00:00.000Z', hasStarted: false },
  ],
  participants: [
    {
      userId: 'user-1',
      nickname: 'Leoncio',
      contributionStartRound: 20,
      contributionEndRound: null,
      paymentCents: 500,
      dueCents: 1_000,
      outstandingCents: 500,
      advanceCents: 0,
      selectedRoundPaymentCents: 500,
      selectedRoundOutstandingCents: 500,
    },
  ],
  transactions: [
    {
      id: 'payment-1',
      userId: 'user-1',
      roundId: 'round-20',
      kind: 'PAYMENT',
      amountCents: 500,
      createdAt: '2026-08-01T12:00:00.000Z',
    },
  ],
};

describe('ContributionsAdmin', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('records a remaining payment directly without a justification or reinforced confirmation', async () => {
    const onRecordPayment = vi.fn().mockResolvedValue(undefined);
    const onPreview = vi.fn<(input: ContributionMutationDraft) => Promise<any>>();
    const onConfirm = vi.fn<(input: ContributionMutationConfirmation) => Promise<void>>();
    const onRefresh = vi.fn<() => Promise<void>>().mockResolvedValue();

    render(
      <ContributionsAdmin
        overview={{
          ...overview,
          selectedRoundId: null,
          participants: [
            {
              ...overview.participants[0],
              selectedRoundPaymentCents: null,
              selectedRoundOutstandingCents: null,
            },
          ],
        }}
        onRecordPayment={onRecordPayment}
        onPreview={onPreview}
        onConfirm={onConfirm}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText('Contribuições por rodada')).toBeTruthy();
    expect(screen.getByText(/R\$\s*10,00 por participante/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Quitar Leoncio'));

    await waitFor(() =>
      expect(onRecordPayment).toHaveBeenCalledWith({
        userId: 'user-1',
        roundId: 'round-20',
        amountCents: 500,
      }),
    );

    await screen.findByText('Pagamento registrado.');
    expect(onPreview).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Justificativa da alteração de contribuição')).toBeNull();
    expect(screen.queryByLabelText('Confirmação da alteração de contribuição')).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('prevents a partial entry greater than the selected round balance', async () => {
    const onRecordPayment = vi.fn().mockResolvedValue(undefined);
    render(<ContributionsAdmin overview={overview} onRecordPayment={onRecordPayment} />);

    fireEvent.change(screen.getByLabelText('Valor para Leoncio na Rodada 20'), {
      target: { value: '5,01' },
    });
    fireEvent.click(screen.getByLabelText('Registrar pagamento parcial de Leoncio'));

    expect((await screen.findByRole('alert')).textContent).toContain('R$ 5,00');
    expect(onRecordPayment).not.toHaveBeenCalled();
  });

  it('selects the most recent active receipt for an auditable void', async () => {
    const onPreview = vi.fn<(input: ContributionMutationDraft) => Promise<any>>().mockResolvedValue({
      previewId: 'preview-void',
      confirmation: 'CONFIRMAR 1 ESTORNO12345',
    });
    const onConfirm = vi.fn<(input: ContributionMutationConfirmation) => Promise<void>>();
    render(
      <ContributionsAdmin
        overview={{
          ...overview,
          transactions: [
            ...overview.transactions!,
            {
              id: 'payment-2',
              userId: 'user-1',
              roundId: 'round-20',
              kind: 'PAYMENT',
              amountCents: 100,
              createdAt: '2026-08-02T12:00:00.000Z',
            },
          ],
        }}
        onPreview={onPreview}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText('Estornar pagamento de Leoncio'));

    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith({
        action: 'VOID',
        transactionId: 'payment-2',
        justification: 'Estorno de contribuição registrado pelo administrador.',
      }),
    );
  });

  it('delegates round selection and previews an auditable account range adjustment', async () => {
    const onRoundChange = vi.fn();
    const onPreview = vi.fn<(input: ContributionMutationDraft) => Promise<any>>().mockResolvedValue({
      previewId: 'preview-account',
      confirmation: 'CONFIRMAR 1 CONTA123456',
    });
    const onConfirm = vi.fn<(input: ContributionMutationConfirmation) => Promise<void>>();
    render(
      <ContributionsAdmin
        overview={overview}
        onRoundChange={onRoundChange}
        onPreview={onPreview}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText('Selecionar Rodada 21'));
    expect(onRoundChange).toHaveBeenCalledWith('round-21');

    fireEvent.click(screen.getByLabelText('Ajustar faixa de cobrança de Leoncio'));
    fireEvent.change(screen.getByLabelText('Rodada inicial de Leoncio'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('Rodada final de Leoncio'), { target: { value: '21' } });
    fireEvent.click(screen.getByText('Revisar faixa de cobrança'));

    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith({
        action: 'ACCOUNT',
        userId: 'user-1',
        startRound: 21,
        endRound: 21,
        justification: 'Faixa de cobrança atualizada pelo administrador.',
      }),
    );
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { FundraisingAdmin } from './FundraisingAdmin';

describe('FundraisingAdmin', () => {
  beforeEach(() => {
    vi.spyOn(api, 'adminFundraising').mockResolvedValue({
      fundraising: {
        poolSeasonId: 'pool-season-1',
        amountCents: 0,
        description: 'Ação entre amigos para custear a viagem',
        updatedAt: null,
        updatedById: null,
        lastJustification: null,
      },
      eligibleMatches: 190,
      activeParticipants: 10,
      estimatedContributionCents: 190_000,
    });
    vi.spyOn(api, 'previewFundraising').mockResolvedValue({
      previewId: 'preview-1',
      affectedCount: 1,
      confirmation: 'CONFIRMAR 1 ABCDEF123456',
      expiresAt: '2026-07-24T13:00:00.000Z',
      preview: {},
    });
    vi.spyOn(api, 'updateFundraising').mockResolvedValue({
      fundraising: {
        poolSeasonId: 'pool-season-1',
        amountCents: 15_050,
        description: 'Ação entre amigos para custear a viagem',
        updatedAt: '2026-07-24T12:00:00.000Z',
        updatedById: 'admin-1',
        lastJustification: 'Valor confirmado pelo administrador',
      },
      affectedCount: 1,
      replayed: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads, previews and saves the cents value', async () => {
    render(<FundraisingAdmin seasonId="season-1" poolSeasonId="pool-season-1" />);

    await screen.findByText(/R\$\s*0,00/);
    fireEvent.change(screen.getByLabelText('Valor arrecadado'), {
      target: { value: '150,50' },
    });
    fireEvent.click(screen.getByText('Gerar prévia'));
    await screen.findByText(/Digite exatamente/);
    fireEvent.change(screen.getByLabelText('Confirmação do valor arrecadado'), {
      target: { value: 'CONFIRMAR 1 ABCDEF123456' },
    });
    fireEvent.click(screen.getByText('Salvar valor arrecadado'));

    await screen.findByText('Valor arrecadado salvo com auditoria.');
    expect(screen.getByText(/R\$\s*150,50/)).toBeTruthy();
    expect(api.updateFundraising).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 15_050, poolSeasonId: 'pool-season-1' }),
    );
  });

  it('shows validation errors without creating a preview', async () => {
    render(<FundraisingAdmin seasonId="season-1" poolSeasonId="pool-season-1" />);
    await waitFor(() => expect(api.adminFundraising).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Valor arrecadado'), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByText('Gerar prévia'));

    expect((await screen.findByRole('alert')).textContent).toContain('Informe um valor válido');
    expect(api.previewFundraising).not.toHaveBeenCalled();
  });
});

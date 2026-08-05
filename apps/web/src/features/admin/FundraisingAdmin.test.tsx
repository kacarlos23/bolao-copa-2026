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
        prizes: [
          { place: 1, percentage: 50, amountCents: 0 },
          { place: 2, percentage: 30, amountCents: 0 },
          { place: 3, percentage: 20, amountCents: 0 },
        ],
        description: 'Premiação do pódio: 50% para o 1º, 30% para o 2º e 20% para o 3º lugar.',
        updatedAt: null,
        updatedById: null,
        lastJustification: null,
      },
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
        prizes: [
          { place: 1, percentage: 50, amountCents: 7_525 },
          { place: 2, percentage: 30, amountCents: 4_515 },
          { place: 3, percentage: 20, amountCents: 3_010 },
        ],
        description: 'Premiação do pódio: 50% para o 1º, 30% para o 2º e 20% para o 3º lugar.',
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

    await screen.findByText(/permanece independente das contribuições por rodada/i);
    fireEvent.change(screen.getByLabelText('Valor arrecadado'), {
      target: { value: '150,50' },
    });
    fireEvent.click(screen.getByText('Revisar valor'));
    await screen.findByText(/Digite exatamente/);
    fireEvent.change(screen.getByLabelText('Confirmação do valor arrecadado'), {
      target: { value: 'CONFIRMAR 1 ABCDEF123456' },
    });
    fireEvent.click(screen.getByText('Salvar valor arrecadado'));

    await screen.findByText('Valor arrecadado salvo com auditoria e premiação recalculada.');
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
    fireEvent.click(screen.getByText('Revisar valor'));

    expect((await screen.findByRole('alert')).textContent).toContain('Informe um valor válido');
    expect(api.previewFundraising).not.toHaveBeenCalled();
  });

  it('recalculates and truncates the podium prizes as the amount changes', async () => {
    render(<FundraisingAdmin seasonId="season-1" poolSeasonId="pool-season-1" />);
    await screen.findByText(/permanece independente das contribuições por rodada/i);

    fireEvent.change(screen.getByLabelText('Valor arrecadado'), {
      target: { value: '265,43' },
    });

    expect(screen.getByText('Premiação do pódio')).toBeTruthy();
    expect(screen.getByText(/R\$\s*132,71/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*79,62/)).toBeTruthy();
    expect(screen.getByText(/R\$\s*53,08/)).toBeTruthy();
    expect(screen.getByText('Valores truncados em centavos, sem arredondamento.')).toBeTruthy();
  });

  it('keeps manual fundraising distinct from round contributions', async () => {
    render(<FundraisingAdmin seasonId="season-1" poolSeasonId="pool-season-1" />);

    await screen.findByText(/permanece independente das contribuições por rodada/i);
    expect(screen.queryByText(/R\$\s*1,00/)).toBeNull();
    expect(screen.queryByText(/Contribuição prevista:/)).toBeNull();
  });
});

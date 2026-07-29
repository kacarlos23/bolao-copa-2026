import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PredictionSubmissionStatusModal } from './PredictionSubmissionStatusModal';

describe('PredictionSubmissionStatusModal', () => {
  it('separates pending and saved participants without exposing scores', () => {
    const onRefresh = vi.fn();
    render(
      <PredictionSubmissionStatusModal
        visible
        matchTitle="Internacional × Flamengo"
        requiredPredictions={1}
        participants={[
          {
            userId: 'user-pending',
            nickname: 'Bruno',
            avatarUrl: null,
            hasSavedPredictions: false,
          },
          {
            userId: 'user-saved',
            nickname: 'Ana',
            avatarUrl: '/uploads/avatars/ana.webp',
            hasSavedPredictions: true,
          },
        ]}
        currentUserId="user-pending"
        loading={false}
        error=""
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Quem falta palpitar' })).toBeTruthy();
    expect(screen.getByText(/Internacional × Flamengo/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Falta palpitar' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Palpites salvos' })).toBeTruthy();
    expect(screen.getByLabelText('Bruno, falta palpitar')).toBeTruthy();
    expect(screen.getByLabelText('Ana, palpites salvos')).toBeTruthy();
    expect(screen.getByLabelText('Avatar de Bruno')).toBeTruthy();
    expect(screen.getByLabelText('Avatar de Ana')).toBeTruthy();
    expect(screen.getByText('VOCÊ')).toBeTruthy();
    expect(screen.getByText(/continuam privados/)).toBeTruthy();
    expect(screen.queryByText(/\d+\s*[×x]\s*\d+/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar situação dos palpites' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows a retry action when status loading fails', () => {
    const onRefresh = vi.fn();
    render(
      <PredictionSubmissionStatusModal
        visible
        matchTitle="Internacional × Flamengo"
        requiredPredictions={0}
        participants={[]}
        currentUserId="user-1"
        loading={false}
        error="Não foi possível carregar."
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Não foi possível carregar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar situação novamente' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesModal } from './UnsavedChangesModal';

describe('UnsavedChangesModal', () => {
  afterEach(cleanup);
  it('mantém o usuário na tela ao continuar editando', () => {
    const onContinue = vi.fn();
    const onKeepDraft = vi.fn();
    render(
      <UnsavedChangesModal
        visible
        onContinue={onContinue}
        onKeepDraft={onKeepDraft}
        onDiscard={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Continuar editando'));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onKeepDraft).not.toHaveBeenCalled();
  });

  it('expõe ações distintas para manter e descartar o rascunho', () => {
    const onKeepDraft = vi.fn();
    const onDiscard = vi.fn();
    render(
      <UnsavedChangesModal visible onContinue={vi.fn()} onKeepDraft={onKeepDraft} onDiscard={onDiscard} />,
    );
    fireEvent.click(screen.getByText('Sair e manter rascunho'));
    expect(onKeepDraft).toHaveBeenCalledOnce();

    cleanup();
    render(<UnsavedChangesModal visible onContinue={vi.fn()} onKeepDraft={onKeepDraft} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByText('Descartar alterações e sair'));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});

import { Profiler, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ScoreInput } from './ScoreInput';
import { AsyncState } from './AsyncState';

afterEach(cleanup);

describe('componentes acessíveis de entrada e estado', () => {
  it('associa o placar ao time, abre teclado numérico e normaliza a entrada', () => {
    const onChange = vi.fn();
    const screen = render(
      <ScoreInput
        teamName="Brasil"
        side="home"
        value=""
        onChange={onChange}
        error="Placar obrigatório"
      />,
    );
    const input = screen.getByLabelText('Placar de Brasil, mandante');

    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('aria-label')).toBe('Placar de Brasil, mandante');
    fireEvent.change(input, { target: { value: '1a23' } });
    expect(onChange).toHaveBeenCalledWith('12');
    expect(screen.getByText('Placar obrigatório')).toBeTruthy();
  });

  it('mantém erro com ação de recuperação acessível', () => {
    const retry = vi.fn();
    const screen = render(<AsyncState status="error" error="Servidor indisponível" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('mede commits antes de qualquer memoização do campo', () => {
    let commits = 0;
    function ControlledScore() {
      const [value, setValue] = useState('');
      return <ScoreInput teamName="Brasil" side="home" value={value} onChange={setValue} />;
    }
    const screen = render(
      <Profiler id="score-input" onRender={() => { commits += 1; }}>
        <ControlledScore />
      </Profiler>,
    );
    expect(commits).toBe(1);
    fireEvent.change(screen.getByLabelText('Placar de Brasil, mandante'), { target: { value: '2' } });
    expect(commits).toBe(2);
  });
});

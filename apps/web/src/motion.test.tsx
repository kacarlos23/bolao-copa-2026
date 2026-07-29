import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DrawerReveal,
  loadGsap,
  MotionModal,
  MotionPressable,
  MotionProvider,
  PageTransition,
  ScrollReveal,
} from './motion';

const gsapMock = vi.hoisted(() => {
  const revert = vi.fn();
  const animation = { pause: vi.fn(), resume: vi.fn() };
  const fromTo = vi.fn(() => animation);
  const to = vi.fn((_target: unknown, vars: { onComplete?: () => void } = {}) => {
    if (vars.onComplete) queueMicrotask(vars.onComplete);
    return animation;
  });
  const set = vi.fn();
  const timeline = vi.fn(() => {
    const chain = {
      call: vi.fn((callback: () => void) => {
        queueMicrotask(callback);
        return chain;
      }),
      fromTo: vi.fn(() => chain),
      to: vi.fn((_target: unknown, vars: { onComplete?: () => void } = {}) => {
        if (vars.onComplete) queueMicrotask(vars.onComplete);
        return chain;
      }),
    };
    return chain;
  });
  const context = vi.fn((callback: () => void) => {
    callback();
    return { revert };
  });
  return { animation, context, fromTo, revert, set, timeline, to };
});

vi.mock('gsap', () => ({
  gsap: {
    context: gsapMock.context,
    fromTo: gsapMock.fromTo,
    set: gsapMock.set,
    timeline: gsapMock.timeline,
    to: gsapMock.to,
  },
}));

function mockMotionPreference(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: reduced,
      removeEventListener: vi.fn(),
    })),
  );
}

describe('camada central de movimento', () => {
  beforeEach(() => {
    mockMotionPreference(false);
    gsapMock.context.mockClear();
    gsapMock.fromTo.mockClear();
    gsapMock.revert.mockClear();
    gsapMock.timeline.mockClear();
    gsapMock.to.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('carrega uma única instância do GSAP', async () => {
    const [first, second] = await Promise.all([loadGsap(), loadGsap()]);
    expect(first).toBe(second);
    expect(first).toBeTruthy();
  });

  it('preserva o contrato dos handlers do pressable', () => {
    const onPress = vi.fn();
    render(
      <MotionPressable accessibilityRole="button" onPress={onPress}>
        <Text>Ação animada</Text>
      </MotionPressable>,
    );

    const button = screen.getByRole('button', { name: 'Ação animada' });
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
    expect(button.getAttribute('data-motion-interactive')).toBe('button');
  });

  it('limpa contextos GSAP no unmount', async () => {
    const result = render(
      <PageTransition>
        <View {...({ 'data-motion-item': true } as object)}>
          <Text>Bloco</Text>
        </View>
      </PageTransition>,
    );

    await waitFor(() => expect(gsapMock.context).toHaveBeenCalled());
    result.unmount();
    expect(gsapMock.revert).toHaveBeenCalled();
  });

  it('aplica diretamente o estado final com movimento reduzido', async () => {
    mockMotionPreference(true);
    render(
      <MotionProvider>
        <PageTransition>
          <Text>Conteúdo estável</Text>
        </PageTransition>
      </MotionProvider>,
    );

    await act(async () => undefined);
    expect(screen.getByText('Conteúdo estável')).toBeTruthy();
    expect(gsapMock.fromTo).not.toHaveBeenCalled();
  });

  it('revela conteúdo ao entrar na área visível e desconecta o observador', async () => {
    let reveal: IntersectionObserverCallback | undefined;
    const disconnectSpy = vi.fn();
    class IntersectionObserverMock {
      disconnect = disconnectSpy;
      observe = vi.fn();
      unobserve = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        reveal = callback;
      }
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

    const result = render(
      <ScrollReveal>
        <Text>Conteúdo da rolagem</Text>
      </ScrollReveal>,
    );
    expect(gsapMock.fromTo).not.toHaveBeenCalled();

    await act(async () => {
      reveal?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await waitFor(() => expect(gsapMock.fromTo).toHaveBeenCalled());
    expect(disconnectSpy).toHaveBeenCalled();
    result.unmount();
  });

  it('mantém o modal presente durante a saída e o remove ao concluir', async () => {
    const { rerender } = render(
      <MotionModal accessibilityLabel="Confirmação" visible onRequestClose={vi.fn()}>
        <Text>Conteúdo do modal</Text>
      </MotionModal>,
    );
    expect(screen.getByText('Conteúdo do modal')).toBeTruthy();

    rerender(
      <MotionModal accessibilityLabel="Confirmação" visible={false} onRequestClose={vi.fn()}>
        <Text>Conteúdo do modal</Text>
      </MotionModal>,
    );
    expect(screen.getByText('Conteúdo do modal')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Conteúdo do modal')).toBeNull());
  });

  it('abre e fecha drawers sem remover conteúdo antes da animação', async () => {
    const { rerender } = render(
      <DrawerReveal open>
        <Text>Detalhes</Text>
      </DrawerReveal>,
    );
    expect(screen.getByText('Detalhes')).toBeTruthy();

    rerender(
      <DrawerReveal open={false}>
        <Text>Detalhes</Text>
      </DrawerReveal>,
    );
    expect(screen.getByText('Detalhes')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Detalhes')).toBeNull());
  });
});

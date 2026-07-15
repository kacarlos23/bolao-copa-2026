import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installApiMocks } from './fixtures';

test('login funciona por teclado e expõe nomes acessíveis', async ({ page }) => {
  await installApiMocks(page, { authenticated: false });
  await page.goto('/');

  await page.getByRole('tab', { name: 'Entrar' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: 'Criar conta' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Nickname')).toBeFocused();
  await page.getByLabel('Nickname').fill('maria');
  await page.getByLabel('Senha').fill('segredo');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('tab', { name: 'Palpites' })).toBeVisible();
  await expect(page.getByText('Copa do Mundo 2026')).toBeVisible();
});

test('palpite diário preserva feedback por item e salva por lote', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Palpites' }).click();

  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await expect(page.getByText('Não salvo')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar todos' }).click();
  await expect(page.getByText(/^Salvo às/)).toBeVisible();
});

test('V1 mantém paridade de login, preenchimento e salvamento atrás da flag', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await installApiMocks(page);
  await page.goto('/?predictions=v1');
  await page.getByRole('tab', { name: 'Palpites' }).click();

  await page.waitForTimeout(250);
  expect(pageErrors).toEqual([]);
  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await page.getByRole('button', { name: 'Salvar palpite' }).click();
  await expect(page.getByText(/Palpite salvo/i)).toBeVisible();
});

test('mata-mata exige classificado no empate e envia resumo completo', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Eliminatorias' }).click();

  await page.getByLabel('Placar de Brasil, mandante').fill('1');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await expect(page.getByText('Escolha quem avança')).toBeVisible();
  await page.getByRole('radio', { name: 'Argentina avança nos pênaltis' }).click();
  await page.getByRole('button', { name: 'Salvar chave completa' }).click();
  await expect(page.getByText(/chave completa foi salva/i)).toBeVisible();
});

test('troca de competição/temporada abre workspace orientado a capability', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: /Brasileirão$/, exact: false }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Brasileirão Série A', exact: true }).click();

  await expect(page.getByText('Brasileirão Série A 2026').first()).toBeVisible();
  await expect(page.getByText('Tabela da liga')).toBeVisible();
  await expect(page.getByLabel('Placar de Brasil, mandante')).toBeVisible();
});

test('ranking destaca usuário, líder da rodada, distância e desempates', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Brasileirão Série A', exact: true }).click();

  await expect(page.getByText('SUA POSIÇÃO')).toBeVisible();
  await expect(page.getByText(/3 pts para Ana/)).toBeVisible();
  await expect(page.getByText(/Líder da rodada · Ana/)).toBeVisible();
  await expect(page.getByText('Critérios de desempate')).toBeVisible();
  await expect(page.getByText(/Maria · Você/)).toBeVisible();
});

test('telas autenticadas de palpite, mata-mata e ranking passam WCAG A/AA', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');

  for (const tab of ['Palpites', 'Eliminatorias'] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByLabel('Placar de Brasil, mandante')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }

  await page.getByRole('tab', { name: 'Brasileirão Série A', exact: true }).click();
  await expect(page.getByText('Critérios de desempate')).toBeVisible();
  const rankingResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(rankingResults.violations).toEqual([]);
});

for (const status of [401, 403, 409, 500]) {
  test(`erro ${status} tem mensagem inequívoca`, async ({ page }) => {
    await installApiMocks(page, { authenticated: false, loginStatus: status });
    await page.goto('/');
    await page.getByLabel('Nickname').fill('maria');
    await page.getByLabel('Senha').fill('segredo');
    await page.getByRole('button', { name: 'Entrar' }).click();
    const expected = status === 401
      ? 'Sessão expirada'
      : status === 403
        ? 'Acesso negado'
        : status === 409
          ? 'Palpite fechado'
          : 'Falha interna';
    await expect(page.getByText(new RegExp(expected))).toBeVisible();
  });
}

test('SSE sinaliza Ao vivo, Offline e reconecta', async ({ page, context }) => {
  await installApiMocks(page);
  let delayNextConnection = false;
  await page.route('**/api/events**', async (route) => {
    if (delayNextConnection) {
      delayNextConnection = false;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Palpites' }).click();
  await expect(page.getByText('Ao vivo')).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText('Offline')).toBeVisible();
  delayNextConnection = true;
  await context.setOffline(false);
  await expect(page.getByText('Reconectando')).toBeVisible();
  await expect(page.getByText('Ao vivo')).toBeVisible({ timeout: 10_000 });
});

for (const width of [320, 768, 1280, 1440]) {
  test(`layout crítico não cria overflow global em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installApiMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Brasileirão Série A', exact: true }).click();
    await expect(page.getByText('Tabela da liga')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('reduced motion e contraste passam na entrada', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApiMocks(page, { authenticated: false });
  await page.goto('/');
  const duration = await page.getByRole('button', { name: 'Entrar' }).evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0s', '0.00001s', '1e-05s']).toContain(duration);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
  expect(serious).toEqual([]);
});

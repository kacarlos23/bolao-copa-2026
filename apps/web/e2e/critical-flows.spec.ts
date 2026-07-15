import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installApiMocks } from './fixtures';

test('login funciona por teclado e expõe nomes acessíveis', async ({ page }) => {
  await installApiMocks(page, { authenticated: false });
  await page.goto('/');

  await page.getByRole('button', { name: 'Usar login' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Criar conta' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Nickname')).toBeFocused();
  await page.getByLabel('Nickname').fill('maria');
  await page.getByLabel('Senha').fill('segredo');
  await page.getByRole('button', { name: 'Entrar no Bolão Sirel' }).click();

  await expect(
    page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Palpites', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Bolão Sirel/);
  await expect(page.getByText('Maria').first()).toBeVisible();
});

test('login e logout revogam a navegação autenticada', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menu de Maria' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('button', { name: 'Entrar no Bolão Sirel' })).toBeVisible();
});

test('palpite diário preserva feedback por item e salva por lote', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes/copa-do-mundo-2026/palpites');

  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await expect(page.getByText('Não salvo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar todos' }).click();
  await expect(page.getByText(/^Salvo às/)).toBeVisible();
});

test('rotas preservam URL, histórico e draft ao sair de palpites', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes/copa-do-mundo-2026/palpites');

  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await expect(page.getByText('Não salvo', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Competições' }).click();
  await expect(page).toHaveURL('/competicoes/copa-do-mundo-2026/palpites');
  await expect(page.getByLabel('Placar de Brasil, mandante')).toHaveValue('2');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Competições' }).click();
  await expect(page).toHaveURL('/competicoes');

  page.once('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL('/competicoes/copa-do-mundo-2026/palpites');
  await expect(page.getByLabel('Placar de Brasil, mandante')).toHaveValue('2');
});

test('troca de temporada respeita o guard e restaura o draft da temporada', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes/brasileirao-serie-a-2026/palpites');

  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await expect(page.getByText('Não salvo', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Brasileirão Série A 2025' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Brasileirão Série A 2026' }),
  ).toBeVisible();
  await expect(page.getByLabel('Placar de Brasil, mandante')).toHaveValue('2');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Brasileirão Série A 2025' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Brasileirão Série A 2025' }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Brasileirão Série A 2026' }).click();
  await expect(page.getByLabel('Placar de Brasil, mandante')).toHaveValue('2');
});

test('Copa aparece somente dentro da central e abre como rota legada', async ({
  page,
}, testInfo) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).not.toContainText(
    'Copa',
  );
  if (process.env.CAPTURE_UI === '1') {
    await testInfo.attach('home-bolao-sirel', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }

  await page.getByRole('link', { name: 'Competições' }).click();
  if (process.env.CAPTURE_UI === '1') {
    await testInfo.attach('central-de-competicoes', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
  await page.getByRole('link', { name: 'Abrir Copa do Mundo, área legada' }).click();
  await expect(page).toHaveURL('/competicoes/copa-do-mundo-2026');
  await expect(page.getByText('LEGADO')).toBeVisible();
  await expect(page).toHaveTitle(/Copa do Mundo 2026 · Bolão Sirel/);
});

test('instante limite mantém o palpite fechado no cliente', async ({ page }) => {
  await installApiMocks(page, { closed: true });
  await page.goto('/competicoes/copa-do-mundo-2026/palpites');
  await expect(page.getByText(/Fechado|Palpite fechado/).first()).toBeVisible();
  await expect(page.getByLabel('Placar de Brasil, mandante')).toHaveAttribute('readonly', '');
});

test('V1 mantém paridade de login, preenchimento e salvamento atrás da flag', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await installApiMocks(page);
  await page.goto('/competicoes/copa-do-mundo-2026/palpites?predictions=v1');

  await page.waitForTimeout(250);
  expect(pageErrors).toEqual([]);
  await page.getByLabel('Placar de Brasil, mandante').fill('2');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await page.getByRole('button', { name: 'Salvar palpite' }).click();
  await expect(page.getByText(/Palpite salvo/i)).toBeVisible();
});

test('mata-mata exige classificado no empate e envia resumo completo', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes/copa-do-mundo-2026/eliminatorias');

  await page.getByLabel('Placar de Brasil, mandante').fill('1');
  await page.getByLabel('Placar de Argentina, visitante').fill('1');
  await expect(page.getByText('Escolha quem avança')).toBeVisible();
  await page.getByRole('radio', { name: 'Argentina avança nos pênaltis' }).click();
  await page.getByRole('button', { name: 'Salvar chave completa' }).click();
  await expect(page.getByText(/chave completa foi salva/i)).toBeVisible();
});

test('troca de competição/temporada abre workspace orientado a capability', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes');
  await page.getByRole('link', { name: 'Abrir Brasileirão Série A' }).click();

  await expect(page).toHaveURL('/competicoes/brasileirao-serie-a-2026');
  await expect(page.getByText('Brasileirão Série A 2026').first()).toBeVisible();
  await page.getByRole('button', { name: 'Brasileirão Série A 2025' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Brasileirão Série A 2025' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Brasileirão Série A 2025, atual' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL('/competicoes/brasileirao-serie-a-2026');
  await page.getByRole('button', { name: 'Brasileirão Série A 2026' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Brasileirão Série A 2026' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Classificação' }).click();
  await expect(page.getByText('Tabela da liga')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Seções de Brasileirão Série A 2026' })
    .getByRole('link', { name: 'Palpites' })
    .click();
  await expect(page.getByLabel('Placar de Brasil, mandante')).toBeVisible();
});

test('ranking destaca usuário, líder da rodada, distância e desempates', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/competicoes/brasileirao-serie-a-2026/ranking');

  await expect(page.getByText('SUA POSIÇÃO', { exact: true })).toBeVisible();
  await expect(page.getByText(/3 pts para Ana/)).toBeVisible();
  await expect(page.getByText(/Líder da rodada.*Ana/)).toBeVisible();
  await expect(page.getByText('Critérios de desempate', { exact: true })).toBeVisible();
  await expect(page.getByText(/Maria · Você/)).toBeVisible();
});

test('admin importa, inspeciona override e bloqueia usuário com feedback', async ({ page }) => {
  await installApiMocks(page, { admin: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menu de Maria' }).click();
  await page.getByRole('button', { name: 'Administração' }).click();
  await expect(page.getByText('Overrides de partida')).toBeVisible();
  await expect(page.getByText(/1 overrides visíveis/)).toBeVisible();
  await page.getByRole('button', { name: 'Importar Copa 2026' }).click();
  await expect(page.getByText(/Tabela importada: 48 seleções e 72 jogos/)).toBeVisible();
  await page
    .getByRole('button', { name: /Bloquear/ })
    .last()
    .click();
  await expect(page.getByText('Usuário bloqueado.')).toBeVisible();
});

test('@rollback admin desliga flags de leitura, escrita e UI em uma ação auditável', async ({
  page,
}) => {
  await installApiMocks(page, { admin: true });
  let rollbackBody: Record<string, unknown> | undefined;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/admin/seasons/season-league/features') &&
      request.method() === 'PUT'
    )
      rollbackBody = request.postDataJSON();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menu de Maria' }).click();
  await page.getByRole('button', { name: 'Administração' }).click();
  await page.getByRole('button', { name: 'Preparar rollback' }).click();
  await page.getByRole('button', { name: 'Salvar flags' }).click();
  await expect(page.getByText('Flags salvas com auditoria.')).toBeVisible();
  expect(rollbackBody).toMatchObject({ readEnabled: false, writeEnabled: false, uiEnabled: false });
});

test('telas autenticadas de palpite, mata-mata e ranking passam WCAG A/AA', async ({ page }) => {
  await installApiMocks(page);
  for (const route of [
    '/competicoes/copa-do-mundo-2026/palpites',
    '/competicoes/copa-do-mundo-2026/eliminatorias',
  ] as const) {
    await page.goto(route);
    await expect(page.getByLabel('Placar de Brasil, mandante')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }

  await page.goto('/competicoes/brasileirao-serie-a-2026/ranking');
  await expect(page.getByText('Critérios de desempate', { exact: true })).toBeVisible();
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
    const expected =
      status === 401
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
  await page.goto('/competicoes/copa-do-mundo-2026/palpites');
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
    await page.goto('/competicoes/brasileirao-serie-a-2026/classificacao');
    await expect(page.getByText('Tabela da liga')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('reduced motion e contraste passam na entrada', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApiMocks(page, { authenticated: false });
  await page.goto('/');
  const duration = await page
    .getByRole('button', { name: 'Entrar' })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0s', '0.00001s', '1e-05s']).toContain(duration);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(serious).toEqual([]);
});

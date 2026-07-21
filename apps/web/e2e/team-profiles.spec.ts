import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApiMocks } from './fixtures';

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('abre o diretório e navega pelas subseções do perfil oficial', async ({ page }) => {
  await page.goto('/competicoes/brasileirao-serie-a-2026/times');

  await expect(
    page.getByRole('heading', { name: 'Times de Brasileirão Série A 2026' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Times' })).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Buscar time por nome, sigla ou estado').fill('Vasco');
  await expect(page.getByText('1 clube')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir perfil de Vasco da Gama' }).click();

  await expect(page).toHaveURL('/competicoes/brasileirao-serie-a-2026/times/team-vasco/atletas');
  await expect(page.getByRole('heading', { name: 'Vasco da Gama' })).toBeVisible();
  await expect(
    page.getByText('Atletas cadastrados por Confederação Brasileira de Futebol'),
  ).toBeVisible();
  await expect(page.getByText('OUTRO CLUBE')).toBeVisible();
  await expect(page.getByRole('link', { name: /fonte oficial.*Vasco/i })).toHaveAttribute(
    'href',
    /cbf\.com\.br/,
  );

  await page.getByRole('link', { name: 'Partidas' }).click();
  await expect(page).toHaveURL(/\/partidas$/);
  await expect(page.getByText('Histórico de partidas')).toBeVisible();
  await expect(page.getByText('VITÓRIA', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Estatísticas' }).click();
  await expect(page).toHaveURL(/\/estatisticas$/);
  await expect(page.getByText('Números em Brasileirão Série A 2026')).toBeVisible();
  await expect(page.getByText('22').last()).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('#conteudo-principal').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('mantém o perfil utilizável em 320 px e por deep link', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/competicoes/brasileirao-serie-a-2026/times/team-vasco/partidas');

  await expect(page.getByRole('heading', { name: 'Vasco da Gama' })).toBeVisible();
  await expect(page.getByText('Histórico de partidas')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

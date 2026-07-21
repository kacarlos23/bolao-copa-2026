import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findForbiddenBehaviorInText,
  validateAllowlist,
} from './check-season-genericity.mjs';

test('detecta selecao literal de tela, provider e temporada por slug', () => {
  const source = `
    if (competitionSlug === 'nova-copa') return screen;
    switch (season.slug) { case 'outra-copa': return provider; }
    const adapter = providerByCompetition[competitionSlug];
    prisma.season.findFirst({ where: { slug: 'temporada-fixa' } });
  `;
  const findings = findForbiddenBehaviorInText(source);
  assert.deepEqual(
    new Set(findings.map((finding) => finding.kind)),
    new Set([
      'comparacao literal por slug',
      'switch por slug',
      'lookup de comportamento por slug',
      'consulta por slug fixo',
    ]),
  );
});

test('aceita comparacao de identidade dinamica e capabilities', () => {
  const source = `
    const selected = competitions.find((item) => item.slug === competitionSlug);
    if (capabilities.has('KNOCKOUT')) return bracket;
  `;
  assert.deepEqual(findForbiddenBehaviorInText(source), []);
});

test('recusa camadas de runtime e listas extensas na allowlist', () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    path: index === 0 ? 'apps/api/src/modules/providers/provider.ts' : `apps/api/prisma/seed-${index}.ts`,
    category: 'seed',
    reason: 'fixture',
  }));
  const errors = validateAllowlist({ version: 1, entries });
  assert.ok(errors.some((error) => error.includes('maximo 8')));
  assert.ok(errors.some((error) => error.includes('runtime proibida')));
});

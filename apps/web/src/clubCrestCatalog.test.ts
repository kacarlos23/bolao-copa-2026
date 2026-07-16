import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brasileirao2026ClubCrestKey } from './clubCrestCatalog';

interface CrestManifest {
  files: Array<{ club: string; file: string; sha256: string; bytes: number }>;
}

describe('catálogo local de escudos do Brasileirão 2026', () => {
  it.each([
    ['Athletico Paranaense', 'athletico-paranaense'],
    ['Atlético Mineiro', 'atletico-mineiro'],
    ['Bahia', 'bahia'],
    ['Botafogo', 'botafogo'],
    ['Chapecoense', 'chapecoense'],
    ['Corinthians', 'corinthians'],
    ['Coritiba SAF', 'coritiba'],
    ['Cruzeiro', 'cruzeiro'],
    ['Flamengo', 'flamengo'],
    ['Fluminense', 'fluminense'],
    ['Grêmio', 'gremio'],
    ['Internacional', 'internacional'],
    ['Mirassol', 'mirassol'],
    ['Palmeiras', 'palmeiras'],
    ['Red Bull Bragantino', 'red-bull-bragantino'],
    ['Remo', 'remo'],
    ['Santos FC', 'santos'],
    ['São Paulo', 'sao-paulo'],
    ['Vasco da Gama Saf', 'vasco-da-gama'],
    ['Vitória', 'vitoria'],
  ])('resolve %s sem depender de id do banco', (name, expected) => {
    expect(brasileirao2026ClubCrestKey(name)).toBe(expected);
  });

  it('aceita aliases usuais e mantém fallback para desconhecidos', () => {
    expect(brasileirao2026ClubCrestKey('Atlético-MG')).toBe('atletico-mineiro');
    expect(brasileirao2026ClubCrestKey('Bragantino')).toBe('red-bull-bragantino');
    expect(brasileirao2026ClubCrestKey('Time a definir')).toBeNull();
  });

  it('mantém os 20 arquivos locais íntegros conforme o manifesto', () => {
    const assetDirectory = join(process.cwd(), 'assets', 'team-crests');
    const manifest = JSON.parse(
      readFileSync(join(assetDirectory, 'manifest.json'), 'utf8'),
    ) as CrestManifest;

    expect(manifest.files).toHaveLength(20);
    for (const asset of manifest.files) {
      const path = join(assetDirectory, asset.file);
      const bytes = readFileSync(path);
      expect(statSync(path).size, asset.club).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), asset.club).toBe(asset.sha256);
    }
  });
});

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const forbidden = tracked.filter((file) => {
  const lower = file.toLowerCase();
  const name = lower.split('/').at(-1);
  return (
    name === '.env' ||
    (name.startsWith('.env.') && name !== '.env.example') ||
    name === '.pgpass' ||
    name.endsWith('.pgpass') ||
    lower.startsWith('backups/') ||
    lower.startsWith('snapshots/') ||
    lower.endsWith('.dump') ||
    lower.endsWith('.backup')
  );
});

if (forbidden.length > 0) {
  process.stderr.write(
    `Arquivos sensiveis ou artefatos de preservacao rastreados pelo Git:\n${forbidden.join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Nenhuma credencial ou artefato de preservacao rastreado pelo Git.\n');
}

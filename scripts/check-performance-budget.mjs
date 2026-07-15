import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps', 'web', 'dist');
const outputDir = path.join(root, 'output', 'release-gates');
const limits = { largestJavaScriptBytes: 2_100_000, totalJavaScriptBytes: 2_400_000, totalCssBytes: 100_000 };

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

const assets = await files(dist);
const measured = await Promise.all(assets.filter((file) => /\.(?:js|css)$/.test(file)).map(async (file) => ({ file: path.relative(dist, file).replaceAll('\\', '/'), bytes: (await stat(file)).size })));
const javascript = measured.filter((item) => item.file.endsWith('.js'));
const css = measured.filter((item) => item.file.endsWith('.css'));
const result = {
  formatVersion: 1,
  suite: 'web-bundle-budget',
  pii: false,
  limits,
  measured: {
    largestJavaScriptBytes: Math.max(0, ...javascript.map((item) => item.bytes)),
    totalJavaScriptBytes: javascript.reduce((sum, item) => sum + item.bytes, 0),
    totalCssBytes: css.reduce((sum, item) => sum + item.bytes, 0),
  },
  assets: measured.sort((left, right) => right.bytes - left.bytes),
};
const failures = Object.entries(limits).filter(([key, limit]) => result.measured[key] > limit);
result.status = failures.length === 0 ? 'passed' : 'failed';
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'performance-budget.json'), `${JSON.stringify(result, null, 2)}\n`);
if (failures.length) {
  for (const [key, limit] of failures) process.stderr.write(`Budget excedido: ${key}=${result.measured[key]} > ${limit}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Bundle dentro do budget: JS total ${result.measured.totalJavaScriptBytes} bytes.\n`);
}

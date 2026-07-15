import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['README.md', 'docs'];

async function markdownFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return target.endsWith('.md') ? [target] : [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => markdownFiles(path.join(target, entry.name))),
  );
  return nested.flat();
}

function headingAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function anchorsFor(file) {
  const content = await readFile(file, 'utf8');
  const anchors = new Set();
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (heading) anchors.add(headingAnchor(heading));
    const explicit = [...line.matchAll(/<a\s+id=["']([^"']+)["']/gi)];
    for (const match of explicit) anchors.add(match[1]);
  }
  return { content, anchors };
}

const files = (await Promise.all(roots.map(markdownFiles))).flat();
const cache = new Map();
const failures = [];

for (const file of files) {
  const { content } = await anchorsFor(file);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:)/i.test(target)) continue;
    const [rawFile, rawAnchor] = target.split('#', 2);
    const targetFile = rawFile ? path.resolve(path.dirname(file), rawFile) : path.resolve(file);
    try {
      await stat(targetFile);
    } catch {
      failures.push(`${file}: destino ausente: ${target}`);
      continue;
    }
    if (!rawAnchor) continue;
    let targetData = cache.get(targetFile);
    if (!targetData) {
      targetData = await anchorsFor(targetFile);
      cache.set(targetFile, targetData);
    }
    const anchor = decodeURIComponent(rawAnchor);
    if (!targetData.anchors.has(anchor)) {
      failures.push(`${file}: âncora ausente: ${target}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${files.length} arquivos Markdown verificados; links locais válidos.\n`);
}

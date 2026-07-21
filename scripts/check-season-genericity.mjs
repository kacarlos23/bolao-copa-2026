import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const allowlistPath = path.join(repositoryRoot, 'docs', 'runtime-genericity-allowlist.json');

const slugSelector = String.raw`(?:competitionSlug|season\??\.slug|competition\??\.slug)`;
const literal = String.raw`(?:'[^']*'|"[^"]*"|\x60[^\x60]*\x60)`;

const behaviorPatterns = [
  {
    kind: 'comparacao literal por slug',
    expression: new RegExp(`${slugSelector}\\s*(?:===|!==|==|!=)\\s*${literal}`, 'g'),
  },
  {
    kind: 'comparacao literal por slug',
    expression: new RegExp(`${literal}\\s*(?:===|!==|==|!=)\\s*${slugSelector}`, 'g'),
  },
  {
    kind: 'switch por slug',
    expression: new RegExp(`switch\\s*\\(\\s*${slugSelector}\\s*\\)`, 'g'),
  },
  {
    kind: 'lookup de comportamento por slug',
    expression: new RegExp(
      String.raw`\b\w*(?:provider|scheduler|standing|screen|workspace|fallback)\w*\s*\[\s*${slugSelector}\s*\]`,
      'gi',
    ),
  },
  {
    kind: 'consulta por slug fixo',
    expression: new RegExp(String.raw`\bwhere\s*:\s*\{[^}]*\bslug\s*:\s*${literal}`, 'gs'),
  },
];

function normalized(file) {
  return file.replaceAll('\\', '/');
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function findForbiddenBehaviorInText(source) {
  const findings = [];
  for (const pattern of behaviorPatterns) {
    pattern.expression.lastIndex = 0;
    for (const match of source.matchAll(pattern.expression)) {
      findings.push({
        kind: pattern.kind,
        line: lineNumberAt(source, match.index ?? 0),
        excerpt: match[0].replace(/\s+/g, ' ').slice(0, 180),
      });
    }
  }
  return findings;
}

export function validateAllowlist(document) {
  const errors = [];
  const entries = Array.isArray(document?.entries) ? document.entries : [];
  if (document?.version !== 1) errors.push('A allowlist deve declarar version 1.');
  if (entries.length > 8) errors.push('A allowlist deve conter no maximo 8 entradas.');

  const seen = new Set();
  for (const entry of entries) {
    const file = normalized(String(entry?.path ?? ''));
    if (!file || seen.has(file)) errors.push(`Entrada ausente ou duplicada: ${file || '<vazia>'}.`);
    seen.add(file);
    if (!['legacy-route-alias', 'seed'].includes(entry?.category)) {
      errors.push(`Categoria invalida para ${file}.`);
    }
    if (!String(entry?.reason ?? '').trim()) errors.push(`Justificativa ausente para ${file}.`);
    if (
      /(?:^|\/)(?:providers?|jobs|standings)(?:\/|$)/i.test(file) ||
      /(?:scheduler|workspace|screen|fallback)/i.test(file)
    ) {
      errors.push(`Camada de runtime proibida na allowlist: ${file}.`);
    }
  }
  return errors;
}

function shouldInspect(file) {
  return (
    /\.(?:[cm]?js|tsx?)$/.test(file) &&
    !/(?:^|\/)(?:node_modules|dist|coverage|\.expo|prisma\/migrations)(?:\/|$)/.test(file) &&
    !/(?:\.test|\.spec)\.[^.]+$/.test(file) &&
    !/(?:^|\/)e2e(?:\/|$)/.test(file)
  );
}

export function scanRepository(root = repositoryRoot, allowlistDocument) {
  const allowlisted = new Map(
    allowlistDocument.entries.map((entry) => [normalized(entry.path), entry.category]),
  );
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .map(normalized)
    .filter(shouldInspect);

  return files.flatMap((file) => {
    const source = readFileSync(path.join(root, file), 'utf8');
    const category = allowlisted.get(file);
    return findForbiddenBehaviorInText(source)
      .filter(
        (finding) =>
          category !== 'seed' ||
          ![
            'comparacao literal por slug',
            'switch por slug',
            'consulta por slug fixo',
          ].includes(finding.kind),
      )
      .map((finding) => ({ file, ...finding }));
  });
}

function main() {
  const allowlistDocument = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const allowlistErrors = validateAllowlist(allowlistDocument);
  const findings = allowlistErrors.length ? [] : scanRepository(repositoryRoot, allowlistDocument);
  if (allowlistErrors.length || findings.length) {
    for (const error of allowlistErrors) process.stderr.write(`allowlist: ${error}\n`);
    for (const finding of findings) {
      process.stderr.write(
        `${finding.file}:${finding.line}: ${finding.kind}: ${finding.excerpt}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Runtime sem selecao de comportamento por slug fora da allowlist.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();

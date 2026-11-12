#!/usr/bin/env node
/**
 * UI-tells gate for the mini app.
 *
 * Fails when a shipped source file under apps/miniapp/src contains:
 *   - an emoji codepoint in a JSX text node or a string literal, or
 *   - a Tailwind radius utility outside the four role values.
 *
 * No network and no external script: the parser comes from the repo's pinned
 * `typescript` dev dependency.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'apps/miniapp/src');
const EMOJI =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}{1,2}|\u20E3)/gu;
const ALLOWED_RADII = new Set([
  'rounded-full',
  'rounded-control',
  'rounded-surface',
  'rounded-flush',
  'rounded-none',
]);
const DIRECTIONAL =
  /^rounded-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee)-(?:full|control|surface|flush|none)$/;
const RADIUS_TOKEN = /^rounded(?:-[a-z0-9[\]().%,#/-]+)?$/i;

const findings = [];
let checked = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      checkFile(path);
    }
  }
}

function checkFile(path) {
  checked += 1;
  const text = readFileSync(path, 'utf8');
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const rel = relative(ROOT, path);

  function report(node, message) {
    const start = node.getStart(source);
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    findings.push(`${rel}:${line + 1}:${character + 1}  ${message}`);
  }

  function checkString(value, node) {
    for (const match of value.matchAll(EMOJI)) {
      const codepoints = [...match[0]]
        .map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
        .join(' ');
      report(node, `emoji in a UI string: ${match[0]} (${codepoints})`);
    }

    for (const raw of value.split(/\s+/)) {
      const token = raw.slice(raw.lastIndexOf(':') + 1);
      if (!RADIUS_TOKEN.test(token)) continue;
      if (ALLOWED_RADII.has(token) || DIRECTIONAL.test(token)) continue;
      report(node, `radius outside the scale: ${token}`);
    }
  }

  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkString(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      checkString(node.head.text, node);
      for (const span of node.templateSpans) checkString(span.literal.text, span.literal);
    } else if (ts.isJsxText(node)) {
      checkString(node.text, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
}

walk(SRC);

if (findings.length > 0) {
  console.error(
    `UI tell check failed (${findings.length} finding${findings.length === 1 ? '' : 's'}):`,
  );
  for (const finding of findings) console.error(`  ${finding}`);
  console.error('\nAllowed radii: rounded-full, rounded-control, rounded-surface, rounded-flush,');
  console.error('rounded-none, and their directional forms (rounded-t-surface, rounded-b-none).');
  console.error('Use words instead of emoji, and a role radius instead of a stock step.');
  process.exit(1);
}

console.log(`UI tells: clean (${checked} files checked).`);

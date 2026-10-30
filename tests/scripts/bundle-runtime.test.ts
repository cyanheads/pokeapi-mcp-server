/**
 * @fileoverview Keep dependency runtime skills in MCPB bundles while pruning package-root agent docs.
 * @module tests/scripts/bundle-runtime
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY as cleanerPattern } from '../../scripts/clean-mcpb.js';

describe('bundle agent-document selection', () => {
  it('keeps the packaging linter selection in sync with the cleaner', () => {
    const linter = readFileSync(
      new URL('../../scripts/lint-packaging.ts', import.meta.url),
      'utf8',
    );
    expect(linter).toContain(`export const AGENT_DOC_ENTRY =\n  ${cleanerPattern.toString()};`);
  });
  it.each([
    'node_modules/example/skills/guide/SKILL.md',
    'node_modules/@example/package/framework-skills/setup/SKILL.md',
    'node_modules/example/.claude/skills/setup/SKILL.md',
    'node_modules/example/.agents/skills/setup/SKILL.md',
    'node_modules/example/SKILL.md',
    'node_modules/example/node_modules/@nested/package/skills/guide/SKILL.md',
  ])('selects package-root agent documentation: %s', (entry) => {
    expect(cleanerPattern.test(entry)).toBe(true);
  });

  it.each([
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.js',
    'node_modules/example/dist/skills/runtime.js',
    'node_modules/example/node_modules/@nested/package/dist/ext/skills/index.js',
    'skills/pokemon/SKILL.md',
  ])('retains runtime modules and published server skills: %s', (entry) => {
    expect(cleanerPattern.test(entry)).toBe(false);
  });
});

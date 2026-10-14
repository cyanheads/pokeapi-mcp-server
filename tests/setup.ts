/**
 * @fileoverview Fail default tests that attempt fetches outside an installed fixture.
 * @module tests/setup
 */
import { afterEach, beforeEach, expect, vi } from 'vitest';

const { unmatched } = vi.hoisted(() => ({ unmatched: [] as string[] }));
vi.mock('@cyanheads/mcp-ts-core/testing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cyanheads/mcp-ts-core/testing')>();
  return {
    ...actual,
    createFetchMock: (...[routes, options]: Parameters<typeof actual.createFetchMock>) =>
      actual.createFetchMock(routes, {
        ...options,
        onUnhandled: (request) => {
          unmatched.push(request.url);
          throw new Error(`Unmatched test fetch: ${request.url}`);
        },
      }),
  };
});
beforeEach(() => {
  unmatched.length = 0;
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    unmatched.push(url);
    throw new Error(`Unmatched test fetch: ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(unmatched, 'Install an explicit fetch fixture for every test request').toEqual([]);
});

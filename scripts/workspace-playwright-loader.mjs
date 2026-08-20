import { pathToFileURL } from 'node:url';

// The packaged develop-web-game client lives outside this project, so Node's
// ESM resolver cannot see the project's Playwright dependency by default.
const localPlaywright = pathToFileURL('D:/boat/node_modules/playwright/index.mjs').href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') {
    return { url: localPlaywright, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

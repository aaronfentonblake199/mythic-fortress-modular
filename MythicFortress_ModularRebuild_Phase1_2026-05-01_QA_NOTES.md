# Mythic Fortress Modular Rebuild Phase 1 QA Notes

Date: 2026-05-01  
Status: REVIEW

## Syntax/build check status

- Source files were generated as ES modules using React/Vite conventions.
- `node --check` passed for non-JSX JavaScript files:
  - `src/core/gameState.js`
  - `src/core/saveSystem.js`
  - `src/core/eventBus.js`
  - `src/core/moduleRegistry.js`
  - `src/utils/validation.js`
  - `src/tests/gameState.test.js`
  - `src/tests/saveSystem.test.js`
- `npm install` could not complete in this execution environment because npm returned `E401 Incorrect or missing password`, indicating the environment has invalid/private npm credentials configured.
- Because dependencies could not be installed here, `npm run build` and `npm run test` could not be executed with Vitest/Vite in this environment.
- The project is structured so those commands should be run after `npm install` succeeds in a normal local environment.

## Test status

- Vitest test files were created:
  - `src/tests/gameState.test.js`
  - `src/tests/saveSystem.test.js`
- A manual Node smoke test was executed against the core non-React modules and passed.
- Smoke-tested behaviors:
  - Empty save creation.
  - 10 difficulty tiers.
  - 10 milestone arrays.
  - Default unlocked difficulty of `tier1` only.
  - Legacy `normal`, `hard`, `nightmare` migration into `tier1`, `tier2`, `tier3`.
  - Invalid JSON import rejection.
  - Missing critical field validation.
  - Save/load/reset behavior using a mocked localStorage object.

## Empty save test

- Covered by Vitest file and Node smoke test.
- Confirmed `saveVersion: 32`, default resources, `settings.gameSpeed: 1`, and `settings.devMode: false`.

## Save/load test

- Covered by Vitest file and Node smoke test.
- Node smoke test used a mocked localStorage object.

## Migration test

- Covered by Vitest file and Node smoke test.
- Confirmed mapping from legacy `maxWaveByDifficulty.normal/hard/nightmare` into `tier1`, `tier2`, and `tier3`.

## Unsafe wrapper scan

- Manual text scan completed against generated project files.
- No use of:
  - `dangerouslySetInnerHTML`
  - `iframe srcDoc`
  - `document.write`
  - `eval()`
  - `new Function()`
- The only appearances of `htmlContent` and unsafe-wrapper terms are in documentation/safety status text, not implementation code.

## Phase-specific QA minimum

- Syntax check: Passed for non-JSX JavaScript files.
- Build check: Not run because npm dependency install failed with environment credential error.
- Vitest check: Not run because npm dependency install failed with environment credential error.
- Empty save test: Passed via Node smoke test.
- Save/load test: Passed via Node smoke test.
- Boss wave every 10 waves test: Not applicable to Phase 1; wave system not implemented yet.
- Milestone unlock test: Not applicable to Phase 1; milestone system not implemented yet.
- Locked tower placement test: Not applicable to Phase 1; tower system not implemented yet.
- Mobile UI review: Basic responsive debug shell implemented; final mobile UI pending Phase 2+.

## Known manual testing still needed

- Run `npm install`, `npm run test`, and `npm run build` in a normal local environment with valid npm registry access.
- Manual browser run on phone after deployment or local network serving.
- Manual import/export workflow in a real browser.
- Manual persistence check across browser reloads.
- Future Phase 2 title/menu mobile layout review.

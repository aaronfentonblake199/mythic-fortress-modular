# Mythic Fortress Modular Rebuild Phase 1 Changelog

Date: 2026-05-01  
Status: REVIEW

## Added

- Added clean Vite/React scaffold under `mythic-fortress-modular/`.
- Added modular folder layout for config, core, systems, UI, render helpers, utilities, and tests.
- Added V32 save schema with 10 difficulty tiers, milestone maps, resources, settings, unlock arrays, and run history.
- Added core state helpers: `createEmptySave`, `createInitialRuntimeState`, `getTierKeys`, `createEmptyDifficultyMap`, and `createEmptyMilestoneMap`.
- Added local save system with load, save, reset, export, import, migration, and validation helpers.
- Added event bus with `createEventBus`, `on`, `off`, and `emit`.
- Added module registry with research, militia, ascension, automation, relics, labs, and events flags.
- Added Phase 1 debug shell UI with save controls, export/import text areas, save version display, unlocked difficulty display, game speed display, and safety status.
- Added Vitest tests for game state and save system behavior.

## Changed

- Started the modular rebuild from a fresh source structure rather than the old single-file JSX/HTML wrapper approach.
- Limited implementation scope to Phase 0/1 only.

## Fixed

- Added migration support for legacy `normal`, `hard`, and `nightmare` wave records into `tier1`, `tier2`, and `tier3`.
- Added validation to catch missing critical save fields before save/import acceptance.

## Removed

- No legacy single-file implementation was used as source.
- No unsafe embedded HTML wrapper patterns were introduced.

## Known Issues

- Gameplay systems are not implemented yet by design.
- App dependencies must be installed before running tests or build locally.
- UI shell is temporary debug UI only, not final game UI.

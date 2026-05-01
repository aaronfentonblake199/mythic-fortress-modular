# Mythic Fortress Modular Rebuild — Phase 1 REVIEW

Local working draft for the Mythic Fortress modular rebuild. This package implements Phase 0 scaffold and Phase 1 core state/save system only.

## Status

REVIEW. Not CURRENT. Do not promote without explicit user approval.

## What is included

- Vite + React modular scaffold.
- Core V32 save schema.
- LocalStorage save/load/reset.
- JSON export/import helpers.
- Save migration helper for legacy `normal`, `hard`, and `nightmare` wave records.
- Event bus.
- Module registry.
- Vitest tests for save shape, tier maps, migration, and invalid import handling.
- Phase 1 debug shell UI.

## What is intentionally not included yet

- Full towers.
- Waves/combat.
- Research implementation.
- Militia implementation.
- Ascension implementation.
- Battlefield renderer.

## Commands

```bash
npm install
npm run test
npm run build
npm run dev
```

## Safety rules preserved

This project does not use embedded HTML-string wrappers, `dangerouslySetInnerHTML`, `iframe srcDoc`, `document.write`, `eval()`, or `new Function()`.

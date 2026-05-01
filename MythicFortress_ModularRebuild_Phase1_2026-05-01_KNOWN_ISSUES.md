# Mythic Fortress Modular Rebuild Phase 1 Known Issues

Date: 2026-05-01  
Status: REVIEW

## Known Issues

1. Phase 1 is not a playable game yet.
   - Only core state, save, registry, event bus, validation, tests, and debug shell are included.

2. Research, militia, and ascension modules are registry-enabled but not implemented.
   - This is intentional for Phase 1.

3. Automation, relics, labs, and events are registry-disabled stubs only.
   - This is intentional for post-MVP modular expansion.

4. Boss waves, milestones, tower placement, enemy spawning, and combat tests are not included yet.
   - These belong to later phases.

5. The debug shell is temporary.
   - It should be replaced or wrapped by the Phase 2 mobile-first title/UI shell.

6. Save migration is conservative.
   - It supports the known legacy wave record mapping requested for Phase 1, but broader historical save migration may need expansion later.

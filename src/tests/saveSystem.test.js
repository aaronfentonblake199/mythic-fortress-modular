import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptySave } from '../core/gameState.js';
import { importSaveJson, loadSave, migrateSave, resetSave, saveGame, validateSaveShape } from '../core/saveSystem.js';

describe('saveSystem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads a valid save', () => {
    const save = createEmptySave();
    save.resources.gold = 123;
    saveGame(save);
    expect(loadSave().resources.gold).toBe(123);
  });

  it('migration maps old normal, hard, nightmare wave records into tier1, tier2, tier3', () => {
    const migrated = migrateSave({
      maxWaveByDifficulty: {
        normal: 11,
        hard: 22,
        nightmare: 33,
      },
    });

    expect(migrated.maxWaveByDifficulty.tier1).toBe(11);
    expect(migrated.maxWaveByDifficulty.tier2).toBe(22);
    expect(migrated.maxWaveByDifficulty.tier3).toBe(33);
  });

  it('migration maps old maxWave records into tier1, tier2, tier3', () => {
    const migrated = migrateSave({
      maxWave: {
        normal: 12,
        hard: 24,
        nightmare: 36,
      },
    });

    expect(migrated.maxWaveByDifficulty.tier1).toBe(12);
    expect(migrated.maxWaveByDifficulty.tier2).toBe(24);
    expect(migrated.maxWaveByDifficulty.tier3).toBe(36);
  });

  it('import rejects invalid JSON', () => {
    expect(() => importSaveJson('{broken-json')).toThrow('Invalid save import');
  });

  it('validateSaveShape catches missing critical fields', () => {
    const result = validateSaveShape({ saveVersion: 32 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('maxWaveByDifficulty'))).toBe(true);
  });

  it('resetSave creates a persisted empty save', () => {
    const fresh = resetSave();
    expect(fresh.saveVersion).toBe(32);
    expect(loadSave().unlockedDifficulties).toEqual(['tier1']);
  });
});

import { describe, expect, it } from 'vitest';
import { createEmptyMilestoneMap, createEmptySave, getTierKeys } from '../core/gameState.js';

describe('gameState', () => {
  it('creates an empty V32 save', () => {
    const save = createEmptySave();
    expect(save.saveVersion).toBe(32);
    expect(save.settings.gameSpeed).toBe(1);
    expect(save.settings.devMode).toBe(false);
    expect(save.resources).toEqual({ gold: 0, shards: 0, arcaneEnergy: 0 });
  });

  it('contains all 10 difficulty tiers', () => {
    const save = createEmptySave();
    expect(getTierKeys()).toEqual(['tier1', 'tier2', 'tier3', 'tier4', 'tier5', 'tier6', 'tier7', 'tier8', 'tier9', 'tier10']);
    expect(Object.keys(save.maxWaveByDifficulty)).toEqual(getTierKeys());
  });

  it('contains all 10 milestone arrays', () => {
    const milestoneMap = createEmptyMilestoneMap();
    for (const tierKey of getTierKeys()) {
      expect(Array.isArray(milestoneMap[tierKey])).toBe(true);
    }
  });

  it('defaults unlocked difficulty to only tier1', () => {
    const save = createEmptySave();
    expect(save.unlockedDifficulties).toEqual(['tier1']);
  });
});

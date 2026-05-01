export const SAVE_VERSION = 32;

export function getTierKeys() {
  return Array.from({ length: 10 }, (_, index) => `tier${index + 1}`);
}

export function createEmptyDifficultyMap(defaultValue) {
  return getTierKeys().reduce((map, tierKey) => {
    map[tierKey] = typeof defaultValue === 'function' ? defaultValue(tierKey) : defaultValue;
    return map;
  }, {});
}

export function createEmptyMilestoneMap() {
  return createEmptyDifficultyMap(() => []);
}

export function createEmptySave() {
  const now = Date.now();

  return {
    saveVersion: SAVE_VERSION,
    createdAt: now,
    lastSavedAt: now,
    maxWaveByDifficulty: createEmptyDifficultyMap(0),
    milestonesClaimedByDifficulty: createEmptyMilestoneMap(),
    unlockedDifficulties: ['tier1'],
    researchLevels: {},
    unlockedTowers: [],
    unlockedMilitia: [],
    ascensionGatesUnlocked: [],
    pendingAscensionGates: [],
    settings: {
      gameSpeed: 1,
      devMode: false,
    },
    runHistory: [],
    resources: {
      gold: 0,
      shards: 0,
      arcaneEnergy: 0,
    },
  };
}

export function createInitialRuntimeState() {
  return {
    activeScreen: 'debug-shell',
    activeRun: null,
    isPaused: false,
    selectedDifficulty: 'tier1',
    saveData: createEmptySave(),
    eventLog: [],
  };
}

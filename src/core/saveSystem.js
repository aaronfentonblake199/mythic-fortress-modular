import { createEmptySave, getTierKeys, SAVE_VERSION } from './gameState.js';
import { isPlainObject, requireFields } from '../utils/validation.js';

const STORAGE_KEY = 'mythic-fortress-v32-save';
const LEGACY_DIFFICULTY_MAP = {
  normal: 'tier1',
  hard: 'tier2',
  nightmare: 'tier3',
};

export function validateSaveShape(saveData) {
  if (!isPlainObject(saveData)) {
    return { valid: false, errors: ['Save data must be an object.'] };
  }

  const requiredFields = [
    'saveVersion',
    'createdAt',
    'lastSavedAt',
    'maxWaveByDifficulty',
    'milestonesClaimedByDifficulty',
    'unlockedDifficulties',
    'researchLevels',
    'unlockedTowers',
    'unlockedMilitia',
    'ascensionGatesUnlocked',
    'pendingAscensionGates',
    'settings',
    'runHistory',
    'resources',
  ];

  const errors = requireFields(saveData, requiredFields).map((field) => `Missing critical field: ${field}`);
  const tierKeys = getTierKeys();

  if (isPlainObject(saveData.maxWaveByDifficulty)) {
    for (const tierKey of tierKeys) {
      if (typeof saveData.maxWaveByDifficulty[tierKey] !== 'number') {
        errors.push(`Missing or invalid maxWaveByDifficulty.${tierKey}`);
      }
    }
  }

  if (isPlainObject(saveData.milestonesClaimedByDifficulty)) {
    for (const tierKey of tierKeys) {
      if (!Array.isArray(saveData.milestonesClaimedByDifficulty[tierKey])) {
        errors.push(`Missing or invalid milestonesClaimedByDifficulty.${tierKey}`);
      }
    }
  }

  if (!Array.isArray(saveData.unlockedDifficulties)) errors.push('unlockedDifficulties must be an array.');
  if (!Array.isArray(saveData.unlockedTowers)) errors.push('unlockedTowers must be an array.');
  if (!Array.isArray(saveData.unlockedMilitia)) errors.push('unlockedMilitia must be an array.');
  if (!Array.isArray(saveData.ascensionGatesUnlocked)) errors.push('ascensionGatesUnlocked must be an array.');
  if (!Array.isArray(saveData.pendingAscensionGates)) errors.push('pendingAscensionGates must be an array.');
  if (!Array.isArray(saveData.runHistory)) errors.push('runHistory must be an array.');

  if (!isPlainObject(saveData.settings)) {
    errors.push('settings must be an object.');
  } else {
    if (typeof saveData.settings.gameSpeed !== 'number') errors.push('settings.gameSpeed must be a number.');
    if (typeof saveData.settings.devMode !== 'boolean') errors.push('settings.devMode must be a boolean.');
  }

  if (!isPlainObject(saveData.resources)) {
    errors.push('resources must be an object.');
  } else {
    for (const resourceKey of ['gold', 'shards', 'arcaneEnergy']) {
      if (typeof saveData.resources[resourceKey] !== 'number') {
        errors.push(`resources.${resourceKey} must be a number.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function migrateSave(rawSave) {
  const baseSave = createEmptySave();
  if (!isPlainObject(rawSave)) return baseSave;

  const migrated = {
    ...baseSave,
    ...rawSave,
    saveVersion: SAVE_VERSION,
    maxWaveByDifficulty: {
      ...baseSave.maxWaveByDifficulty,
      ...(isPlainObject(rawSave.maxWaveByDifficulty) ? rawSave.maxWaveByDifficulty : {}),
    },
    milestonesClaimedByDifficulty: {
      ...baseSave.milestonesClaimedByDifficulty,
      ...(isPlainObject(rawSave.milestonesClaimedByDifficulty) ? rawSave.milestonesClaimedByDifficulty : {}),
    },
    settings: {
      ...baseSave.settings,
      ...(isPlainObject(rawSave.settings) ? rawSave.settings : {}),
    },
    resources: {
      ...baseSave.resources,
      ...(isPlainObject(rawSave.resources) ? rawSave.resources : {}),
    },
  };

  for (const [legacyKey, tierKey] of Object.entries(LEGACY_DIFFICULTY_MAP)) {
    if (typeof rawSave?.maxWaveByDifficulty?.[legacyKey] === 'number') {
      migrated.maxWaveByDifficulty[tierKey] = Math.max(
        migrated.maxWaveByDifficulty[tierKey] ?? 0,
        rawSave.maxWaveByDifficulty[legacyKey],
      );
    }
    if (typeof rawSave?.maxWave?.[legacyKey] === 'number') {
      migrated.maxWaveByDifficulty[tierKey] = Math.max(
        migrated.maxWaveByDifficulty[tierKey] ?? 0,
        rawSave.maxWave[legacyKey],
      );
    }
  }

  for (const tierKey of getTierKeys()) {
    if (!Array.isArray(migrated.milestonesClaimedByDifficulty[tierKey])) {
      migrated.milestonesClaimedByDifficulty[tierKey] = [];
    }
    if (typeof migrated.maxWaveByDifficulty[tierKey] !== 'number') {
      migrated.maxWaveByDifficulty[tierKey] = 0;
    }
  }

  migrated.unlockedDifficulties = Array.isArray(rawSave.unlockedDifficulties) && rawSave.unlockedDifficulties.length > 0
    ? rawSave.unlockedDifficulties
    : baseSave.unlockedDifficulties;
  migrated.researchLevels = isPlainObject(rawSave.researchLevels) ? rawSave.researchLevels : baseSave.researchLevels;
  migrated.unlockedTowers = Array.isArray(rawSave.unlockedTowers) ? rawSave.unlockedTowers : baseSave.unlockedTowers;
  migrated.unlockedMilitia = Array.isArray(rawSave.unlockedMilitia) ? rawSave.unlockedMilitia : baseSave.unlockedMilitia;
  migrated.ascensionGatesUnlocked = Array.isArray(rawSave.ascensionGatesUnlocked) ? rawSave.ascensionGatesUnlocked : baseSave.ascensionGatesUnlocked;
  migrated.pendingAscensionGates = Array.isArray(rawSave.pendingAscensionGates) ? rawSave.pendingAscensionGates : baseSave.pendingAscensionGates;
  migrated.runHistory = Array.isArray(rawSave.runHistory) ? rawSave.runHistory : baseSave.runHistory;

  return migrated;
}

export function loadSave() {
  if (typeof localStorage === 'undefined') return createEmptySave();
  const existingSave = localStorage.getItem(STORAGE_KEY);
  if (!existingSave) return createEmptySave();

  try {
    return migrateSave(JSON.parse(existingSave));
  } catch (_error) {
    return createEmptySave();
  }
}

export function saveGame(saveData) {
  const migratedSave = migrateSave(saveData);
  migratedSave.lastSavedAt = Date.now();
  const validation = validateSaveShape(migratedSave);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid save data: ${validation.errors.join('; ')}`);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedSave));
  }
  return migratedSave;
}

export function resetSave() {
  const freshSave = createEmptySave();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(freshSave));
  }
  return freshSave;
}

export function exportSaveJson(saveData) {
  return JSON.stringify(migrateSave(saveData), null, 2);
}

export function importSaveJson(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (_error) {
    throw new Error('Invalid save import: JSON could not be parsed.');
  }

  const migrated = migrateSave(parsed);
  const validation = validateSaveShape(migrated);
  if (!validation.valid) {
    throw new Error(`Invalid save import: ${validation.errors.join('; ')}`);
  }
  return saveGame(migrated);
}

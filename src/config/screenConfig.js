export const SCREEN_IDS = Object.freeze({
  TITLE: 'title',
  GAME: 'game',
  RESEARCH: 'research',
  ASCENSION: 'ascension',
  SETTINGS: 'settings',
  DEBUG_SAVE: 'debugSave',
});

export const SCREEN_ORDER = Object.freeze([
  SCREEN_IDS.TITLE,
  SCREEN_IDS.GAME,
  SCREEN_IDS.RESEARCH,
  SCREEN_IDS.ASCENSION,
  SCREEN_IDS.SETTINGS,
  SCREEN_IDS.DEBUG_SAVE,
]);

export const SCREEN_META = Object.freeze({
  [SCREEN_IDS.TITLE]: {
    id: SCREEN_IDS.TITLE,
    label: 'Home',
    title: 'Mythic Fortress',
    description: 'Mobile-first title screen and main menu shell.',
  },
  [SCREEN_IDS.GAME]: {
    id: SCREEN_IDS.GAME,
    label: 'Battle',
    title: 'Battlefield',
    description: 'Placeholder for the future battlefield renderer.',
  },
  [SCREEN_IDS.RESEARCH]: {
    id: SCREEN_IDS.RESEARCH,
    label: 'Research',
    title: 'Research',
    description: 'Placeholder for vertical research categories and cards.',
  },
  [SCREEN_IDS.ASCENSION]: {
    id: SCREEN_IDS.ASCENSION,
    label: 'Ascension',
    title: 'Ascension',
    description: 'Placeholder for vertical ascension rows.',
  },
  [SCREEN_IDS.SETTINGS]: {
    id: SCREEN_IDS.SETTINGS,
    label: 'Settings',
    title: 'Settings',
    description: 'Placeholder for settings and developer controls.',
  },
  [SCREEN_IDS.DEBUG_SAVE]: {
    id: SCREEN_IDS.DEBUG_SAVE,
    label: 'Save Debug',
    title: 'Save Debug',
    description: 'Phase 1 save tools retained for QA.',
  },
});

export function getScreenMeta(screenId) {
  return SCREEN_META[screenId] ?? SCREEN_META[SCREEN_IDS.TITLE];
}

export function isValidScreenId(screenId) {
  return SCREEN_ORDER.includes(screenId);
}

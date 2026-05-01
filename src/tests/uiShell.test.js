import { describe, expect, it } from 'vitest';
import { getScreenMeta, isValidScreenId, SCREEN_IDS, SCREEN_ORDER, SCREEN_META } from '../config/screenConfig.js';

describe('Phase 2 screen configuration', () => {
  it('contains the required shell screens', () => {
    expect(SCREEN_ORDER).toEqual([
      SCREEN_IDS.TITLE,
      SCREEN_IDS.GAME,
      SCREEN_IDS.RESEARCH,
      SCREEN_IDS.ASCENSION,
      SCREEN_IDS.SETTINGS,
      SCREEN_IDS.DEBUG_SAVE,
    ]);
  });

  it('has metadata for every configured screen', () => {
    SCREEN_ORDER.forEach((screenId) => {
      expect(SCREEN_META[screenId]).toBeDefined();
      expect(SCREEN_META[screenId].label.length).toBeGreaterThan(0);
      expect(SCREEN_META[screenId].title.length).toBeGreaterThan(0);
    });
  });

  it('rejects invalid screen IDs', () => {
    expect(isValidScreenId('waves')).toBe(false);
  });

  it('falls back to title metadata for invalid screen IDs', () => {
    expect(getScreenMeta('missing')).toEqual(SCREEN_META[SCREEN_IDS.TITLE]);
  });
});

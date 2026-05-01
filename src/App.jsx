import { useMemo, useState } from 'react';
import { loadSave } from './core/saveSystem.js';
import { getScreenMeta, SCREEN_IDS, SCREEN_ORDER, SCREEN_META, isValidScreenId } from './config/screenConfig.js';
import { AppHeader } from './ui/components/AppHeader.jsx';
import { BottomNav } from './ui/components/BottomNav.jsx';
import {
  AscensionScreen,
  GameScreen,
  ResearchScreen,
  SaveDebugScreen,
  SettingsScreen,
  TitleScreen,
} from './ui/screens/index.js';

export default function App() {
  const [saveData, setSaveData] = useState(() => loadSave());
  const [activeScreen, setActiveScreen] = useState(SCREEN_IDS.TITLE);

  const navScreens = useMemo(
    () => SCREEN_ORDER.map((screenId) => SCREEN_META[screenId]),
    [],
  );

  const activeScreenMeta = getScreenMeta(activeScreen);

  function handleNavigate(screenId) {
    if (isValidScreenId(screenId)) {
      setActiveScreen(screenId);
    }
  }

  function renderActiveScreen() {
    switch (activeScreen) {
      case SCREEN_IDS.GAME:
        return <GameScreen />;
      case SCREEN_IDS.RESEARCH:
        return <ResearchScreen />;
      case SCREEN_IDS.ASCENSION:
        return <AscensionScreen />;
      case SCREEN_IDS.SETTINGS:
        return <SettingsScreen saveData={saveData} />;
      case SCREEN_IDS.DEBUG_SAVE:
        return <SaveDebugScreen saveData={saveData} setSaveData={setSaveData} />;
      case SCREEN_IDS.TITLE:
      default:
        return <TitleScreen saveData={saveData} onNavigate={handleNavigate} />;
    }
  }

  return (
    <main className="app-shell">
      <AppHeader activeScreenTitle={activeScreenMeta.title} saveVersion={saveData.saveVersion} />
      <p className="phase-label">Current phase: Phase 2 — Title Screen and UI Shell</p>
      <section className="active-screen" aria-label={activeScreenMeta.description}>
        {renderActiveScreen()}
      </section>
      <BottomNav screens={navScreens} activeScreen={activeScreen} onNavigate={handleNavigate} />
    </main>
  );
}

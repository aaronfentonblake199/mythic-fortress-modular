import { SCREEN_IDS } from '../../config/screenConfig.js';
import { ShellCard } from '../components/ShellCard.jsx';

export function TitleScreen({ onNavigate, saveData }) {
  const menuItems = [
    { label: 'Begin Run', screen: SCREEN_IDS.GAME },
    { label: 'Research', screen: SCREEN_IDS.RESEARCH },
    { label: 'Ascension', screen: SCREEN_IDS.ASCENSION },
    { label: 'Settings', screen: SCREEN_IDS.SETTINGS },
    { label: 'Save Debug', screen: SCREEN_IDS.DEBUG_SAVE },
  ];

  return (
    <div className="title-screen screen-stack">
      <ShellCard eyebrow="Phase 2 Shell" title="Fortress command starts here">
        <p className="lead-text">
          This is the mobile-first title shell. It is intentionally UI/navigation only; battlefield,
          towers, enemies, research logic, militia, and ascension logic remain locked for later phases.
        </p>
        <dl className="compact-stats">
          <div><dt>Save version</dt><dd>{saveData.saveVersion}</dd></div>
          <div><dt>Unlocked tier</dt><dd>{saveData.unlockedDifficulties.join(', ')}</dd></div>
          <div><dt>Game speed</dt><dd>{saveData.settings.gameSpeed}x</dd></div>
        </dl>
      </ShellCard>

      <section className="main-menu-card" aria-label="Main menu">
        <p className="eyebrow">Main Menu</p>
        <div className="main-menu-grid">
          {menuItems.map((item) => (
            <button key={item.label} type="button" onClick={() => onNavigate(item.screen)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

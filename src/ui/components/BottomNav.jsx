export function BottomNav({ screens, activeScreen, onNavigate }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {screens.map((screen) => (
        <button
          key={screen.id}
          type="button"
          className={screen.id === activeScreen ? 'nav-button active' : 'nav-button'}
          aria-current={screen.id === activeScreen ? 'page' : undefined}
          onClick={() => onNavigate(screen.id)}
        >
          {screen.label}
        </button>
      ))}
    </nav>
  );
}

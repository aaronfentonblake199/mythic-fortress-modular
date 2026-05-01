export function AppHeader({ activeScreenTitle, saveVersion }) {
  return (
    <header className="app-header" aria-label="Application header">
      <div>
        <p className="eyebrow">Mythic Fortress</p>
        <h1>{activeScreenTitle}</h1>
      </div>
      <div className="version-pill" aria-label="Save version">V{saveVersion}</div>
    </header>
  );
}

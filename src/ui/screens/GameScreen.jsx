import { PlaceholderPanel } from '../components/PlaceholderPanel.jsx';

export function GameScreen() {
  return (
    <div className="screen-stack">
      <PlaceholderPanel
        title="Battlefield Placeholder"
        description="Phase 2 only reserves the battlefield route. The renderer is built in a later phase."
        bullets={[
          'No towers implemented yet.',
          'No enemies or waves implemented yet.',
          'Future renderer will live under src/render and UI battlefield components.',
        ]}
      />
    </div>
  );
}

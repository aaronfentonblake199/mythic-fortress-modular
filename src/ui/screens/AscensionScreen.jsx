import { PlaceholderPanel } from '../components/PlaceholderPanel.jsx';

export function AscensionScreen() {
  return (
    <div className="screen-stack">
      <PlaceholderPanel
        title="Ascension Placeholder"
        description="The future ascension screen should use vertical rows, not horizontal card columns."
        bullets={[
          'No ascension bonuses are implemented yet.',
          'Pending gates remain save-schema placeholders.',
          'This screen stays visible from the main shell, not hidden in settings.',
        ]}
      />
    </div>
  );
}

import { PlaceholderPanel } from '../components/PlaceholderPanel.jsx';

export function SettingsScreen({ saveData }) {
  return (
    <div className="screen-stack">
      <PlaceholderPanel
        title="Settings Placeholder"
        description="Settings and developer controls will be expanded later without changing the save core."
        bullets={[
          `Developer mode: ${saveData.settings.devMode ? 'on' : 'off'}`,
          `Game speed setting: ${saveData.settings.gameSpeed}x`,
          'Game speed must affect simulation only, never economy or rewards.',
        ]}
      />
    </div>
  );
}

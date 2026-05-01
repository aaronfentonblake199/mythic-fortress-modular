import { PlaceholderPanel } from '../components/PlaceholderPanel.jsx';

export function ResearchScreen() {
  return (
    <div className="screen-stack">
      <PlaceholderPanel
        title="Research Placeholder"
        description="The future research UI should use top categories with vertical upgrade cards below."
        bullets={[
          'Tower unlocks remain research-only by design.',
          'No research logic is active in Phase 2.',
          'This route exists so the UI shell can scale cleanly.',
        ]}
      />
    </div>
  );
}

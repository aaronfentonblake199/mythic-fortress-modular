import { useMemo, useState } from 'react';
import { createEmptySave } from '../../core/gameState.js';
import { exportSaveJson, importSaveJson, resetSave, saveGame } from '../../core/saveSystem.js';
import { MODULES } from '../../core/moduleRegistry.js';

export function SaveDebugScreen({ saveData, setSaveData }) {
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Phase 1 save tools retained inside Phase 2 shell.');

  const enabledModules = useMemo(
    () => Object.entries(MODULES).filter(([, enabled]) => enabled).map(([name]) => name),
    [],
  );

  function handleCreateResetSave() {
    setSaveData(resetSave());
    setStatusMessage('Fresh V32 save created and stored locally.');
  }

  function handleSaveNow() {
    try {
      setSaveData(saveGame(saveData));
      setStatusMessage('Save written to localStorage.');
    } catch (error) {
      setStatusMessage(error.message);
    }
  }

  function handleExport() {
    setExportText(exportSaveJson(saveData));
    setStatusMessage('Save JSON exported below.');
  }

  function handleImport() {
    try {
      const imported = importSaveJson(importText);
      setSaveData(imported);
      setStatusMessage('Save JSON imported and stored locally.');
    } catch (error) {
      setStatusMessage(error.message);
    }
  }

  function handleCreateMemoryOnlySave() {
    setSaveData(createEmptySave());
    setStatusMessage('Fresh save created in memory. Use Save Now to persist it.');
  }

  return (
    <div className="screen-stack">
      <section className="panel-grid">
        <article className="shell-card">
          <h2>Save State</h2>
          <dl className="compact-stats">
            <div><dt>Save version</dt><dd>{saveData.saveVersion}</dd></div>
            <div><dt>Unlocked difficulties</dt><dd>{saveData.unlockedDifficulties.join(', ')}</dd></div>
            <div><dt>Current game speed</dt><dd>{saveData.settings.gameSpeed}x</dd></div>
            <div><dt>Enabled modules</dt><dd>{enabledModules.join(', ')}</dd></div>
          </dl>
        </article>

        <article className="shell-card">
          <h2>Safety Status</h2>
          <ul className="safety-list">
            <li>No embedded HTML string</li>
            <li>No unsafe wrappers</li>
            <li>Modular scaffold active</li>
          </ul>
        </article>
      </section>

      <section className="shell-card">
        <h2>Save Controls</h2>
        <div className="button-grid">
          <button type="button" onClick={handleCreateResetSave}>Create/Reset Save</button>
          <button type="button" onClick={handleSaveNow}>Save Now</button>
          <button type="button" onClick={handleExport}>Export Save JSON</button>
          <button type="button" onClick={handleImport}>Import Save JSON</button>
          <button type="button" onClick={handleCreateMemoryOnlySave}>Create Memory Save</button>
        </div>
        <p className="status-message">{statusMessage}</p>
        <label className="text-area-label" htmlFor="import-save">Import Save JSON</label>
        <textarea id="import-save" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste exported save JSON here" />
        <label className="text-area-label" htmlFor="export-save">Exported Save JSON</label>
        <textarea id="export-save" value={exportText} readOnly placeholder="Exported save JSON appears here" />
      </section>
    </div>
  );
}

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AppShell from './components/AppShell';
import Works from './pages/Works';
import Settings from './pages/Settings';
import DeAi from './pages/DeAi';
import Examples from './pages/Examples';
import { useSettingsStore } from './stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import './App.css';

function App() {
  const setWorksDirectory = useSettingsStore((s) => s.setWorksDirectory);

  useEffect(() => {
    invoke<string>('get_workspace_dir', { dirType: 'articles' })
      .then((dir) => setWorksDirectory(dir))
      .catch((err) => console.error('Failed to initialize workspace directory:', err));
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Works />} />
          <Route path="settings" element={<Settings />} />
          <Route path="examples" element={<Examples />} />
          <Route path="de-ai" element={<DeAi />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;

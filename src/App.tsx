import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import Home from './pages/Home';
import Works from './pages/Works';
import Settings from './pages/Settings';
import DeAi from './pages/DeAi';
import Outline from './pages/Outline';
import Examples from './pages/Examples';
import Background from './pages/Background';
import Chat from './pages/Chat';
import Story from './pages/Story';
import Adventure from './pages/Adventure';
import Bond from './pages/Bond';
import BookTravelMaterials from './pages/BookTravelMaterials';

// Mobile components
import MobileShell from './components/MobileShell';
import MobileHome from './pages/MobileHome';
import MobileChat from './pages/MobileChat';
import MobileStory from './pages/MobileStory';
import MobileBond from './pages/MobileBond';

import { useSettingsStore } from './stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { isLocalWebPreviewHost, isMobile } from './utils/runtime';
import { applyPartnerStoreContent } from './utils/partnerStoreSync';
import './App.css';

function MuseApplication() {
  const setWorksDirectory = useSettingsStore((s) => s.setWorksDirectory);
  const mobileEnv = isMobile();

  useEffect(() => {
    // Only invoke desktop setup commands on desktop
    if (!mobileEnv) {
      invoke<string>('get_workspace_dir', { dirType: 'articles' })
        .then((dir) => setWorksDirectory(dir))
        .catch((err) => console.error('Failed to initialize workspace directory:', err));
    }
  }, [mobileEnv, setWorksDirectory]);

  useEffect(() => {
    if (mobileEnv) return;

    let unlistenFn: (() => void) | undefined;
    listen('partner-store-updated', async () => {
      try {
        const content = await invoke<string>('load_app_state', { name: 'partner-store' });
        applyPartnerStoreContent(content);
      } catch (err) {
        console.error('Failed to sync partner store:', err);
      }
    }).then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [mobileEnv]);

  return (
    <Router>
      <Routes>
        {mobileEnv ? (
          <Route path="/" element={<MobileShell />}>
            <Route index element={<MobileHome />} />
            <Route path="chat" element={<MobileChat />} />
            <Route path="story" element={<MobileStory />} />
            <Route path="bond" element={<MobileBond />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        ) : (
          <Route path="/" element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="works" element={<Works />} />
            <Route path="settings" element={<Settings />} />
            <Route path="examples" element={<Examples />} />
            <Route path="de-ai" element={<DeAi />} />
            <Route path="outline" element={<Outline />} />
            <Route path="background" element={<Background />} />
            <Route path="chat" element={<Chat />} />
            <Route path="adventure" element={<Adventure />} />
            <Route path="story" element={<Story />} />
            <Route path="bond" element={<Bond />} />
            <Route path="book-travel-materials" element={<BookTravelMaterials />} />
          </Route>
        )}
      </Routes>
    </Router>
  );
}

function LocalPreviewUnavailable() {
  return (
    <main className="local-preview-disabled">
      <div className="local-preview-disabled__content">
        <span className="local-preview-disabled__mark" aria-hidden="true">M</span>
        <h1>网页预览已关闭</h1>
        <p>请通过 MuseAI 桌面应用使用完整功能。</p>
        <small>此地址仅用于桌面应用的开发连接。</small>
      </div>
    </main>
  );
}

function App() {
  if (isLocalWebPreviewHost()) {
    return <LocalPreviewUnavailable />;
  }

  return <MuseApplication />;
}

export default App;

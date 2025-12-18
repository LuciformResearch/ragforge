import React, { useState, useEffect } from 'react';
import { Database, Settings, GitGraph, LayoutDashboard } from 'lucide-react';
import SetupWizard from './components/Setup/SetupWizard';
import Dashboard from './components/Dashboard/Dashboard';
import GraphExplorer from './components/GraphExplorer/GraphExplorer';

type View = 'setup' | 'dashboard' | 'graph';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('setup');
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Check initial status
  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const dockerStatus = await window.studio.docker.check();
      const neo4jStatus = await window.studio.neo4j.status();

      if (dockerStatus.running && neo4jStatus.running) {
        const connected = await window.studio.db.connect();
        setIsConnected(connected);
        if (connected) {
          setIsReady(true);
          setCurrentView('dashboard');
        }
      }
    } catch (err) {
      console.error('Status check failed:', err);
    }
  }

  function handleSetupComplete() {
    setIsReady(true);
    setIsConnected(true);
    setCurrentView('dashboard');
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="drag-region h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-2 pl-16">
          <Database className="w-5 h-5 text-neo4j-blue" />
          <span className="font-semibold">RagForge Studio</span>
        </div>

        {isReady && (
          <nav className="no-drag flex items-center gap-1 ml-8">
            <NavButton
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Dashboard"
              active={currentView === 'dashboard'}
              onClick={() => setCurrentView('dashboard')}
            />
            <NavButton
              icon={<GitGraph className="w-4 h-4" />}
              label="Graph Explorer"
              active={currentView === 'graph'}
              onClick={() => setCurrentView('graph')}
            />
            <NavButton
              icon={<Settings className="w-4 h-4" />}
              label="Setup"
              active={currentView === 'setup'}
              onClick={() => setCurrentView('setup')}
            />
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 no-drag">
          <StatusIndicator connected={isConnected} />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {currentView === 'setup' && (
          <SetupWizard onComplete={handleSetupComplete} />
        )}
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'graph' && <GraphExplorer />}
      </main>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? 'bg-gray-700 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatusIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div
        className={`w-2 h-2 rounded-full ${
          connected ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
      <span className="text-gray-400">
        {connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}

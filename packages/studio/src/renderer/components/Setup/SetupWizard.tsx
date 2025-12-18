import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Play,
  ExternalLink,
  Key,
  Sparkles,
  Box,
} from 'lucide-react';

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = 'docker' | 'neo4j-image' | 'neo4j-container' | 'connection' | 'gemini-key' | 'replicate-key' | 'done';

interface StepStatus {
  docker: 'pending' | 'checking' | 'success' | 'error';
  neo4jImage: 'pending' | 'checking' | 'pulling' | 'success' | 'error';
  neo4jContainer: 'pending' | 'checking' | 'starting' | 'success' | 'error';
  connection: 'pending' | 'checking' | 'success' | 'error';
  geminiKey: 'pending' | 'checking' | 'success' | 'error' | 'saving';
  replicateKey: 'pending' | 'checking' | 'success' | 'skipped' | 'saving';
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('docker');
  const [status, setStatus] = useState<StepStatus>({
    docker: 'pending',
    neo4jImage: 'pending',
    neo4jContainer: 'pending',
    connection: 'pending',
    geminiKey: 'pending',
    replicateKey: 'pending',
  });
  const [pullProgress, setPullProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [replicateKey, setReplicateKey] = useState<string>('');

  useEffect(() => {
    // Listen for pull progress
    window.studio.neo4j.onPullProgress((progress) => {
      setPullProgress(progress.status + (progress.progress ? ` ${progress.progress}` : ''));
    });

    // Start checking
    checkDocker();
  }, []);

  async function checkDocker() {
    setStatus((s) => ({ ...s, docker: 'checking' }));
    setError('');

    const result = await window.studio.docker.check();

    if (result.running) {
      setStatus((s) => ({ ...s, docker: 'success' }));
      setCurrentStep('neo4j-image');
      checkNeo4jImage();
    } else if (result.installed) {
      setStatus((s) => ({ ...s, docker: 'error' }));
      setError('Docker is installed but not running. Please start Docker Desktop.');
    } else {
      setStatus((s) => ({ ...s, docker: 'error' }));
      setError('Docker is not installed.');
    }
  }

  async function checkNeo4jImage() {
    setStatus((s) => ({ ...s, neo4jImage: 'checking' }));

    const result = await window.studio.neo4j.status();

    if (result.imageExists) {
      setStatus((s) => ({ ...s, neo4jImage: 'success' }));
      setCurrentStep('neo4j-container');
      checkNeo4jContainer();
    } else {
      setStatus((s) => ({ ...s, neo4jImage: 'pending' }));
      setCurrentStep('neo4j-image');
    }
  }

  async function pullNeo4jImage() {
    setStatus((s) => ({ ...s, neo4jImage: 'pulling' }));
    setPullProgress('Starting download...');

    const success = await window.studio.neo4j.pull();

    if (success) {
      setStatus((s) => ({ ...s, neo4jImage: 'success' }));
      setPullProgress('');
      setCurrentStep('neo4j-container');
      checkNeo4jContainer();
    } else {
      setStatus((s) => ({ ...s, neo4jImage: 'error' }));
      setError('Failed to download Neo4j image');
    }
  }

  async function checkNeo4jContainer() {
    setStatus((s) => ({ ...s, neo4jContainer: 'checking' }));

    const result = await window.studio.neo4j.status();

    if (result.running) {
      setStatus((s) => ({ ...s, neo4jContainer: 'success' }));
      setCurrentStep('connection');
      checkConnection();
    } else if (result.exists) {
      // Container exists but not running, start it
      startNeo4j();
    } else {
      setStatus((s) => ({ ...s, neo4jContainer: 'pending' }));
    }
  }

  async function startNeo4j() {
    setStatus((s) => ({ ...s, neo4jContainer: 'starting' }));

    const success = await window.studio.neo4j.start();

    if (success) {
      // Wait a bit for Neo4j to be ready
      await new Promise((r) => setTimeout(r, 3000));
      setStatus((s) => ({ ...s, neo4jContainer: 'success' }));
      setCurrentStep('connection');
      checkConnection();
    } else {
      setStatus((s) => ({ ...s, neo4jContainer: 'error' }));
      setError('Failed to start Neo4j container');
    }
  }

  async function checkConnection() {
    setStatus((s) => ({ ...s, connection: 'checking' }));

    // Retry a few times as Neo4j might still be starting
    for (let i = 0; i < 10; i++) {
      const connected = await window.studio.db.connect();
      if (connected) {
        setStatus((s) => ({ ...s, connection: 'success' }));
        setCurrentStep('gemini-key');
        // Check if Gemini key already exists
        checkExistingGeminiKey();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    setStatus((s) => ({ ...s, connection: 'error' }));
    setError('Unable to connect to Neo4j');
  }

  async function checkExistingGeminiKey() {
    setStatus((s) => ({ ...s, geminiKey: 'checking' }));
    const existing = await window.studio.config.getApiKey('gemini');
    if (existing) {
      setGeminiKey(existing);
      setStatus((s) => ({ ...s, geminiKey: 'success' }));
      setCurrentStep('replicate-key');
      checkExistingReplicateKey();
    } else {
      setStatus((s) => ({ ...s, geminiKey: 'pending' }));
    }
  }

  async function saveGeminiKey() {
    if (!geminiKey.trim()) {
      setError('Gemini API key is required');
      return;
    }
    setStatus((s) => ({ ...s, geminiKey: 'saving' }));
    setError('');

    const success = await window.studio.config.setApiKey('gemini', geminiKey.trim());
    if (success) {
      setStatus((s) => ({ ...s, geminiKey: 'success' }));
      setCurrentStep('replicate-key');
      checkExistingReplicateKey();
    } else {
      setStatus((s) => ({ ...s, geminiKey: 'error' }));
      setError('Failed to save API key');
    }
  }

  async function checkExistingReplicateKey() {
    setStatus((s) => ({ ...s, replicateKey: 'checking' }));
    const existing = await window.studio.config.getApiKey('replicate');
    if (existing) {
      setReplicateKey(existing);
      setStatus((s) => ({ ...s, replicateKey: 'success' }));
      setCurrentStep('done');
    } else {
      setStatus((s) => ({ ...s, replicateKey: 'pending' }));
    }
  }

  async function saveReplicateKey() {
    if (!replicateKey.trim()) {
      skipReplicateKey();
      return;
    }
    setStatus((s) => ({ ...s, replicateKey: 'saving' }));

    const success = await window.studio.config.setApiKey('replicate', replicateKey.trim());
    if (success) {
      setStatus((s) => ({ ...s, replicateKey: 'success' }));
    }
    setCurrentStep('done');
  }

  function skipReplicateKey() {
    setStatus((s) => ({ ...s, replicateKey: 'skipped' }));
    setCurrentStep('done');
  }

  function openDockerDownload() {
    window.studio.docker.openDownload();
  }

  function openGeminiConsole() {
    window.studio.shell.openExternal('https://aistudio.google.com/apikey');
  }

  function openReplicateConsole() {
    window.studio.shell.openExternal('https://replicate.com/account/api-tokens');
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="w-full max-w-lg bg-gray-800 rounded-xl p-8 shadow-xl">
        <h2 className="text-2xl font-bold mb-2">RagForge Setup</h2>
        <p className="text-gray-400 mb-8">
          Setting up the environment for RagForge Studio
        </p>

        <div className="space-y-4">
          {/* Step 1: Docker */}
          <StepItem
            number={1}
            title="Docker"
            description="Checking Docker Desktop"
            status={status.docker}
            active={currentStep === 'docker'}
          >
            {status.docker === 'error' && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-red-400">{error}</p>
                <div className="flex gap-2">
                  <button
                    onClick={openDockerDownload}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download Docker
                  </button>
                  <button
                    onClick={checkDocker}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                  >
                    Check again
                  </button>
                </div>
              </div>
            )}
          </StepItem>

          {/* Step 2: Neo4j Image */}
          <StepItem
            number={2}
            title="Neo4j Image"
            description="Downloading the Neo4j image"
            status={status.neo4jImage}
            active={currentStep === 'neo4j-image'}
          >
            {status.neo4jImage === 'pending' && currentStep === 'neo4j-image' && (
              <button
                onClick={pullNeo4jImage}
                className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                <Download className="w-4 h-4" />
                Download Neo4j 5
              </button>
            )}
            {status.neo4jImage === 'pulling' && (
              <p className="mt-2 text-sm text-gray-400">{pullProgress}</p>
            )}
          </StepItem>

          {/* Step 3: Neo4j Container */}
          <StepItem
            number={3}
            title="Neo4j Container"
            description="Starting the container"
            status={status.neo4jContainer}
            active={currentStep === 'neo4j-container'}
          >
            {status.neo4jContainer === 'pending' && currentStep === 'neo4j-container' && (
              <button
                onClick={startNeo4j}
                className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                <Play className="w-4 h-4" />
                Start Neo4j
              </button>
            )}
          </StepItem>

          {/* Step 4: Connection */}
          <StepItem
            number={4}
            title="Connection"
            description="Connecting to the database"
            status={status.connection}
            active={currentStep === 'connection'}
          />

          {/* Step 5: Gemini API Key */}
          <StepItem
            number={5}
            title="Gemini API Key"
            description="Required for embeddings and AI"
            status={status.geminiKey}
            active={currentStep === 'gemini-key'}
          >
            {currentStep === 'gemini-key' && status.geminiKey !== 'success' && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-gray-400">
                  RagForge uses Gemini for generating embeddings and analyzing code.
                  <button
                    onClick={openGeminiConsole}
                    className="ml-1 text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    Get a key <ExternalLink className="w-3 h-3" />
                  </button>
                </p>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={saveGeminiKey}
                  disabled={!geminiKey.trim() || status.geminiKey === 'saving'}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm"
                >
                  {status.geminiKey === 'saving' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            )}
          </StepItem>

          {/* Step 6: Replicate API Key (Optional) */}
          <StepItem
            number={6}
            title="Replicate Key"
            description="Optional - For 3D generation"
            status={status.replicateKey}
            active={currentStep === 'replicate-key'}
          >
            {currentStep === 'replicate-key' && status.replicateKey !== 'success' && status.replicateKey !== 'skipped' && (
              <div className="mt-3 space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-400">
                  <Box className="w-4 h-4 mt-0.5 text-purple-400" />
                  <p>
                    Replicate enables 3D model generation from images or text.
                    It's optional and affordable (~$0.10/model).
                    <button
                      onClick={openReplicateConsole}
                      className="ml-1 text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                    >
                      Get a key <ExternalLink className="w-3 h-3" />
                    </button>
                  </p>
                </div>
                <input
                  type="password"
                  value={replicateKey}
                  onChange={(e) => setReplicateKey(e.target.value)}
                  placeholder="r8_..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded focus:border-blue-500 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveReplicateKey}
                    disabled={status.replicateKey === 'saving'}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded text-sm"
                  >
                    {status.replicateKey === 'saving' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Key className="w-4 h-4" />
                    )}
                    Save
                  </button>
                  <button
                    onClick={skipReplicateKey}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                  >
                    Skip this step
                  </button>
                </div>
              </div>
            )}
          </StepItem>
        </div>

        {/* Done */}
        {currentStep === 'done' && (
          <div className="mt-8 p-4 bg-green-900/30 border border-green-700 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
              <div>
                <p className="font-semibold text-green-400">Setup complete!</p>
                <p className="text-sm text-gray-400">
                  RagForge Studio is ready to use.
                </p>
              </div>
            </div>
            <button
              onClick={onComplete}
              className="mt-4 w-full py-2 bg-green-600 hover:bg-green-700 rounded font-medium transition-colors"
            >
              Continue to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepItem({
  number,
  title,
  description,
  status,
  active,
  children,
}: {
  number: number;
  title: string;
  description: string;
  status: 'pending' | 'checking' | 'pulling' | 'starting' | 'success' | 'error' | 'saving' | 'skipped';
  active: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`p-4 rounded-lg border transition-colors ${
        active
          ? 'border-blue-500 bg-blue-900/20'
          : status === 'success'
          ? 'border-green-700 bg-green-900/10'
          : status === 'skipped'
          ? 'border-gray-600 bg-gray-800/30'
          : status === 'error'
          ? 'border-red-700 bg-red-900/10'
          : 'border-gray-700 bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <StatusIcon status={status} number={number} />
        <div className="flex-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-gray-400">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function StatusIcon({
  status,
  number,
}: {
  status: 'pending' | 'checking' | 'pulling' | 'starting' | 'success' | 'error' | 'saving' | 'skipped';
  number: number;
}) {
  if (status === 'success') {
    return <CheckCircle2 className="w-6 h-6 text-green-500" />;
  }
  if (status === 'skipped') {
    return <CheckCircle2 className="w-6 h-6 text-gray-500" />;
  }
  if (status === 'error') {
    return <XCircle className="w-6 h-6 text-red-500" />;
  }
  if (status === 'checking' || status === 'pulling' || status === 'starting' || status === 'saving') {
    return <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />;
  }
  return (
    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-sm">
      {number}
    </div>
  );
}

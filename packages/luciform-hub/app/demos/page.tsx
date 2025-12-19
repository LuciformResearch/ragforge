'use client';

import { useState } from 'react';
import { ThreeDViewer } from '../components/ThreeDViewer';

// Video data
const videos = [
  {
    id: 'a2mac1-general',
    title: 'A2Mac1 - Real-time Cutting Tool',
    description: 'Real-time cutting lines on very high-poly vehicles (several million polygons) with IGES export',
    url: 'https://www.youtube.com/watch?v=72MchVWr1zM',
    category: 'Professional',
    tech: 'C++, OpenGL, IGES Export',
    company: 'A2Mac1',
    platform: 'youtube'
  },
  {
    id: 'a2mac1-iges',
    title: 'A2Mac1 - IGES Export',
    description: 'IGES export demonstration for complex automotive parts',
    url: 'https://www.youtube.com/watch?v=aB0px8-A9S4',
    category: 'Professional',
    tech: 'IGES, CAD Export',
    company: 'A2Mac1',
    platform: 'youtube'
  },
  {
    id: 'a2mac1-bbox',
    title: 'A2Mac1 - Oriented Bounding Box',
    description: 'Minimal oriented bounding box tool in real-time on very high-poly vehicle parts',
    url: 'https://www.youtube.com/watch?v=N3SbzY1vlh4',
    category: 'Professional',
    tech: 'C++, Algorithms, 3D Math',
    company: 'A2Mac1',
    platform: 'youtube'
  },
  {
    id: 'designhubz-3dview',
    title: 'DesignHubz - Advanced3DView',
    description: 'Custom 3D navigation tool for luxury objects/jewelry and art',
    url: 'https://youtu.be/VYLJY-ADjT4',
    category: 'Professional',
    tech: 'WebGL, Three.js, UX/UI',
    company: 'DesignHubz',
    platform: 'youtube'
  },
  {
    id: 'webgpu-webxr',
    title: 'WebGPU/WebXR Engine',
    description: 'WebGPU/WebXR/Electron rendering engine developed from scratch',
    url: 'https://www.youtube.com/watch?v=5y_AhouQd98',
    category: 'Personal',
    tech: 'WebGPU, WebXR, Electron, C++',
    company: 'Personal Project',
    platform: 'youtube'
  },
  {
    id: 'animation-rigging',
    title: '3D Animation Tool - Rigging',
    description: 'Fast rigging and 3D animation demonstration',
    url: 'https://www.youtube.com/watch?v=XrMqmwP3i5Q',
    category: 'Personal',
    tech: 'C++, OpenGL, Animation',
    company: 'Personal Project',
    platform: 'youtube'
  },
  {
    id: 'vr-editor-blocks',
    title: 'Unity VR Editor - Block Placement',
    description: 'VR game map editor with Minecraft-style block placement and asset manager',
    url: 'https://www.youtube.com/watch?v=mpjuCC6f0qY',
    category: 'Personal',
    tech: 'Unity, VR, C#',
    company: 'Personal Project',
    platform: 'youtube'
  },
  {
    id: 'vr-editor-fight',
    title: 'Unity VR Editor - Character Fight',
    description: 'Character combat demonstration in VR editor',
    url: 'https://www.youtube.com/watch?v=MvlL0xR47gA',
    category: 'Personal',
    tech: 'Unity, VR, Gameplay',
    company: 'Personal Project',
    platform: 'youtube'
  },
  {
    id: 'heightmap-editor',
    title: 'Nodal Heightmap Editor',
    description: 'Nodal heightmap editor for procedural terrain generation on Unity',
    url: 'https://www.youtube.com/watch?v=YLxsFT6W-xQ',
    category: 'Personal',
    tech: 'Unity, Procedural Generation, C#',
    company: 'Personal Project',
    platform: 'youtube'
  },
  {
    id: 'houdini-houses',
    title: 'Houdini Procedural Generation',
    description: 'Procedural house generation via VEX scripting on Houdini',
    url: 'https://www.youtube.com/watch?v=QR8taSTJrTg',
    category: 'Hobby',
    tech: 'Houdini, VEX, Procedural',
    company: 'Hobby',
    platform: 'youtube'
  },
  {
    id: 'game-engine-42',
    title: 'Personal Game Engine',
    description: 'Game engine developed at 42 school with dynamic C# library management, scene editor and multiview',
    url: 'https://www.youtube.com/watch?v=br4s_2I0DEw',
    category: 'Education',
    tech: 'C#, Dynamic Libraries, Game Engine',
    company: '42 School',
    platform: 'youtube'
  }
];

const miniGames = [
  { id: 'helixJump', name: 'Helix Jump', file: '/game_samples/helixJump.html', description: 'Navigate through the helix tower' },
  { id: 'holeio', name: 'Hole.io', file: '/game_samples/holeio.html', description: 'Grow your black hole and consume everything' },
  { id: 'pio2', name: 'Paper.io 2', file: '/game_samples/pio2.html', description: 'Capture territory in this multiplayer game' },
  { id: 'spaceSpeed', name: 'Space Speed', file: '/game_samples/spaceSpeed.html', description: 'High-speed space racing' },
  { id: 'windRider', name: 'Wind Rider', file: '/game_samples/windRider.html', description: 'Glide through the wind currents' },
];

const getVideoId = (url: string) => {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
};

export default function DemosPage() {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [showOpenDD, setShowOpenDD] = useState(false);

  // Video state
  const [selectedVideoCategory, setSelectedVideoCategory] = useState('All');
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [showVideoEmbed, setShowVideoEmbed] = useState(false);

  const filteredVideos = selectedVideoCategory === 'All'
    ? videos
    : videos.filter(v => v.category === selectedVideoCategory);

  const currentVideo = filteredVideos[currentVideoIndex] || filteredVideos[0];

  return (
    <div className="py-12 px-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Interactive Demos</h1>
          <p className="text-slate-400 text-lg">
            Personal projects and playable demos from my portfolio
          </p>
          <a href="/cv" className="text-blue-400 hover:underline text-sm mt-2 inline-block">
            &larr; Back to CV
          </a>
        </div>

        {/* Video Demonstrations Section */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-6">Video Demonstrations</h2>
          <p className="text-slate-400 mb-6 text-sm">
            Collection of videos demonstrating my professional and personal projects in 3D development, game engines, and specialized tools.
          </p>

          {/* Category filters */}
          <div className="flex flex-wrap gap-2 mb-6">
            {['All', 'Professional', 'Personal', 'Hobby', 'Education'].map(category => (
              <button
                key={category}
                onClick={() => {
                  setSelectedVideoCategory(category);
                  setCurrentVideoIndex(0);
                }}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  selectedVideoCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Current video */}
          {currentVideo && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-lg">{currentVideo.title}</h3>
                  <p className="text-blue-400 text-sm">{currentVideo.company}</p>
                </div>
                <span className="text-slate-500 text-xs">{currentVideoIndex + 1} / {filteredVideos.length}</span>
              </div>
              <p className="text-slate-400 text-sm mb-3">{currentVideo.description}</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {currentVideo.tech.split(', ').map(tech => (
                  <span key={tech} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                    {tech}
                  </span>
                ))}
              </div>

              {/* Thumbnail */}
              <div
                className="relative bg-black rounded-lg overflow-hidden mb-4 cursor-pointer"
                style={{ aspectRatio: '16/9' }}
                onClick={() => setShowVideoEmbed(true)}
              >
                <img
                  src={`https://img.youtube.com/vi/${getVideoId(currentVideo.url)}/hqdefault.jpg`}
                  alt={currentVideo.title}
                  className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/50 rounded-full p-4 hover:bg-black/70 transition-colors">
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <a
                  href={currentVideo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Watch on YouTube
                </a>
                <button
                  onClick={() => setShowVideoEmbed(true)}
                  className="border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Watch Here
                </button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center">
            <button
              onClick={() => setCurrentVideoIndex(Math.max(0, currentVideoIndex - 1))}
              disabled={currentVideoIndex === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentVideoIndex === 0
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Previous
            </button>
            <div className="flex gap-1">
              {filteredVideos.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentVideoIndex(index)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    index === currentVideoIndex ? 'bg-blue-500' : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => setCurrentVideoIndex(Math.min(filteredVideos.length - 1, currentVideoIndex + 1))}
              disabled={currentVideoIndex === filteredVideos.length - 1}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentVideoIndex === filteredVideos.length - 1
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Next
            </button>
          </div>

          {/* Video Modal */}
          {showVideoEmbed && currentVideo && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowVideoEmbed(false)}>
              <div className="bg-slate-900 rounded-xl p-4 max-w-4xl w-full" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{currentVideo.title}</h3>
                  <button onClick={() => setShowVideoEmbed(false)} className="text-slate-400 hover:text-white text-2xl">
                    &times;
                  </button>
                </div>
                <div className="bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${getVideoId(currentVideo.url)}?autoplay=1`}
                    className="w-full h-full border-0"
                    title={currentVideo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* OpenDD Section */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-6">OpenDD - Car Physics Sandbox</h2>
          <p className="text-slate-400 mb-4">
            A Three.js car driving demo with terrain collision and adjustable parameters.
            Built with TypeScript and dat.gui for real-time tweaking.
          </p>
          <p className="text-slate-500 text-sm mb-6 bg-slate-900 border border-slate-800 rounded-lg p-3">
            <strong className="text-slate-300">No physics engine used.</strong> All physics (suspension, gravity, ground detection, friction)
            are implemented from scratch using raycasts and custom vector math. The car uses 4-wheel raycasting for
            terrain collision and orientation.
          </p>

          {/* Play button */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => setShowOpenDD(!showOpenDD)}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                showOpenDD
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {showOpenDD ? 'Close' : 'Play'}
            </button>
            <span className="text-slate-500 text-sm">Use the GUI panel (top-right) to toggle terrain mode</span>
          </div>

          {/* Controls info */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
            <h3 className="font-semibold mb-2">Controls</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-slate-400">
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">W/Z</kbd> Accelerate</div>
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">S</kbd> Brake</div>
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">A/Q</kbd> Turn Left</div>
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">D</kbd> Turn Right</div>
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">Space</kbd> Handbrake</div>
              <div><kbd className="bg-slate-800 px-2 py-1 rounded">T</kbd> Debug Mode (Fly Camera)</div>
            </div>
          </div>

          {/* OpenDD iframe */}
          {showOpenDD && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <iframe
                src="/game_samples/opendd/index.html"
                className="w-full h-[700px] border-0"
                title="OpenDD Car Physics"
              />
            </div>
          )}

          {/* Preview card when not playing */}
          {!showOpenDD && (
            <button
              onClick={() => setShowOpenDD(true)}
              className="w-full bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-8 text-left transition-colors"
            >
              <div className="flex items-center gap-6">
                <div className="text-6xl">🚗</div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">OpenDD Car Physics</h3>
                  <p className="text-slate-400">
                    Three.js driving simulation with realistic physics, suspension, and ground collision.
                    Features adjustable downforce, ground adhesion, and debug tools.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded">Three.js</span>
                    <span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded">TypeScript</span>
                    <span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded">dat.gui</span>
                    <span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded">Vite</span>
                  </div>
                </div>
              </div>
            </button>
          )}
        </section>

        {/* 3D Viewer Section */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-6">3D Model Viewer</h2>
          <p className="text-slate-400 mb-4">
            Upload any .glb, .gltf, or .obj file to view it in 3D with automatic camera framing.
            Capture screenshots from multiple angles with a single click.
          </p>
          <p className="text-slate-500 text-sm mb-6 bg-slate-900 border border-slate-800 rounded-lg p-3">
            <strong className="text-slate-300">Auto-framing algorithm from RagForge.</strong> The camera automatically
            positions itself to frame the model perfectly using Thales theorem for optimal perspective distance
            and NDC projection for precise centering.
          </p>
          <ThreeDViewer />
        </section>

        {/* Mini Games Section */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-6">Mini Games</h2>
          <p className="text-slate-400 mb-8">
            HTML5 games playable directly in your browser. Click on a game to play.
          </p>

          {/* Game selector */}
          <div className="flex flex-wrap gap-3 mb-8">
            {miniGames.map((game) => (
              <button
                key={game.id}
                onClick={() => setSelectedGame(selectedGame === game.id ? null : game.id)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  selectedGame === game.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {game.name}
              </button>
            ))}
          </div>

          {/* Game iframe */}
          {selectedGame && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
                <span className="font-medium">
                  {miniGames.find(g => g.id === selectedGame)?.name}
                </span>
                <button
                  onClick={() => setSelectedGame(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
              <iframe
                src={miniGames.find(g => g.id === selectedGame)?.file}
                className="w-full h-[600px] border-0"
                title={miniGames.find(g => g.id === selectedGame)?.name}
              />
            </div>
          )}

          {/* Game cards when none selected */}
          {!selectedGame && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {miniGames.map((game) => (
                <button
                  key={game.id}
                  onClick={() => setSelectedGame(game.id)}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-6 text-left transition-colors"
                >
                  <div className="text-3xl mb-3">🎮</div>
                  <h3 className="font-semibold mb-2">{game.name}</h3>
                  <p className="text-slate-400 text-sm">{game.description}</p>
                </button>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

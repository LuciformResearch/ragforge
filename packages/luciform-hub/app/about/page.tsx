'use client';

import Link from 'next/link';
import { GlitchText } from '../components/GlitchText';

export default function AboutPage() {
  return (
    <div className="py-12 px-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-purple-400/30
            bg-purple-400/5 text-purple-400 text-sm mb-6">
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            Independent Research
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            <GlitchText
              text="About"
              gradient="from-white via-purple-200 to-white"
              glowColor="rgba(168,85,247,0.3)"
              repeatInterval={12000}
            />
          </h1>
          <p className="text-slate-400 text-lg">
            Building autonomous systems for developers
          </p>
        </div>

        {/* Profile Section */}
        <div className="grid md:grid-cols-3 gap-12 mb-20">
          {/* Photo */}
          <div className="md:col-span-1">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-b from-cyan-500/30 to-purple-500/30 rounded-2xl blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
              <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border-2 border-cyan-400/30 group-hover:border-cyan-400/50 transition-colors">
                <img
                  src="/photos_lucie/1764621365401.png"
                  alt="Lucie Defraiteur"
                  className="w-full h-full object-cover"
                />
                {/* Scanline overlay */}
                <div className="absolute inset-0 pointer-events-none opacity-10"
                  style={{
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="md:col-span-2 space-y-8">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                <GlitchText
                  text="Lucie Defraiteur"
                  gradient="from-cyan-400 to-purple-400"
                  glowColor="rgba(0,255,255,0.3)"
                  repeatInterval={15000}
                />
              </h2>
              <p className="text-cyan-400 text-lg mb-6">RAG Systems Engineer & 3D Graphics Developer</p>
              <p className="text-slate-300 leading-relaxed text-lg">
                Passionate about artificial intelligence and developer tooling. I specialize in building
                intelligent agents, code analysis systems, and RAG (Retrieval-Augmented Generation)
                architectures. My work focuses on making AI more accessible and useful for developers.
              </p>
            </div>

            <div className="p-6 rounded-xl bg-slate-900/50 border border-slate-700/50">
              <h3 className="text-lg font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-cyan-400 rounded-full" />
                Contact
              </h3>
              <div className="space-y-3 text-slate-400">
                <p className="flex items-center gap-3">
                  <span className="text-cyan-400">▹</span>
                  <a href="mailto:luciedefraiteur@luciformresearch.com"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors hover:underline">
                    luciedefraiteur@luciformresearch.com
                  </a>
                </p>
                <p className="flex items-center gap-3">
                  <span className="text-purple-400">▹</span>
                  <a href="https://github.com/LuciformResearch" target="_blank" rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 transition-colors hover:underline">
                    github.com/LuciformResearch
                  </a>
                </p>
                <p className="flex items-center gap-3">
                  <span className="text-pink-400">▹</span>
                  <a href="https://www.npmjs.com/~luciformresearch" target="_blank" rel="noopener noreferrer"
                    className="text-pink-400 hover:text-pink-300 transition-colors hover:underline">
                    npmjs.com/~luciformresearch
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Expertise */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold mb-10 text-center">
            <GlitchText
              text="Expertise"
              gradient="from-cyan-400 via-purple-400 to-pink-400"
              glowColor="rgba(0,255,255,0.2)"
              repeatInterval={14000}
            />
          </h2>
          <div className="grid md:grid-cols-3 gap-6">

            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-cyan-400/20 rounded-2xl p-6
                group-hover:border-cyan-400/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center mb-4
                  group-hover:border-cyan-400/60 transition-colors">
                  <span className="text-2xl">🤖</span>
                </div>
                <h3 className="text-xl font-bold mb-3 text-cyan-400">AI & LLMs</h3>
                <ul className="text-slate-400 text-sm space-y-2">
                  <li className="flex items-center gap-2"><span className="text-cyan-400/60">▹</span> Google Generative AI (Gemini)</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400/60">▹</span> Conversational agents</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400/60">▹</span> RAG architectures</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400/60">▹</span> Embeddings & vector search</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-400/60">▹</span> Multi-agent orchestration</li>
                </ul>
              </div>
            </div>

            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-purple-500/20 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-purple-400/20 rounded-2xl p-6
                group-hover:border-purple-400/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-400/30 flex items-center justify-center mb-4
                  group-hover:border-purple-400/60 transition-colors">
                  <span className="text-2xl">💻</span>
                </div>
                <h3 className="text-xl font-bold mb-3 text-purple-400">Development</h3>
                <ul className="text-slate-400 text-sm space-y-2">
                  <li className="flex items-center gap-2"><span className="text-purple-400/60">▹</span> TypeScript & JavaScript</li>
                  <li className="flex items-center gap-2"><span className="text-purple-400/60">▹</span> React & Next.js</li>
                  <li className="flex items-center gap-2"><span className="text-purple-400/60">▹</span> Python</li>
                  <li className="flex items-center gap-2"><span className="text-purple-400/60">▹</span> Neo4j & PostgreSQL</li>
                  <li className="flex items-center gap-2"><span className="text-purple-400/60">▹</span> Node.js ecosystem</li>
                </ul>
              </div>
            </div>

            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-pink-500/20 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-pink-400/20 rounded-2xl p-6
                group-hover:border-pink-400/40 transition-all">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-400/30 flex items-center justify-center mb-4
                  group-hover:border-pink-400/60 transition-colors">
                  <span className="text-2xl">🎮</span>
                </div>
                <h3 className="text-xl font-bold mb-3 text-pink-400">3D & Graphics</h3>
                <ul className="text-slate-400 text-sm space-y-2">
                  <li className="flex items-center gap-2"><span className="text-pink-400/60">▹</span> WebGPU & WebGL</li>
                  <li className="flex items-center gap-2"><span className="text-pink-400/60">▹</span> Three.js</li>
                  <li className="flex items-center gap-2"><span className="text-pink-400/60">▹</span> GLSL & WGSL shaders</li>
                  <li className="flex items-center gap-2"><span className="text-pink-400/60">▹</span> Procedural generation</li>
                  <li className="flex items-center gap-2"><span className="text-pink-400/60">▹</span> Game development</li>
                </ul>
              </div>
            </div>

          </div>
        </div>

        {/* Luciform Research */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 rounded-2xl blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
          <div className="relative bg-slate-900/80 backdrop-blur-sm border border-cyan-400/20 rounded-2xl p-8
            group-hover:border-cyan-400/40 transition-all">

            <div className="flex items-center gap-5 mb-6">
              <div className="relative">
                <img
                  src="/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png"
                  alt="Luciform Research Logo"
                  className="w-16 h-16 rounded-xl object-cover"
                />
                <div className="absolute inset-0 rounded-xl border-2 border-cyan-400/30 group-hover:border-cyan-400/60 transition-colors" />
              </div>
              <h2 className="text-3xl font-bold">
                <GlitchText
                  text="Luciform Research"
                  gradient="from-cyan-400 via-purple-400 to-pink-400"
                  glowColor="rgba(0,255,255,0.3)"
                  repeatInterval={16000}
                />
              </h2>
            </div>

            <p className="text-slate-300 leading-relaxed mb-6 text-lg">
              Luciform Research is my independent software research initiative focused on developer tools
              and AI-powered solutions. The name combines &quot;lucid&quot; (clear, bright) and &quot;form&quot; (structure, shape) —
              representing the goal of bringing clarity and structure to complex software problems.
            </p>
            <p className="text-slate-400 leading-relaxed mb-8">
              All packages are available on npm under the <code className="text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/20">@luciformresearch</code> scope,
              and source code is available on GitHub.
            </p>

            <div className="flex gap-4">
              <Link
                href="/products"
                className="px-6 py-3 bg-cyan-500/10 border border-cyan-400/50 rounded-lg font-medium text-cyan-400
                  hover:bg-cyan-500/20 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(0,255,255,0.3)] transition-all"
              >
                View Products →
              </Link>
              <a
                href="https://github.com/LuciformResearch"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 border border-slate-600 rounded-lg font-medium text-slate-300
                  hover:border-slate-500 hover:text-white transition-all"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

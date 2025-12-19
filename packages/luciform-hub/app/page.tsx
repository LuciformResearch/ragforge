'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function HomePage() {
  const [glitchText, setGlitchText] = useState('Luciform Research');

  // Glitch effect on title
  useEffect(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%';
    const originalText = 'Luciform Research';
    let interval: NodeJS.Timeout;

    const glitch = () => {
      let iterations = 0;
      interval = setInterval(() => {
        setGlitchText(
          originalText
            .split('')
            .map((char, index) => {
              if (index < iterations || char === ' ') return char;
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join('')
        );
        iterations += 1 / 3;
        if (iterations >= originalText.length) {
          clearInterval(interval);
          setGlitchText(originalText);
        }
      }, 30);
    };

    glitch();
    const repeatInterval = setInterval(glitch, 8000);

    return () => {
      clearInterval(interval);
      clearInterval(repeatInterval);
    };
  }, []);

  return (
    <div className="relative">
      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 relative">
        {/* Scanlines overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
          }}
        />

        {/* Logo */}
        <div className="mb-8 relative">
          <div className="w-32 h-32 relative">
            <img
              src="/ragforge-logos/LR_LOGO_TRANSPARENT.png"
              alt="Luciform Research"
              className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(0,255,255,0.5)]"
            />
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 animate-pulse" />
          </div>
        </div>

        {/* Title with glitch */}
        <h1 className="text-6xl md:text-7xl font-bold mb-6 text-center relative">
          <span className="bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent
            drop-shadow-[0_0_30px_rgba(0,255,255,0.5)]">
            {glitchText}
          </span>
        </h1>

        {/* Tagline */}
        <p className="text-xl md:text-2xl text-cyan-100/80 mb-4 text-center font-light tracking-wide">
          Autonomous AI Systems
        </p>
        <p className="text-lg text-slate-400 mb-12 max-w-2xl text-center">
          Building the infrastructure for intelligent agents. RAG architectures,
          knowledge graphs, and AI-powered development tools.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap gap-4 justify-center mb-16">
          <Link
            href="/products"
            className="group relative px-8 py-4 bg-transparent border border-cyan-400/50 rounded-lg font-medium
              overflow-hidden transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(0,255,255,0.3)]"
          >
            <span className="relative z-10 text-cyan-400 group-hover:text-white transition-colors">
              Explore Products
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 opacity-0
              group-hover:opacity-100 transition-opacity" />
          </Link>
          <Link
            href="/cv"
            className="group relative px-8 py-4 bg-transparent border border-purple-400/50 rounded-lg font-medium
              overflow-hidden transition-all duration-300 hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]"
          >
            <span className="relative z-10 text-purple-400 group-hover:text-white transition-colors">
              View CV
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 opacity-0
              group-hover:opacity-100 transition-opacity" />
          </Link>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-cyan-400/50">
          <span className="text-xs uppercase tracking-widest">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-cyan-400/50 to-transparent animate-pulse" />
        </div>
      </section>

      {/* Products Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-400/30
              bg-cyan-400/5 text-cyan-400 text-sm mb-4">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              Source Available
            </div>
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Agent Infrastructure
              </span>
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              Tools and frameworks for building autonomous AI systems
            </p>
          </div>

          {/* Product cards */}
          <div className="grid md:grid-cols-3 gap-6">

            {/* RagForge */}
            <Link href="/products#ragforge" className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-cyan-400/50 group-hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-cyan-400/30
                    group-hover:border-cyan-400/60 transition-colors">
                    <img
                      src="/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png"
                      alt="RagForge"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white group-hover:text-cyan-400 transition-colors">
                      RagForge
                    </h3>
                    <span className="text-xs text-slate-500">CORE FRAMEWORK</span>
                  </div>
                </div>
                <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                  Universal RAG agent with persistent knowledge brain. Neo4j graph database,
                  semantic search, and MCP integration.
                </p>
                <div className="flex items-center justify-between">
                  <code className="text-xs text-cyan-400/80 bg-cyan-400/10 px-2 py-1 rounded">
                    @luciformresearch/ragforge
                  </code>
                  <span className="text-cyan-400 text-sm group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </div>
              </div>
            </Link>

            {/* CodeParsers */}
            <Link href="/products#codeparsers" className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-green-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-green-400/50 group-hover:shadow-[0_0_30px_rgba(0,255,136,0.1)]">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-green-400/30
                    group-hover:border-green-400/60 transition-colors">
                    <img
                      src="/product-logos/codeparsers-logo-transparent.png"
                      alt="CodeParsers"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white group-hover:text-green-400 transition-colors">
                      CodeParsers
                    </h3>
                    <span className="text-xs text-slate-500">AST EXTRACTION</span>
                  </div>
                </div>
                <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                  Multi-language code parser using tree-sitter WASM. Extract functions,
                  classes, and imports from any codebase.
                </p>
                <div className="flex items-center justify-between">
                  <code className="text-xs text-green-400/80 bg-green-400/10 px-2 py-1 rounded">
                    @luciformresearch/codeparsers
                  </code>
                  <span className="text-green-400 text-sm group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </div>
              </div>
            </Link>

            {/* XMLParser */}
            <Link href="/products#xmlparser" className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-purple-400/50 group-hover:shadow-[0_0_30px_rgba(168,85,247,0.1)]">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-400/30
                    flex items-center justify-center group-hover:border-purple-400/60 transition-colors">
                    <span className="text-2xl">&lt;/&gt;</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white group-hover:text-purple-400 transition-colors">
                      XMLParser
                    </h3>
                    <span className="text-xs text-slate-500">LLM OUTPUTS</span>
                  </div>
                </div>
                <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                  Fault-tolerant XML parser for AI pipelines. Handles malformed LLM outputs
                  with streaming SAX API.
                </p>
                <div className="flex items-center justify-between">
                  <code className="text-xs text-purple-400/80 bg-purple-400/10 px-2 py-1 rounded">
                    @luciformresearch/xmlparser
                  </code>
                  <span className="text-purple-400 text-sm group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </div>
              </div>
            </Link>

          </div>
        </div>
      </section>

      {/* Stats/Features Section */}
      <section className="py-24 px-6 border-t border-slate-800/50">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div className="p-6">
              <div className="text-4xl font-bold text-cyan-400 mb-2">Neo4j</div>
              <div className="text-slate-400 text-sm">Knowledge Graph</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-green-400 mb-2">MCP</div>
              <div className="text-slate-400 text-sm">Claude Integration</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-purple-400 mb-2">WASM</div>
              <div className="text-slate-400 text-sm">Tree-sitter Parsing</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-pink-400 mb-2">RAG</div>
              <div className="text-slate-400 text-sm">Semantic Search</div>
            </div>
          </div>
        </div>
      </section>

      {/* Links Section */}
      <section className="py-16 px-6 border-t border-slate-800/50">
        <div className="max-w-6xl mx-auto flex flex-wrap justify-center gap-8">
          <a
            href="https://github.com/LuciformResearch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/~luciformresearch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z"/>
            </svg>
            npm
          </a>
          <Link
            href="/demos"
            className="flex items-center gap-2 text-slate-400 hover:text-purple-400 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Demos
          </Link>
        </div>
      </section>
    </div>
  );
}

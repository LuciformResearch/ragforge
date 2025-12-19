'use client';

import { GlitchText, GlitchHeading } from '../components/GlitchText';

export default function ProductsPage() {
  return (
    <div className="py-12 px-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-400/30
            bg-cyan-400/5 text-cyan-400 text-sm mb-6">
            <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            Source Available
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            <GlitchText
              text="Products"
              gradient="from-white via-cyan-200 to-white"
              glowColor="rgba(0,255,255,0.3)"
              repeatInterval={12000}
            />
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Infrastructure for building autonomous AI systems.
            All packages available on npm under the <code className="text-cyan-400">@luciformresearch</code> scope.
          </p>
        </div>

        {/* RagForge */}
        <section id="ragforge" className="mb-20 scroll-mt-24">
          <div className="relative group">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative bg-slate-900/80 backdrop-blur-sm border border-cyan-400/20 rounded-2xl p-8
              group-hover:border-cyan-400/40 transition-all duration-300">

              {/* Header */}
              <div className="flex items-center gap-5 mb-6">
                <div className="relative">
                  <img
                    src="/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png"
                    alt="RagForge Logo"
                    className="w-16 h-16 rounded-xl object-cover"
                  />
                  <div className="absolute inset-0 rounded-xl border-2 border-cyan-400/30 group-hover:border-cyan-400/60 transition-colors" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold">
                    <GlitchText
                      text="RagForge"
                      gradient="from-cyan-400 to-blue-400"
                      glowColor="rgba(0,255,255,0.4)"
                      repeatInterval={15000}
                    />
                  </h2>
                  <code className="text-sm text-cyan-400/80">@luciformresearch/ragforge</code>
                </div>
                <div className="ml-auto">
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-cyan-400/10 text-cyan-400 border border-cyan-400/30">
                    CORE FRAMEWORK
                  </span>
                </div>
              </div>

              <p className="text-slate-300 mb-8 text-lg leading-relaxed">
                AI agent framework with a persistent local knowledge base for code, documentation, and web content.
                Enables AI assistants like Claude to maintain searchable context across multiple projects.
              </p>

              {/* Features grid */}
              <h3 className="font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-cyan-400 rounded-full" />
                Features
              </h3>
              <div className="grid md:grid-cols-2 gap-4 mb-8">
                {[
                  { title: 'Persistent Brain', desc: 'Neo4j-powered knowledge graph stored locally at ~/.ragforge', color: 'cyan' },
                  { title: 'Daemon Architecture', desc: 'Activates on demand with file watching and incremental ingestion', color: 'purple' },
                  { title: 'Universal Ingestion', desc: 'Code, documents (PDF, DOCX), media (glTF, images), web pages', color: 'green' },
                  { title: 'Semantic Search', desc: 'Vector embeddings via Gemini for intelligent retrieval', color: 'pink' },
                  { title: 'MCP Integration', desc: 'Works with Claude Desktop and MCP-compatible clients', color: 'blue' },
                  { title: 'ResearchAgent', desc: 'Autonomous codebase exploration with structured queries', color: 'yellow' },
                ].map((feature) => (
                  <div key={feature.title} className={`p-4 rounded-xl bg-${feature.color}-500/5 border border-${feature.color}-400/20
                    hover:border-${feature.color}-400/40 transition-colors`}>
                    <h4 className={`font-medium text-${feature.color}-400 mb-1`}>{feature.title}</h4>
                    <p className="text-slate-400 text-sm">{feature.desc}</p>
                  </div>
                ))}
              </div>

              {/* Packages */}
              <h3 className="font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-400 rounded-full" />
                Packages
              </h3>
              <div className="grid md:grid-cols-3 gap-4 mb-8">
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-cyan-400/30 transition-colors">
                  <code className="text-cyan-400 text-sm">@luciformresearch/ragforge</code>
                  <p className="text-slate-500 text-xs mt-1">Core library</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-purple-400/30 transition-colors">
                  <code className="text-purple-400 text-sm">@luciformresearch/ragforge-cli</code>
                  <p className="text-slate-500 text-xs mt-1">CLI & MCP server</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-pink-400/30 transition-colors">
                  <code className="text-pink-400 text-sm">@luciformresearch/ragforge-studio</code>
                  <p className="text-slate-500 text-xs mt-1">Desktop app (Electron)</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4">
                <a
                  href="https://www.npmjs.com/package/@luciformresearch/ragforge"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-cyan-500/10 border border-cyan-400/50 rounded-lg font-medium text-cyan-400
                    hover:bg-cyan-500/20 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(0,255,255,0.3)] transition-all"
                >
                  npm →
                </a>
                <a
                  href="https://github.com/LuciformResearch/ragforge"
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
        </section>

        {/* CodeParsers */}
        <section id="codeparsers" className="mb-20 scroll-mt-24">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-green-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative bg-slate-900/80 backdrop-blur-sm border border-green-400/20 rounded-2xl p-8
              group-hover:border-green-400/40 transition-all duration-300">

              <div className="flex items-center gap-5 mb-6">
                <div className="relative">
                  <img
                    src="/product-logos/codeparsers-logo-transparent.png"
                    alt="CodeParsers Logo"
                    className="w-16 h-16 rounded-xl object-cover"
                  />
                  <div className="absolute inset-0 rounded-xl border-2 border-green-400/30 group-hover:border-green-400/60 transition-colors" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold">
                    <GlitchText
                      text="CodeParsers"
                      gradient="from-green-400 to-emerald-400"
                      glowColor="rgba(0,255,136,0.4)"
                      repeatInterval={16000}
                    />
                  </h2>
                  <code className="text-sm text-green-400/80">@luciformresearch/codeparsers</code>
                </div>
                <div className="ml-auto">
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-400/10 text-green-400 border border-green-400/30">
                    AST EXTRACTION
                  </span>
                </div>
              </div>

              <p className="text-slate-300 mb-8 text-lg leading-relaxed">
                Unified code parsing library using tree-sitter WASM bindings. Works in both Node.js and browser
                environments with a consistent API across all supported languages.
              </p>

              <h3 className="font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-green-400 rounded-full" />
                Supported Languages
              </h3>
              <div className="flex flex-wrap gap-2 mb-8">
                {['TypeScript/TSX', 'Python', 'HTML', 'CSS', 'SCSS', 'Vue SFC', 'Svelte', 'Markdown'].map((lang) => (
                  <span key={lang} className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-sm border border-green-400/20
                    hover:border-green-400/40 transition-colors">
                    {lang}
                  </span>
                ))}
              </div>

              <h3 className="font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-emerald-400 rounded-full" />
                Features
              </h3>
              <ul className="text-slate-400 space-y-3 mb-8">
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Tree-sitter Based</strong> — Robust, production-ready parsing with WASM bindings</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Consistent API</strong> — Same interface across all parsers</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Scope Extraction</strong> — Functions, classes, imports, decorators, references</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-green-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Browser Compatible</strong> — ESM-only modules with bundled WASM grammars</span>
                </li>
              </ul>

              <div className="flex gap-4">
                <a
                  href="https://www.npmjs.com/package/@luciformresearch/codeparsers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-green-500/10 border border-green-400/50 rounded-lg font-medium text-green-400
                    hover:bg-green-500/20 hover:border-green-400 hover:shadow-[0_0_20px_rgba(0,255,136,0.3)] transition-all"
                >
                  npm →
                </a>
                <a
                  href="https://github.com/LuciformResearch/LR_CodeParsers"
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
        </section>

        {/* XMLParser */}
        <section id="xmlparser" className="mb-20 scroll-mt-24">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-purple-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative bg-slate-900/80 backdrop-blur-sm border border-purple-400/20 rounded-2xl p-8
              group-hover:border-purple-400/40 transition-all duration-300">

              <div className="flex items-center gap-5 mb-6">
                <div className="w-16 h-16 rounded-xl bg-purple-500/10 border-2 border-purple-400/30 flex items-center justify-center
                  group-hover:border-purple-400/60 transition-colors">
                  <span className="text-2xl text-purple-400 font-mono">&lt;/&gt;</span>
                </div>
                <div>
                  <h2 className="text-3xl font-bold">
                    <GlitchText
                      text="XMLParser"
                      gradient="from-purple-400 to-pink-400"
                      glowColor="rgba(168,85,247,0.4)"
                      repeatInterval={17000}
                    />
                  </h2>
                  <code className="text-sm text-purple-400/80">@luciformresearch/xmlparser</code>
                </div>
                <div className="ml-auto">
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-400/10 text-purple-400 border border-purple-400/30">
                    LLM OUTPUTS
                  </span>
                </div>
              </div>

              <p className="text-slate-300 mb-8 text-lg leading-relaxed">
                TypeScript XML parser designed for AI pipelines. Excels at parsing LLM-generated XML with
                permissive mode error recovery while maintaining strict validation for production.
              </p>

              <h3 className="font-semibold mb-4 text-slate-200 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-400 rounded-full" />
                Features
              </h3>
              <ul className="text-slate-400 space-y-3 mb-8">
                <li className="flex items-start gap-3">
                  <span className="text-purple-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Permissive Mode</strong> — Robust error recovery for malformed LLM outputs with configurable recovery caps</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-purple-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Streaming SAX API</strong> — Parse large inputs incrementally as they arrive</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-purple-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Namespace Support</strong> — xmlns mapping with namespace-aware queries (findByNS, findAllByNS)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-purple-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Security Focused</strong> — Depth limits, text-length limits, entity expansion guards</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-purple-400 mt-1">▹</span>
                  <span><strong className="text-slate-300">Dual Build</strong> — ESM/CJS with TypeScript definitions included</span>
                </li>
              </ul>

              <div className="flex gap-4">
                <a
                  href="https://www.npmjs.com/package/@luciformresearch/xmlparser"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-purple-500/10 border border-purple-400/50 rounded-lg font-medium text-purple-400
                    hover:bg-purple-500/20 hover:border-purple-400 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all"
                >
                  npm →
                </a>
                <a
                  href="https://github.com/LuciformResearch/LR_XMLParser"
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
        </section>

      </div>
    </div>
  );
}

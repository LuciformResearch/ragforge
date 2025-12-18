import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Panel,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { Play, Loader2, Settings2, LayoutGrid, Maximize2, Minimize2, Search, X, Network, Brain, Zap } from 'lucide-react';
import ScopeNode from './nodes/ScopeNode';
import FileNode from './nodes/FileNode';
import DocumentNode from './nodes/DocumentNode';
import { ExpandProvider, useExpand } from './ExpandContext';

// Custom node types
const nodeTypes = {
  scope: ScopeNode,
  file: FileNode,
  document: DocumentNode,
};

// Properties to hide from the inspector (internal/large data)
const HIDDEN_PROPERTIES = [
  'embedding_name',
  'embedding_description',
  'embedding_content',
  'embeddingsDirty',
  'schemaDirty',
  'rawContentHash',
  'contentHash',
  'hash',
  'source',
  'rawContent',
  'textContent',
  'labels', // Already shown separately
];

/**
 * Filter out internal/large properties for display
 */
function filterPropertiesForDisplay(data: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    // Skip hidden properties
    if (HIDDEN_PROPERTIES.includes(key)) continue;
    // Skip arrays (likely embeddings or large data)
    if (Array.isArray(value) && value.length > 10) continue;
    filtered[key] = value;
  }
  return filtered;
}

// Layout directions
type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

const layoutOptions: { value: LayoutDirection; label: string }[] = [
  { value: 'TB', label: 'Top → Bottom' },
  { value: 'LR', label: 'Left → Right' },
  { value: 'BT', label: 'Bottom → Top' },
  { value: 'RL', label: 'Right → Left' },
];

/**
 * Apply dagre layout to nodes and edges
 */
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 180;
  const nodeHeight = 60;

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 50,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });

  // Add nodes to dagre
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // Add edges to dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Run the layout
  dagre.layout(dagreGraph);

  // Get new positions
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// Default queries organized by category
const defaultQueries = [
  // Code relationships
  {
    name: 'Dependencies',
    cypher: 'MATCH (n:Scope)-[r:CONSUMES]->(m:Scope) RETURN n, r, m',
    category: 'code',
  },
  {
    name: 'Scope Hierarchy',
    cypher: 'MATCH (child:Scope)-[r:HAS_PARENT]->(parent:Scope) RETURN child, r, parent',
    category: 'code',
  },
  {
    name: 'Inheritance',
    cypher: 'MATCH (n)-[r:INHERITS_FROM]->(m) RETURN n, r, m',
    category: 'code',
  },
  {
    name: 'Scopes in Files',
    cypher: 'MATCH (s:Scope)-[r:DEFINED_IN]->(f:File) RETURN s, r, f',
    category: 'code',
  },
  {
    name: 'External Libs',
    cypher: 'MATCH (s:Scope)-[r:USES_LIBRARY]->(lib:ExternalLibrary) RETURN s, r, lib',
    category: 'code',
  },
  // Document relationships
  {
    name: 'Markdown Structure',
    cypher: 'MATCH (d:MarkdownDocument)-[r:HAS_SECTION]->(s:MarkdownSection) RETURN d, r, s',
    category: 'docs',
  },
  {
    name: 'Section Hierarchy',
    cypher: 'MATCH (parent:MarkdownSection)<-[r:CHILD_OF]-(child:MarkdownSection) RETURN parent, r, child',
    category: 'docs',
  },
  {
    name: 'Code in Docs',
    cypher: 'MATCH (d:MarkdownDocument)-[r:CONTAINS_CODE]->(c:CodeBlock) RETURN d, r, c',
    category: 'docs',
  },
  // Web relationships
  {
    name: 'Web Links',
    cypher: 'MATCH (p1:WebPage)-[r:LINKS_TO]->(p2:WebPage) RETURN p1, r, p2',
    category: 'web',
  },
  // File structure
  {
    name: 'Directory Structure',
    cypher: 'MATCH (f:File)-[r:IN_DIRECTORY]->(d:Directory) RETURN f, r, d',
    category: 'structure',
  },
  // All
  {
    name: 'All Relationships',
    cypher: 'MATCH (n)-[r]->(m) RETURN n, r, m',
    category: 'all',
  },
];

// Context menu component
interface ContextMenuProps {
  x: number;
  y: number;
  node: Node;
  onClose: () => void;
  onExplore: (depth: number) => void;
}

function ContextMenu({ x, y, node, onClose, onExplore }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50"
      style={{ left: x, top: y }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700">
        {node.data.name || node.data.title || 'Node'}
      </div>
      <button
        onClick={() => { onExplore(1); onClose(); }}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-700 flex items-center gap-2"
      >
        <Network className="w-3.5 h-3.5" /> Explore relations (depth 1)
      </button>
      <button
        onClick={() => { onExplore(2); onClose(); }}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-700 flex items-center gap-2"
      >
        <Network className="w-3.5 h-3.5" /> Explore relations (depth 2)
      </button>
      <button
        onClick={() => { onExplore(3); onClose(); }}
        className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-700 flex items-center gap-2"
      >
        <Network className="w-3.5 h-3.5" /> Explore relations (depth 3)
      </button>
    </div>
  );
}

function GraphExplorerInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [query, setQuery] = useState(defaultQueries[0].cypher);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>('TB');

  // Brain search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDepth, setSearchDepth] = useState(1);
  const [searchMode, setSearchMode] = useState(false);
  const [searchSemantic, setSearchSemantic] = useState(false); // false = BM25, true = semantic
  const [fuzzyDistance, setFuzzyDistance] = useState<0 | 1 | 2>(1); // For BM25 mode
  const [daemonStatus, setDaemonStatus] = useState<'unknown' | 'starting' | 'ready' | 'error'>('unknown');
  const [daemonMessage, setDaemonMessage] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: Node } | null>(null);

  const { expandAll, collapseAll, setAllNodeIds, expandedNodes } = useExpand();

  // Load initial graph
  useEffect(() => {
    executeQuery();
  }, []);

  // Update node IDs for expand/collapse all
  useEffect(() => {
    setAllNodeIds(nodes.map((n) => n.id));
  }, [nodes, setAllNodeIds]);

  function getEdgeColor(type: string): string {
    switch (type) {
      // Code relationships
      case 'CONSUMES':
        return '#EF4444'; // red - dependencies
      case 'DEFINED_IN':
        return '#3B82F6'; // blue - scope in file
      case 'INHERITS_FROM':
        return '#F59E0B'; // amber - inheritance
      case 'IMPLEMENTS':
        return '#FBBF24'; // yellow - interface implementation
      case 'IMPORTS':
        return '#10B981'; // green - imports
      case 'USES_LIBRARY':
        return '#06B6D4'; // cyan - external libs
      case 'HAS_PARENT':
      case 'PARENT_OF':
        return '#A855F7'; // purple - scope hierarchy
      // Document relationships
      case 'HAS_SECTION':
        return '#EC4899'; // pink - doc sections
      case 'CHILD_OF':
        return '#F472B6'; // light pink - section hierarchy
      case 'CONTAINS_CODE':
        return '#14B8A6'; // teal - code blocks in docs
      // Web relationships
      case 'LINKS_TO':
        return '#6366F1'; // indigo - web links
      case 'HAS_PAGE':
        return '#818CF8'; // light indigo - website pages
      // File structure
      case 'IN_DIRECTORY':
        return '#8B5CF6'; // violet - directory structure
      case 'BELONGS_TO':
        return '#64748B'; // slate - project membership
      // Summary/Memory relationships
      case 'MENTIONS_FILE':
      case 'MENTIONS_NODE':
        return '#22D3EE'; // cyan - summary references
      // Asset relationships
      case 'REFERENCES':
      case 'REFERENCES_IMAGE':
      case 'HAS_IMAGE':
        return '#FB923C'; // orange - asset references
      default:
        return '#6B7280'; // gray - unknown
    }
  }

  function getNodeType(labels: string[]): string {
    // Code nodes (Scope types from brain_search)
    if (labels.includes('Scope')) return 'scope';
    if (labels.includes('CodeBlock')) return 'scope';
    // Specific scope types from brain_search graph
    if (labels.includes('function')) return 'scope';
    if (labels.includes('method')) return 'scope';
    if (labels.includes('class')) return 'scope';
    if (labels.includes('interface')) return 'scope';
    if (labels.includes('type')) return 'scope';
    if (labels.includes('variable')) return 'scope';
    if (labels.includes('module')) return 'scope';
    if (labels.includes('enum')) return 'scope';
    if (labels.includes('namespace')) return 'scope';
    // File nodes
    if (labels.includes('File')) return 'file';
    // Document nodes
    if (labels.includes('MarkdownDocument')) return 'document';
    if (labels.includes('MarkdownSection')) return 'document';
    if (labels.includes('WebPage')) return 'document';
    // Default for others
    if (labels.includes('ExternalLibrary')) return 'file';
    if (labels.includes('Directory')) return 'file';
    if (labels.includes('Project')) return 'file';
    if (labels.includes('Summary')) return 'document';
    return 'file';
  }

  function convertToFlowElements(data: { nodes: any[]; edges: any[] }) {
    const flowNodes: Node[] = data.nodes.map((node) => ({
      id: node.id,
      type: getNodeType(node.labels),
      position: { x: 0, y: 0 }, // Will be set by dagre
      data: {
        ...node.properties,
        labels: node.labels,
      },
    }));

    const flowEdges: Edge[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      type: 'smoothstep',
      animated: edge.type === 'CONSUMES',
      style: { stroke: getEdgeColor(edge.type), strokeWidth: 2 },
      labelStyle: { fontSize: 10, fill: '#9CA3AF' },
      labelBgStyle: { fill: '#1F2937', fillOpacity: 0.8 },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: getEdgeColor(edge.type),
        width: 20,
        height: 20,
      },
    }));

    return { flowNodes, flowEdges };
  }

  async function executeQuery() {
    setLoading(true);
    setSearchMode(false);
    try {
      const data = await window.studio.db.getGraph(query, limit);
      const { flowNodes, flowEdges } = convertToFlowElements(data);

      // Apply dagre layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        flowNodes,
        flowEdges,
        layoutDirection
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      console.error('Query failed:', err);
    }
    setLoading(false);
  }

  async function executeBrainSearch() {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSearchMode(true);
    setDaemonStatus('starting');
    setDaemonMessage('Connecting to daemon...');

    try {
      // Listen for daemon progress messages
      window.studio.daemon.onProgress((msg) => {
        setDaemonMessage(msg);
      });

      // Call brain_search via daemon (auto-starts if needed)
      const response = await window.studio.daemon.brainSearch(searchQuery, {
        semantic: searchSemantic,
        limit,
        explore_depth: searchDepth,
        fuzzy_distance: searchSemantic ? undefined : fuzzyDistance,
      });

      setDaemonStatus('ready');
      setDaemonMessage('');

      if (!response.success) {
        console.error('Brain search failed:', response.error);
        setDaemonStatus('error');
        setDaemonMessage(response.error || 'Search failed');
        setLoading(false);
        return;
      }

      const searchResult = response.result;
      const results = searchResult?.results || [];

      if (results.length === 0) {
        setNodes([]);
        setEdges([]);
        setLoading(false);
        return;
      }

      // Check if we have a graph structure (from explore_depth > 0)
      const graph = searchResult?.graph;

      // Build a map of rich data from results for merging
      const resultDataMap = new Map<string, any>();
      for (const result of results) {
        const node = result.node;
        if (node.uuid) {
          resultDataMap.set(node.uuid, {
            ...node,
            score: result.score,
            filePath: result.filePath,
            fileLineCount: result.fileLineCount,
            projectPath: result.projectPath,
          });
        }
      }

      let flowNodes: Node[] = [];
      let flowEdges: Edge[] = [];

      if (graph && graph.nodes && graph.edges) {
        // Identify EmbeddingChunks and collect their parentUuids
        const HIDDEN_NODE_TYPES = ['Summary']; // Keep EmbeddingChunk for parent resolution
        const embeddingChunks = graph.nodes.filter((n: any) => n.type === 'EmbeddingChunk');
        const parentUuids = [...new Set(embeddingChunks.map((c: any) => c.parentUuid).filter(Boolean))];

        // Resolve parent Scopes for EmbeddingChunks (single optimized query)
        let chunkParents: Record<string, any> = {};
        if (parentUuids.length > 0) {
          const { parents } = await window.studio.db.resolveChunkParents(parentUuids);
          chunkParents = parents;
        }

        // Build a map from chunk UUID to parent UUID for edge remapping
        const chunkToParentMap = new Map<string, string>();
        for (const chunk of embeddingChunks) {
          if (chunk.parentUuid && chunkParents[chunk.parentUuid]) {
            chunkToParentMap.set(chunk.uuid, chunk.parentUuid);
          }
        }

        // Process nodes: replace EmbeddingChunks with their parents, filter others
        const processedNodes: any[] = [];
        const seenParentUuids = new Set<string>(); // Deduplicate parents

        for (const n of graph.nodes) {
          // Skip hidden types
          if (HIDDEN_NODE_TYPES.includes(n.type)) continue;
          // Skip unnamed/internal nodes (but not EmbeddingChunks which we'll replace)
          if (n.type !== 'EmbeddingChunk' && (n.name === 'unnamed' || n.name?.startsWith('file_scope_'))) continue;

          if (n.type === 'EmbeddingChunk') {
            // Replace with parent Scope
            const parent = chunkParents[n.parentUuid];
            if (parent && !seenParentUuids.has(parent.uuid)) {
              seenParentUuids.add(parent.uuid);
              processedNodes.push({
                ...parent,
                // Inherit search result status and score from the chunk
                isSearchResult: n.isSearchResult,
                score: n.score,
              });
            }
          } else {
            processedNodes.push(n);
          }
        }

        // Get set of visible node UUIDs for edge filtering
        const visibleNodeIds = new Set(processedNodes.map((n: any) => n.uuid));

        // Use the pre-built graph from brain_search
        // Convert graph nodes to our format, merging rich data from results
        const nodeEntries = processedNodes.map((n: any) => {
          // Try to get rich data from results
          const richData = resultDataMap.get(n.uuid);

          // Determine labels - use type from graph, but also check for Neo4j-style labels
          const labels = n.type ? [n.type] : ['Unknown'];

          // Prefer richData.type over n.type because richData comes from full node data
          // while n.type from graph exploration might just be the Neo4j label ("Scope")
          const nodeType = (richData?.type && richData.type !== 'Scope')
            ? richData.type
            : (n.type && n.type !== 'Scope')
              ? n.type
              : richData?.type || n.type || 'unknown';

          return {
            id: n.uuid,
            labels: [nodeType],
            properties: {
              // Start with rich data if available (has signature, docstring, etc.)
              ...(richData || {}),
              // Override with graph node data
              ...n,
              // Ensure these are set correctly
              name: n.name || richData?.name,
              type: nodeType,
              file: n.file || richData?.file,
              signature: richData?.signature || n.signature,
              docstring: richData?.docstring || n.docstring,
              startLine: richData?.startLine || n.startLine,
              endLine: richData?.endLine || n.endLine,
              source: richData?.source || n.source,
              absolutePath: richData?.absolutePath,
              // Mark search results for highlighting
              isSearchResult: n.isSearchResult || resultDataMap.has(n.uuid),
              score: n.score ?? richData?.score,
            },
          };
        });

        // Convert graph edges to our format, remapping chunk edges to parents
        const edgeEntries = graph.edges
          .map((e: any) => ({
            // Remap source/target if they were EmbeddingChunks
            from: chunkToParentMap.get(e.from) || e.from,
            to: chunkToParentMap.get(e.to) || e.to,
            type: e.type,
          }))
          // Filter to only edges between visible nodes, and deduplicate
          .filter((e: any) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))
          .filter((e: any, i: number, arr: any[]) =>
            // Deduplicate edges (same from-type-to)
            arr.findIndex((x: any) => x.from === e.from && x.to === e.to && x.type === e.type) === i
          )
          .map((e: any) => ({
            id: `${e.from}-${e.type}-${e.to}`,
            source: e.from,
            target: e.to,
            type: e.type,
          }));

        // Build set of nodes that have edges (connected nodes)
        const connectedNodeIds = new Set<string>();
        for (const e of edgeEntries) {
          connectedNodeIds.add(e.source);
          connectedNodeIds.add(e.target);
        }

        // Filter out orphan nodes (no edges AND not a search result)
        // Search results are always kept even without connections
        const filteredNodeEntries = nodeEntries.filter((n: any) =>
          n.properties.isSearchResult || connectedNodeIds.has(n.id)
        );

        const converted = convertToFlowElements({
          nodes: filteredNodeEntries,
          edges: edgeEntries,
        });
        flowNodes = converted.flowNodes;
        flowEdges = converted.flowEdges;
      } else {
        // No graph structure, just show result nodes without edges
        const nodeEntries = results.map((result: any) => {
          const node = result.node;
          const uuid = node.uuid || node.path;
          return {
            id: uuid,
            labels: node.labels || [node.type || 'Unknown'],
            properties: {
              ...node,
              score: result.score,
              filePath: result.filePath,
              isSearchResult: true,
            },
          };
        }).filter((n: any) => n.id);

        const converted = convertToFlowElements({
          nodes: nodeEntries,
          edges: [],
        });
        flowNodes = converted.flowNodes;
        flowEdges = converted.flowEdges;
      }

      // Apply dagre layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        flowNodes,
        flowEdges,
        layoutDirection
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      console.error('Brain search failed:', err);
      setDaemonStatus('error');
      setDaemonMessage(err instanceof Error ? err.message : 'Search failed');
    }
    setLoading(false);
  }

  async function exploreNodeRelations(node: Node, depth: number) {
    const uuid = node.data?.uuid;
    if (!uuid) {
      console.error('Node has no uuid');
      return;
    }

    setLoading(true);
    setSearchMode(true);
    try {
      const data = await window.studio.db.getNodeRelations(uuid, depth);
      const { flowNodes, flowEdges } = convertToFlowElements(data);

      // Apply dagre layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        flowNodes,
        flowEdges,
        layoutDirection
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      console.error('Explore failed:', err);
    }
    setLoading(false);
  }

  // Re-layout when direction changes
  function applyLayout(direction: LayoutDirection) {
    setLayoutDirection(direction);
    if (nodes.length > 0) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        nodes,
        edges,
        direction
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
  }

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  const hasExpandedNodes = expandedNodes.size > 0;

  return (
    <div className="h-full flex">
      {/* Graph canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-gray-900"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
          <Controls className="bg-gray-800 border-gray-700" />
          <MiniMap
            className="bg-gray-800 border border-gray-700"
            nodeColor={(node) => {
              if (node.type === 'scope') return '#8B5CF6';
              if (node.type === 'file') return '#F59E0B';
              if (node.type === 'document') return '#EC4899';
              return '#6B7280';
            }}
          />

          {/* Query panel */}
          <Panel position="top-left" className="bg-gray-800 rounded-lg p-4 m-2 w-96 shadow-xl border border-gray-700 max-h-[calc(100vh-100px)] overflow-y-auto">
            {/* Brain Search section */}
            <div className="mb-4 pb-4 border-b border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium">Brain Search</span>
              </div>

              {/* Search mode toggle */}
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setSearchSemantic(false)}
                  className={`flex-1 px-2 py-1 text-xs rounded-l ${
                    !searchSemantic
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title="BM25 keyword search with fuzzy matching"
                >
                  <Zap className="w-3 h-3 inline mr-1" />
                  BM25
                </button>
                <button
                  onClick={() => setSearchSemantic(true)}
                  className={`flex-1 px-2 py-1 text-xs rounded-r ${
                    searchSemantic
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title="Semantic search with embeddings"
                >
                  <Brain className="w-3 h-3 inline mr-1" />
                  Semantic
                </button>
              </div>

              {/* Search input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeBrainSearch()}
                  placeholder={searchSemantic ? "Search by meaning..." : "Search keywords..."}
                  className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={executeBrainSearch}
                  disabled={loading || !searchQuery.trim()}
                  className={`px-3 py-1.5 rounded text-sm disabled:opacity-50 ${
                    searchSemantic ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>

              {/* Options row */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <label className="text-xs text-gray-400">Depth:</label>
                  <select
                    value={searchDepth}
                    onChange={(e) => setSearchDepth(parseInt(e.target.value))}
                    className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>

                {/* Fuzzy distance (only for BM25 mode) */}
                {!searchSemantic && (
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-400">Fuzzy:</label>
                    <select
                      value={fuzzyDistance}
                      onChange={(e) => setFuzzyDistance(parseInt(e.target.value) as 0 | 1 | 2)}
                      className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs"
                    >
                      <option value={0}>Exact</option>
                      <option value={1}>~1</option>
                      <option value={2}>~2</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Daemon status */}
              {daemonMessage && (
                <div className={`mt-2 text-xs ${daemonStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                  {daemonStatus === 'starting' && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
                  {daemonMessage}
                </div>
              )}

              {/* Clear search */}
              {searchMode && (
                <button
                  onClick={() => { setSearchMode(false); setSearchQuery(''); setDaemonMessage(''); executeQuery(); }}
                  className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-white"
                >
                  <X className="w-3 h-3" /> Clear search
                </button>
              )}
            </div>

            {/* Query section */}
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium">Query</span>
            </div>

            {/* Preset queries */}
            <div className="flex gap-2 mb-3 flex-wrap">
              {defaultQueries.map((q) => (
                <button
                  key={q.name}
                  onClick={() => setQuery(q.cypher)}
                  className={`px-2 py-1 text-xs rounded ${
                    query === q.cypher
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {q.name}
                </button>
              ))}
            </div>

            {/* Query input */}
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-20 bg-gray-900 border border-gray-600 rounded p-2 text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
              placeholder="MATCH (n)-[r]->(m) RETURN n, r, m"
            />

            {/* Controls */}
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Limit:</label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value) || 50)}
                  className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm"
                />
              </div>
              <button
                onClick={executeQuery}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50 ml-auto"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Run
              </button>
            </div>

            {/* Layout direction */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-700">
              <LayoutGrid className="w-4 h-4 text-gray-400" />
              <label className="text-xs text-gray-400">Layout:</label>
              <select
                value={layoutDirection}
                onChange={(e) => applyLayout(e.target.value as LayoutDirection)}
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm"
              >
                {layoutOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Expand/Collapse All */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={expandAll}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                title="Expand all nodes (show source code)"
              >
                <Maximize2 className="w-3 h-3" />
                Expand All
              </button>
              <button
                onClick={collapseAll}
                disabled={!hasExpandedNodes}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
                title="Collapse all nodes"
              >
                <Minimize2 className="w-3 h-3" />
                Collapse All
              </button>
              {hasExpandedNodes && (
                <span className="text-xs text-gray-500 ml-auto">
                  {expandedNodes.size} expanded
                </span>
              )}
            </div>

            {/* Results count */}
            <div className="mt-3 text-xs text-gray-500">
              {nodes.length} nodes, {edges.length} edges
              {searchMode && <span className="ml-2 text-green-400">(search results)</span>}
            </div>

            {/* Legend */}
            <div className="mt-3 pt-3 border-t border-gray-700">
              <label className="text-xs text-gray-500 mb-2 block">Edge Legend</label>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#EF4444' }}></span> CONSUMES
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#3B82F6' }}></span> DEFINED_IN
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#A855F7' }}></span> HAS_PARENT
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#F59E0B' }}></span> INHERITS
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#06B6D4' }}></span> USES_LIB
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ backgroundColor: '#EC4899' }}></span> HAS_SECTION
                </span>
              </div>
            </div>

            {/* Hints */}
            <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 space-y-1">
              <div>💡 Double-click to expand/collapse source</div>
              <div>🖱️ Right-click to explore relations</div>
            </div>
          </Panel>
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            node={contextMenu.node}
            onClose={() => setContextMenu(null)}
            onExplore={(depth) => exploreNodeRelations(contextMenu.node, depth)}
          />
        )}
      </div>

      {/* Inspector panel */}
      {selectedNode && (
        <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 overflow-auto">
          <h3 className="font-semibold mb-3">Inspector</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Type</label>
              <p className="text-sm">{selectedNode.data.labels?.join(', ') || selectedNode.type}</p>
            </div>
            {selectedNode.data.name && (
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <p className="text-sm font-mono">{selectedNode.data.name}</p>
              </div>
            )}
            {selectedNode.data.uuid && (
              <div>
                <label className="text-xs text-gray-500">UUID</label>
                <p className="text-xs font-mono text-gray-400 truncate">{selectedNode.data.uuid}</p>
              </div>
            )}
            {selectedNode.data.file && (
              <div>
                <label className="text-xs text-gray-500">File</label>
                <p className="text-sm font-mono truncate">{selectedNode.data.file}</p>
              </div>
            )}
            {selectedNode.data.type && (
              <div>
                <label className="text-xs text-gray-500">Scope Type</label>
                <p className="text-sm">{selectedNode.data.type}</p>
              </div>
            )}
            {selectedNode.data.startLine && (
              <div>
                <label className="text-xs text-gray-500">Lines</label>
                <p className="text-sm">
                  {selectedNode.data.startLine} - {selectedNode.data.endLine}
                </p>
              </div>
            )}

            {/* Explore button */}
            <div className="pt-3 border-t border-gray-700">
              <button
                onClick={() => exploreNodeRelations(selectedNode, 2)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                <Network className="w-4 h-4" />
                Explore relations (depth 2)
              </button>
            </div>

            {/* All properties */}
            <div className="pt-3 border-t border-gray-700">
              <label className="text-xs text-gray-500 mb-2 block">All Properties</label>
              <pre className="text-xs bg-gray-900 rounded p-2 overflow-auto max-h-60">
                {JSON.stringify(filterPropertiesForDisplay(selectedNode.data), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrap with ExpandProvider
export default function GraphExplorer() {
  return (
    <ExpandProvider>
      <GraphExplorerInner />
    </ExpandProvider>
  );
}

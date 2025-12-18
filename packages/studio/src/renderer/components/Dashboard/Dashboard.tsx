import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Globe,
  FileCode,
  RefreshCw,
  Trash2,
  GitGraph,
  Database,
  Loader2,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  path: string;
  nodeCount: number;
  lastAccessed: string;
  type: string;
}

interface Stats {
  totalNodes: number;
  totalRelationships: number;
  nodesByLabel: Record<string, number>;
  relationshipsByType: Record<string, number>;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [projectsData, statsData] = await Promise.all([
        window.studio.db.getProjects(),
        window.studio.db.getStats(),
      ]);
      setProjects(projectsData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Rafraîchir
          </button>
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              icon={<Database className="w-5 h-5" />}
              label="Total Nodes"
              value={stats.totalNodes.toLocaleString()}
              color="blue"
            />
            <StatCard
              icon={<GitGraph className="w-5 h-5" />}
              label="Relations"
              value={stats.totalRelationships.toLocaleString()}
              color="green"
            />
            <StatCard
              icon={<FileCode className="w-5 h-5" />}
              label="Scopes"
              value={(stats.nodesByLabel['Scope'] || 0).toLocaleString()}
              color="purple"
            />
            <StatCard
              icon={<FolderOpen className="w-5 h-5" />}
              label="Files"
              value={(stats.nodesByLabel['File'] || 0).toLocaleString()}
              color="orange"
            />
          </div>
        )}

        {/* Projects */}
        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Projets ({projects.length})</h2>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Aucun projet ingéré</p>
              <p className="text-sm mt-1">
                Utilisez <code className="bg-gray-700 px-1 rounded">ragforge agent --ingest ./path</code> pour ajouter un projet
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>

        {/* Node types breakdown */}
        {stats && Object.keys(stats.nodesByLabel).length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Types de nœuds</h2>
            <div className="grid grid-cols-4 gap-3">
              {Object.entries(stats.nodesByLabel)
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <div
                    key={label}
                    className="bg-gray-700/50 rounded-lg p-3 flex items-center justify-between"
                  >
                    <span className="text-sm text-gray-300">{label}</span>
                    <span className="font-mono text-sm">{count.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colorClasses = {
    blue: 'bg-blue-900/30 border-blue-700 text-blue-400',
    green: 'bg-green-900/30 border-green-700 text-green-400',
    purple: 'bg-purple-900/30 border-purple-700 text-purple-400',
    orange: 'bg-orange-900/30 border-orange-700 text-orange-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const icon =
    project.type === 'web-crawl' ? (
      <Globe className="w-5 h-5 text-blue-400" />
    ) : (
      <FolderOpen className="w-5 h-5 text-yellow-400" />
    );

  const timeAgo = project.lastAccessed
    ? formatTimeAgo(new Date(project.lastAccessed))
    : 'Unknown';

  return (
    <div className="bg-gray-700/50 rounded-lg p-4 flex items-center gap-4 hover:bg-gray-700 transition-colors">
      {icon}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{project.name}</h3>
        <p className="text-sm text-gray-400 truncate">{project.path}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono">{project.nodeCount.toLocaleString()} nodes</p>
        <p className="text-sm text-gray-500">{timeAgo}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="p-2 hover:bg-gray-600 rounded"
          title="View in Graph Explorer"
        >
          <GitGraph className="w-4 h-4" />
        </button>
        <button
          className="p-2 hover:bg-gray-600 rounded text-red-400"
          title="Remove"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

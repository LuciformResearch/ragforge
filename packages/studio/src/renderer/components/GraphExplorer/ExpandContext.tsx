import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ExpandContextType {
  expandedNodes: Set<string>;
  toggleExpanded: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  isExpanded: (nodeId: string) => boolean;
  setAllNodeIds: (ids: string[]) => void;
}

const ExpandContext = createContext<ExpandContextType | null>(null);

export function ExpandProvider({ children }: { children: ReactNode }) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [allNodeIds, setAllNodeIds] = useState<string[]>([]);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedNodes(new Set(allNodeIds));
  }, [allNodeIds]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  const isExpanded = useCallback(
    (nodeId: string) => expandedNodes.has(nodeId),
    [expandedNodes]
  );

  return (
    <ExpandContext.Provider
      value={{
        expandedNodes,
        toggleExpanded,
        expandAll,
        collapseAll,
        isExpanded,
        setAllNodeIds,
      }}
    >
      {children}
    </ExpandContext.Provider>
  );
}

export function useExpand() {
  const context = useContext(ExpandContext);
  if (!context) {
    throw new Error('useExpand must be used within an ExpandProvider');
  }
  return context;
}

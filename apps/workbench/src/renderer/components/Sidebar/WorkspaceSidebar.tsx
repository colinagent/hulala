import React from 'react';
import { FileExplorer } from '../FileExplorer/FileExplorer';

export function WorkspaceSidebar() {
  return (
    <div className="flex flex-col h-full text-prime-text">
      <div className="flex-1 overflow-hidden">
        <FileExplorer showHeader={false} startDepth={1} />
      </div>
    </div>
  );
}

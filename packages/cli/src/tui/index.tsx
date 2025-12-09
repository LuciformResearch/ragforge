import React from 'react';
import { render, type Instance } from 'ink';
import { App } from './App.js';

export interface TuiOptions {
  projectName?: string;
  projectPath?: string;
  model?: string;
  verbose?: boolean;
}

export async function startTui(options: TuiOptions = {}): Promise<void> {
  const instance: Instance = render(
    <App
      projectName={options.projectName}
      projectPath={options.projectPath}
      model={options.model}
      verbose={options.verbose}
    />
  );
  await instance.waitUntilExit();
}

export { App } from './App.js';
export * from './components/index.js';
export * from './hooks/index.js';

/**
 * Main application script
 */

interface AppConfig {
  theme: 'light' | 'dark';
  language: string;
}

export function initApp(config: AppConfig): void {
  console.log('Initializing app with config:', config);

  document.addEventListener('DOMContentLoaded', () => {
    setupTheme(config.theme);
  });
}

function setupTheme(theme: 'light' | 'dark'): void {
  document.body.classList.add(`theme-${theme}`);
}

// Initialize with default config
initApp({ theme: 'light', language: 'en' });

// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: "src/main/index.ts"
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      lib: {
        entry: "src/preload/index.ts",
        formats: ["cjs"]
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js"
        }
      }
    }
  },
  renderer: {
    root: "src/renderer",
    publicDir: "../../public",
    plugins: [react()],
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: "src/renderer/index.html"
      }
    }
  }
});
export {
  electron_vite_config_default as default
};

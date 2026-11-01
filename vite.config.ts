import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // the preview proxy serves the dev server from a *.e2b.app host — allow it explicitly
  server: { allowedHosts: ['.e2b.app'] },
  resolve: {
    alias: [
      // The game renders through three/webgpu. Three's classic addons still import
      // the bare "three" specifier; alias that exact specifier to the WebGPU build
      // so the bundle contains one Three module instance (and one class registry).
      {
        find: /^three$/,
        replacement: path.resolve(__dirname, "node_modules/three/build/three.webgpu.js"),
      },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
});

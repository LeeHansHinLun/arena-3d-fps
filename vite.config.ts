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
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Builds the visual-regression harness (never shipped): `npm run harness`
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: "harness-dist",
    emptyOutDir: true,
    minify: false,
    cssMinify: false,
    rollupOptions: { input: path.resolve(__dirname, "__harness__/index.html") },
  },
});

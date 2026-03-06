import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const remotePort =
  process.env.VIBETERM_REMOTE_PORT || process.env.VITE_VIBETERM_REMOTE_PORT || "3030";
const remoteProxyTarget = `http://127.0.0.1:${remotePort}`;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    proxy: {
      "/api": {
        target: remoteProxyTarget,
        changeOrigin: true,
        ws: true,
      },
      "/health": {
        target: remoteProxyTarget,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));

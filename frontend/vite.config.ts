import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const shouldAnalyze =
    mode === "analyze" ||
    process.env.ANALYZE === "true" ||
    process.env.npm_config_analyze === "true";

  const rawNgrokDomain = env.VITE_NGROK_DOMAIN ?? env.NGROK_DOMAIN ?? "";
  const normalizedNgrokHost = rawNgrokDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
  const allowedHosts = new Set(["localhost", "127.0.0.1"]);
  if (normalizedNgrokHost.length > 0) {
    allowedHosts.add(normalizedNgrokHost);
  }

  return {
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      force: true,
      include: [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "zustand",
        "axios",
        "@phosphor-icons/react",
        "phosphor-react",
      ],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // we'll register manually via workbox-window
        workbox: undefined, // not used with injectManifest
        strategies: "injectManifest",
        injectManifest: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // allow caching bundles up to 10 MB
        },
        srcDir: "src",
        filename: "sw.ts",
        // Disable dev SW injection to avoid HMR issues; rely on production SW only
        devOptions: {
          enabled: false,
        },
        manifest: {
          name: "Funly",
          short_name: "Funly",
          description: "Chat app that feels like a mobile app",
          theme_color: "#0ea5e9",
          background_color: "#0b1220",
          display: "standalone",
          start_url: "/",
          scope: "/",
          lang: "en",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
      }),
      shouldAnalyze
        ? visualizer({
            filename: "dist/bundle-analysis.html",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
          })
        : null,
    ].filter(Boolean),
    server: {
      host: true,
      // Allow additional hosts from env so Vite doesn't 403 forwarded requests.
      allowedHosts: Array.from(allowedHosts),
    },
  };
});

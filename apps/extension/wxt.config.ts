import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Brief - YouTube Video Summaries",
    description: "One-click AI summaries of YouTube videos",
    permissions: ["activeTab", "storage", "notifications", "cookies"],
    host_permissions: [
      "https://brief.niftymonkey.dev/*",
      "http://localhost:3000/*",
      "*://*.youtube.com/*",
    ],
  },
});

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
    icons: {
      "16": "icon-16.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
  },
});

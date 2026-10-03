import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

// Identifies this build. Open overlays compare the id baked into their bundle
// with /version.json and reload themselves when a newer build is live (see
// src/widget/autoReload.ts). Workers Builds provides the commit; the timestamp
// makes every rebuild distinct, including a redeploy of the same commit.
const commit = (process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local').slice(0, 7);
const buildId = `${commit}-${Date.now().toString(36)}`;

// Writes /version.json next to the built pages.
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: buildId }),
      });
    },
  };
}

export default defineConfig({
  base: '/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [versionFile()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget/index.html'),
      },
    },
  },
});

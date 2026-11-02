import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Excalidraw (sceneoppsettet) henter fontene til tegningen selv, med `fetch`,
 * fra `window.EXCALIDRAW_ASSET_PATH` — og ellers fra esm.sh. Vi serverer dem
 * selv under `/excalidraw/<versjon>/fonts/…`, så den som tegner ikke sender IP
 * og tidspunkt til en tredjepart (samme prinsipp som bildene i markdown.ts).
 *
 * Xiaolai (kinesisk/japansk, ~12 MB) er utelatt: den lastes bare for slike
 * tegn, og da faller Excalidraw tilbake til esm.sh.
 */
function excalidrawFonts(): Plugin {
  const dist = dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw')))
  const pkg = JSON.parse(readFileSync(resolve(dist, '../../package.json'), 'utf8')) as { version: string }
  const base = `/excalidraw/${pkg.version}/`
  const fontsDir = resolve(dist, 'fonts')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name !== 'Xiaolai') walk(path)
      } else if (name.endsWith('.woff2')) files.push(relative(dist, path).split(sep).join('/'))
    }
  }
  walk(fontsDir)
  const known = new Set(files)

  return {
    name: 'tb-excalidraw-fonts',
    config: () => ({ define: { __EXCALIDRAW_ASSET_BASE__: JSON.stringify(base) } }),
    configureServer(server) {
      server.middlewares.use(base, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\/+/, ''))
        if (!known.has(name)) return next()
        const path = resolve(dist, name)
        if (!path.startsWith(fontsDir + sep) || !existsSync(path)) return next()
        res.setHeader('Content-Type', 'font/woff2')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        createReadStream(path).pipe(res)
      })
    },
    generateBundle() {
      if (this.environment?.name !== 'client') return
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `${base.slice(1)}${name}`, source: readFileSync(resolve(dist, name)) })
      }
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    excalidrawFonts(),
  ],
})

export default config

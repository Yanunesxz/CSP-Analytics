import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

const raiz = dirname(fileURLToPath(import.meta.url));
const pacote = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8')) as { version: string };

/** Identificador desta build: versão do pacote + commit (na Vercel) ou hora da build. */
const builtAt = new Date().toISOString();
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 7);
const version = commit ? `${pacote.version}+${commit}` : pacote.version;

/**
 * Gera `public/version.json` ({ version, builtAt }) em toda build e no dev.
 * `src/lib/versao.ts` lê `/version.json` de tempos em tempos e, quando o `builtAt` muda,
 * a casca mostra a faixa "Versão nova disponível" (seção 10 do padrão).
 */
function versaoJson(): Plugin {
  return {
    name: 'csp-mkt:version-json',
    buildStart() {
      const pasta = resolve(raiz, 'public');
      mkdirSync(pasta, { recursive: true });
      writeFileSync(resolve(pasta, 'version.json'), JSON.stringify({ version, builtAt }, null, 2) + '\n');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versaoJson()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

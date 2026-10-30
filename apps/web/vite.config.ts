import { readFileSync } from 'node:fs';
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
 * Serve `/version.json` ({ version, builtAt }): na build vira `dist/version.json`; no dev sai de um
 * middleware, para uma build rodada com o dev aberto não trocar o arquivo que o dev serve.
 * `src/lib/versao.ts` lê `/version.json` de tempos em tempos e, quando o `builtAt` muda,
 * a casca mostra a faixa "Versão nova disponível" (seção 10 do padrão).
 */
function versaoJson(): Plugin {
  const conteudo = JSON.stringify({ version, builtAt }, null, 2) + '\n';
  return {
    name: 'csp-mkt:version-json',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(conteudo);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: conteudo });
    },
  };
}

/**
 * `--mode exemplo` (scripts dev:exemplo e build:exemplo) liga os dados de exemplo sem precisar de .env:
 * é o protótipo da fase 2 aberto como o dono vai ver. Nunca usar em produção.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), versaoJson()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
    ...(mode === 'exemplo' ? { 'import.meta.env.VITE_SAMPLE_DATA': JSON.stringify('true') } : {}),
  },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));

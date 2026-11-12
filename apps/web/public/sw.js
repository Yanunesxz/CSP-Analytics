/*
 * Service worker do CSP MKT: o mínimo para o navegador oferecer "Instalar app".
 *
 * Não guarda nada no aparelho. Os números mudam de hora em hora, e o sistema é de escritório, com internet
 * (a nova versão continua avisada pelo /version.json). Só a abertura de página passa por aqui: sem
 * internet, em vez da tela de erro do navegador, aparece uma página que diz o que aconteceu e o que fazer.
 *
 * Registrado só na build (src/lib/app-instalavel.ts): no `pnpm dev` a porta 5173 é de vários projetos.
 */

const PAGINA_SEM_INTERNET = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Sem internet · CSP MKT</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: Canvas; color: CanvasText;
    font-family: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { display: grid; gap: 12px; justify-items: center; max-width: 36ch; padding: 24px 16px; text-align: center; }
  h1 { margin: 0; font-size: 24px; font-weight: 700; }
  p { margin: 0; font-size: 16px; line-height: 1.5; }
  button { min-height: 44px; margin-top: 8px; padding: 0 16px; border: 1px solid currentColor; border-radius: 6px;
    background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Sem internet</h1>
  <p>O CSP MKT precisa de conexão para mostrar os números. Confira o Wi-Fi ou os dados do celular.</p>
  <button type="button" onclick="location.reload()">Tentar de novo</button>
</main>
</body>
</html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (evento) => {
  if (evento.request.mode !== 'navigate') return;
  evento.respondWith(
    fetch(evento.request).catch(
      () =>
        new Response(PAGINA_SEM_INTERNET, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
    ),
  );
});

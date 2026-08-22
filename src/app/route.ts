/**
 * Serve o `Form.html` na raiz.
 *
 * O arquivo é lido do disco SEM ALTERAÇÃO — a única coisa que muda é a injeção
 * da tag do shim antes de `</head>`, ocupando o lugar do que o `HtmlService`
 * do Apps Script injetava sozinho. Assim o front continua byte a byte igual ao
 * que está em produção, e a paridade é verificável por hash.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const arquivo = path.join(process.cwd(), 'public', 'Form.html');
  const html = await readFile(arquivo, 'utf8');

  // Injetados aqui, não no arquivo: o `Form.html` permanece byte a byte
  // idêntico ao que roda em produção no Apps Script, e essa paridade continua
  // verificável por hash.
  const injecao = [
    '  <script src="/gs-shim.js"></script>',
    // C2 pede que "pagaram os dois" tenha representação PRÓPRIA — antes caía
    // num círculo cinza idêntico ao de "sem pagador", que é coisa diferente.
    // Aqui a foto da família cumpre isso melhor que o círculo dividido, e por
    // URL: a advertência de payload da própria C2 é não embutir imagem em cada
    // item de lista. Sobreposto por CSS para o Form.html seguir intocado.
    '  <style>',
    "    .avatar-duo{background-image:url('/avatar-ambos-192.png');background-size:cover;background-position:center}",
    '    .avatar-duo i{display:none}',
    '  </style>',
    '  <link rel="apple-touch-icon" sizes="180x180" href="/icone-180.png">',
    '  <link rel="icon" type="image/png" sizes="192x192" href="/icone-192.png">',
    '  <link rel="manifest" href="/manifest.json">',
    '</head>',
  ].join('\n');

  const comShim = html.replace('</head>', injecao);

  return new Response(comShim, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      /* Sem isto a resposta ia SEM nenhuma instrução de cache, e quem decidia
         era o cliente. O app é usado como atalho na tela inicial, onde o iOS
         guarda o HTML de forma agressiva e não oferece botão de recarregar —
         resultado: correções publicadas que simplesmente não chegam ao
         aparelho, e um diagnóstico que persegue o defeito errado.

         `must-revalidate` com `max-age=0` não desliga o cache: mantém o ETag e
         devolve 304 quando nada mudou, então o custo é uma ida ao servidor, não
         o download do arquivo inteiro. É o mesmo que o Next já manda nas
         páginas dele — a rota é que estava fora do padrão. */
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

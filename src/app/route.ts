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
    '  <link rel="apple-touch-icon" sizes="180x180" href="/icone-180.png">',
    '  <link rel="icon" type="image/png" sizes="192x192" href="/icone-192.png">',
    '  <link rel="manifest" href="/manifest.json">',
    '</head>',
  ].join('\n');

  const comShim = html.replace('</head>', injecao);

  return new Response(comShim, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

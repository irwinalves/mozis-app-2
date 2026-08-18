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

  const comShim = html.replace(
    '</head>',
    '  <script src="/gs-shim.js"></script>\n</head>',
  );

  return new Response(comShim, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

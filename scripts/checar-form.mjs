/**
 * Sanidade do `public/Form.html`.
 *
 * Este arquivo não passa por build nenhum — é servido como está, com as injeções
 * do `route.ts` grudadas antes de `</head>`. Consequência: um erro de sintaxe no
 * JavaScript não aparece em lugar nenhum do terminal. A tela fica em branco no
 * celular, e só o console do navegador conta o que houve.
 *
 * Este script é o compilador que o arquivo não tem. Ele extrai cada bloco
 * <script> inline e manda o Node analisar a sintaxe.
 *
 * A paridade byte a byte com o app antigo acabou em 20/08/2026 (regra 2 do
 * CLAUDE.md), então comparar hashes deixou de fazer sentido. Isto ficou no lugar.
 *
 * Uso: node scripts/checar-form.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const caminho = process.argv[2] ?? 'public/Form.html';
const html = readFileSync(caminho, 'utf8');

// Só blocos inline: um <script src=...> não tem corpo para analisar.
const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

if (!blocos.length) {
  console.error(`FALHA  nenhum bloco <script> inline em ${caminho} — isso não deveria acontecer.`);
  process.exit(1);
}

let erros = 0;
for (const [i, m] of blocos.entries()) {
  const corpo = m[1];
  // Em que linha do arquivo este bloco começa, para o erro ser localizável.
  const linhaInicial = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(corpo, { filename: `${caminho}:bloco${i + 1}` });
  } catch (e) {
    erros++;
    console.error(`FALHA  bloco ${i + 1} (linha ~${linhaInicial}): ${e.message}`);
  }
}

// Toda chamada ao backend passa pelo shim de `google.script.run`. Se o número cair
// sem que uma feature tenha saído, alguma virou `fetch` solto e escapou da rota
// única de RPC — que é onde vive a allowlist de métodos.
const chamadas = (html.match(/google\.script\.run/g) ?? []).length;

console.log(`${blocos.length} bloco(s) <script> · ${erros} com erro de sintaxe · ${chamadas} chamadas a google.script.run`);
process.exit(erros > 0 ? 1 : 0);

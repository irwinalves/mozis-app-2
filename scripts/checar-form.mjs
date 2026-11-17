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

/* `$('algumId')` para um elemento que não existe devolve `null`, e a linha
   seguinte — `.onclick =`, `.addEventListener`, `.style` — derruba o arquivo
   INTEIRO na carga. Não é a tela daquele id que some: é o app.

   Isto existe porque aconteceu. Ao aposentar o formulário antigo desta página
   sobrou um `mascaraValorInput($('fValor'))` no meio de funções utilitárias,
   longe das 500 linhas removidas. A sintaxe estava perfeita e o `checar-form`
   passava verde — o app não abriria.

   Ids criados em tempo de execução (`innerHTML` com `id=`) também contam, por
   isso a varredura olha as duas formas de escrever. */
const idsNaMarcacao = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsDinamicos = new Set(
  [...html.matchAll(/id=\\?'([a-zA-Z][\w-]*)\\?'/g)].map((m) => m[1]),
);
const pedidos = new Map();
for (const m of html.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  if (!pedidos.has(m[1])) pedidos.set(m[1], html.slice(0, m.index).split('\n').length);
}
for (const [id, linha] of pedidos) {
  if (idsNaMarcacao.has(id) || idsDinamicos.has(id)) continue;
  erros++;
  console.error(
    `FALHA  linha ${linha}: $('${id}') não existe na marcação.\n` +
      `       Devolve null, e o uso seguinte derruba o app inteiro na carga.`,
  );
}

// Toda chamada ao backend passa pelo shim de `google.script.run`. Se o número cair
// sem que uma feature tenha saído, alguma virou `fetch` solto e escapou da rota
// única de RPC — que é onde vive a allowlist de métodos.
const chamadas = (html.match(/google\.script\.run/g) ?? []).length;

console.log(
  `${blocos.length} bloco(s) <script> · ${erros} problema(s) · ` +
    `${pedidos.size} ids pedidos, todos presentes · ${chamadas} chamadas a google.script.run`,
);
process.exit(erros > 0 ? 1 : 0);

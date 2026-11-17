/**
 * Toda rota tem que ter porta de entrada.
 *
 * O DEFEITO QUE ORIGINOU ISTO
 *
 * Em 22/10/2026 o Lançar saiu do `Form.html` para React (9e55922). A navegação
 * de baixo passou a mandar para `/lancar`, e a tela antiga `screen-new` virou
 * código morto — levando junto o único botão que apontava para `/importar`.
 *
 * A rota `/importar` nunca quebrou. Continuou respondendo 200, renderizando,
 * importando. Simplesmente deixou de ter caminho até ela, e o app passou quase
 * um mês sem importação de fatura sem que nada acusasse.
 *
 * POR QUE NENHUMA OUTRA CAMADA PEGA
 *
 * Esta é a diferença que dá sentido ao script: **todas as outras checagens
 * provam que o destino existe, e o que sumiu foi o caminho.** `npm run build`
 * listou `/importar` alegremente nos dois lados do commit. O typecheck não tem
 * o que reclamar: ninguém escreveu nada errado, apenas pararam de escrever.
 * Os invariantes olham o banco, e o banco estava perfeito. Um teste de tela
 * que navegasse direto para `/importar` passaria — e é justamente o que um
 * humano não consegue fazer no celular, onde não há barra de endereço.
 *
 * Falha por AUSÊNCIA não aparece em nenhuma verificação que parte do que
 * existe. Só aparece quando alguém enumera o que deveria existir.
 *
 * Uso: node scripts/checar-rotas.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const APP = path.join(RAIZ, 'src', 'app');

/** Rotas que de propósito não têm link — a porta delas é outra coisa. */
const SEM_LINK_DE_PROPOSITO = new Map([
  ['/entrar', 'o middleware redireciona para cá; link seria redundante'],
]);

function arquivos(dir, filtro, achados = []) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (nome === 'node_modules' || nome === '.next') continue;
    if (statSync(p).isDirectory()) arquivos(p, filtro, achados);
    else if (filtro(nome)) achados.push(p);
  }
  return achados;
}

/** `src/app/(app)/serie/[id]/editar/page.tsx` → `/serie/[id]/editar` */
function rotaDe(arquivo) {
  const rel = path.relative(APP, path.dirname(arquivo));
  const partes = rel
    .split(path.sep)
    .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
  return '/' + partes.join('/');
}

const paginas = arquivos(APP, (n) => n === 'page.tsx').map(rotaDe).sort();

// Onde um link pode estar: qualquer .tsx do app, e o Form.html, que ainda é a
// tela inicial e portanto ainda é porta de entrada legítima.
const fontes = [
  ...arquivos(path.join(RAIZ, 'src'), (n) => n.endsWith('.tsx') || n.endsWith('.ts')),
  path.join(RAIZ, 'public', 'Form.html'),
];

const conteudo = new Map(fontes.map((f) => [f, readFileSync(f, 'utf8')]));

/* A `screen-new` do `Form.html` foi aposentada em 17/11/2026, e o recorte que a
   ignorava saiu daqui junto com ela. Fica o registro do porquê existiu: aquela
   tela hospedava o único link para `/importar`, e contá-la dava um
   "ok /importar ← public/Form.html" num app onde a importação só era alcançável
   por um botão escrito "Quitar".

   A lição, caso o padrão volte: este script responde "existe link", e isso é
   mais fraco que "alguém acha". Um link dentro de tela que ninguém procura
   passa por aqui e não serve para nada — nenhuma verificação estática fecha
   essa distância, só abrir o app e tentar. */



/**
 * Um link para esta rota, escrito de qualquer um dos jeitos que o projeto usa:
 * `href="/x"`, `'/x'`, `location.href = '/x'`, ou o template `` `/x/${id}` ``
 * para as dinâmicas. Procurar a rota como texto é frouxo de propósito: um
 * falso positivo aqui só deixa de acusar algo, e acusar errado é pior — um
 * relatório que grita por engano é um relatório que ninguém lê.
 */
function temPorta(rota, menos) {
  const base = rota.replace(/\/\[[^\]]+\]/g, ''); // /serie/[id]/editar → /serie/editar
  const prefixo = rota.split('/[')[0]; // /serie/[id]/editar → /serie
  const alvos = rota.includes('[') ? [`${prefixo}/`] : [`'${rota}'`, `"${rota}"`, `${rota}"`, `${rota}'`];

  for (const [arquivo, texto] of conteudo) {
    if (arquivo === menos) continue;
    if (dentroDaRota(arquivo, rota)) continue;
    for (const alvo of alvos) if (texto.includes(alvo)) return path.relative(RAIZ, arquivo);
  }
  void base;
  return null;
}

/**
 * O arquivo mora DENTRO da própria rota (ou de uma filha dela)?
 *
 * Este recorte é o que faz a checagem valer alguma coisa. Sem ele, a tela que
 * tem um "voltar" para a mãe contava como porta de entrada da mãe — e a mãe
 * podia estar tão inalcançável quanto a filha. Um link só é porta se vem de FORA.
 */
function dentroDaRota(arquivo, rota) {
  const segmentos = rota.split('/').filter(Boolean);
  if (!segmentos.length) return false;
  const rel = path.relative(APP, arquivo);
  if (rel.startsWith('..')) return false; // Form.html e companhia
  const pastas = path
    .dirname(rel)
    .split(path.sep)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return segmentos.every((seg, i) => pastas[i] === seg);
}

let orfas = 0;
console.log(`${paginas.length} rotas\n`);
for (const rota of paginas) {
  const desculpa = SEM_LINK_DE_PROPOSITO.get(rota);
  if (desculpa) {
    console.log(`  –    ${rota.padEnd(28)} sem link de propósito — ${desculpa}`);
    continue;
  }
  const porta = temPorta(rota);
  if (porta) {
    console.log(`  ok   ${rota.padEnd(28)} ← ${porta}`);
  } else {
    orfas++;
    console.log(`  ÓRFÃ ${rota.padEnd(28)} nenhuma tela leva até aqui`);
  }
}

console.log();
if (orfas) {
  console.error(
    `FALHA  ${orfas} rota(s) sem porta de entrada.\n` +
      `       A tela existe e responde — ninguém consegue chegar nela pelo app.\n` +
      `       No celular não há barra de endereço: sem link, a tela não existe.`,
  );
  process.exit(1);
}
console.log('Todas as rotas têm porta de entrada.');

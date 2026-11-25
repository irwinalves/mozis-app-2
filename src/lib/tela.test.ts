/**
 * Os quatro defeitos de 18/11/2026, virados em teste.
 *
 * Todos foram achados por RELATO, não por verificação — e todos são da mesma
 * família: o app renderiza, o typecheck passa, os invariantes do banco passam,
 * e a tela mente. O que eles têm em comum é que a prova não está no dado nem
 * no tipo, está na FORMA do front. Então é a forma do front que estes testes
 * leem, do mesmo jeito que `contrato.test.ts` lê o payload.
 *
 * Teste de forma é frágil de propósito: se alguém reescrever o trecho, ele
 * quebra e obriga a reler a regra. É melhor do que não ter nada avisando.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { iniciaisDe } from '@/components/Avatar';
import { partesDe } from '@/components/DivisaoEPagador';

const ler = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), 'utf8');

const FORM = ler('public', 'Form.html');
const IMPORTADOR = ler('src', 'app', '(app)', 'importar', 'Importador.tsx');
const LINHA = ler('src', 'components', 'LinhaLancamento.tsx');
const API = ler('src', 'lib', 'api.ts');

/** Todo arquivo de código sob `src/`, caminho relativo à raiz do projeto. */
function arquivosDeCodigo(dir = 'src'): string[] {
  const fora: string[] = [];
  for (const e of readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) fora.push(...arquivosDeCodigo(rel));
    // Os próprios testes ficam de fora: este arquivo cita a cor para procurá-la.
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) fora.push(rel);
  }
  return fora;
}

// ---------------------------------------------------------------------------
// 1. A marca do dono identifica o dono
// ---------------------------------------------------------------------------

test('iniciais distinguem os donos que não têm foto', () => {
  assert.equal(iniciaisDe('Avô da Maria'), 'AM');
  assert.equal(iniciaisDe('Mãe do Irwin'), 'MI');
  // Sem tirar as preposições os dois dariam 'AD' e 'MD' — letras que não
  // distinguem ninguém, que é o defeito de novo com outra roupa.
  assert.notEqual(iniciaisDe('Avô da Maria'), iniciaisDe('Mãe do Irwin'));
});

test('a foto do André só aparece quando o dono é o André', () => {
  /* O defeito: `x.gastoDe ? <foto do André>` — qualquer dono virava a foto
     dele, com o nome do outro no `title`. O olho acredita na foto. */
  assert.ok(
    /if \(nome === 'André'\)/.test(FORM),
    'Form.html: a marca do dono voltou a não comparar com o nome',
  );
  assert.ok(
    !/gastoDe\s*\n?\s*\?\s*'<img class="tag-andre"/.test(FORM),
    'Form.html: a foto do André voltou a ser escolhida só por ter dono',
  );
  assert.ok(
    !/quem="André"/.test(LINHA),
    'LinhaLancamento: a foto do André voltou a ser fixa, independente do dono',
  );
});

// ---------------------------------------------------------------------------
// 2. A paginação carrega o mesmo filtro da primeira página
// ---------------------------------------------------------------------------

test('"Ver mais" pede a próxima página COM o filtro', () => {
  const chamadas = [...FORM.matchAll(/\.ultimosLancamentos\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(chamadas.length >= 2, 'esperava ao menos duas chamadas a ultimosLancamentos');
  for (const args of chamadas) {
    assert.ok(
      /FILTROS\s*$/.test(args.trim()),
      `ultimosLancamentos(${args}) sem FILTROS — a página seguinte traz linhas de fora ` +
        'do filtro, no offset da lista filtrada: fora de ordem e fora da janela',
    );
  }
});

// ---------------------------------------------------------------------------
// 3. O filtro sobrevive à navegação
// ---------------------------------------------------------------------------

test('o filtro é guardado e relido, não vive só na memória', () => {
  /* Abrir um lançamento sai do Form.html para uma página React; voltar
     recarrega esta página do zero. Enquanto FILTROS era só `let`, o filtro
     morria em toda edição. */
  assert.ok(
    /let FILTROS = filtrosGuardados\(\)/.test(FORM),
    'FILTROS voltou a nascer só do padrão — o filtro morre ao navegar',
  );
  const i = FORM.indexOf('function aplicarFiltros()');
  assert.ok(i > 0, 'aplicarFiltros sumiu');
  assert.ok(
    FORM.slice(i, i + 400).includes('guardarFiltros()'),
    'aplicarFiltros parou de guardar — o filtro volta a morrer ao navegar',
  );
});

// ---------------------------------------------------------------------------
// 4. A lista de divisões existe UMA vez, e tem `De fora`
// ---------------------------------------------------------------------------

test('o servidor não serve uma segunda lista de divisões', () => {
  /* Eram duas: a canônica em `DivisaoEPagador`, com `De fora`, e esta, sem.
     Divergiram, e as telas que liam daqui ficaram sem como marcar gasto de
     terceiro. */
  assert.ok(
    !/^\s*divisoes:\s*\[/m.test(API),
    'api.ts voltou a declarar uma lista de divisões — a canônica é DIVISOES',
  );
});

test('a revisão de fatura oferece a lista canônica', () => {
  assert.ok(
    /import \{[^}]*\bDIVISOES\b[^}]*\} from '@\/components\/DivisaoEPagador'/.test(IMPORTADOR),
    'o Importador parou de usar DIVISOES',
  );
  assert.ok(
    !/opcoes\.divisoes/.test(IMPORTADOR),
    'o Importador voltou a ler a lista servida pelo servidor',
  );
});

test('a linha inteira da fatura pode ser De fora, não só o pedaço', () => {
  /* Antes, marcar "este gasto é da mãe do Irwin" obrigava a DIVIDIR uma linha
     que tem um dono só. Os dois campos precisam ir no payload da linha
     inteira, senão a escolha da tela não chega ao banco. */
  const i = IMPORTADOR.indexOf('    return [\n      {\n        ...base,');
  assert.ok(i > 0, 'o payload da linha inteira mudou de forma');
  const corpo = IMPORTADOR.slice(i, IMPORTADOR.indexOf('    ];', i));
  for (const campo of ['deFora', 'gastoDe']) {
    assert.ok(
      corpo.includes(`${campo}:`),
      `a linha inteira não manda \`${campo}\` — a escolha da tela não chega ao banco`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. A revisão de fatura é o MESMO formulário do Lançar, reduzido
// ---------------------------------------------------------------------------

test('`De fora` zera as DUAS partes, não só a do Irwin', () => {
  /* O erro que isto pega: calcular a parte do Irwin e tirar do total. Com
     `De fora` a do Irwin é zero, então a subtração dá o total inteiro para a
     Maria — e a tela afirmava que um gasto de terceiro era todo dela. */
  assert.deepEqual(partesDe(90, 'De fora', true, 0.55), { irwin: 0, maria: 0 });
  assert.deepEqual(partesDe(90, '50/50', true, 0.55), { irwin: 0, maria: 0 });
  // E o caminho normal continua somando o total.
  assert.deepEqual(partesDe(90, '50/50', false, 0.55), { irwin: 45, maria: 45 });
  assert.deepEqual(partesDe(90, '100% Maria', false, 0.55), { irwin: 0, maria: 90 });
  const renda = partesDe(100, 'Renda', false, 0.55);
  assert.equal(renda.irwin + renda.maria, 100, 'as partes têm que somar o total');
});

test('a cor da categoria mora num lugar só', () => {
  /* A mesma cor aparece no chip do Lançar, no chip da fatura, na bolinha da
     lista e na fatia do gráfico. Duas cópias desalinhariam o relatório do
     formulário, e seria invisível de dentro de cada arquivo (A26). */
  const fora = arquivosDeCodigo().filter(
    (f) => f !== path.join('src', 'lib', 'cores.ts') && ler(f).includes('#2F5597'),
  );
  assert.deepEqual(fora, [], 'a paleta de categorias foi copiada para fora de src/lib/cores.ts');
});

test('a revisão de fatura veste o formulário do Lançar, não uma cópia dele', () => {
  const css = ler('src', 'app', 'globals.css');
  /* Toda regra DESCENDENTE de `.form-lanc` vale também dentro de
     `.campos-lanc`. Uma que fique só no Lançar é um ajuste que a tela da
     fatura não recebe — e a divergência começa aí. */
  const sozinhas = css.split('\n').filter((l) => /^\.form-lanc [.[:]/.test(l));
  assert.deepEqual(
    sozinhas,
    [],
    'regra de formulário que só vale no Lançar: use :is(.form-lanc, .campos-lanc)',
  );
  assert.ok(
    IMPORTADOR.includes('className="campos-lanc"'),
    'a revisão de fatura parou de vestir o formulário do Lançar',
  );
});

test('campo, select e botão ao lado fecham a mesma moldura', () => {
  /* O defeito que isto pega: `line-height: normal` deixa cada tipo de campo
     calcular a própria altura. Medido na tela da fatura antes da correção:
     texto 41px, data 43px, select 43px, botão 42px — quatro alturas na mesma
     tela. Nada disso quebra build, typecheck ou invariante de banco (C12). */
  const css = ler('src', 'app', 'globals.css')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .replace(/;\}/g, '}');

  assert.ok(css.includes('--alt-campo:42px'), 'o token da altura de campo sumiu');
  assert.ok(
    css.includes(
      "input[type='text'],input[type='number'],input[type='date'],select{height:var(--alt-campo)}",
    ),
    'os campos em moldura pararam de tirar a altura do token',
  );
  const base = /textarea\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(
    base.includes('line-height:20px'),
    'sem line-height explícito cada campo volta a calcular a própria altura',
  );

  const andre = /\.btn-andre\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(andre.includes('height:var(--alt-campo)'), 'o botão do André saiu do token');
  assert.ok(
    !/height:\d/.test(andre),
    'altura em pixel no botão do André: repetida, ela diverge no primeiro ajuste',
  );
});

test('o seletor que remarca em bloco não existe na tela de reabrir', () => {
  /* A armadilha que isto pega (C15): marcado quer dizer "vai ser criado" numa
     importação nova e "está lançado no banco" ao reabrir um lote. O mesmo
     atalho que poupa 42 toques na primeira apagaria 44 lançamentos na segunda,
     em um toque. Nada no typecheck nem no banco acusaria. */
  // O rótulo do campo, não a palavra solta: ela também aparece no comentário
  // que explica a guarda, e ancorar nele mediria o texto errado.
  const i = IMPORTADOR.indexOf('<span>Marcar as de</span>');
  assert.ok(i > 0, 'o seletor de marcar por dono sumiu da revisão de fatura');
  const antes = IMPORTADOR.slice(Math.max(0, i - 400), i);
  assert.ok(
    /\{!edicao && \(/.test(antes),
    'o seletor de marcar por dono perdeu a guarda `!edicao` e voltou à tela de reabrir',
  );
  // E o filtro de ver continua valendo nas duas: ele não grava nada.
  assert.ok(IMPORTADOR.includes('setFiltroDono'), 'o filtro de dono sumiu');
});

test('data e pagador da fatura não viram campo', () => {
  /* C16. O `input[type=date]` da linha foi trocado por leitura com cadeado, e
     os chips de pagador só voltam quando o nome no cartão não bateu com
     ninguém — sem pagador a gravação é recusada (A4), e um campo travado em
     branco deixaria a fatura impossível de fechar. */
  assert.ok(
    !/dataEditada: ev\.target\.value/.test(IMPORTADOR),
    'a data da linha da fatura voltou a ser editável',
  );
  assert.ok(
    /\{e\.quemPagou \? \(/.test(IMPORTADOR),
    'o pagador da linha da fatura deixou de ser travado quando a fatura o resolve',
  );
  assert.ok(
    /não bateu com\s+ninguém/.test(IMPORTADOR),
    'sumiu a saída para a linha cujo nome no cartão não bateu com ninguém',
  );
});

test('o que sobrou do ciclo não acusa o que o próprio lote lançou', () => {
  /* C18. Ao reabrir um lote, as linhas que ELE MESMO lançou estão no ciclo e
     nenhuma linha da fatura as "reclama" — o cruzamento só casa com o que já
     existia antes. Sem tirar o lote, elas apareceriam como não explicadas,
     sendo as mais explicadas de todas. Foi exatamente o erro da primeira
     medição: "Lavatudovip 1/6" parecia um gasto esquecido e era uma parcela
     que a própria importação tinha criado. */
  assert.match(
    API,
    /importacao_id is distinct from \$\{lote\}/,
    'sobrasDoCiclo parou de excluir os lançamentos do próprio lote',
  );
  // E a janela vem das linhas À VISTA: parcelada carrega a data da compra
  // original e esticaria o ciclo por meses.
  assert.match(
    IMPORTADOR,
    /\.filter\(\(l\) => !l\.parcela\)/,
    'o ciclo voltou a contar as parceladas, que esticam a janela até a data da compra',
  );
});

test('o topo do painel fala do último mês fechado', () => {
  /* C19. "Este mês" nunca está fechado: em 20/11 o topo dava
     pouco mais da metade da variável de outubro, e parecia economia. */
  assert.match(FORM, /\$\('valVarMes'\)\.textContent = brl\(f\.variavel\)/, 'o topo deixou de ler o mês fechado');
  assert.doesNotMatch(FORM, />Fixo este mês</, 'o rótulo "este mês" voltou');
  // O período nasce na declaração: o boot carrega o painel antes do bloco dele rodar.
  assert.match(
    FORM,
    /let FILTRO_DASH = \{[^}]*preset: '3m'[^}]*\};\s*\(function\(\)\{ const j = janelaPreset\('3m'\)/,
    'o período deixou de nascer preenchido na declaração de FILTRO_DASH',
  );
  // O anualizado para no último mês fechado, como o topo.
  assert.match(
    API,
    /as meses\s+\$\{base\} and data <= \$\{fechado\.fim\}/,
    'o anualizado voltou a contar o mês em andamento',
  );
});

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
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { iniciaisDe } from '@/components/Avatar';

const ler = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), 'utf8');

const FORM = ler('public', 'Form.html');
const IMPORTADOR = ler('src', 'app', '(app)', 'importar', 'Importador.tsx');
const LINHA = ler('src', 'components', 'LinhaLancamento.tsx');
const API = ler('src', 'lib', 'api.ts');

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

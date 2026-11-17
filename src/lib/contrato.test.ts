/**
 * Teste de CONTRATO entre o front e a API.
 *
 * Existe por causa de um bug real: a API lia `dados.categoria` enquanto o front
 * mandava `grupo`, e gravar recusava com "Escolha a categoria" mesmo com a
 * categoria escolhida na tela. Os testes de então usavam OS NOMES DA API, então
 * eram incapazes de pegar isso — passavam com o app quebrado.
 *
 * A diferença aqui: os nomes são extraídos do FRONT REAL. Se o front mudar um
 * campo, este teste quebra sem que ninguém precise lembrar dele.
 *
 * O front dos lançamentos mudou de casa em 17/11/2026: era o `coletarLanc` do
 * `Form.html`, hoje é o objeto `campos` do `FormLancamento.tsx`. A mudança
 * valida o teste em vez de enfraquecê-lo — ele quebrou sozinho na hora em que a
 * função sumiu, que é exatamente o serviço que se espera dele. O `Form.html`
 * segue sendo a fonte para o investimento, que ainda mora lá.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FORM = readFileSync(path.join(process.cwd(), 'public', 'Form.html'), 'utf8');
const LANC = readFileSync(
  path.join(process.cwd(), 'src', 'components', 'FormLancamento.tsx'),
  'utf8',
);

/** Chaves de nível 1 do objeto `campos`, que é o payload do lançamento. */
function chavesDoPayload(): string[] {
  const i = LANC.indexOf('const campos = {');
  assert.ok(i > 0, '`const campos` não encontrado no FormLancamento.tsx');
  const abre = LANC.indexOf('{', i);
  const fecha = LANC.indexOf('\n    };', abre);
  assert.ok(fecha > abre, 'não achei o fim do objeto `campos`');
  const corpo = LANC.slice(abre + 1, fecha);
  /* Só o que estiver no COMEÇO da linha — ignora chamadas aninhadas e os
     ternários, que levam `?` e `:` no meio.

     O `[,:]` é obrigatório e custou uma rodada: em TSX metade dos campos é
     shorthand (`data,`) e metade é nomeada (`grupo: categoria`). Exigir `:`
     deixava `data` e `tipoValor` de fora e o teste acusava o front de ter
     parado de mandá-los.

     Flag `m`: sem ela o `^` só casaria o começo do trecho e o PRIMEIRO campo
     ficaria de fora — que foi o que aconteceu na primeira versão deste teste. */
  return [...corpo.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*[,:]/gm)].map((m) => m[1]);
}

test('o front manda `grupo`, não `categoria`', () => {
  const chaves = chavesDoPayload();
  assert.ok(chaves.includes('grupo'), 'o front deixou de mandar `grupo`');
  assert.ok(
    !chaves.includes('categoria'),
    'o front passou a mandar `categoria` — a API precisa acompanhar',
  );
});

test('criar e editar mandam os MESMOS campos', () => {
  // Não é preciosismo: as duas listas já existiram escritas à mão, lado a lado.
  // Enquanto forem o mesmo objeto, não há como uma receber um campo e a outra
  // não — que é o defeito que fez o `De fora` existir no Lançar e sumir na
  // edição.
  assert.ok(
    /rpc\('salvarLancamento', \{\s*\.\.\.campos,/.test(LANC),
    'criar deixou de partir de `...campos` — as duas portas podem divergir de novo',
  );
  assert.ok(
    /rpc\('atualizarLancamento', ed\.linha, campos\)/.test(LANC),
    'editar deixou de mandar `campos`',
  );
});

test('todos os campos que a API consome estão presentes', () => {
  const chaves = new Set(chavesDoPayload());
  // Cada um destes é lido em salvarLancamento/atualizarLancamento. Se o front
  // renomear qualquer um, o efeito é silencioso — o campo chega undefined.
  for (const campo of [
    'data', 'valor', 'descricao', 'grupo', 'tipo', 'fonte', 'quemPagou',
    'gastoDe', 'pagoIrwin', 'divisao', 'pctIrwinCustom',
  ]) {
    assert.ok(chaves.has(campo), `o front deixou de mandar \`${campo}\``);
  }
});

/** Os campos do parcelamento/recorrência só existem ao CRIAR, nunca ao editar:
 *  editar uma linha não reparcela a compra — para isso existe a tela da série. */
test('ao criar, os campos de parcelamento e recorrência vão junto', () => {
  const i = LANC.indexOf("rpc('salvarLancamento'");
  assert.ok(i > 0);
  const corpo = LANC.slice(i, LANC.indexOf('});', i));
  for (const campo of [
    'parcelado', 'parcelas', 'tipoValor', 'repetir', 'freqRec', 'fimRec', 'semFimRec',
  ]) {
    assert.ok(
      new RegExp('^\\s*' + campo + '\\s*[,:]', 'm').test(corpo),
      `o front deixou de mandar \`${campo}\` ao criar`,
    );
  }
});

test('investimento: o front manda `quem`, não `deQuem`', () => {
  // Não é função nomeada — é um literal dentro do onclick do botão.
  const i = FORM.indexOf("$('btnSalvarInvest').onclick");
  assert.ok(i > 0);
  const corpo = FORM.slice(i, i + 400);
  assert.ok(/\bquem\s*:/.test(corpo), 'o front deixou de mandar `quem`');
  assert.ok(/\bconta\s*:/.test(corpo) && /\bmovimento\s*:/.test(corpo));
  assert.ok(!/\bdeQuem\s*:/.test(corpo), 'o front passou a mandar `deQuem`');
});

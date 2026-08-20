/**
 * Teste de CONTRATO entre o front e a API.
 *
 * Existe por causa de um bug real: a API lia `dados.categoria` enquanto o front
 * mandava `grupo`, e gravar recusava com "Escolha a categoria" mesmo com a
 * categoria escolhida na tela. Os testes de então usavam OS NOMES DA API, então
 * eram incapazes de pegar isso — passavam com o app quebrado.
 *
 * A diferença aqui: os nomes são extraídos do `Form.html` REAL. Se o front
 * mudar um campo, este teste quebra sem que ninguém precise lembrar dele.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FORM = readFileSync(path.join(process.cwd(), 'public', 'Form.html'), 'utf8');

/** Chaves de nível 1 do objeto literal devolvido por uma função do front. */
function chavesDoPayload(nomeFuncao: string): string[] {
  const i = FORM.indexOf(`function ${nomeFuncao}(`);
  assert.ok(i > 0, `função ${nomeFuncao} não encontrada no Form.html`);
  const trecho = FORM.slice(i, i + 1200);
  const abre = trecho.indexOf('{', trecho.indexOf('return'));
  const fecha = trecho.indexOf('\n  };', abre);
  const corpo = trecho.slice(abre + 1, fecha);
  // Só o que estiver no começo de um "campo:" — ignora chamadas aninhadas.
  // Flag `m`: sem ela o `^` só casaria o começo do trecho e o PRIMEIRO campo
  // ficaria de fora — que foi o que aconteceu na primeira versão deste teste.
  return [...corpo.matchAll(/(?:^|[,{])\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]);
}

test('coletarLanc: o front manda `grupo`, não `categoria`', () => {
  const chaves = chavesDoPayload('coletarLanc');
  assert.ok(chaves.includes('grupo'), 'o front deixou de mandar `grupo`');
  assert.ok(
    !chaves.includes('categoria'),
    'o front passou a mandar `categoria` — a API precisa acompanhar',
  );
});

test('coletarLanc: todos os campos que a API consome estão presentes', () => {
  const chaves = new Set(chavesDoPayload('coletarLanc'));
  // Cada um destes é lido em salvarLancamento/atualizarLancamento. Se o front
  // renomear qualquer um, o efeito é silencioso — o campo chega undefined.
  for (const campo of [
    'data', 'valor', 'descricao', 'grupo', 'tipo', 'fonte', 'quemPagou',
    'pagoIrwin', 'divisao', 'pctIrwinCustom',
    'parcelas', 'tipoValor', 'repetir', 'freqRec', 'fimRec', 'semFimRec',
  ]) {
    assert.ok(chaves.has(campo), `o front deixou de mandar \`${campo}\``);
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

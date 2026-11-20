/**
 * A sugestão que aprende do histórico.
 *
 * Os casos aqui são os que a base real produziu, não hipóteses: `araujo` com
 * maioria em `7 Outros`, `ifd` como prefixo que a fatura usa, `uber` que a
 * palavra-chave `uber/99` nunca pegava.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { montarIndice, sugerirPorHistorico, termosDe } from './aprendizado';

const linha = (descricao: string, categoria: string) => ({ descricao, categoria });
const vezes = (n: number, descricao: string, categoria: string) =>
  Array.from({ length: n }, () => linha(descricao, categoria));

test('o termo sai da descrição como a fatura escreve', () => {
  /* `Ifd*Inconfidentes` precisa virar `ifd`: é o prefixo que a fatura usa, e é
     por ele que a linha é reconhecível. Acento não separa termo. */
  assert.deepEqual(termosDe('Ifd*Inconfidentes'), ['ifd', 'inconfidentes']);
  assert.deepEqual(termosDe('Pão de Queijo 2/3'), ['pao', 'queijo']);
  // Fora: uma e duas letras casam com meio mundo; número é parcela ou data.
  assert.deepEqual(termosDe('Uber * 99 Sp'), ['uber']);
});

test('`7 Outros` não vota, e por isso não entra no índice', () => {
  /* O caso `araujo` da base real: 49 em Outros, 7 em Comida, 7 em Saúde.
     Aprendendo cru, o índice devolveria `7 Outros` com 78% de confiança — ele
     aprenderia a NÃO categorizar, e com cara de certeza. */
  const idx = montarIndice([
    ...vezes(49, 'Araujo', '7 Outros'),
    ...vezes(7, 'Araujo', '3 Comida'),
    ...vezes(7, 'Araujo', '4 Saúde'),
  ]);
  const m = idx.get('araujo');
  assert.ok(m, 'o termo sumiu do índice');
  assert.equal(m.get('7 Outros'), undefined, '`7 Outros` entrou no índice');
  // 7 a 7 entre Comida e Saúde: 50% de confiança não chega ao mínimo.
  assert.equal(sugerirPorHistorico('Araujo Loja', idx), null);
});

test('investimento e acerto também ficam fora', () => {
  const idx = montarIndice([
    ...vezes(5, 'Aporte XP', '8 Investimentos'),
    ...vezes(5, 'Quitação', '9 Acerto de Contas'),
  ]);
  assert.equal(idx.size, 0, 'categoria que não é despesa entrou no índice');
});

test('o nome da loja decide, mesmo contra um termo mais frequente', () => {
  /* `sao` aparece em todo lugar e não decide nada; `ifood` decide. Ganha
     quem tem MAIS CONFIANÇA, não quem aparece mais vezes. */
  const idx = montarIndice([
    ...vezes(12, 'Ifood Sao Paulo', '3 Comida'),
    ...vezes(40, 'Loja Sao Paulo', '5 Lazer & Pessoal'),
    ...vezes(40, 'Posto Sao Paulo', '2 Carro'),
  ]);
  assert.equal(sugerirPorHistorico('Ifood*Sao Paulo Br', idx), '3 Comida');
});

test('termo raro não tem voz', () => {
  const idx = montarIndice(vezes(2, 'Vivara', '5 Lazer & Pessoal'));
  assert.equal(sugerirPorHistorico('Vivara BH', idx), null, 'duas vezes já bastou');
  const idx3 = montarIndice(vezes(3, 'Vivara', '5 Lazer & Pessoal'));
  assert.equal(sugerirPorHistorico('Vivara BH', idx3), '5 Lazer & Pessoal');
});

test('maioria apertada não sugere', () => {
  /* 3 a 2 é 60% e passa; 3 a 3 é 50% e não passa. A linha fica sem palpite em
     vez de receber um chute — na revisão, palpite errado custa mais caro que
     palpite nenhum, porque ele parece resposta. */
  const apertada = montarIndice([
    ...vezes(3, 'Amazon', '1 Casa'),
    ...vezes(2, 'Amazon', '3 Comida'),
  ]);
  assert.equal(sugerirPorHistorico('Amazon', apertada), '1 Casa');
  const empate = montarIndice([
    ...vezes(3, 'Amazon', '1 Casa'),
    ...vezes(3, 'Amazon', '3 Comida'),
  ]);
  assert.equal(sugerirPorHistorico('Amazon', empate), null);
});

test('descrição desconhecida devolve null, e quem chama cai na palavra-chave', () => {
  const idx = montarIndice(vezes(9, 'Japa', '3 Comida'));
  assert.equal(sugerirPorHistorico('Acgibare Belo Horizont Br', idx), null);
});

test('o mesmo termo repetido numa descrição é um voto só', () => {
  /* Sem isto, `Japa Japa Japa` valeria por três e inflaria a confiança de um
     nome que apareceu uma vez. */
  const idx = montarIndice([linha('Japa Japa Japa', '3 Comida')]);
  assert.equal(idx.get('japa')?.get('3 Comida'), 1);
});

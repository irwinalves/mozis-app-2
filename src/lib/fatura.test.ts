import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFatura, pessoaDoNomeNoCartao } from './fatura';
import { cruzar, type ParcelaExistente, type LancamentoExistente } from './cruzamento';

/**
 * A matriz é o que o `exceljs` entrega depois de tirar o primeiro elemento
 * vazio: índice 0 = coluna A. Reproduz o layout REAL da fatura do Itaú, medido
 * no arquivo de ago/2026.
 */
function faturaFalsa(linhas: unknown[][]): unknown[][] {
  return [
    ['', 'Nome', 'Irwin Alves De Souza'],
    ['', 'Fatura Paga - Agosto/2026'],
    ['', 'Data', 'Lançamento', 'Parcelamento', 'Valor', '', 'Titularidade', 'Nome', 'Tipo do cartão', 'Número'],
    ...linhas,
  ];
}
const l = (data: string, desc: string, parc: string, valor: unknown, nome: string) =>
  ['', data, desc, parc, valor, '', 'Titular', nome, 'Físico', '****8607'];

// ---------------------------------------------------------------------------
// Leitura da fatura
// ---------------------------------------------------------------------------

test('acha o cabeçalho em vez de assumir a linha', () => {
  const r = lerFatura(faturaFalsa([l('2026-07-28', 'Hering', '', 141.58, 'Irwin Alves Souza')]));
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].descricao, 'Hering');
});

test('positivo é gasto e negativo é descartado, com o motivo', () => {
  const r = lerFatura(
    faturaFalsa([
      l('2026-07-06', 'Pagamento Efetuado', '', -13414.89, 'Irwin Alves Souza'),
      l('2026-07-10', 'Cancelamento De Compra', '', -53.78, 'Irwin Alves Souza'),
      l('2026-07-28', 'Hering', '', 141.58, 'Irwin Alves Souza'),
    ]),
  );
  assert.equal(r.linhas.length, 1);
  assert.equal(r.descartadas.length, 2);
  assert.equal(r.descartadas[0].motivo, 'pagamento da fatura');
  assert.equal(r.descartadas[1].motivo, 'estorno ou crédito');
});

test('`Parcela 8 de 12` vira posição e total', () => {
  const r = lerFatura(
    faturaFalsa([l('2025-12-18', 'Zurich Seguros', 'Parcela 8 de 12', 199.81, 'Irwin Alves Souza')]),
  );
  assert.deepEqual(r.linhas[0].parcela, { n: 8, de: 12 });
  // A data é a da COMPRA, não a da cobrança — é o que permite reconhecer a
  // série depois.
  assert.equal(r.linhas[0].data, '2025-12-18');
});

test('o rodapé da fatura não vira lançamento', () => {
  const r = lerFatura(
    faturaFalsa([
      l('2026-07-28', 'Hering', '', 141.58, 'Irwin Alves Souza'),
      ['', '', '', '', ''],
      ['', 'Importante saber', '', '', 0],
      ['', 'As compras recentes levam até 48 horas para aparecer…', '', '', 0],
    ]),
  );
  assert.equal(r.linhas.length, 1);
});

test('data vem como Date sem voltar um dia por fuso', () => {
  // O Excel guarda data como número e a biblioteca devolve `Date` em UTC.
  // Construir a partir da string traria o defeito da regra 6 para cá.
  const r = lerFatura(faturaFalsa([l('', 'X', '', 10, 'Irwin Alves Souza')]).map((linha, i) =>
    i === 3 ? ['', new Date(Date.UTC(2026, 6, 28)), 'X', '', 10, '', 'Titular', 'Irwin Alves Souza'] : linha,
  ));
  assert.equal(r.linhas[0].data, '2026-07-28');
});

test('sem cabeçalho, falha dizendo o que fazer', () => {
  assert.throws(() => lerFatura([['', 'qualquer', 'coisa']]), /cabeçalho da fatura/);
});

// ---------------------------------------------------------------------------
// Nome no cartão → pessoa
// ---------------------------------------------------------------------------

test('o primeiro nome identifica quem pagou', () => {
  assert.equal(pessoaDoNomeNoCartao('Irwin Alves Souza', ['Irwin', 'Maria']), 'Irwin');
  assert.equal(pessoaDoNomeNoCartao('Maria Menezes', ['Irwin', 'Maria']), 'Maria');
  // Sem correspondência não se inventa pagador: pela A4 a linha é recusada na
  // gravação até alguém escolher.
  assert.equal(pessoaDoNomeNoCartao('Fulano De Tal', ['Irwin', 'Maria']), null);
});

// ---------------------------------------------------------------------------
// Cruzamento
// ---------------------------------------------------------------------------

const serieSeguro: ParcelaExistente[] = [
  {
    lancamentoId: 26,
    serieId: 61,
    serieDescricao: 'Seguro Carro',
    seq: 8,
    total: 12,
    // A compra foi em 18/12; a 8ª parcela caiu em 20/07 no app.
    data: '2026-07-20',
    valor: 199.77,
  },
];

test('a parcela reconhece a série do app, mesmo com descrição diferente', () => {
  const [c] = cruzar(
    [{ data: '2025-12-18', descricao: 'Zurich Seguros', parcela: { n: 8, de: 12 }, valor: 199.81 }],
    serieSeguro,
    [],
  );
  assert.equal(c.situacao.tipo, 'jaLancado');
  assert.equal(c.situacao.tipo === 'jaLancado' && c.situacao.serieDescricao, 'Seguro Carro');
});

test('total diferente não casa, mesmo com valor e data iguais', () => {
  const [c] = cruzar(
    [{ data: '2025-12-18', descricao: 'Zurich', parcela: { n: 8, de: 10 }, valor: 199.81 }],
    serieSeguro,
    [],
  );
  assert.notEqual(c.situacao.tipo, 'jaLancado');
});

test('`Parcela 1 de N` desconhecida vira uma SÉRIE, não uma linha', () => {
  const [c] = cruzar(
    [{ data: '2026-07-28', descricao: 'Hering', parcela: { n: 1, de: 3 }, valor: 141.58 }],
    [],
    [],
  );
  assert.deepEqual(c.situacao, { tipo: 'novaSerie', parcelas: 3, primeira: '2026-07-28' });
});

test('parcela do meio sem série entra como linha única, sem inventar passado', () => {
  const [c] = cruzar(
    [{ data: '2025-01-10', descricao: 'Algo antigo', parcela: { n: 7, de: 10 }, valor: 50 }],
    [],
    [],
  );
  assert.equal(c.situacao.tipo, 'nova');
});

const avulsos: LancamentoExistente[] = [
  { id: 900, data: '2026-07-20', descricao: 'Gasolina', valor: 163.88 },
];

test('valor e data próximos viram SUSPEITA, nunca certeza', () => {
  const [c] = cruzar(
    [{ data: '2026-07-20', descricao: 'Posto Hugo Werneck', parcela: null, valor: 163.88 }],
    [],
    avulsos,
  );
  assert.equal(c.situacao.tipo, 'suspeita');
  assert.equal(c.situacao.tipo === 'suspeita' && c.situacao.descricao, 'Gasolina');
});

test('mesmo valor mas semanas depois não é suspeita', () => {
  const [c] = cruzar(
    [{ data: '2026-08-15', descricao: 'Posto Hugo Werneck', parcela: null, valor: 163.88 }],
    [],
    avulsos,
  );
  assert.equal(c.situacao.tipo, 'nova');
});

test('a folga de data cresce com a posição da parcela', () => {
  // Onze somas de mês afastam a data da compra da data gravada; com folga
  // fixa, a parcela 11 nunca casaria.
  const [c] = cruzar(
    [{ data: '2025-09-08', descricao: 'Leiturinha', parcela: { n: 11, de: 12 }, valor: 72.9 }],
    [
      {
        lancamentoId: 1, serieId: 2, serieDescricao: 'Leiturinha', seq: 11, total: 12,
        data: '2026-07-25', valor: 72.9,
      },
    ],
    [],
  );
  assert.equal(c.situacao.tipo, 'jaLancado');
});

/**
 * Leitura da fatura de cartão exportada pelo Itaú.
 *
 * POR QUE UM PARSER PRÓPRIO, E NÃO O DE EXTRATO
 *
 * O parser genérico de `importacao.ts` identifica campos por FORMATO, porque
 * exportação de banco não tem layout estável. A fatura tem — e tem muito mais:
 * ela já diz **de quem é o cartão** e **qual parcela é**, duas coisas que o
 * genérico teria de adivinhar e não conseguiria.
 *
 *   Data | Lançamento | Parcelamento | Valor | | Titularidade | Nome | Tipo | Nº
 *
 * Medido na fatura real de ago/2026: 153 linhas com data, 48 com
 * `Parcela N de M`, e **o Nome nunca vem vazio**. Jogar isso fora para usar um
 * parser que adivinha seria trocar certeza por heurística.
 *
 * O SINAL É AO CONTRÁRIO DO EXTRATO DE CONTA
 *
 * Aqui **positivo é gasto** e negativo é estorno, pagamento de fatura ou
 * redução — 9 das 155 linhas. No extrato de conta corrente é o oposto: o gasto
 * sai negativo. É por isso que a tela pergunta qual arquivo é qual, em vez de
 * tentar descobrir: aplicar a regra errada não dá erro, dá silêncio — e
 * descartaria exatamente tudo que interessa.
 *
 * A DATA É A DA COMPRA, NÃO A DA COBRANÇA
 *
 * Uma `Parcela 8 de 12` aparece com a data de dezembro, quando a compra foi
 * feita. Isso não é defeito: é o que permite reconhecer que aquela cobrança
 * pertence a uma série que o app já conhece.
 */
import type { Pessoa } from './pessoas';

export interface LinhaFatura {
  /** Data da COMPRA, em ISO. Numa parcelada, é a da compra original. */
  data: string;
  descricao: string;
  /** `Parcela 8 de 12` vira `{ n: 8, de: 12 }`. `null` quando é à vista. */
  parcela: { n: number; de: number } | null;
  valor: number;
  /** Do nome no cartão. `null` quando não bate com ninguém do elenco. */
  quemPagou: Pessoa | null;
  /** O nome como veio no arquivo, para a tela poder mostrar de onde saiu. */
  nomeCartao: string;
  cartao: string;
  /** Físico · Virtual recorrente · Virtual temporário. */
  tipoCartao: string;
}

export interface Descartada {
  linha: number;
  descricao: string;
  valor: number;
  motivo: string;
}

export interface ResultadoFatura {
  linhas: LinhaFatura[];
  descartadas: Descartada[];
  /** Soma dos gastos aceitos. É o número que a tela mostra antes de confirmar. */
  total: number;
}

const COL = { data: 1, descricao: 2, parcela: 3, valor: 4, titular: 6, nome: 7, tipo: 8, cartao: 9 };

const RE_PARCELA = /parcela\s+(\d+)\s+de\s+(\d+)/i;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const RE_BR = /^(\d{2})\/(\d{2})\/(\d{4})/;

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * A data pode chegar como `Date` (o Excel guarda como número de série e a
 * biblioteca converte) ou como texto. Fatiar a string em vez de construir
 * `Date` a partir dela é deliberado: `new Date('2026-08-20')` é interpretado
 * como UTC e em fuso negativo volta um dia — a mesma armadilha da regra 6, do
 * outro lado da junta.
 */
function paraIso(v: unknown): string | null {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(
      v.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const iso = RE_ISO.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = RE_BR.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function paraNumero(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[R$\s]/gi, '').trim();
  if (!s) return NaN;
  // O último separador é o decimal — vale para `1.234,56` e para `1,234.56`.
  const p = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const num = p === -1 ? s : s.slice(0, p).replace(/[.,]/g, '') + '.' + s.slice(p + 1);
  return Number(num);
}

/**
 * O nome no cartão vira pessoa pelo PRIMEIRO NOME.
 *
 * `Irwin Alves Souza` → Irwin, `Maria Menezes` → Maria. Comparar o nome
 * completo não serviria: o cartão traz `Irwin Alves Souza` e o app conhece
 * `Irwin`. Sem correspondência devolve `null`, e a linha entra na tela sem
 * pagador — que pela A4 é recusada na gravação até alguém escolher.
 */
export function pessoaDoNomeNoCartao(nome: string, conhecidas: readonly Pessoa[]): Pessoa | null {
  const primeiro = semAcento(nome).split(/\s+/)[0];
  return conhecidas.find((p) => semAcento(p) === primeiro) ?? null;
}

/**
 * Lê a matriz de células da fatura. Função PURA: recebe linhas de células e
 * devolve o resultado, sem tocar em arquivo. É o que permite testá-la sem um
 * `.xlsx` — o mesmo desenho dos parsers de OFX e CSV.
 *
 * `matriz[i][j]` é 0-based; a coluna A do arquivo é `j = 0`.
 */
export function lerFatura(
  matriz: unknown[][],
  conhecidas: readonly Pessoa[] = ['Irwin', 'Maria'],
): ResultadoFatura {
  // Acha o cabeçalho em vez de assumir a linha 14: o bloco de topo da fatura
  // muda de altura conforme o banco resolve incluir avisos.
  let inicio = -1;
  for (let i = 0; i < matriz.length; i++) {
    const linha = matriz[i] ?? [];
    const temData = semAcento(String(linha[COL.data] ?? '')) === 'data';
    const temLanc = semAcento(String(linha[COL.descricao] ?? '')) === 'lancamento';
    if (temData && temLanc) {
      inicio = i + 1;
      break;
    }
  }
  if (inicio === -1) {
    throw new Error(
      'Não encontrei o cabeçalho da fatura. Confira se o arquivo é a exportação do cartão.',
    );
  }

  const linhas: LinhaFatura[] = [];
  const descartadas: Descartada[] = [];

  for (let i = inicio; i < matriz.length; i++) {
    const l = matriz[i] ?? [];
    const data = paraIso(l[COL.data]);
    const descricao = String(l[COL.descricao] ?? '').replace(/\s+/g, ' ').trim();

    // Sem data válida é rodapé — a fatura termina com "Importante saber" e um
    // parágrafo de avisos. Parar no primeiro não serve: há uma linha em branco
    // antes dele.
    if (!data) continue;

    const valor = paraNumero(l[COL.valor]);
    if (!Number.isFinite(valor) || valor === 0) {
      descartadas.push({ linha: i + 1, descricao, valor: 0, motivo: 'sem valor' });
      continue;
    }
    if (valor < 0) {
      // Pagamento da fatura, estorno, cancelamento, redução de mensalidade.
      // Nenhum é gasto novo (A13) — e o pagamento da fatura em especial já está
      // representado pelas próprias compras dela.
      descartadas.push({
        linha: i + 1,
        descricao,
        valor,
        // `Pagamento Efetuado` numa fatura paga e `Pagamento Debito
        // Automatico` numa fatura aberta — o banco usa os dois. Reconhecer só
        // o primeiro fazia o pagamento de setembro, R$ 16.132,19, aparecer
        // como "estorno ou crédito". Os dois são descartados do mesmo jeito,
        // mas o MOTIVO é lido por quem olha a tela, e agora também por
        // `ligarEstornos`, que não pode procurar a compra que um pagamento de
        // fatura cancelaria — ele não cancela nenhuma, paga todas.
        motivo: /^pagamento\b/i.test(descricao) ? 'pagamento da fatura' : 'estorno ou crédito',
      });
      continue;
    }

    const mp = RE_PARCELA.exec(String(l[COL.parcela] ?? ''));
    const nomeCartao = String(l[COL.nome] ?? '').trim();

    linhas.push({
      data,
      descricao,
      parcela: mp ? { n: Number(mp[1]), de: Number(mp[2]) } : null,
      valor,
      quemPagou: pessoaDoNomeNoCartao(nomeCartao, conhecidas),
      nomeCartao,
      cartao: String(l[COL.cartao] ?? '').trim(),
      tipoCartao: String(l[COL.tipo] ?? '').trim(),
    });
  }

  return {
    linhas,
    descartadas,
    total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100,
  };
}

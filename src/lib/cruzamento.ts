/**
 * O cruzamento entre a fatura e o que o app já tem.
 *
 * É o que impede a importação de duplicar, e o que a torna usável: sem isto,
 * reimportar a fatura do mês seguinte — que sempre traz sobreposição — criaria
 * tudo de novo.
 *
 * A CHAVE FORTE É A PARCELA, NÃO O TEXTO
 *
 * A descrição nunca casa: a fatura diz `Zurich Seguros`, o app diz
 * `Seguro Carro`. Mas a fatura diz `Parcela 8 de 12` com a data da COMPRA, e o
 * app tem uma série de 12 parcelas que começou naquele mês. Isso identifica
 * sem ambiguidade, e é muito mais confiável que "mesmo valor, data ±3 dias".
 *
 * Para o que não é parcelado sobra a chave fraca — valor e data próxima — e
 * por isso ela nunca marca como certeza: marca como SUSPEITA, desmarcada, com
 * a linha existente ao lado. C7: onde é palpite, a tela diz que é palpite.
 *
 * Função pura, sem banco: recebe as linhas e os candidatos, devolve a
 * classificação. É o que permite testá-la sem montar uma base.
 */

export interface LinhaCruzavel {
  data: string;
  descricao: string;
  parcela: { n: number; de: number } | null;
  valor: number;
}

/** Uma parcela que já está no app, com a série a que pertence. */
export interface ParcelaExistente {
  lancamentoId: number;
  serieId: number;
  serieDescricao: string;
  seq: number;
  total: number;
  data: string;
  valor: number;
}

/** Um lançamento avulso, para a checagem fraca. */
export interface LancamentoExistente {
  id: number;
  data: string;
  descricao: string;
  valor: number;
}

export type Situacao =
  /** Já está no app, com certeza — a parcela casou com uma série existente. */
  | { tipo: 'jaLancado'; serieId: number; serieDescricao: string; seq: number; total: number; lancamentoId: number }
  /** Compra parcelada nova: vira uma SÉRIE de N lançamentos, não uma linha. */
  | { tipo: 'novaSerie'; parcelas: number; primeira: string }
  /**
   * Já está coberta por uma série que OUTRA LINHA DESTA MESMA FATURA vai
   * criar. Entra desmarcada: lançá-la seria contar o gasto duas vezes.
   */
  | { tipo: 'naSerieNova'; linhaDaSerie: number; seq: number; total: number }
  /** Pode já estar lá. Chave fraca — entra desmarcada, com o candidato ao lado. */
  | { tipo: 'suspeita'; lancamentoId: number; descricao: string; data: string }
  /** Gasto novo, à vista. */
  | { tipo: 'nova' };

export interface LinhaClassificada<T extends LinhaCruzavel = LinhaCruzavel> {
  linha: T;
  situacao: Situacao;
}

/** Meio por cento, com piso de cinco centavos. */
function pertoDe(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);
}

/** Soma meses com clamp de fim de mês — a mesma regra do parcelamento (A8). */
function addMeses(iso: string, k: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + k, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  const dia = Math.min(d, ultimo);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function diasEntre(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(
    (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000,
  );
}

/**
 * Quantos dias de folga a data pode ter.
 *
 * A fatura traz a data da COMPRA; o app grava a parcela na data que o
 * parcelamento calculou. Numa parcela 8, oito somas de mês afastam os dois em
 * até uma quinzena — e a folga tem que crescer com a posição, senão a parcela
 * 11 nunca casaria. Não cresce sem limite: 45 dias já cobre o pior caso medido
 * e para antes de começar a casar meses vizinhos.
 */
function folga(seq: number): number {
  return Math.min(45, 12 + seq * 3);
}

export function cruzar<T extends LinhaCruzavel>(
  linhas: T[],
  parcelas: ParcelaExistente[],
  avulsos: LancamentoExistente[],
): LinhaClassificada<T>[] {
  const passo1 = linhas.map((linha) => {
    if (linha.parcela) {
      const { n, de } = linha.parcela;
      // Onde a parcela `n` deveria estar, contando da data da compra.
      const esperada = addMeses(linha.data, n - 1);

      const achou = parcelas.find(
        (p) =>
          p.total === de &&
          p.seq === n &&
          pertoDe(linha.valor, p.valor) &&
          diasEntre(p.data, esperada) <= folga(n),
      );
      if (achou) {
        return {
          linha,
          situacao: {
            tipo: 'jaLancado',
            serieId: achou.serieId,
            serieDescricao: achou.serieDescricao,
            seq: achou.seq,
            total: achou.total,
            lancamentoId: achou.lancamentoId,
          },
        };
      }

      // Não achou. Se é a primeira parcela, é compra nova e vira série inteira.
      // Se é uma parcela do meio sem série, a compra é anterior ao app ou foi
      // lançada de outro jeito — e aí ela entra como as demais: uma linha só,
      // na data da cobrança, para não inventar um passado que não existe.
      if (n === 1) {
        return { linha, situacao: { tipo: 'novaSerie', parcelas: de, primeira: linha.data } };
      }
    }

    const suspeita = avulsos.find(
      (a) => pertoDe(linha.valor, a.valor) && diasEntre(a.data, linha.data) <= 3,
    );
    if (suspeita) {
      return {
        linha,
        situacao: {
          tipo: 'suspeita',
          lancamentoId: suspeita.id,
          descricao: suspeita.descricao,
          data: suspeita.data,
        },
      };
    }

    return { linha, situacao: { tipo: 'nova' } };
  }) as LinhaClassificada<T>[];

  /**
   * A FATURA TAMBÉM PRECISA SER CRUZADA CONSIGO MESMA.
   *
   * Medido em 26/08/2026 na fatura de agosto: `Adaptaorg` aparece nela com as
   * doze parcelas de uma vez — `Parcela 1 de 12` até `Parcela 12 de 12`, todas
   * com a data da compra. A primeira virava série de 12 lançamentos, e as
   * outras onze, sem série no app para casar, caíam em `nova` e entravam
   * SOLTAS. O mesmo gasto contado duas vezes, R$ 1.188 virando R$ 2.277.
   *
   * O passo 1 só sabe comparar a fatura com o app. Aqui a série que está
   * PRESTES a nascer entra na conta: uma parcela cujo irmão `1 de N` está na
   * mesma fatura já está coberta por ele.
   */
  const novasSeries = passo1
    .map((c, i) => ({ i, c }))
    .filter((x) => x.c.situacao.tipo === 'novaSerie');

  if (!novasSeries.length) return passo1;

  return passo1.map((c, i) => {
    const { parcela } = c.linha;
    if (c.situacao.tipo !== 'nova' || !parcela) return c;

    const dona = novasSeries.find(
      (x) =>
        x.i !== i &&
        x.c.linha.parcela?.de === parcela.de &&
        pertoDe(c.linha.valor, x.c.linha.valor) &&
        // Mesma data de compra: é o que amarra as parcelas ao mesmo gasto.
        // Duas compras de igual valor e igual número de parcelas em dias
        // diferentes continuam sendo duas compras.
        x.c.linha.data === c.linha.data,
    );
    if (!dona) return c;

    return {
      linha: c.linha,
      situacao: {
        tipo: 'naSerieNova',
        linhaDaSerie: dona.i,
        seq: parcela.n,
        total: parcela.de,
      },
    };
  });
}

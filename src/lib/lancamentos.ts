/**
 * Lógica pura de lançamentos, portada de `Codigo.gs` (Apps Script).
 *
 * Esta parte NÃO é reescrita: é o código já depurado ao longo de três semanas,
 * com dinheiro real em cima. O que muda é só a camada de acesso a dados, que
 * não vive aqui. Cada armadilha que custou tempo está preservada e comentada.
 */

/** Arredonda para 2 casas sem erro de ponto flutuante. */
export function arred(v: number | string): number {
  return Math.round(Number(v) * 100) / 100;
}

/**
 * Constrói uma Date LOCAL a partir de "yyyy-MM-dd".
 *
 * Evita o bug clássico: `new Date('2026-01-15')` é interpretado como UTC e, em
 * fuso negativo como o de São Paulo, volta um dia. Aqui o dia é o que foi escrito.
 */
export function parseDataLocal(str: string): Date {
  const p = String(str).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

/**
 * Formata Date como "yyyy-MM-dd" usando os componentes LOCAIS.
 *
 * Nunca usar `toISOString()` aqui: ele converte para UTC e pode devolver o dia
 * anterior — é o mesmo bug de `parseDataLocal`, com o sinal trocado.
 */
export function formatarData(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Soma k meses preservando o dia, com clamp de fim de mês.
 * 31/01 → 28/02 → 31/03: volta ao dia original quando o mês comporta.
 */
export function addMeses(base: Date, k: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth() + k, 1);
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(base.getDate(), ultimoDia));
  return d;
}

/** Último dia do mês da data informada. */
export function fimDoMes(data: Date): Date {
  return new Date(data.getFullYear(), data.getMonth() + 1, 0);
}

export type Divisao = '50/50' | 'Renda' | '100% Irwin' | '100% Maria' | 'Custom';
export type QuemPagou = 'Irwin' | 'Maria' | 'Ambos' | 'Conjunta' | '' | null | undefined;

/**
 * % do Irwin conforme o modo de divisão.
 *
 * Diferença em relação ao original: `pctIrwinRenda` chega por parâmetro em vez
 * de ser lido da planilha aqui dentro. A regra é idêntica — inclusive o
 * fallback de 0.4947 e o fato de qualquer valor não reconhecido cair em 'Renda'.
 */
export function pctIrwinDe(
  divisao: string,
  pctCustom: number | null | undefined,
  pctIrwinRenda = 0.4947,
): number {
  if (divisao === '50/50') return 0.5;
  if (divisao === '100% Irwin') return 1;
  if (divisao === '100% Maria') return 0;
  if (divisao === 'Custom') return (Number(pctCustom) || 0) / 100;
  return pctIrwinRenda > 0 && pctIrwinRenda < 1 ? pctIrwinRenda : 0.4947;
}

/**
 * Quanto o Irwin efetivamente desembolsou.
 *
 * Desembolso e consumo são relações DIFERENTES com a transação. Antes da
 * Versão 36 o app só modelava bem a segunda, e a fórmula da planilha era um SE
 * aninhado cuja única função era inferir a primeira.
 *
 * Devolve `null` quando não há pagador definido: a linha fica fora do acerto.
 */
export function pagoIrwinDe(
  quemPagou: QuemPagou,
  valor: number,
  parteIrwin: number,
  pagoIrwinInformado?: number | string | null,
): number | null {
  if (quemPagou === 'Ambos' || quemPagou === 'Conjunta') {
    // 'Conjunta' entra junto com 'Ambos' de propósito: a planilha tem linhas
    // antigas com esse rótulo, e sem isto reeditar uma delas gravaria pago
    // vazio — a linha sumiria do acerto em silêncio.
    //
    // Sem rateio informado (importação em lote), o padrão é "cada um pôs a
    // própria parte": não gera dívida.
    return pagoIrwinInformado === null ||
      pagoIrwinInformado === undefined ||
      pagoIrwinInformado === ''
      ? arred(Number(parteIrwin) || 0)
      : arred(Number(pagoIrwinInformado) || 0);
  }
  if (quemPagou === 'Irwin') return arred(Number(valor) || 0);
  if (quemPagou === 'Maria') return 0;
  return null;
}

export interface Ocorrencia {
  data: Date;
  descricao: string;
  valor: number;
}

export interface DadosParcelas {
  data: string;
  descricao: string;
  valor: number | string;
  parcelas?: number | string;
  /** 'total' = o valor digitado é o total a fracionar; 'parcela' = é o valor de cada uma. */
  tipoValor?: 'total' | 'parcela';
}

/**
 * Transforma um lançamento em N linhas, uma por parcela.
 *
 * Quando o valor informado é o TOTAL, a última parcela absorve a diferença do
 * arredondamento — a soma fecha exatamente com o total. R$ 1.000 em 3× vira
 * 333,33 + 333,33 + 333,34.
 */
export function montarParcelas(d: DadosParcelas): Ocorrencia[] {
  const n = Math.max(1, parseInt(String(d.parcelas), 10) || 1);
  const bruto = Number(d.valor);
  if (!(bruto > 0)) throw new Error('Informe um valor maior que zero.');

  let valores: number[] = [];
  if (n === 1) {
    valores = [arred(bruto)];
  } else if (d.tipoValor === 'parcela') {
    for (let i = 0; i < n; i++) valores.push(arred(bruto));
  } else {
    const base = arred(bruto / n);
    for (let i = 0; i < n - 1; i++) valores.push(base);
    valores.push(arred(bruto - base * (n - 1)));
  }

  const d0 = parseDataLocal(d.data);

  return valores.map((v, i) => ({
    data: addMeses(d0, i),
    descricao: n > 1 ? `${d.descricao} ${i + 1}/${n}` : d.descricao,
    valor: v,
  }));
}

// Passo de cada frequência, em dias. 'mensal' não entra aqui de propósito:
// usa addMeses(), que tem o clamp de fim de mês.
const DIAS_FREQ: Record<string, number> = { semanal: 7, quinzenal: 14 };

export type Frequencia = 'mensal' | 'quinzenal' | 'semanal';

/** Frequência válida; qualquer coisa não reconhecida vira 'mensal'. */
export function normalizarFreq(v: unknown): Frequencia {
  const f = String(v || '').toLowerCase();
  return f === 'semanal' || f === 'quinzenal' ? (f as Frequencia) : 'mensal';
}

/** Ocorrência k passos à frente de `base`, conforme a frequência. */
export function ocorrenciaFreq(base: Date, freq: Frequencia, k: number): Date {
  const dias = DIAS_FREQ[freq];
  return dias
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias * k)
    : addMeses(base, k);
}

/** Datas de ocorrência a partir de d0 até `limite` (inclusive), com teto de segurança. */
export function gerarDatasRecorrencia(
  d0: Date,
  freq: Frequencia,
  limite: Date,
  tetoOcorrencias: number,
): Date[] {
  const datas: Date[] = [];
  for (let k = 0; k < tetoOcorrencias; k++) {
    const data = ocorrenciaFreq(d0, freq, k);
    if (data.getTime() > limite.getTime()) break;
    datas.push(data);
  }
  return datas;
}

export interface DadosRecorrencia {
  data: string;
  descricao: string;
  valor: number | string;
  freqRec?: string;
  fimRec?: string;
  semFimRec?: boolean;
}

/**
 * Ocorrências de um gasto recorrente, da data do lançamento até a data fim.
 *
 * Modelo DIFERENTE do parcelamento: cada ocorrência tem o valor CHEIO e a MESMA
 * descrição. Parcela fraciona um valor; recorrência repete o valor inteiro.
 *
 * Marcado como indefinido, gera só até o fim do mês corrente — o resto fica com
 * o gatilho mensal idempotente.
 */
export function montarRecorrencias(d: DadosRecorrencia): Ocorrencia[] {
  const valor = arred(Number(d.valor));
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero.');
  const d0 = parseDataLocal(d.data);
  const freq = normalizarFreq(d.freqRec);

  let limite: Date;
  if (d.semFimRec) {
    limite = fimDoMes(new Date());
  } else {
    if (!d.fimRec) throw new Error('Informe a data fim ou marque repetição indefinida.');
    limite = parseDataLocal(d.fimRec);
    if (!(limite.getTime() >= d0.getTime())) {
      throw new Error('A data fim deve ser igual ou depois da data do lançamento.');
    }
  }

  const datas = gerarDatasRecorrencia(d0, freq, limite, 500);
  if (!datas.length) throw new Error('Nenhuma ocorrência no período informado.');

  return datas.map((data) => ({ data, descricao: d.descricao, valor }));
}

/**
 * Fração do total que o Irwin pagou, para distribuir o rateio entre ocorrências.
 *
 * A base muda conforme o modelo, e confundir os dois foi um dos bugs de 12/08:
 * - recorrência: a base é UMA ocorrência (todas têm o valor cheio), então o
 *   rateio se repete igual em cada uma;
 * - parcelamento: a base é a SOMA das parcelas — o total sobre o qual o rateio
 *   foi digitado —, então a fração é aplicada a cada parcela.
 */
export function fracaoPagaPeloIrwin(
  dados: { quemPagou?: QuemPagou; pagoIrwin?: number | string | null; repetir?: boolean },
  ocorrencias: Ocorrencia[],
): number | null {
  if (dados.quemPagou !== 'Ambos' && dados.quemPagou !== 'Conjunta') return null;
  if (dados.pagoIrwin === null || dados.pagoIrwin === undefined || dados.pagoIrwin === '') {
    return null;
  }
  const base = dados.repetir
    ? ocorrencias.length
      ? ocorrencias[0].valor
      : 0
    : ocorrencias.reduce((a, b) => a + b.valor, 0);
  if (!(base > 0)) return null;
  return (Number(dados.pagoIrwin) || 0) / base;
}

/**
 * Procurar, NOS LANÇAMENTOS JÁ GRAVADOS, a compra que um estorno cancela.
 *
 * POR QUE ISSO PRECISA EXISTIR
 *
 * `ligarEstornos` só olha para a própria fatura, e isso deixa de fora o caso
 * mais caro: a compra foi lançada meses atrás e o cancelamento chega agora.
 *
 * Medido na fatura de outubro/2026. Três linhas iguais:
 *
 *     Canc Parcela Sem Juros - Heringblumenaubr   −R$ 141,58   (×3)
 *
 * Rastreando as faturas de agosto, setembro e outubro, `Heringblumenaubr`
 * R$ 141,58 aparece nas três, sempre com data de compra 28/07 — era um
 * parcelamento 3× de R$ 424,74, e outubro cancelou as três parcelas. No app
 * existe UM lançamento de R$ 141,58, de 28/07: a parcela de setembro nunca
 * chegou a entrar. Sem este cruzamento, a tela diz "não corresponde a nenhuma
 * compra desta fatura" e o lançamento de uma compra que não existe mais fica
 * para sempre no resultado do mês.
 *
 * O ACHADO QUE DEFINE A REGRA
 *
 * O estorno `Leiturinha −R$ 540,00` da mesma fatura não casa com nada do
 * Leiturinha no app. Mas procurando R$ 540,00 na base inteira existe
 * exatamente um lançamento com esse valor: `Torneiras`, de julho de 2020.
 * Valor igual, lojista sem nenhuma relação.
 *
 * Daí a regra, e ela não é negociável: **o nome filtra, o valor confirma.**
 * Valor sozinho nunca propõe nada — proporia apagar uma torneira de seis anos
 * atrás por causa de uma assinatura infantil.
 *
 * ESTA FUNÇÃO NÃO DECIDE E NÃO ESCREVE. Devolve o que achou e com que grau de
 * confiança; quem age é a tela, com confirmação explícita, porque isto é a
 * primeira vez que a importação mexe em dado FORA do próprio lote.
 */

import { lojista } from './estornos';

const CENTAVO = 0.005;

/**
 * O mesmo lojista, comparando fatura com app.
 *
 * Aqui a comparação é mais frouxa que dentro da fatura, e de propósito: os
 * dois lados vêm de fontes diferentes. Na fatura o nome vem com a cidade
 * GRUDADA e sem espaço — `Leiturinhacampinasbr` — enquanto no app alguém
 * digitou `Leiturinha`. Não há o que separar por espaço, então um ser prefixo
 * do outro é o que resta.
 *
 * O piso de 5 letras existe para o prefixo não virar coringa: sem ele,
 * qualquer `casa` casaria com `casaamericanabr`. E ainda que um falso positivo
 * passe, ele só faz a tela MOSTRAR o lançamento — as ações continuam presas às
 * regras de valor, e o valor é quem confirma.
 */
function mesmoLojista(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.startsWith(a)) return true;
  if (b.length >= 5 && a.startsWith(b)) return true;
  return false;
}

/** Um lançamento já gravado, como o cruzamento precisa de ver. */
export interface LancamentoNoApp {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  serieId: number | null;
  /** Quantos lançamentos a série tem, e quanto soma — quando há série. */
  serieQtd?: number | null;
  serieTotal?: number | null;
}

export type AchadoNoApp =
  /** Valor igual ao de um lançamento solto do mesmo lojista: cancela aquele. */
  | { tipo: 'lancamento'; confianca: 'alta'; ids: number[]; valor: number }
  /** Valor igual ao TOTAL de uma série do mesmo lojista: cancela a compra. */
  | { tipo: 'serie'; confianca: 'alta'; serieId: number; ids: number[]; valor: number }
  /**
   * O estorno é múltiplo exato do valor de uma parcela — `N` parcelas foram
   * canceladas. O app pode ter menos de `N` lançadas, e dizer isso é metade
   * da informação: é o caso Hering, 3 canceladas e 1 no app.
   */
  | {
      tipo: 'parcelas';
      confianca: 'media';
      ids: number[];
      valorParcela: number;
      canceladas: number;
      noApp: number;
    }
  /** Mesmo lojista e valor MENOR: devolveu parte. Sugere o líquido. */
  | {
      tipo: 'parcial';
      confianca: 'media';
      ids: number[];
      valorAtual: number;
      valorSugerido: number;
    }
  /** Achou o lojista, nenhum valor encaixa. Mostra e não oferece botão. */
  | { tipo: 'semEncaixe'; confianca: 'baixa'; ids: number[]; valores: number[] }
  /** Nem o lojista existe no app. */
  | { tipo: 'nada'; confianca: 'nenhuma' };

export interface EstornoNoApp {
  /** Índice do estorno na lista de `ligarEstornos`. */
  i: number;
  achado: AchadoNoApp;
}

/**
 * Agrupa estornos idênticos — mesmo lojista, mesmo valor.
 *
 * Três linhas de −R$ 141,58 do Hering não são três perguntas: são uma compra
 * de 3 parcelas cancelada. Tratar uma a uma faria a tela oferecer "excluir o
 * lançamento" três vezes para o mesmo lançamento.
 */
export function agruparIguais<T extends { descricao: string; valor: number }>(
  negativas: T[],
): { chave: string; itens: T[]; loja: string; valorUnit: number; vezes: number }[] {
  const m = new Map<string, T[]>();
  for (const n of negativas) {
    const chave = `${lojista(n.descricao)}|${Math.abs(n.valor).toFixed(2)}`;
    if (!m.has(chave)) m.set(chave, []);
    m.get(chave)!.push(n);
  }
  return [...m.entries()].map(([chave, itens]) => ({
    chave,
    itens,
    loja: lojista(itens[0].descricao),
    valorUnit: Math.abs(itens[0].valor),
    vezes: itens.length,
  }));
}

/**
 * O que este estorno cancela, entre os lançamentos do app.
 *
 * `vezes` é quantas devoluções idênticas vieram na fatura — 3, no Hering.
 * `alvo` é o valor de UMA delas.
 */
export function acharNoApp(
  descricaoEstorno: string,
  alvo: number,
  vezes: number,
  lancamentos: LancamentoNoApp[],
): AchadoNoApp {
  const loja = lojista(descricaoEstorno);
  // Sem nome aproveitável não se procura NADA. Procurar só por valor é o que
  // produziria o `Torneiras` — ver o cabeçalho.
  if (!loja) return { tipo: 'nada', confianca: 'nenhuma' };

  const mesmos = lancamentos.filter((l) => mesmoLojista(loja, lojista(l.descricao)));
  if (!mesmos.length) return { tipo: 'nada', confianca: 'nenhuma' };

  const total = alvo * vezes;

  // 1. O total devolvido bate com o total de uma série: a compra inteira caiu.
  const porSerie = new Map<number, LancamentoNoApp[]>();
  for (const l of mesmos) {
    if (l.serieId == null) continue;
    if (!porSerie.has(l.serieId)) porSerie.set(l.serieId, []);
    porSerie.get(l.serieId)!.push(l);
  }
  for (const [serieId, ls] of porSerie) {
    const somaSerie = ls[0].serieTotal ?? ls.reduce((a, l) => a + l.valor, 0);
    if (Math.abs(somaSerie - total) < CENTAVO) {
      return {
        tipo: 'serie',
        confianca: 'alta',
        serieId,
        ids: ls.map((l) => l.id),
        valor: somaSerie,
      };
    }
  }

  // 2. Uma devolução, e existe lançamento de valor idêntico.
  const iguais = mesmos.filter((l) => Math.abs(l.valor - alvo) < CENTAVO);
  if (vezes === 1 && iguais.length) {
    return {
      tipo: 'lancamento',
      confianca: 'alta',
      ids: iguais.map((l) => l.id),
      valor: alvo,
    };
  }

  /* 3. Várias devoluções do mesmo valor: N parcelas canceladas. O app pode ter
        MENOS que N lançadas, e é exatamente isso que precisa ser dito — no
        Hering são 3 canceladas e 1 no app, porque a parcela de setembro nunca
        entrou. Omitir o número faria parecer que as três foram tratadas. */
  if (vezes > 1 && iguais.length) {
    return {
      tipo: 'parcelas',
      confianca: 'media',
      ids: iguais.map((l) => l.id),
      valorParcela: alvo,
      canceladas: vezes,
      noApp: iguais.length,
    };
  }

  /* 4. Devolveu parte. Só com UMA candidata: com várias, qual delas foi
        reduzida é coisa que só quem comprou sabe, e chutar aqui mexeria no
        dinheiro por conta própria (C7). */
  const maiores = mesmos.filter((l) => l.valor > total + CENTAVO);
  if (vezes === 1 && maiores.length === 1) {
    const l = maiores[0];
    return {
      tipo: 'parcial',
      confianca: 'media',
      ids: [l.id],
      valorAtual: l.valor,
      valorSugerido: Math.round((l.valor - total) * 100) / 100,
    };
  }

  // 5. O lojista existe, nenhum valor encaixa. Mostra e não propõe nada.
  return {
    tipo: 'semEncaixe',
    confianca: 'baixa',
    ids: mesmos.map((l) => l.id),
    valores: mesmos.map((l) => l.valor),
  };
}

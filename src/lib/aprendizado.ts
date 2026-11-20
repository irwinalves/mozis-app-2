/**
 * Sugestão de categoria que APRENDE do que vocês já categorizaram.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * A sugestão era só `sugerirCategoria`: casar a descrição com as palavras-chave
 * do Plano de Contas. Só que essas "palavras-chave" são a FRASE que descreve a
 * categoria para um humano ler — "Financiamento, IPVA, seguro, combustível,
 * manutenção, estacionamento, multas, Uber/99". O termo gravado é `uber/99`, e
 * nenhuma fatura escreve isso. Medido nos 400 lançamentos de set a nov/2026:
 * a regra acerta 20,3% e joga 86,3% em `7 Outros`.
 *
 * O histórico sabe o que a frase não sabe. `ifood` aparece 12 vezes, todas em
 * Comida. `ifd` — o prefixo que a fatura usa de verdade — aparece 6 vezes, 5
 * em Comida. `uber` aparece 123 vezes, 88% em Carro. Aprendendo daí, o acerto
 * vai a 45,8%.
 *
 * `7 OUTROS` NÃO VOTA
 *
 * Esta é a parte que não é óbvia, e foi medida. `araujo` aparecia 63 vezes:
 * 49 em `7 Outros`, 7 em Comida, 7 em Saúde. Aprender cru devolveria `7 Outros`
 * com 78% de confiança — o índice aprenderia a NÃO categorizar, para sempre,
 * e com cara de certeza. `7 Outros` é a ausência de uma decisão, não uma
 * decisão: ele fica fora da votação, e por isso fora do índice inteiro.
 *
 * SEM CACHE, DE PROPÓSITO
 *
 * O índice é montado a cada importação, a partir dos lançamentos daquele
 * momento. É uma consulta de duas colunas sobre alguns milhares de linhas, e
 * importação é coisa rara. Em troca, toda correção feita na revisão vale já na
 * fatura seguinte — que é exatamente o ciclo que faz os 54% sem palpite
 * encolherem sozinhos. Tabela materializada precisaria ser atualizada, e um
 * índice desatualizado ensina o passado.
 */

/** Quantas vezes um termo precisa aparecer para ter voz. */
export const MIN_OCORRENCIAS = 3;
/** Quanto da votação a categoria vencedora precisa ter. */
export const CONFIANCA_MIN = 0.6;

const semAcento = (s: string) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Os termos de uma descrição.
 *
 * Tudo que não é letra ou dígito separa — `Ifd*Inconfidentes` vira `ifd` e
 * `inconfidentes`, e é justamente o prefixo que a fatura usa. Fora os de uma
 * ou duas letras, que casam com meio mundo, e os puramente numéricos, que são
 * número de parcela e data.
 */
export function termosDe(descricao: string): string[] {
  return semAcento(descricao)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

export type Indice = Map<string, Map<string, number>>;

/**
 * Monta o índice termo → quantas vezes caiu em cada categoria.
 *
 * Quem chama passa os lançamentos JÁ sem `7 Outros` e sem `8`/`9` — ver o
 * cabeçalho. Mesmo assim a filtragem é refeita aqui: a função é pura e é
 * testada sozinha, e uma guarda que depende de quem chama não é guarda.
 */
export function montarIndice(
  linhas: readonly { descricao: string; categoria: string }[],
): Indice {
  const idx: Indice = new Map();
  for (const l of linhas) {
    if (!l.categoria || l.categoria.startsWith('7 ')) continue;
    if (l.categoria.startsWith('8 ') || l.categoria.startsWith('9 ')) continue;
    // `Set`: um termo repetido na mesma descrição é um voto, não dois.
    for (const t of new Set(termosDe(l.descricao))) {
      let m = idx.get(t);
      if (!m) idx.set(t, (m = new Map()));
      m.set(l.categoria, (m.get(l.categoria) ?? 0) + 1);
    }
  }
  return idx;
}

/**
 * O que o histórico diz sobre esta descrição, ou `null` quando não diz nada.
 *
 * Entre os termos conhecidos, ganha o de MAIOR CONFIANÇA — não o mais
 * frequente. `ifood` com 12 de 12 vale mais que `sao` com 400 de 900: um nome
 * de loja decide a categoria, uma preposição não decide nada. Empate em
 * confiança desempata por frequência.
 */
export function sugerirPorHistorico(descricao: string, idx: Indice): string | null {
  let melhor: { categoria: string; confianca: number; n: number } | null = null;
  for (const t of new Set(termosDe(descricao))) {
    const m = idx.get(t);
    if (!m) continue;
    let n = 0;
    for (const v of m.values()) n += v;
    if (n < MIN_OCORRENCIAS) continue;
    let topo = '';
    let votos = 0;
    for (const [cat, v] of m) {
      if (v > votos) {
        topo = cat;
        votos = v;
      }
    }
    const confianca = votos / n;
    if (
      !melhor ||
      confianca > melhor.confianca ||
      (confianca === melhor.confianca && n > melhor.n)
    ) {
      melhor = { categoria: topo, confianca, n };
    }
  }
  return melhor && melhor.confianca >= CONFIANCA_MIN ? melhor.categoria : null;
}

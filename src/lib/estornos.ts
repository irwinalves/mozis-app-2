/**
 * Ligar um estorno à compra que ele cancela, dentro da MESMA fatura.
 *
 * POR QUE ISSO PRECISA EXISTIR
 *
 * A A13 manda descartar valor negativo, e está certa: estorno não é gasto
 * novo. Mas descartar em silêncio esconde o que importa. Medido na fatura de
 * agosto/2026, e quem viu foi a Maria, não o código: `Adaptaorg` aparece com as
 * doze parcelas de R$ 99 **e** com um estorno de −R$ 1.188,00 na mesma data.
 * A compra foi cancelada. Sem ligar os dois, o app grava uma série de doze
 * parcelas indo até junho de 2027 para algo que não existe, e o −1.188 some.
 *
 * Não é caso isolado: agosto tem 8 negativos, setembro tem 5, e vários são
 * estorno parcial de compra da própria fatura — Shein, Shopee, Apple.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ
 *
 * Não decide. Devolve um palpite com o grau de confiança, e a tela mostra.
 * O palpite ERRA: a primeira parcela da Adaptaorg vem descrita só como
 * `Adaptaorg` e as outras onze como `Adaptaorg Sao Paulo Br`, então qualquer
 * agrupamento por texto já começa com uma linha fora. É por isso que o VALOR é
 * a chave forte aqui, e o texto é só o filtro — a mesma divisão de papéis do
 * cruzamento com o app.
 */

export interface LinhaPositiva {
  i: number;
  descricao: string;
  valor: number;
  parcela: { n: number; de: number } | null;
}

export interface Negativa {
  linha: number;
  descricao: string;
  valor: number;
  motivo: string;
}

export type Vinculo =
  /** O estorno cobre a compra inteira — soma das parcelas, ou a linha única. */
  | { tipo: 'integral'; refs: number[]; valor: number }
  /** Cobre exatamente uma linha de mesmo valor. */
  | { tipo: 'linha'; refs: number[]; valor: number }
  /** Mesmo lojista, valor menor: devolveu parte. Informativo, não muda nada. */
  | { tipo: 'parcial'; refs: number[]; valor: number }
  /** Nada na fatura corresponde — compra de outro mês, ou ajuste do banco. */
  | { tipo: 'solto' };

export interface EstornoLigado {
  negativa: Negativa;
  vinculo: Vinculo;
}

const CENTAVO = 0.005;

/**
 * O nome do lojista, sem o que o banco acrescenta.
 *
 * Duas coisas atrapalham, e as duas foram medidas nas faturas reais:
 *
 * 1. **Cidade e UF vêm grudadas.** `Adaptaorg` e `Adaptaorg Sao Paulo Br` são
 *    o mesmo lojista — a primeira parcela veio sem o sufixo e as outras onze
 *    com ele. Ficar com o primeiro pedaço significativo resolve.
 *
 * 2. **O intermediador vem na frente, separado por asterisco.** `Shopee *`,
 *    `Mercadolivre*`, `Pg *`, `Mp*`, `Ec *`, `Brs*`, `Ifd*`. Ficar com o
 *    primeiro pedaço aí dá o nome da PLATAFORMA, não da loja: sete compras
 *    Shopee de vendedores diferentes viravam um grupo só, e o estorno de
 *    R$ 0,01 de uma apontava para R$ 868,77 das outras seis. Depois do último
 *    asterisco está o lojista de verdade — e é o que faz
 *    `Brs*Sheincomsao Paulobr` casar com `Shein *Sheincomsao Paulobr`.
 */
export function lojista(s: string): string {
  const limpo = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    /* 3. **O banco tem mais de um jeito de dizer "cancelei".** A lista era
     *    `cancelamento de compra`, `estorno`, `reducao` e `credito`, e a
     *    fatura de outubro trouxe `Canc Parcela Sem Juros - Heringblumenaubr`,
     *    que não casava com nenhum: o prefixo ficava, e o lojista devolvido
     *    era `canc` — igual para TODO cancelamento de parcela, de qualquer
     *    loja. Com isso o Hering não casava nem dentro da própria fatura. */
    .replace(
      /^(canc(elamento)?( parcial)?( de compra| parcela sem juros)?|estorno|devolucao|reducao|credito)\s*-?\s*/,
      '',
    );
  const depoisDoAsterisco = limpo.split('*').pop() ?? limpo;
  return (
    depoisDoAsterisco
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 3)[0] ?? ''
  );
}

export function ligarEstornos(
  linhas: LinhaPositiva[],
  descartadas: Negativa[],
): EstornoLigado[] {
  // Pagamento da fatura não cancela compra nenhuma: ele paga todas. Fica de
  // fora para não aparecer como "estorno sem correspondência" todo mês.
  const candidatas = descartadas.filter((d) => d.motivo !== 'pagamento da fatura');

  return candidatas.map((negativa) => {
    const alvo = Math.abs(negativa.valor);
    const loja = lojista(negativa.descricao);
    const mesmas = loja ? linhas.filter((l) => lojista(l.descricao) === loja) : [];

    if (!mesmas.length) return { negativa, vinculo: { tipo: 'solto' } as Vinculo };

    // 1. A compra inteira. Numa parcelada é a SOMA das parcelas — é o caso da
    //    Adaptaorg, e é o de maior consequência, porque evita gravar a série.
    const soma = mesmas.reduce((a, l) => a + l.valor, 0);
    if (Math.abs(soma - alvo) < CENTAVO) {
      return {
        negativa,
        vinculo: { tipo: 'integral', refs: mesmas.map((l) => l.i), valor: soma },
      };
    }

    // 2. Uma linha de valor idêntico.
    const iguais = mesmas.filter((l) => Math.abs(l.valor - alvo) < CENTAVO);
    if (iguais.length === 1) {
      return {
        negativa,
        vinculo: { tipo: 'linha', refs: [iguais[0].i], valor: iguais[0].valor },
      };
    }

    // 3. Mesmo lojista, valor menor: devolveu parte. A tela mostra e não mexe
    //    em nada — qual linha foi reduzida, e em quanto, só quem comprou sabe.
    if (alvo < soma) {
      return {
        negativa,
        vinculo: { tipo: 'parcial', refs: mesmas.map((l) => l.i), valor: soma },
      };
    }

    return { negativa, vinculo: { tipo: 'solto' } as Vinculo };
  });
}

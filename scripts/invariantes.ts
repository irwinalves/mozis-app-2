/**
 * Invariantes do banco — o oráculo que a suíte de testes não tem.
 *
 * POR QUE ISSO EXISTE
 *
 * `npm test` verifica lógica pura e o contrato do front. Nenhum dos dois toca
 * o banco, e é no banco que mora o dado que vale dinheiro. Duas vezes este app
 * esteve quebrado com a suíte inteira verde:
 *
 *   - o filtro de datas comparado em JavaScript nunca excluía nada, e os três
 *     cortes do acerto davam idênticos, escondendo R$ 2.719,16;
 *   - a API lia `categoria` onde o front manda `grupo`, e gravar era recusado.
 *
 * O que os dois têm em comum: o teste repetia a suposição do código em vez de
 * derivar a resposta de outra fonte. Aqui a fonte é o estado real da base, e
 * várias checagens calculam a mesma grandeza por DOIS caminhos independentes —
 * se as duas concordam, é evidência; se divergem, há um número para investigar.
 *
 * SÓ LEITURA. Nada aqui escreve, e é assim que deve continuar: o valor de
 * poder rodar isto a qualquer momento, inclusive contra produção, depende de
 * ser inofensivo.
 *
 * Uso:  npm run invariantes
 */
import postgres from 'postgres';
import { pctIrwinDe } from '../src/lib/lancamentos';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida.');
const sql = postgres(url);

/**
 * Tolerância das comparações de dinheiro: meio centavo.
 *
 * Não é folga para erro de regra — é o piso do que a aritmética de ponto
 * flutuante consegue prometer somando milhares de linhas. Qualquer divergência
 * real de negócio é ordens de grandeza maior. O delta medido sempre aparece no
 * relatório, então uma diferença de 0,004 não passa despercebida: ela é
 * impressa mesmo quando o teste passa.
 */
const TOLERANCIA = 0.005;

type Severidade = 'defeito' | 'herança';

interface Resultado {
  ok: boolean;
  /** Uma linha explicando o que foi medido — impressa passando ou falhando. */
  medida: string;
  /** Exemplos concretos. Sem eles um "3 linhas erradas" é impossível de agir. */
  exemplos?: string[];
  severidade?: Severidade;
}

interface Invariante {
  id: string;
  /** A regra do `docs/INVARIANTES.md` ou do CLAUDE.md que isto protege. */
  regra: string;
  pergunta: string;
  checar: () => Promise<Resultado>;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// Os invariantes
// ---------------------------------------------------------------------------

const invariantes: Invariante[] = [
  {
    id: 'pagador',
    regra: 'A4 — todo lançamento tem pagador',
    pergunta: 'Existe lançamento criado no app novo sem pagador?',
    checar: async () => {
      // `linha_origem` só é preenchida pela carga da planilha. NULL = nasceu
      // aqui, depois do cutover, passando por `exigirPagador`. Separar os dois
      // é o que impede este check de gritar para sempre por causa das linhas
      // históricas que ninguém pode mais corrigir.
      const novos = await sql<{ id: number; data: string; descricao: string }[]>`
        select id, data::text as data, descricao from lancamentos
        where linha_origem is null and (quem_pagou is null or quem_pagou = '' or pago_irwin is null)
        order by data desc limit 5`;
      const [{ n: historicos }] = await sql<{ n: string }[]>`
        select count(*)::text as n from lancamentos
        where linha_origem is not null and (quem_pagou is null or quem_pagou = '' or pago_irwin is null)`;

      return {
        ok: novos.length === 0,
        severidade: 'defeito',
        medida: `${novos.length} sem pagador entre os criados no app novo · ${historicos} no histórico importado (conhecido, não corrigível sem saber quem pagou)`,
        exemplos: novos.map((l) => `#${l.id} ${l.data} — ${l.descricao}`),
      };
    },
  },

  {
    id: 'recorrencia-adiantada',
    regra: 'A18 — recorrência não adianta o futuro, tenha ou não data fim',
    pergunta: 'Existe recorrência lançada além do mês corrente?',
    checar: async () => {
      // Uma parcelada futura é dívida já contraída e PODE estar lançada (A7).
      // Uma recorrência futura não: ela é escolha que se repete, e o cron a
      // gera mês a mês. Achado em 09/10/2026 com 23 ocorrências até março de
      // 2027 — o corte "total" do acerto estava R$ 11.429,53 errado.
      const linhas = await sql<
        { descricao: string; n: string; ate: string; saldo: string }[]
      >`select descricao, count(*)::text as n, max(data)::text as ate,
               round(sum(saldo_irwin)::numeric, 2)::text as saldo
          from v_lancamentos
         where recorrente = true
           and data > (date_trunc('month', current_date)
                       + interval '1 month' - interval '1 day')::date
         group by descricao order by count(*) desc`;

      const total = linhas.reduce((a, l) => a + Number(l.n), 0);
      const efeito = linhas.reduce((a, l) => a + Number(l.saldo), 0);

      return {
        ok: total === 0,
        severidade: 'defeito',
        medida:
          total === 0
            ? 'nenhuma recorrência lançada além do mês corrente'
            : `${total} ocorrência(s) adiantada(s) em ${linhas.length} regra(s) · movem o acerto "total" em ${brl(efeito)}`,
        exemplos: linhas.map((l) => `${l.descricao} — ${l.n} até ${l.ate}`),
      };
    },
  },

  {
    id: 'pct-congelado',
    regra: 'Regra 3 — uma implementação, nunca duas',
    pergunta: 'O `pct_irwin` gravado ainda concorda com o que a regra calcularia hoje?',
    checar: async () => {
      // O caminho independente: recalcular com a MESMA função que a API usa e
      // comparar com o que está gravado. Divergência aqui significa uma de duas
      // coisas, ambas graves: a regra mudou e o histórico não foi migrado, ou
      // alguma gravação não passou por `pctIrwinDe`.
      const [{ pct_irwin_renda }] = await sql<{ pct_irwin_renda: string }[]>`
        select pct_irwin_renda from config where id = 1`;
      const renda = Number(pct_irwin_renda);

      const linhas = await sql<
        { id: number; divisao: string; pct_irwin_custom: string | null; pct_irwin: string; descricao: string }[]
      >`select id, divisao, pct_irwin_custom, pct_irwin, descricao from lancamentos`;

      const fora = linhas.filter((l) => {
        const esperado = pctIrwinDe(
          l.divisao,
          l.pct_irwin_custom === null ? null : Number(l.pct_irwin_custom) * 100,
          renda,
        );
        return Math.abs(esperado - Number(l.pct_irwin)) > 1e-9;
      });

      return {
        ok: fora.length === 0,
        severidade: 'defeito',
        medida: `${linhas.length} linhas recalculadas com pctIrwinDe() · ${fora.length} divergem do gravado`,
        exemplos: fora.slice(0, 5).map((l) => `#${l.id} ${l.descricao} — divisão ${l.divisao}, gravado ${l.pct_irwin}`),
      };
    },
  },

  {
    id: 'acerto-dois-caminhos',
    regra: 'E1 + Regra 6 — o número tem que fechar por dois caminhos',
    pergunta: 'O saldo do acerto calculado pelo Postgres bate com o calculado em TypeScript?',
    checar: async () => {
      // Caminho 1: a view, como a API faz — soma `saldo_irwin` já derivado.
      const [{ saldo: viaSql }] = await sql<{ saldo: string }[]>`
        select round(
            coalesce((select sum(saldo_irwin) from v_lancamentos), 0)
          + coalesce((select sum(case when quem_pagou = 'Irwin' then valor
                                      when quem_pagou = 'Maria' then -valor
                                      else 0 end) from acerto_contas), 0)
        , 2) as saldo`;

      // Caminho 2: das colunas CRUAS, refazendo a aritmética aqui. Não olha a
      // view nem `pct_irwin` derivado — se a view tiver um erro de sinal ou de
      // parêntese, este caminho não o herda.
      //
      // `de_fora` entra aqui porque ESTE CHECK FALHOU no dia em que a coluna
      // ganhou o primeiro dado: o segundo caminho tinha sido escrito antes de
      // ela existir e parou de encodar a mesma regra, acusando um delta de
      // R$ 299,00 que não era defeito do app — era defeito do check. O que
      // precisa ser independente é a IMPLEMENTAÇÃO, não a regra; um segundo
      // caminho que ignora uma regra do primeiro não verifica, só discorda.
      const cruas = await sql<
        { valor_total: string; pago_irwin: string | null; pct_irwin: string; de_fora: boolean }[]
      >`select valor_total, pago_irwin, pct_irwin, de_fora from lancamentos`;
      const viaTs = cruas.reduce((acc, l) => {
        if (l.de_fora) return acc; // não é gasto do casal: não cria dívida entre os dois
        if (l.pago_irwin === null) return acc; // sem pagador fica fora do acerto
        return acc + (Number(l.pago_irwin) - Number(l.valor_total) * Number(l.pct_irwin));
      }, 0);
      const quitacoes = await sql<{ quem_pagou: string | null; valor: string }[]>`
        select quem_pagou, valor from acerto_contas`;
      const viaTsTotal = quitacoes.reduce((acc, q) => {
        if (q.quem_pagou === 'Irwin') return acc + Number(q.valor);
        if (q.quem_pagou === 'Maria') return acc - Number(q.valor);
        return acc;
      }, viaTs);

      const delta = Math.abs(Number(viaSql) - viaTsTotal);
      return {
        ok: delta <= TOLERANCIA,
        severidade: 'defeito',
        medida: `SQL ${brl(Number(viaSql))} · TypeScript ${brl(viaTsTotal)} · delta ${delta.toFixed(6)}`,
      };
    },
  },

  {
    id: 'cortes-distintos',
    regra: 'Regra 6 — data se compara no Postgres',
    pergunta: 'Os três cortes do acerto ainda são capazes de diferir entre si?',
    checar: async () => {
      // Este é o check que teria pego o bug do filtro de datas. Não afirma que
      // os cortes DEVEM diferir — se não houver parcela futura, é correto que
      // sejam iguais. Ele mede quantas linhas caem fora de cada corte: se o
      // filtro estiver quebrado, esse número é zero mesmo havendo futuro.
      const [{ total, ate_mes, ate_mes_seguinte }] = await sql<
        { total: string; ate_mes: string; ate_mes_seguinte: string }[]
      >`select count(*)::text as total,
               count(*) filter (where data <= (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date)::text as ate_mes,
               count(*) filter (where data <= (date_trunc('month', current_date) + interval '2 month' - interval '1 day')::date)::text as ate_mes_seguinte
          from lancamentos`;

      const futuras = Number(total) - Number(ate_mes);
      const filtroCorta = Number(ate_mes) < Number(total) || Number(ate_mes_seguinte) < Number(total);
      return {
        // Só é defeito se HÁ futuro e mesmo assim nenhum corte exclui nada.
        ok: futuras === 0 || filtroCorta,
        severidade: 'defeito',
        medida: `${total} lançamentos · ${ate_mes} até o fim deste mês · ${ate_mes_seguinte} até o seguinte · ${futuras} no futuro`,
      };
    },
  },

  {
    id: 'quitacao',
    regra: 'A11 — quitação é campo, não string mágica',
    pergunta: '`eh_quitacao` concorda com a categoria em todas as linhas?',
    checar: async () => {
      const fora = await sql<{ id: number; categoria: string; eh_quitacao: boolean; descricao: string }[]>`
        select id, categoria, eh_quitacao, descricao from lancamentos
        where eh_quitacao <> (trim(categoria) like '9 %')
        order by data desc limit 5`;
      const [{ n }] = await sql<{ n: string }[]>`
        select count(*)::text as n from lancamentos where eh_quitacao`;
      return {
        ok: fora.length === 0,
        severidade: 'defeito',
        medida: `${n} quitações marcadas · ${fora.length} em desacordo com a categoria`,
        exemplos: fora.map((l) => `#${l.id} ${l.descricao} — categoria "${l.categoria}", eh_quitacao=${l.eh_quitacao}`),
      };
    },
  },

  {
    id: 'desembolso-coerente',
    regra: 'A4 — quem pagou determina o desembolso',
    pergunta: 'O `pago_irwin` concorda com quem está registrado como pagador?',
    checar: async () => {
      // Com pagador único o desembolso não é opinião, é consequência: se pagou
      // Irwin, `pago_irwin` É o valor; se pagou Maria, é zero. Só 'Ambos' tem
      // liberdade, e mesmo ela é limitada ao intervalo [0, valor].
      //
      // Esta versão substituiu um check mais fraco ("pago > valor"), que só
      // pegava um dos lados. A troca veio de um achado real: 11 parcelas de
      // 'Seguro Carro' com Irwin como pagador e `pago_irwin` de R$ 199,81
      // contra um valor de R$ 199,77 — o valor da parcela foi corrigido e o
      // desembolso ficou para trás. O check fraco pegou porque a diferença era
      // para cima; se fosse para baixo, teria passado.
      const fora = await sql<
        { id: number; data: string; descricao: string; valor_total: string; pago_irwin: string; quem_pagou: string }[]
      >`select id, data::text as data, descricao, valor_total, pago_irwin, quem_pagou
          from lancamentos
         where pago_irwin is not null and (
              (quem_pagou = 'Irwin' and abs(pago_irwin - valor_total) > 0.005)
           or (quem_pagou = 'Maria' and abs(pago_irwin) > 0.005)
           or (pago_irwin < -0.005 or pago_irwin > valor_total + 0.005))
         order by data limit 5`;
      const [{ n, delta }] = await sql<{ n: string; delta: string | null }[]>`
        select count(*)::text as n,
               round(coalesce(sum(pago_irwin - valor_total), 0)::numeric, 2)::text as delta
          from lancamentos
         where pago_irwin is not null and (
              (quem_pagou = 'Irwin' and abs(pago_irwin - valor_total) > 0.005)
           or (quem_pagou = 'Maria' and abs(pago_irwin) > 0.005))`;

      return {
        ok: Number(n) === 0,
        severidade: 'defeito',
        medida: `${n} linhas onde o desembolso não segue o pagador · efeito no saldo do Irwin ${brl(Number(delta ?? 0))}`,
        exemplos: fora.map(
          (l) => `#${l.id} ${l.data} ${l.descricao} — ${l.quem_pagou} pagou ${brl(Number(l.pago_irwin))} de ${brl(Number(l.valor_total))}`,
        ),
      };
    },
  },

  {
    id: 'categoria-conhecida',
    regra: 'A1 — 8 categorias + 9 Acerto de Contas',
    pergunta: 'Toda categoria usada existe no plano de contas?',
    checar: async () => {
      const orfas = await sql<{ categoria: string; n: string }[]>`
        select l.categoria, count(*)::text as n from lancamentos l
        left join plano_de_contas p on p.nome = l.categoria
        where p.nome is null group by l.categoria order by count(*) desc limit 5`;
      return {
        ok: orfas.length === 0,
        severidade: 'defeito',
        medida: `${orfas.length} categorias fora do plano de contas`,
        exemplos: orfas.map((c) => `"${c.categoria}" — ${c.n} lançamentos`),
      };
    },
  },

  {
    id: 'recorrencias-idempotentes',
    regra: 'A10 — recorrência indefinida é idempotente',
    pergunta: 'Alguma regra ativa tem `ultima_geracao` no futuro, ou atrasada?',
    checar: async () => {
      // ATENÇÃO ao limiar: `ultima_geracao` é a data da última OCORRÊNCIA
      // gerada, não do dia em que o gatilho rodou. O gerador produz tudo até o
      // fim do mês corrente, então uma data futura DENTRO deste mês é normal —
      // 'Clube Livelo' marca 28/08 no dia 20/08 e está correto.
      //
      // O que não pode existir é geração além do fim do mês: o gerador nunca
      // produziria isso, e a consequência é silenciosa e cara. Foi assim que
      // 'Internet' apareceu marcando 05/09 com o último lançamento em 05/08 —
      // em setembro a próxima ocorrência calculada seria 05/10, e o mês inteiro
      // seria pulado sem erro nenhum.
      const futuro = await sql<{ id: number; descricao: string; ultima_geracao: string; ultimo_lanc: string | null }[]>`
        select r.id, r.descricao, r.ultima_geracao::text as ultima_geracao,
               (select max(l.data)::text from lancamentos l where l.descricao = r.descricao) as ultimo_lanc
          from recorrencias r
         where r.ativo
           and r.ultima_geracao > (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date`;
      // Atraso: regra mensal ativa que não gera há mais de 40 dias. Não é
      // defeito por si — é o sinal de que o cron pode não estar disparando,
      // que é exatamente o que ainda não foi visto acontecer sozinho.
      const atrasadas = await sql<{ id: number; descricao: string; ultima_geracao: string | null }[]>`
        select id, descricao, ultima_geracao::text as ultima_geracao from recorrencias
        where ativo and frequencia = 'mensal'
          and (ultima_geracao is null or ultima_geracao < current_date - interval '40 days')`;
      const [{ n }] = await sql<{ n: string }[]>`select count(*)::text as n from recorrencias where ativo`;

      return {
        ok: futuro.length === 0 && atrasadas.length === 0,
        severidade: futuro.length > 0 ? 'defeito' : 'herança',
        medida: `${n} regras ativas · ${futuro.length} marcando geração além do fim do mês · ${atrasadas.length} sem gerar há mais de 40 dias`,
        exemplos: [
          ...futuro.map(
            (r) =>
              `#${r.id} ${r.descricao} — marca ${r.ultima_geracao} como gerado, último lançamento em ${r.ultimo_lanc ?? 'nenhum'}`,
          ),
          ...atrasadas.map((r) => `#${r.id} ${r.descricao} — última geração ${r.ultima_geracao ?? 'nunca'}`),
        ].slice(0, 5),
      };
    },
  },

  {
    id: 'duplicatas',
    regra: 'A10 — a guarda anti-duplicata',
    pergunta: 'Há lançamentos idênticos em data, descrição e valor?',
    checar: async () => {
      // Duplicata exata é quase sempre gravação dupla — a recorrência gerando
      // duas vezes, ou um toque repetido em "Salvar". Quase, porque duas
      // compras iguais no mesmo dia existem: por isso é herança, não defeito.
      const dups = await sql<{ data: string; descricao: string; valor_total: string; n: string }[]>`
        select data::text as data, descricao, valor_total, count(*)::text as n from lancamentos
        group by data, descricao, valor_total having count(*) > 1
        order by data desc limit 5`;
      return {
        ok: dups.length === 0,
        severidade: 'herança',
        medida: `${dups.length} grupos de lançamentos idênticos`,
        exemplos: dups.map((d) => `${d.data} — ${d.descricao} ${brl(Number(d.valor_total))} ×${d.n}`),
      };
    },
  },

  {
    id: 'datas-plausiveis',
    regra: 'A7 — clamp de fim de mês e datas de parcela',
    pergunta: 'Alguma data é absurda o bastante para denunciar bug de fuso ou de parsing?',
    checar: async () => {
      const fora = await sql<{ id: number; data: string; descricao: string }[]>`
        select id, data::text as data, descricao from lancamentos
        where data < date '2015-01-01' or data > current_date + interval '6 years'
        order by data limit 5`;
      const [{ min, max }] = await sql<{ min: string; max: string }[]>`
        select min(data)::text as min, max(data)::text as max from lancamentos`;
      return {
        ok: fora.length === 0,
        severidade: 'defeito',
        medida: `de ${min} a ${max} · ${fora.length} fora da faixa plausível`,
        exemplos: fora.map((l) => `#${l.id} ${l.data} — ${l.descricao}`),
      };
    },
  },

  {
    id: 'recorrencia-orfa',
    regra: 'A10 — recorrência indefinida é regra + geração idempotente',
    pergunta: 'Existe lançamento recorrente sem regra que o continue?',
    checar: async () => {
      // Um lançamento marcado recorrente sem regra correspondente é uma
      // recorrência que MORRE no fim do mês, sem erro e sem aviso: o cron não
      // tem o que continuar. Foi assim que o `Financiamento` de R$ 6.800/mês
      // ficou órfão — o app novo gerava as ocorrências e não gravava a regra.
      //
      // A separação por `linha_origem` é a mesma do check de pagador, e pelo
      // mesmo motivo: o histórico da planilha tem órfãos que ninguém introduziu
      // agora, e misturar os dois faria este check gritar para sempre.
      const novos = await sql<{ descricao: string; n: string; valor: string }[]>`
        select l.descricao, count(*)::text as n, max(l.valor_total)::text as valor
        from lancamentos l
        where l.recorrente and l.linha_origem is null
          and not exists (select 1 from recorrencias r where r.descricao = l.descricao)
        group by l.descricao order by max(l.valor_total) desc`;
      const antigos = await sql<{ descricao: string; n: string }[]>`
        select l.descricao, count(*)::text as n
        from lancamentos l
        where l.recorrente and l.linha_origem is not null
          and not exists (select 1 from recorrencias r where r.descricao = l.descricao)
        group by l.descricao order by count(*) desc`;

      return {
        ok: novos.length === 0,
        severidade: 'defeito',
        medida:
          `${novos.length} órfã(s) criada(s) no app novo · ` +
          `${antigos.length} vinda(s) da planilha (${antigos.reduce((a, b) => a + Number(b.n), 0)} linhas)`,
        exemplos: [
          ...novos.map((o) => `NOVO  ${o.descricao} — ${o.n}× até ${brl(Number(o.valor))}`),
          ...antigos.map((o) => `plan. ${o.descricao} — ${o.n} linha(s)`),
        ],
      };
    },
  },

  {
    id: 'regra-cumprida',
    regra: 'A10 — `ultima_geracao` é a promessa de que já gerou',
    pergunta: 'Toda regra ativa tem, de fato, o lançamento que ela diz ter gerado?',
    checar: async () => {
      // `ultima_geracao` é o único freio contra duplicar, e é usado como
      // afirmação: "até esta data, já gerei". Se a data avançou mas o
      // lançamento não existe, o mês foi PULADO e o cron nunca vai voltar —
      // ele só olha para frente a partir dali.
      //
      // O par independente aqui é o próprio banco: a regra afirma, a tabela de
      // lançamentos confirma ou desmente. Casar por descrição é fraco de
      // propósito enquanto não existe `serie_id`; é exatamente essa fraqueza
      // que a identidade de série vem substituir.
      const quebradas = await sql<
        { id: number; descricao: string; ultima_geracao: string }[]
      >`
        select r.id, r.descricao, r.ultima_geracao::text as ultima_geracao
        from recorrencias r
        where r.ativo and r.ultima_geracao is not null
          and not exists (
            select 1 from lancamentos l
            where l.descricao = r.descricao and l.data = r.ultima_geracao)
        order by r.ultima_geracao`;
      const [{ n: ativas }] = await sql<{ n: string }[]>`
        select count(*)::text as n from recorrencias where ativo`;

      return {
        ok: quebradas.length === 0,
        severidade: 'defeito',
        medida: `${quebradas.length} de ${ativas} regra(s) ativa(s) sem o lançamento que ultima_geracao promete`,
        exemplos: quebradas.map((r) => `#${r.id} ${r.descricao} — diz ter gerado ${r.ultima_geracao}`),
      };
    },
  },

  {
    id: 'serie-identidade',
    regra: 'Fase 0.2 — série tem id, não sufixo de texto',
    pergunta: 'Toda parcela pertence a uma série identificada?',
    checar: async () => {
      // Sem isto a tela de edição volta a agrupar por texto, e agrupar por
      // texto funde séries diferentes: `Seguro Carro` são duas compras, 10x de
      // R$ 407,52 e 12x de R$ 199,77, com a mesma raiz de descrição.
      const soltas = await sql<{ id: number; data: string; descricao: string }[]>`
        select id, data::text as data, descricao from lancamentos
        where descricao ~ ' [(]?[0-9][0-9,+]*/[0-9]+[)]?' and serie_id is null
        order by data desc limit 8`;
      const [{ n: total }] = await sql<{ n: string }[]>`
        select count(*)::text as n from lancamentos
        where descricao ~ ' [(]?[0-9][0-9,+]*/[0-9]+[)]?'`;
      const [{ n: series }] = await sql<{ n: string }[]>`
        select count(*)::text as n from series where tipo = 'parcelamento'`;

      return {
        ok: soltas.length === 0,
        severidade: 'defeito',
        medida: `${Number(total) - soltas.length} de ${total} parcelas em ${series} séries · ${soltas.length} sem identidade`,
        exemplos: soltas.map((l) => `#${l.id} ${l.data} — ${l.descricao}`),
      };
    },
  },

  {
    id: 'serie-numeracao',
    regra: 'Fase 0.2 — uma posição, um lançamento',
    pergunta: 'Alguma série tem duas linhas disputando a mesma parcela?',
    checar: async () => {
      // Posição repetida é o sintoma de duas séries fundidas — o erro que a
      // identidade existe para impedir. Diferente de faltar parcela, que é
      // história: 40 das 86 séries estão incompletas e isso está certo.
      const colisoes = await sql<{ descricao: string; seq: number; n: string }[]>`
        select s.descricao, l.seq, count(*)::text as n
        from lancamentos l join series s on s.id = l.serie_id
        where s.tipo = 'parcelamento'
        group by s.id, s.descricao, l.seq having count(*) > 1
        order by count(*) desc limit 8`;
      const foraDaFaixa = await sql<{ descricao: string; seq: number; total: number }[]>`
        select s.descricao, l.seq, s.total
        from lancamentos l join series s on s.id = l.serie_id
        where s.total is not null and (l.seq < 1 or l.seq > s.total) limit 8`;
      const [{ n: incompletas }] = await sql<{ n: string }[]>`
        select count(*)::text as n from v_series
        where tipo = 'parcelamento' and not completa`;

      return {
        ok: colisoes.length === 0 && foraDaFaixa.length === 0,
        severidade: 'defeito',
        medida: `${colisoes.length} posição(ões) repetida(s) · ${foraDaFaixa.length} fora da faixa 1..total · ${incompletas} séries incompletas (história, não defeito)`,
        exemplos: [
          ...colisoes.map((c) => `repetida: ${c.descricao} posição ${c.seq} ×${c.n}`),
          ...foraDaFaixa.map((c) => `fora: ${c.descricao} posição ${c.seq} de ${c.total}`),
        ],
      };
    },
  },

  {
    id: 'serie-rotulo',
    regra: 'C7 — o texto e o dado têm que concordar',
    pergunta: 'O `N/M` da descrição bate com o `seq` e o `total` gravados?',
    checar: async () => {
      // O sufixo é apresentação e `seq` é o dado — mas se os dois divergirem, a
      // pessoa lê uma coisa na lista e a tela de série opera outra. Foi assim
      // que o `Seguro Casa` chegou aqui: nove linhas rotuladas `01/10` por uma
      // célula arrastada, com a numeração real perdida.
      const divergentes = await sql<{ id: number; descricao: string; seq: number; total: number }[]>`
        select l.id, l.descricao, l.seq, s.total
        from lancamentos l join series s on s.id = l.serie_id
        where s.tipo = 'parcelamento'
          -- Duas formas legítimas que um regex ingênuo acusa por engano:
          -- o parêntese de Vacina RH- (4/4) e a parcela agrupada de
          -- Japaratinga 3,4,5/6, onde o seq é o PRIMEIRO número.
          and l.descricao !~ ('(^|[ (])0*' || l.seq || '([,+][0-9,+]*)?/0*' || s.total || '([ )]|$)')
        order by l.data desc limit 8`;
      const [{ n: reconstruidas }] = await sql<{ n: string }[]>`
        select count(*)::text as n from series where origem = 'reconstruida'`;

      return {
        ok: divergentes.length === 0,
        severidade: 'defeito',
        medida: `${divergentes.length} descrição(ões) em desacordo com o dado · ${reconstruidas} série(s) com numeração reconstruída por heurística`,
        exemplos: divergentes.map((d) => `#${d.id} "${d.descricao}" mas seq=${d.seq} de ${d.total}`),
      };
    },
  },

  {
    id: 'de-fora-tem-dono',
    regra: 'A4, aplicada à outra conta — `De fora` sem nome desaparece de tudo',
    pergunta: 'Todo lançamento `de_fora` diz de quem é o gasto?',
    checar: async () => {
      // Sem `gasto_de` a linha sai das duas contas (de_fora zera o
      // `saldo_irwin`) E sai da dívida de terceiro, que é agrupada por este
      // campo. É o pior dos casos: dinheiro que não aparece em lugar nenhum.
      const orfas = await sql<{ id: number; data: string; descricao: string; valor_total: string }[]>`
        select id, data::text as data, descricao, valor_total from lancamentos
        where de_fora and coalesce(gasto_de, '') = ''
        order by data desc limit 8`;
      const [{ n }] = await sql<{ n: string }[]>`
        select count(*)::text as n from lancamentos where de_fora`;
      return {
        ok: orfas.length === 0,
        severidade: 'defeito',
        medida: `${n} lançamento(s) de fora · ${orfas.length} sem dono`,
        exemplos: orfas.map(
          (l) => `#${l.id} ${l.data} ${l.descricao} ${brl(Number(l.valor_total))} — sem gasto_de`,
        ),
      };
    },
  },

  {
    id: 'de-fora-nao-mexe-no-acerto',
    regra: '`de_fora` fica fora do acerto do casal — é conta com outra pessoa',
    pergunta: 'A soma do efeito no acerto dos lançamentos `de_fora` é exatamente zero?',
    checar: async () => {
      // Dois caminhos independentes para a mesma grandeza: a view (que aplica
      // o `case when de_fora then 0`) e a aritmética crua do que o acerto
      // seria sem a regra. O segundo número é quanto de dívida entre os dois
      // a regra está evitando — se ele for zero, o check não prova nada, e
      // dizer isso é mais honesto que mostrar dois zeros iguais.
      const [{ pela_view, sem_a_regra }] = await sql<{ pela_view: string; sem_a_regra: string }[]>`
        select coalesce(sum(v.saldo_irwin), 0)::text as pela_view,
               coalesce(sum(l.pago_irwin - (l.valor_total * l.pct_irwin)), 0)::text as sem_a_regra
          from v_lancamentos v join lancamentos l on l.id = v.id
         where l.de_fora`;
      const pela = Number(pela_view);
      const sem = Number(sem_a_regra);
      return {
        ok: Math.abs(pela) < TOLERANCIA,
        severidade: 'defeito',
        medida:
          `efeito no acerto: ${brl(pela)} · dívida entre os dois que a regra evita: ${brl(sem)}` +
          (Math.abs(sem) < TOLERANCIA ? ' (nenhuma ainda — o check não discrimina)' : ''),
      };
    },
  },

  {
    id: 'terceiros-derivado',
    regra: 'A dívida de terceiro é derivada, nunca gravada',
    pergunta: '`v_terceiros` concorda com a soma crua dos lançamentos e das devoluções?',
    checar: async () => {
      // A view calcula o saldo por um caminho (dois CTEs e um full join); aqui
      // a mesma grandeza é recalculada por fora, pessoa por pessoa. Se as duas
      // discordam, há um número para investigar — e é esta a razão de o saldo
      // não ser coluna: coluna gravada não tem segundo caminho.
      const linhas = await sql<
        { pessoa: string; saldo_view: string; saldo_cru: string }[]
      >`
        with pessoas as (
          select distinct pessoa from (
            select gasto_de as pessoa from lancamentos where de_fora and coalesce(gasto_de,'') <> ''
            union all select pessoa from reembolsos
          ) x
        )
        select p.pessoa,
               (select saldo from v_terceiros t where t.pessoa = p.pessoa)::text as saldo_view,
               (coalesce((select sum(valor_total) from lancamentos
                           where de_fora and gasto_de = p.pessoa), 0)
                - coalesce((select sum(valor) from reembolsos
                             where pessoa = p.pessoa), 0))::text as saldo_cru
          from pessoas p`;

      const fora = linhas.filter(
        (l) => Math.abs(Number(l.saldo_view) - Number(l.saldo_cru)) >= TOLERANCIA,
      );
      const [{ n }] = await sql<{ n: string }[]>`select count(*)::text as n from reembolsos`;
      return {
        ok: fora.length === 0,
        severidade: 'defeito',
        medida: `${linhas.length} pessoa(s) de fora · ${n} devolução(ões) registrada(s) · ${fora.length} divergência(s)`,
        exemplos: fora.map(
          (l) => `${l.pessoa}: view ${brl(Number(l.saldo_view))} ≠ cru ${brl(Number(l.saldo_cru))}`,
        ),
      };
    },
  },

  {
    id: 'reembolso-tem-recebedor',
    regra: 'A devolução diz quem recebeu — senão não controla nada',
    pergunta: 'Toda devolução aponta para Irwin ou Maria?',
    checar: async () => {
      const fora = await sql<{ id: number; pessoa: string; para_quem: string; valor: string }[]>`
        select id, pessoa, para_quem, valor from reembolsos
        where para_quem not in ('Irwin', 'Maria') limit 8`;
      return {
        ok: fora.length === 0,
        severidade: 'defeito',
        medida: `${fora.length} devolução(ões) sem recebedor válido`,
        exemplos: fora.map((r) => `#${r.id} ${r.pessoa} → "${r.para_quem}"`),
      };
    },
  },
];

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nInvariantes do Mozi\'s App 2.0 — só leitura\n');

  const falhas: { inv: Invariante; r: Resultado }[] = [];

  for (const inv of invariantes) {
    let r: Resultado;
    try {
      r = await inv.checar();
    } catch (e) {
      r = { ok: false, severidade: 'defeito', medida: `erro ao verificar: ${(e as Error).message}` };
    }
    const marca = r.ok ? '  ok  ' : r.severidade === 'herança' ? ' aviso' : ' FALHA';
    console.log(`${marca}  ${inv.id.padEnd(24)} ${inv.regra}`);
    console.log(`        ${r.medida}`);
    for (const ex of r.exemplos ?? []) console.log(`          · ${ex}`);
    console.log();
    if (!r.ok) falhas.push({ inv, r });
  }

  const defeitos = falhas.filter((f) => f.r.severidade !== 'herança');
  const avisos = falhas.filter((f) => f.r.severidade === 'herança');

  console.log('─'.repeat(72));
  if (defeitos.length === 0 && avisos.length === 0) {
    console.log(`${invariantes.length} invariantes, nenhuma divergência.`);
  } else {
    console.log(
      `${invariantes.length} invariantes · ${defeitos.length} defeito(s) · ${avisos.length} aviso(s) para olhar`,
    );
    for (const f of defeitos) console.log(`  FALHA  ${f.inv.id}: ${f.inv.pergunta}`);
    for (const f of avisos) console.log(`  aviso  ${f.inv.id}: ${f.inv.pergunta}`);
  }
  console.log();

  await sql.end();
  // Só defeito derruba o comando. Aviso é para ler, não para bloquear — se
  // avisos travassem a saída, a primeira reação seria silenciá-los.
  process.exit(defeitos.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

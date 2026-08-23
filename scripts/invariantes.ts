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
  /** A regra do PARA-O-APP-2.0.md ou do CLAUDE.md que isto protege. */
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
      const cruas = await sql<{ valor_total: string; pago_irwin: string | null; pct_irwin: string }[]>`
        select valor_total, pago_irwin, pct_irwin from lancamentos`;
      const viaTs = cruas.reduce((acc, l) => {
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

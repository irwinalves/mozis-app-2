/**
 * Gera os lançamentos pendentes das regras de recorrência indefinida.
 *
 * IDEMPOTENTE por construção: cada regra guarda `ultima_geracao`, e a próxima
 * ocorrência é sempre calculada a partir dela. Rodar duas vezes no mesmo dia não
 * duplica nada — é isso que torna seguro disparar diariamente em vez de
 * mensalmente (o plano Hobby da Vercel limita cron a 1 disparo por dia).
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import {
  ehQuitacaoDe,
} from './api';
import {
  fimDoMes,
  pctIrwinDe,
  formatarData,
  gerarDatasRecorrencia,
  normalizarFreq,
  ocorrenciaFreq,
} from './lancamentos';

interface Regra {
  id: number;
  descricao: string;
  categoria: string;
  fonte: string | null;
  valor: string;
  divisao: string;
  pct_irwin_custom: string | null;
  quem_pagou: string | null;
  frequencia: string;
  ultima_geracao: Date | string | null;
  data_inicio: Date | string;
}

function comoData(v: Date | string): Date {
  if (v instanceof Date) {
    // O driver devolve `date` em meia-noite UTC — extrair os componentes em UTC
    // e remontar local, senão em fuso negativo o dia volta um.
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

export async function gerarRecorrenciasPendentes() {
  const regras = await db.execute<Regra & Record<string, unknown>>(
    sql`select * from recorrencias where ativo = true`,
  );

  const [conf] = await db.execute<{ pct_irwin_renda: string }>(
    sql`select pct_irwin_renda from config where id = 1`,
  );
  const pctRenda = Number(conf?.pct_irwin_renda ?? 0.4947);

  const limite = fimDoMes(new Date());
  const geradas: { regra: string; datas: string[] }[] = [];

  for (const r of regras) {
    const freq = normalizarFreq(r.frequencia);
    const base = comoData(r.ultima_geracao ?? r.data_inicio);
    const proxima = ocorrenciaFreq(base, freq, 1);
    if (proxima.getTime() > limite.getTime()) continue; // nada pendente ainda

    const datas = gerarDatasRecorrencia(proxima, freq, limite, 60);
    if (!datas.length) continue;

    const inseridas: string[] = [];
    await db.transaction(async (tx) => {
      for (const data of datas) {
        // Guarda anti-duplicata.
        //
        // A idempotência via `ultima_geracao` sozinha NÃO basta, e isso foi
        // medido na base real: existem regras ATIVAS duplicadas (duas para
        // 'Clube Livelo', duas para 'Natação André') e pelo menos uma
        // `Última Geração` defasada — 'Orgânicos do Chico' marcava 10/08 com o
        // lançamento de 24/08 já gravado. Nos dois casos o gatilho antigo
        // regrava por cima, criando lançamento em dobro.
        //
        // Isto não muda regra de negócio: faz a função cumprir o que ela já se
        // propunha a ser.
        const [existe] = await tx.execute<{ n: string }>(
          sql`select count(*) as n from lancamentos
              where data = ${formatarData(data)}
                and descricao = ${r.descricao}
                and valor_total = ${r.valor}
                and recorrente = true`,
        );
        if (Number(existe.n) > 0) continue;
        inseridas.push(formatarData(data));

        await tx.execute(
          sql`insert into lancamentos
                (data, descricao, categoria, tipo, fonte, valor_total, divisao,
                 pct_irwin_custom, pct_irwin, eh_quitacao, quem_pagou,
                 pago_irwin, recorrente)
              values (${formatarData(data)}, ${r.descricao}, ${r.categoria}, 'Fixa',
                      ${r.fonte}, ${r.valor}, ${r.divisao}, ${r.pct_irwin_custom},
                      ${pctIrwinDe(r.divisao, Number(r.pct_irwin_custom) * 100, pctRenda)},
                      ${ehQuitacaoDe(r.categoria)}, ${r.quem_pagou},
                      -- mesmo mapa de pagamento de um lançamento comum
                      ${r.quem_pagou === 'Irwin' ? Number(r.valor) : r.quem_pagou === 'Maria' ? 0 : null},
                      true)`,
        );
      }
      await tx.execute(
        sql`update recorrencias set ultima_geracao = ${formatarData(datas[datas.length - 1])}
            where id = ${r.id}`,
      );
    });

    if (inseridas.length) geradas.push({ regra: r.descricao, datas: inseridas });
  }

  return { regras: regras.length, geradas };
}

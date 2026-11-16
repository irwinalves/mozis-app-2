/**
 * Quem nos deve — a outra metade do `de_fora`.
 *
 * POR QUE ESTA TELA EXISTE
 *
 * Marcar um gasto como `De fora` resolvia metade do problema: a compra passa a
 * ficar registrada e fora do acerto do casal. A metade que faltava é a dívida.
 * Sem ela, a conta da Vivo da mãe do Irwin — R$ 200 por mês — não tinha onde
 * aparecer, e a saída que sobrava era não lançar: R$ 3.499,00 em dez meses
 * fora do app.
 *
 * A dívida aqui é DERIVADA, nunca gravada: soma dos `de_fora` da pessoa menos
 * as devoluções registradas. Ver `v_terceiros`.
 */
import Link from 'next/link';
import { listarTerceiros } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { brl, dataBR } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const QUITE = 0.005;

export default async function PaginaTerceiros() {
  const [eu, terceiros] = await Promise.all([quemEsta(), listarTerceiros()]);

  const devendo = terceiros.filter((t) => t.saldo > QUITE);
  const quites = terceiros.filter((t) => Math.abs(t.saldo) <= QUITE);
  const adiantados = terceiros.filter((t) => t.saldo < -QUITE);
  const totalDevido = devendo.reduce((s, t) => s + t.saldo, 0);

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Quem nos deve</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <div className="conteudo">
        <div className="pad terceiros">
          {terceiros.length === 0 ? (
            <div className="card">
              <div className="vazio">
                Ninguém de fora por aqui ainda.
                <br />
                <br />
                Um gasto entra nesta tela quando é marcado como <b>De fora</b> — passou pelo
                cartão de vocês, mas é de outra pessoa. A conta da Vivo da mãe do Irwin é o
                caso típico: ele paga, ela devolve.
              </div>
            </div>
          ) : (
            <>
              {/* O total só aparece com mais de um devedor. Com um só, ele
                  repetiria o número da linha de baixo — e um número repetido
                  faz quem lê procurar a diferença entre os dois. */}
              {devendo.length > 1 && (
                <div className="card suave">
                  <div className="t-rot">Em aberto, somando todos</div>
                  <div className="terceiro-saldo pos">{brl(totalDevido)}</div>
                </div>
              )}

              {devendo.length > 0 && (
                <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
                  <div className="titulo-lista">
                    <span>Em aberto</span>
                    <span>
                      {devendo.length === 1 ? '1 pessoa' : `${devendo.length} pessoas`}
                    </span>
                  </div>
                  {devendo.map((t) => (
                    <LinhaTerceiro key={t.pessoa} t={t} />
                  ))}
                </div>
              )}

              {adiantados.length > 0 && (
                <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
                  {/* Saldo negativo não é erro: a mãe pode devolver dois meses
                      de uma vez. O crédito fica visível para abater o gasto do
                      mês que vem em vez de virar diferença sem explicação. */}
                  <div className="titulo-lista">
                    <span>Devolveram adiantado</span>
                    <span>a favor deles</span>
                  </div>
                  {adiantados.map((t) => (
                    <LinhaTerceiro key={t.pessoa} t={t} />
                  ))}
                </div>
              )}

              {quites.length > 0 && (
                <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
                  <div className="titulo-lista">
                    <span>Quites</span>
                    <span>
                      {quites.length === 1 ? '1 pessoa' : `${quites.length} pessoas`}
                    </span>
                  </div>
                  {quites.map((t) => (
                    <LinhaTerceiro key={t.pessoa} t={t} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function LinhaTerceiro({
  t,
}: {
  t: Awaited<ReturnType<typeof listarTerceiros>>[number];
}) {
  const quite = Math.abs(t.saldo) <= QUITE;
  return (
    <Link href={`/terceiros/${encodeURIComponent(t.pessoa)}`} className="linha-terceiro">
      <div className="lt-nome">
        <b>{t.pessoa}</b>
        <span className="lt-meta">
          {t.lancamentos === 0
            ? 'só devoluções'
            : `${t.lancamentos} ${t.lancamentos === 1 ? 'gasto' : 'gastos'}`}
          {t.ultimoGasto && ` · último ${dataBR(t.ultimoGasto).slice(0, 5)}`}
          {t.devolucoes > 0 && ` · ${t.devolucoes} devolveu`}
        </span>
      </div>
      <div className={`lt-saldo ${quite ? '' : t.saldo > 0 ? 'pos' : 'neg'}`}>
        {quite ? 'quites' : brl(Math.abs(t.saldo))}
      </div>
    </Link>
  );
}

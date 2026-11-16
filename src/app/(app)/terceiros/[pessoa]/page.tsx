/**
 * O extrato de uma pessoa de fora: o que passou pelo nosso cartão e o que ela
 * já devolveu, numa linha do tempo só.
 *
 * Duas listas separadas obrigariam quem lê a intercalar as datas de cabeça
 * para responder "ela pagou o mês de setembro?" — que é a única pergunta que
 * se faz aqui.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { extratoTerceiro } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { brl, dataBR } from '@/lib/formato';
import { Devolucoes } from './Devolucoes';

export const dynamic = 'force-dynamic';

export default async function PaginaTerceiro({
  params,
}: {
  params: Promise<{ pessoa: string }>;
}) {
  const { pessoa: cru } = await params;
  const pessoa = decodeURIComponent(cru);

  const [eu, extrato] = await Promise.all([quemEsta(), extratoTerceiro(pessoa)]);
  if (!extrato.gastos.length && !extrato.devolucoes.length) notFound();

  const quite = Math.abs(extrato.saldo) <= 0.005;

  /* Gastos e devoluções no mesmo eixo do tempo, do mais novo para o mais
     velho. O `sort` é estável no V8, então na mesma data a devolução aparece
     depois do gasto que ela quita — que é a ordem em que a coisa aconteceu. */
  const linha = [
    ...extrato.gastos.map((g) => ({ ...g, kind: 'gasto' as const })),
    ...extrato.devolucoes.map((d) => ({ ...d, kind: 'devolucao' as const })),
  ].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/terceiros" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>{pessoa}</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <div className="conteudo">
        <div className="pad terceiros">
          <div className="card suave">
            <div className="t-rot">{quite ? 'Situação' : 'Em aberto'}</div>
            <div
              className={`terceiro-saldo ${quite ? '' : extrato.saldo > 0 ? 'pos' : 'neg'}`}
            >
              {quite
                ? 'quites'
                : extrato.saldo > 0
                  ? brl(extrato.saldo)
                  : `${brl(-extrato.saldo)} a favor`}
            </div>
            <div className="terceiro-conta">
              {brl(extrato.adiantado)} pelo cartão de vocês
              {extrato.devolvido > 0 && <> · {brl(extrato.devolvido)} devolvido</>}
            </div>
          </div>

          <Devolucoes
            pessoa={pessoa}
            saldo={extrato.saldo}
            eu={eu}
            devolucoes={extrato.devolucoes}
          />

          <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <div className="titulo-lista">
              <span>Linha do tempo</span>
              <span>{linha.length} lançamentos</span>
            </div>
            {linha.map((it) => (
              <div key={`${it.kind}-${it.id}`} className="linha-terceiro">
                <div className="lt-nome">
                  <b>
                    {it.kind === 'gasto'
                      ? it.descricao
                      : `Devolveu para ${it.paraQuem}`}
                  </b>
                  <span className="lt-meta">
                    {dataBR(it.data)}
                    {it.kind === 'gasto' && it.quemPagou && ` · pagou ${it.quemPagou}`}
                    {it.kind === 'devolucao' && it.obs && ` · ${it.obs}`}
                  </span>
                </div>
                <div className={`lt-saldo ${it.kind === 'gasto' ? '' : 'pos'}`}>
                  {it.kind === 'gasto' ? brl(it.valor) : `− ${brl(it.valor)}`}
                </div>
              </div>
            ))}
          </div>

          {/* C7 outra vez: esta tela mostra número que não é do casal, e o
              acerto entre os dois é o número mais lido do app. Dizer que são
              contas separadas evita a leitura errada de que isto some com o
              que a Maria deve. */}
          <div className="aviso">
            <span>ℹ</span>
            <div>
              Isto é conta com <b>{pessoa}</b>, não entra no acerto entre vocês dois. Os
              gastos marcados <b>De fora</b> ficam registrados e fora da divisão.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

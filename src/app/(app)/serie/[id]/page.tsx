/**
 * A série, em leitura. Primeira tela React do app.
 *
 * É um SERVER COMPONENT e chama `obterSerie` direto, sem passar por
 * `/api/[metodo]`: o HTTP existe para o navegador falar com o servidor, e aqui
 * já se está no servidor. O cliente RPC (`lib/rpc.ts`) é para as mutações da
 * Fase 2, que nascem no toque do usuário.
 *
 * A edição ainda não está aqui — de propósito. Esta tela existe para provar a
 * junta inteira: identidade de série no banco → view → API → React → tela.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obterSerie } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { LinhaLancamento } from '@/components/LinhaLancamento';
import { Avatar } from '@/components/Avatar';
import { EfeitoNoAcerto } from '@/components/EfeitoNoAcerto';
import { brl, mesAno } from '@/lib/formato';

export const dynamic = 'force-dynamic';

/**
 * Tira o ` N/M ` da descrição, deixando a raiz e o que vier depois dela.
 * Não altera o dado — é só apresentação, e o dado é o `seq`.
 */
function semParcela(descricao: string, raiz: string): string {
  const resto = descricao.replace(/^.*?\s[(]?\d[\d,+]*\/\d+[)]?(\s|$)/, '').trim();
  return resto ? `${raiz} ${resto}` : raiz;
}

export default async function PaginaSerie({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  const { id } = await params;
  const { de } = await searchParams;
  const idSerie = Number(id);
  if (!Number.isInteger(idSerie)) notFound();

  const eu = await quemEsta();

  let serie: Awaited<ReturnType<typeof obterSerie>>;
  try {
    serie = await obterSerie(idSerie, de ? Number(de) : undefined, eu);
  } catch {
    notFound();
  }

  const ehParcelamento = serie.tipo === 'parcelamento';
  const lancadas = serie.lancamentos - serie.futuras;
  const progresso = serie.total ? Math.min(1, lancadas / serie.total) : 0;

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>{ehParcelamento ? 'Parcelamento' : 'Recorrência'}</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <div className="conteudo">
        <div className="pad">
          <div className="card suave">
            <div className="serie-nome">{serie.descricao}</div>
            <div className="serie-sub">
              {serie.completa || !serie.total
                ? serie.lancamentos
                : `${serie.lancamentos} de ${serie.total}`}{' '}
              {ehParcelamento ? 'parcelas' : 'ocorrências'} · {brl(serie.totalValor)}
              {serie.primeira && serie.ultima
                ? ` · ${mesAno(serie.primeira)} a ${mesAno(serie.ultima)}`
                : ''}
            </div>

            {serie.total ? (
              <>
                <div className="serie-barra">
                  <i style={{ width: `${progresso * 100}%` }} />
                </div>
                <div className="serie-legenda">
                  <span>{lancadas} lançadas</span>
                  {serie.futuras > 0 && <span className="fut">{serie.futuras} futuras</span>}
                </div>
              </>
            ) : null}

            {/* Série sem nenhuma ocorrência tem saldo NULL porque a soma é
                sobre zero linhas — e NULL, na linha do acerto, quer dizer
                "sem pagador", que é outra coisa. Melhor não dizer nada. */}
            {serie.lancamentos > 0 && (
              <div className="serie-legenda" style={{ marginTop: 9 }}>
                <span>Efeito acumulado no acerto</span>
                <EfeitoNoAcerto saldoIrwin={serie.saldoIrwin} eu={eu} />
              </div>
            )}
          </div>

          {/* C7 — honestidade sobre a qualidade do dado. Uma série cuja
              numeração foi reconstruída por heurística no backfill não é a
              mesma coisa que uma criada pelo app, e a tela precisa dizer. */}
          {serie.origem === 'reconstruida' && (
            <div className="aviso" style={{ marginTop: 0, marginBottom: 10 }}>
              <span>⚠</span>
              <div>
                A numeração desta série foi <b>reconstruída pela data</b>: as descrições
                originais repetiam a mesma parcela. Confira antes de usar como referência.
              </div>
            </div>
          )}
          {serie.origem === 'backfill-parcial' && (
            <div className="aviso" style={{ marginTop: 0, marginBottom: 10 }}>
              <span>⚠</span>
              <div>
                Existe <b>mais de uma regra</b> com esta descrição, então as ocorrências
                antigas não foram ligadas a nenhuma. Só o que for gerado daqui em diante
                aparece aqui.
              </div>
            </div>
          )}
          {!serie.completa && serie.total && (
            <div className="aviso" style={{ marginTop: 0, marginBottom: 10 }}>
              <span>⚠</span>
              <div>
                A série declara <b>{serie.total} parcelas</b> e só {serie.lancamentos} foram
                lançadas. Isso é comum no histórico e não impede nada — mas o total acima é
                do que existe, não do que foi comprado.
              </div>
            </div>
          )}

          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {serie.itens.length === 0 ? (
              <div className="vazio">Nenhuma ocorrência ligada a esta série ainda.</div>
            ) : (
              serie.itens.map((it) => (
                <LinhaLancamento
                  key={it.id}
                  // A pílula já mostra a posição; repetir ` 3/12` no texto gasta
                  // a largura que a descrição tem de sobra em outras telas e
                  // aqui não tem. O que sobra depois da fração — como o
                  // `[cartao temp]` de uma série do histórico — fica.
                  item={{ ...it, descricao: semParcela(it.descricao, serie.descricao) }}
                  eu={eu}
                  ancora={serie.ancora === it.id}
                  meta={[it.categoria.replace(/^\d+\s/, ''), it.tipo, it.fonte]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

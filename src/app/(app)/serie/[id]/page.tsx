/**
 * A série, em leitura.
 *
 * SERVER COMPONENT: chama `obterSerie` direto, sem passar por `/api/[metodo]`.
 * HTTP existe para o navegador falar com o servidor, e aqui já se está no
 * servidor. O cliente RPC é para as mutações, que nascem no toque.
 *
 * A lista difere entre os dois tipos, e a régua não é gosto — é contagem: a
 * maior série de parcelas da base tem 12 linhas e cabe inteira, lida do começo
 * como a sequência que é; a maior recorrência tem 125, e carregar tudo seria
 * rolagem sem fim para chegar no que interessa, que é o recente.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obterSerie } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { CabecalhoSerie } from '@/components/CabecalhoSerie';
import { LinhaLancamento } from '@/components/LinhaLancamento';
import { Avatar } from '@/components/Avatar';
import { dataBR } from '@/lib/formato';

export const dynamic = 'force-dynamic';

/** Quantas ocorrências passadas a recorrência mostra de saída. */
const JANELA_RECORRENCIA = 6;

export default async function PaginaSerie({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; tudo?: string }>;
}) {
  const { id } = await params;
  const { de, tudo } = await searchParams;
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

  // Parcelamento: todas, crescente. Recorrência: as futuras mais as N últimas,
  // decrescente — e "ver mais" abre as anteriores.
  const futuras = serie.itens.filter((i) => i.futura);
  const passadas = serie.itens.filter((i) => !i.futura);
  const verTudo = tudo === '1';
  const escondidas = ehParcelamento
    ? 0
    : Math.max(0, passadas.length - JANELA_RECORRENCIA);

  const visiveis = ehParcelamento
    ? serie.itens
    : [
        ...futuras.slice().reverse(),
        ...(verTudo ? passadas.slice().reverse() : passadas.slice(-JANELA_RECORRENCIA).reverse()),
      ];

  const marcoDepoisDe = (i: number) =>
    ehParcelamento
      ? visiveis[i].futura && !visiveis[i - 1]?.futura
      : !visiveis[i].futura && visiveis[i - 1]?.futura;

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
          <CabecalhoSerie
            serie={serie}
            eu={eu}
            href={`/serie/${serie.id}/editar${de ? `?de=${de}` : ''}`}
          />

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
          {serie.origem === 'backfill-versoes' && (
            <div className="aviso" style={{ marginTop: 0, marginBottom: 10 }}>
              <span>⚠</span>
              <div>
                Esta recorrência teve <b>mais de uma regra</b> ao longo do tempo — era assim
                que se mudava o valor antes desta tela existir. As ocorrências de todas as
                versões estão reunidas aqui.
              </div>
            </div>
          )}
          {!serie.completa && serie.total && (
            <div className="aviso" style={{ marginTop: 0, marginBottom: 10 }}>
              <span>⚠</span>
              <div>
                A série declara <b>{serie.total} parcelas</b> e só {serie.lancamentos} foram
                lançadas. É comum no histórico e não impede nada — mas o total acima é do que
                existe, não do que foi comprado.
              </div>
            </div>
          )}

          <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <div className="titulo-lista">
              <span>{ehParcelamento ? 'Parcelas' : 'Ocorrências'}</span>
              <span>
                {ehParcelamento
                  ? `as ${serie.lancamentos}`
                  : `${visiveis.length} de ${serie.lancamentos}`}
              </span>
            </div>

            {visiveis.length === 0 ? (
              <div className="vazio">Nenhuma ocorrência ligada a esta série ainda.</div>
            ) : (
              visiveis.map((it, i) => (
                <div key={it.id}>
                  {/* O marco entra na virada entre passado e futuro. Sem ele
                      uma lista de 12 linhas iguais não diz onde a pessoa está
                      — foi a dúvida do primeiro uso: "estava numerando certo?".
                      A numeração estava; faltava o ponto de referência. */}
                  {i > 0 && marcoDepoisDe(i) && (
                    <div className="marco-hoje">hoje · {dataBR(serie.hoje).slice(0, 5)}</div>
                  )}
                  <LinhaLancamento
                    item={{
                      ...it,
                      // Na série, o nome se repete em toda linha. A etiqueta traz
                      // a posição e o texto traz a categoria, que é o que muda.
                      descricao: it.categoria.replace(/^\d+\s/, ''),
                      seq: it.posicao,
                      total: serie.total,
                    }}
                    eu={eu}
                    passada={!it.futura}
                    ancora={serie.ancora === it.id}
                    rotuloPosicao={
                      ehParcelamento ? undefined : `${it.posicao}ª`
                    }
                    meta={[it.tipo, it.divisao].filter(Boolean).join(' · ')}
                    href={`/serie/${serie.id}/editar?de=${it.id}`}
                  />
                </div>
              ))
            )}

            {escondidas > 0 && !verTudo && (
              <Link href={`/serie/${serie.id}?tudo=1${de ? `&de=${de}` : ''}`} className="ver-mais">
                ▼ Ver as {escondidas} anteriores
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

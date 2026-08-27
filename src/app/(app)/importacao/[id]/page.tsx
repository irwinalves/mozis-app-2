/**
 * O lote de uma importação.
 *
 * É o que o selo `fatura` na lista abre: tudo que entrou de uma vez, o efeito
 * que teve no acerto, e o botão de desfazer. Sem esta tela a importação seria
 * irreversível na prática — 154 linhas espalhadas pela lista não se desfazem
 * uma a uma.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { obterImportacao } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { LinhaLancamento } from '@/components/LinhaLancamento';
import { EfeitoNoAcerto } from '@/components/EfeitoNoAcerto';
import { brl, dataBR } from '@/lib/formato';
import { Desfazer } from './Desfazer';

export const dynamic = 'force-dynamic';

export default async function PaginaImportacao({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const idImp = Number(id);
  if (!Number.isInteger(idImp)) notFound();

  const eu = await quemEsta();

  let imp: Awaited<ReturnType<typeof obterImportacao>>;
  try {
    imp = await obterImportacao(idImp, eu);
  } catch {
    notFound();
  }

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Importação</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <div className="conteudo">
        <div className="pad">
          <div className="serie-cab">
            <div className="serie-topo">
              <div className="nome">{imp.titulo}</div>
            </div>
            <div className="serie-l2">
              <span className="unit">{brl(imp.total)}</span>
              <span className="ponto">·</span>
              {imp.qtd} {imp.qtd === 1 ? 'lançamento' : 'lançamentos'}
              {imp.series > 0 && (
                <>
                  <span className="ponto">·</span>
                  {imp.series} {imp.series === 1 ? 'série' : 'séries'}
                </>
              )}
            </div>
            <div className="serie-l3">
              importada em <b>{dataBR(imp.criadaEm)}</b>
              {imp.criadaPor && (
                <>
                  {' '}
                  por <b>{imp.criadaPor}</b>
                </>
              )}
            </div>
            <div className="serie-l4">
              no acerto:{' '}
              <EfeitoNoAcerto saldoIrwin={imp.efeitoNoAcerto} eu={eu} />
              {imp.arquivo && (
                <>
                  <span className="ponto">·</span>
                  {imp.arquivo}
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <div className="titulo-lista">
              <span>O que entrou</span>
              <span>{imp.itens.length}</span>
            </div>
            {imp.itens.length === 0 ? (
              <div className="vazio">Nada nesta importação.</div>
            ) : (
              imp.itens.map((it) => (
                <LinhaLancamento
                  key={it.linha}
                  item={{
                    id: it.linha,
                    data: it.data,
                    descricao: it.descricao,
                    categoria: it.categoria,
                    tipo: it.tipo,
                    fonte: null,
                    valor: it.valor,
                    quemPagou: it.quemPagou,
                    saldoIrwin: it.saldoIrwin,
                    gastoDe: it.gastoDe || null,
                  }}
                  eu={eu}
                  meta={[it.categoria.replace(/^\d+\s/, ''), it.tipo].filter(Boolean).join(' · ')}
                />
              ))
            )}
          </div>

          <Desfazer id={imp.id} qtd={imp.qtd} podeEditar={imp.podeEditar} />
        </div>
      </div>
    </>
  );
}

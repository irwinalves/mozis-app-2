/**
 * Reabrir um lote já importado.
 *
 * Serve a MESMA tela de revisão da importação, com as decisões do dia — as
 * linhas marcadas, as que ficaram de fora de propósito, os nomes reescritos e
 * as categorias escolhidas. É por isso que o lote guarda o estado da revisão e
 * não só o resultado dela: sem as linhas descartadas, "reabrir exatamente como
 * ficou" seria mentira.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { estadoDaImportacao, getOpcoes } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { Importador, type EstadoSalvo } from '../../../importar/Importador';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarImportacao({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const idImp = Number(id);
  if (!Number.isInteger(idImp)) notFound();

  const eu = await quemEsta();

  let guardado: Awaited<ReturnType<typeof estadoDaImportacao>>;
  try {
    guardado = await estadoDaImportacao(idImp);
  } catch (e) {
    // Um lote anterior à coluna `estado` não tem o que reabrir, e isso é uma
    // explicação, não um 404: a tela precisa dizer por quê.
    return (
      <>
        <header className="cabecalho">
          <div className="titulo">
            <Link href={`/importacao/${idImp}`} className="voltar" aria-label="Voltar">
              ←
            </Link>
            <h1>Editar importação</h1>
          </div>
        </header>
        <div className="conteudo">
          <div className="pad">
            <div className="aviso">
              <span>⚠</span>
              <div>{e instanceof Error ? e.message : 'Não consegui reabrir esta importação.'}</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const opcoes = await getOpcoes(eu);

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href={`/importacao/${idImp}`} className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Editar importação</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <Importador
        opcoes={{
          gruposLancar: opcoes.gruposLancar,
          divisoes: opcoes.divisoes,
          pagadores: opcoes.pagadores,
        }}
        eu={eu}
        edicao={{
          id: idImp,
          titulo: guardado.titulo,
          salvo: guardado.estado as EstadoSalvo,
        }}
      />
    </>
  );
}

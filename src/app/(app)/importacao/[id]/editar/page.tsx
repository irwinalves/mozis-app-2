/**
 * Corrigir em lote o que uma importação trouxe.
 *
 * Serve a MESMA tela de revisão, com duas camadas sobrepostas: as decisões do
 * dia da importação — que é a única fonte para as linhas que ficaram de fora,
 * porque o lote não guarda o que não entrou — e, por cima, o que os
 * lançamentos SÃO hoje.
 *
 * A ordem importa e é o coração da tela: o banco ganha. Quem renomeou uma linha
 * na tela normal encontra aqui o nome que escreveu, e só as linhas mexidas
 * nesta tela são regravadas. O objetivo é corrigir em bloco sem perder
 * trabalho, não reimportar.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { estadoDaImportacao, getOpcoes } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { Importador, type EstadoSalvo, type AtualDoLote } from '../../../importar/Importador';

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
          pagadores: opcoes.pagadores,
        }}
        eu={eu}
        edicao={{
          id: idImp,
          titulo: guardado.titulo,
          salvo: guardado.estado as EstadoSalvo,
          atual: guardado.atual as AtualDoLote,
        }}
      />
    </>
  );
}

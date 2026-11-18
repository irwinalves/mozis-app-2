/**
 * A porta da importação.
 *
 * SERVER COMPONENT só para buscar as opções e saber quem está olhando; o resto
 * é cliente, porque a tela inteira vive de um arquivo escolhido no aparelho e
 * de um estado de revisão que não existe no banco até o botão do fim.
 */
import Link from 'next/link';
import { getOpcoes } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import { Importador } from './Importador';

export const dynamic = 'force-dynamic';

export default async function PaginaImportar() {
  const eu = await quemEsta();
  const opcoes = await getOpcoes(eu);

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Importar</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <Importador
        opcoes={{
          gruposLancar: opcoes.gruposLancar,
          pagadores: opcoes.pagadores,
          pctIrwinRenda: opcoes.pctIrwinRenda,
        }}
        eu={eu}
      />
    </>
  );
}

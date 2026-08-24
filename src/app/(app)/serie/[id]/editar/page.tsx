/**
 * Editar uma série. UMA tela, duas portas de entrada.
 *
 * Pelo CABEÇALHO (sem `?de=`): escopo `da atual em diante` ou `todas`.
 * Por uma LINHA (com `?de=`):  escopo `só esta` ou `esta e as seguintes`.
 *
 * Duas implementações de edição em lote divergiriam, e a menos usada é que
 * teria o defeito — por isso é uma só, mudando âncora e padrão.
 *
 * Aqui a tela é CLIENT: escopo, campos e prévia mudam a cada toque, e a prévia
 * precisa vir do servidor a cada mudança, porque é ele que sabe recalcular o
 * efeito no acerto. O dado inicial vem do server component ao lado.
 */
import { notFound } from 'next/navigation';
import { obterSerie } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { getOpcoes } from '@/lib/api';
import { EditorSerie } from './EditorSerie';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarSerie({
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

  const opcoes = await getOpcoes(eu);

  return <EditorSerie serie={serie} opcoes={opcoes} eu={eu} ancoraId={de ? Number(de) : null} />;
}

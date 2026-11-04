/**
 * Editar UM lançamento — a mesma tela de Lançar, com os campos preenchidos.
 *
 * Era a reclamação do Irwin em 22/10: *"é praticamente a mesma tela de um
 * lançamento, não sei por que a gente está fazendo uma outra tela"*. Ele
 * estava certo, e a causa não era escolha de produto: a tela de Lançar vivia
 * no `Form.html` em JS solto, e `abrirEdicao()` a reconfigurava campo por
 * campo — escondendo cards, trocando o rótulo do botão, ligando o Excluir.
 *
 * O custo apareceu rápido: o campo `De fora`, criado no formulário novo em
 * 04/11, não existia na edição. `obterLancamento` não devolvia e
 * `atualizarLancamento` não gravava. Marcar errado era definitivo.
 *
 * Aqui não há tela nova: é `FormLancamento` recebendo `lancamento`. Campo que
 * entrar no formulário entra nas duas portas, porque é um formulário só.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOpcoes, obterLancamento } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import FormLancamento from '@/components/FormLancamento';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarLancamento({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) notFound();

  const eu = await quemEsta();
  const [opcoes, lancamento] = await Promise.all([getOpcoes(eu), obterLancamento(n)]);

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Editar lançamento</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <FormLancamento opcoes={opcoes} lancamento={lancamento} />
    </>
  );
}

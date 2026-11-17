/**
 * Lançar — a primeira tela a sair do `Form.html` para React.
 *
 * O formulário em si mora em `@/components/FormLancamento` e não aqui, porque
 * ele não é desta tela: série e importação vão usar o MESMO componente. Era
 * essa a dívida — três formulários do mesmo objeto, cada um com um subconjunto
 * diferente dos campos, porque o original vivia em HTML servido byte a byte e
 * não havia o que reusar.
 *
 * A rota `/` continua servindo o `Form.html`; o botão de lançar de lá aponta
 * para cá. Trocar a porta de entrada antes de migrar o resto é o que permite
 * validar no celular sem derrubar o app que vocês usam todo dia.
 *
 * O BOTÃO DE IMPORTAR FATURA MORA AQUI, e isso custou um mês de app sem
 * importação. Ele estava no `screen-new` do `Form.html`; quando a navegação
 * de baixo passou a mandar o Lançar para esta rota (9e55922, 22/10/2026), a
 * tela antiga virou código morto e o botão foi junto. A rota `/importar`
 * nunca quebrou — ficou sem porta, que é uma falha que nenhum teste de
 * backend, nenhum invariante e nenhum build pegam: todos eles provam que o
 * destino existe, e o que sumiu foi o caminho até ele.
 */
import Link from 'next/link';
import { getOpcoes } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import FormLancamento from '@/components/FormLancamento';

export const dynamic = 'force-dynamic';

export default async function PaginaLancar() {
  const eu = await quemEsta();
  const opcoes = await getOpcoes(eu);

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>Lançar</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <FormLancamento
        opcoes={opcoes}
        topo={
          <Link href="/importar" className="btn-importar">
            ↥ Importar fatura do cartão
          </Link>
        }
      />
    </>
  );
}

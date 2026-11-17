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
import { getAcertoContas, getOpcoes } from '@/lib/api';
import { quemEsta } from '@/lib/sessao';
import { Avatar } from '@/components/Avatar';
import FormLancamento from '@/components/FormLancamento';
import type { Divisao } from '@/components/DivisaoEPagador';

export const dynamic = 'force-dynamic';

/**
 * Monta a quitação do acerto — o que o botão `Quitar` fazia na tela antiga.
 *
 * O saldo vem de `getAcertoContas()`, o MESMO que desenha o card de onde o
 * botão foi tocado. Era a tentação óbvia mandar o valor na URL, e são duas
 * razões para não: dado financeiro do casal entra em histórico do navegador e
 * em log de servidor, e um valor que viaja por fora vira uma segunda fonte
 * para o saldo — exatamente o que a coluna `Saldo Irwin` existe para evitar.
 *
 * Quem deve paga: saldo positivo significa que a Maria deve ao Irwin, então é
 * ela quem lança, e a divisão é 100% de quem recebe — assim a quitação anula
 * o saldo em vez de criar outro.
 */
async function quitacao(opcoes: Awaited<ReturnType<typeof getOpcoes>>) {
  const acerto = await getAcertoContas();
  const saldo = acerto.mesAtual.saldo;
  if (Math.abs(saldo) < 0.005) return undefined; // já estão quites

  const devedor = saldo > 0 ? 'Maria' : 'Irwin';
  const credor = saldo > 0 ? 'Irwin' : 'Maria';
  const cat =
    opcoes.gruposLancar.find((g) => g.nome.startsWith('9 ')) ??
    opcoes.gruposLancar[opcoes.gruposLancar.length - 1];

  return {
    descricao: 'Quitação de acerto de contas',
    valor: Math.abs(saldo),
    categoria: cat.nome,
    tipo: cat.tipo,
    /* `Pix` era a origem na tela antiga. Virou `Banco`: a distinção nunca
       significou nada — um TED não é um Pix e os dois saem da mesma conta —
       e `Pix` hoje só é ACEITO na leitura, nunca gravado. */
    origem: 'Banco',
    pagador: devedor,
    divisao: (credor === 'Irwin' ? '100% Irwin' : '100% Maria') as Divisao,
  };
}

export default async function PaginaLancar({
  searchParams,
}: {
  searchParams: Promise<{ quitar?: string }>;
}) {
  const eu = await quemEsta();
  const opcoes = await getOpcoes(eu);
  const { quitar } = await searchParams;
  const inicial = quitar ? await quitacao(opcoes) : undefined;

  return (
    <>
      <header className="cabecalho">
        <div className="titulo">
          <Link href="/" className="voltar" aria-label="Voltar">
            ←
          </Link>
          <h1>{inicial ? 'Quitar acerto' : 'Lançar'}</h1>
        </div>
        {eu && <Avatar quem={eu} tamanho={28} />}
      </header>

      <FormLancamento
        opcoes={opcoes}
        inicial={inicial}
        topo={
          /* Na quitação o botão não aparece: importar fatura não tem nada a ver
             com zerar o acerto, e era justamente esse aparecimento fora de hora
             que a tela antiga produzia. */
          inicial ? undefined : (
            <Link href="/importar" className="btn-importar">
              ↥ Importar fatura do cartão
            </Link>
          )
        }
      />
    </>
  );
}

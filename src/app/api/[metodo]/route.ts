/**
 * Rota única de RPC.
 *
 * Preserva a forma de chamada do Apps Script: o front manda o NOME do método e
 * a lista de argumentos posicionais, exatamente como `google.script.run` fazia.
 * Só os 14 métodos abaixo são alcançáveis — o mapa é a lista de permissão.
 */
import { NextResponse } from 'next/server';
import * as api from '@/lib/api';
import { quemEsta } from '@/lib/sessao';

const METODOS = {
  getOpcoes: api.getOpcoes,
  ultimosLancamentos: api.ultimosLancamentos,
  buscarLancamentos: api.buscarLancamentos,
  getAcertoContas: api.getAcertoContas,
  getDashboard: api.getDashboard,
  obterSerie: api.obterSerie,
  serieDoLancamento: api.serieDoLancamento,
  previewEdicaoSerie: api.previewEdicaoSerie,
  atualizarSerie: api.atualizarSerie,
  analisarFatura: api.analisarFatura,
  lancarFatura: api.lancarFatura,
  obterImportacao: api.obterImportacao,
  listarImportacoes: api.listarImportacoes,
  desfazerImportacao: api.desfazerImportacao,
  estadoDaImportacao: api.estadoDaImportacao,
  ajustarImportacao: api.ajustarImportacao,
  previewConciliacao: api.previewConciliacao,
  // O que o app tem no ciclo do cartão e a fatura não explicou (C18). Só lê.
  sobrasDoCiclo: api.sobrasDoCiclo,
  conciliarValor: api.conciliarValor,
  salvarLancamento: api.salvarLancamento,
  obterLancamento: api.obterLancamento,
  atualizarLancamento: api.atualizarLancamento,
  excluirLancamento: api.excluirLancamento,
  // A porta pela qual a importação corrige um lançamento ANTIGO por estorno
  // parcial. Só reduz valor e carimba a Obs — ver `ajustarValorLancamento`.
  ajustarValorLancamento: api.ajustarValorLancamento,
  // Terceiros: a dívida de quem não é do casal. Nenhum destes toca o acerto
  // entre Irwin e Maria — ver o cabeçalho do bloco em `api.ts`.
  listarTerceiros: api.listarTerceiros,
  extratoTerceiro: api.extratoTerceiro,
  registrarReembolso: api.registrarReembolso,
  excluirReembolso: api.excluirReembolso,
  previewParcelas: api.previewParcelas,
  previewRecorrencia: api.previewRecorrencia,
} as const;

/**
 * `previewImportacao` e `lancarImportacaoLote` SAÍRAM da lista (A21).
 *
 * Eram a porta da tela antiga de OFX/CSV, que grava sem criar `importacoes` —
 * logo, sem desfazer. Em 21/10/2026 entraram por ali 150 linhas, R$ 18.796,35,
 * da fatura de setembro, todas `Ambos` 50/50 e com descrição crua.
 *
 * A tela já não tinha botão nenhum apontando para ela, nem aqui nem em
 * produção — e mesmo assim foi usada. A explicação que sobra é o app instalado
 * no celular: ele é PWA, e uma versão em cache do `Form.html` continua tendo a
 * tela, com o código que chamava estes dois métodos. Esconder o botão não
 * alcança quem já tem a página velha guardada; fechar a porta do servidor,
 * sim. É por isso que a A21 diz "deixar de existir, não ficar escondida".
 */

type Metodo = keyof typeof METODOS;

/**
 * Métodos que precisam saber QUEM está olhando. A pessoa entra como último
 * argumento, depois dos que o front mandou.
 *
 * A resolução da sessão fica aqui e não dentro de `lib/api`, porque aquele
 * módulo também roda em scripts fora do Next — importar NextAuth lá dentro
 * quebraria `verificar-e2e`, `sync` e `reconcile` de uma vez.
 */
const PRECISAM_DA_PESSOA = new Set<string>(['getOpcoes', 'obterSerie', 'obterImportacao']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ metodo: string }> },
) {
  const { metodo } = await params;

  if (!Object.prototype.hasOwnProperty.call(METODOS, metodo)) {
    return NextResponse.json({ error: `Método desconhecido: ${metodo}` }, { status: 404 });
  }

  let args: unknown[] = [];
  try {
    const corpo = await req.text();
    args = corpo ? JSON.parse(corpo) : [];
    if (!Array.isArray(args)) args = [args];
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }

  if (PRECISAM_DA_PESSOA.has(metodo)) args = [...args, await quemEsta()];

  try {
    const fn = METODOS[metodo as Metodo] as (...a: unknown[]) => Promise<unknown>;
    const resultado = await fn(...args);
    return NextResponse.json(resultado ?? null);
  } catch (e) {
    // A mensagem vai para a tela: o front mostra `e.message` ao usuário, e a
    // checagem de assinatura depende de a palavra "desatualizada" chegar lá.
    const msg = e instanceof Error ? e.message : 'Erro inesperado.';
    console.error(`[api/${metodo}]`, e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

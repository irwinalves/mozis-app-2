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
  getPatrimonio: api.getPatrimonio,
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
  conciliarValor: api.conciliarValor,
  salvarLancamento: api.salvarLancamento,
  obterLancamento: api.obterLancamento,
  atualizarLancamento: api.atualizarLancamento,
  excluirLancamento: api.excluirLancamento,
  previewParcelas: api.previewParcelas,
  previewRecorrencia: api.previewRecorrencia,
  salvarInvestimento: api.salvarInvestimento,
  previewImportacao: api.previewImportacao,
  lancarImportacaoLote: api.lancarImportacaoLote,
} as const;

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

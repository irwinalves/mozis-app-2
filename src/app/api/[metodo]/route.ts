/**
 * Rota única de RPC.
 *
 * Preserva a forma de chamada do Apps Script: o front manda o NOME do método e
 * a lista de argumentos posicionais, exatamente como `google.script.run` fazia.
 * Só os 14 métodos abaixo são alcançáveis — o mapa é a lista de permissão.
 */
import { NextResponse } from 'next/server';
import * as api from '@/lib/api';

const METODOS = {
  getOpcoes: api.getOpcoes,
  ultimosLancamentos: api.ultimosLancamentos,
  buscarLancamentos: api.buscarLancamentos,
  getAcertoContas: api.getAcertoContas,
  getDashboard: api.getDashboard,
  getPatrimonio: api.getPatrimonio,
  salvarLancamento: api.salvarLancamento,
  obterLancamento: api.obterLancamento,
  atualizarLancamento: api.atualizarLancamento,
  excluirLancamento: api.excluirLancamento,
  previewParcelas: api.previewParcelas,
  previewRecorrencia: api.previewRecorrencia,
  salvarInvestimento: api.salvarInvestimento,
} as const;

type Metodo = keyof typeof METODOS;

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

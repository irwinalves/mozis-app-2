/**
 * Gatilho das recorrências. Chamado pelo Vercel Cron (ver vercel.json).
 *
 * Protegido por CRON_SECRET: sem isso a rota ficaria aberta e qualquer um
 * poderia disparar gravação de lançamentos.
 */
import { NextResponse } from 'next/server';
import { gerarRecorrenciasPendentes } from '@/lib/recorrencias';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (segredo && auth !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const r = await gerarRecorrenciasPendentes();
    console.log('[cron/recorrencias]', JSON.stringify(r));
    return NextResponse.json(r);
  } catch (e) {
    console.error('[cron/recorrencias]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro inesperado.' },
      { status: 500 },
    );
  }
}

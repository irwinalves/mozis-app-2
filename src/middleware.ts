/**
 * Fecha o app inteiro, inclusive `/api`.
 *
 * A rota de cron fica de fora porque é chamada pela Vercel, sem sessão — ela
 * tem a própria proteção via CRON_SECRET.
 */
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * Exceção de desenvolvimento, com TRAVA DUPLA.
 *
 * Só vale fora de produção E com a variável ligada explicitamente. Na Vercel
 * `NODE_ENV` é sempre 'production', então isto não tem como virar porta aberta
 * no deploy — nem se alguém copiar o .env por engano.
 *
 * Existe porque, sem credencial OAuth do Google, não haveria como exercitar o
 * app localmente. Sai quando as credenciais entrarem.
 */
const BYPASS_DEV =
  process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS_DEV === 'sim';

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (BYPASS_DEV) return NextResponse.next();

  const publica =
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname === '/entrar';

  if (publica) return NextResponse.next();

  if (!req.auth) {
    // Chamada de dados responde 401; navegação vai para a tela de entrada.
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/entrar';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Deixa passar estáticos e o shim; todo o resto é protegido.
  // Ícones e manifest ficam FORA da proteção de propósito: o iOS busca o
  // apple-touch-icon sem cookie de sessão ao criar o atalho. Protegê-los
  // faria o atalho nascer com ícone genérico.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|gs-shim.js|manifest.json|icone-).*)',
  ],
};

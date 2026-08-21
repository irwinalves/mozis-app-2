/**
 * Autenticação — Auth.js com provider Google e allowlist de dois e-mails.
 *
 * Por que allowlist e não só "entrar com Google": o dado é financeiro e a URL é
 * pública. Sem a lista, qualquer conta Google do mundo entraria. Hoje o Apps
 * Script protegia isso de graça; na Vercel é trabalho explícito.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { elencoDoAmbiente, podeEntrar } from '@/lib/pessoas';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  // Sem isto o Auth.js recusa a requisição em produção por não confiar no
  // host. Na Vercel a URL é gerada dinamicamente (e muda a cada preview),
  // então não dá para fixar AUTH_URL.
  trustHost: true,
  callbacks: {
    // Quem pode entrar sai de `lib/pessoas`, que é a MESMA fonte de quem é
    // quem. Eram duas listas antes; duas listas que precisam concordar acabam
    // divergindo, e aqui isso significaria ou ninguém entrar, ou alguém ver o
    // sinal da dívida trocado.
    signIn({ profile }) {
      return podeEntrar(elencoDoAmbiente(), profile?.email);
    },
    // O e-mail precisa sobreviver até a sessão para a tela saber quem está
    // olhando. Sem isto o token do Auth.js não o carrega por padrão.
    jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      return token;
    },
    session({ session, token }) {
      if (token.email) session.user.email = token.email;
      return session;
    },
  },
  pages: { signIn: '/entrar' },
});

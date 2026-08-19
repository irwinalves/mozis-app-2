/**
 * Autenticação — Auth.js com provider Google e allowlist de dois e-mails.
 *
 * Por que allowlist e não só "entrar com Google": o dado é financeiro e a URL é
 * pública. Sem a lista, qualquer conta Google do mundo entraria. Hoje o Apps
 * Script protegia isso de graça; na Vercel é trabalho explícito.
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

/** Quem pode entrar. Vem do ambiente para não versionar e-mail no repositório. */
const PERMITIDOS = (process.env.EMAILS_PERMITIDOS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  // Sem isto o Auth.js recusa a requisição em produção por não confiar no
  // host. Na Vercel a URL é gerada dinamicamente (e muda a cada preview),
  // então não dá para fixar AUTH_URL.
  trustHost: true,
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      // Lista vazia recusa TODO MUNDO, de propósito: uma variável de ambiente
      // esquecida no deploy não pode virar porta aberta.
      return PERMITIDOS.includes(email);
    },
  },
  pages: { signIn: '/entrar' },
});

/**
 * Quem está olhando — resolvido no servidor.
 *
 * POR QUE FICA AQUI E NÃO EM `lib/api.ts`
 *
 * `lib/api.ts` também roda em scripts fora do Next (`verificar-e2e`, `sync`,
 * `reconcile`). Importar NextAuth lá dentro quebraria os três de uma vez. Por
 * isso a sessão é resolvida na borda — na rota de RPC ou na página — e entra
 * na API como argumento.
 *
 * Este módulo existe porque a lógica estava dentro de
 * `src/app/api/[metodo]/route.ts` e a primeira tela React precisou da mesma
 * coisa. Duplicar seria a regra nº 3 quebrada no primeiro dia: uma
 * implementação, nunca duas.
 */
import 'server-only';
import { auth } from '@/auth';
import { elencoDoAmbiente, pessoaDoEmail, type Pessoa } from '@/lib/pessoas';
import { modoDemo } from '@/lib/demo';

/**
 * Fingir ser uma pessoa, só em desenvolvimento. TRAVA DUPLA: fora de produção
 * E com a variável ligada. Na Vercel `NODE_ENV` é sempre 'production', então
 * isto não tem como virar porta aberta no deploy — nem se alguém copiar o
 * `.env` por engano.
 */
const PESSOA_FINGIDA =
  process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS_DEV === 'sim'
    ? (process.env.BYPASS_PESSOA as Pessoa | undefined)
    : undefined;

export async function quemEsta(): Promise<Pessoa | null> {
  if (PESSOA_FINGIDA === 'Irwin' || PESSOA_FINGIDA === 'Maria') return PESSOA_FINGIDA;
  /* No deploy público de demonstração não há login, e sem ninguém o app mostra
     os dois lados do acerto em vez de escolher um — que é o certo em casa e é
     exatamente o que esconde a feature de quem veio conhecer o app. Então a
     demonstração é vista pelos olhos de uma das duas pessoas fictícias. */
  if (await modoDemo()) return 'Irwin';
  try {
    const sessao = await auth();
    return pessoaDoEmail(elencoDoAmbiente(), sessao?.user?.email);
  } catch {
    // Sessão indisponível não é erro: a tela apenas volta a mostrar os dois
    // lados do acerto, em vez de escolher um.
    return null;
  }
}

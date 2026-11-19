/**
 * O shell das telas React — o mesmo do `Form.html`: coluna de 520px no
 * máximo, centralizada, com o cabeçalho fixo e a área rolável no meio.
 *
 * Não é um grupo de rotas por organização: é para estas telas terem o shell e
 * a rota `/`, que ainda serve o `Form.html` por `src/app/route.ts`, não ter.
 */
import { TARJA_DEMO, modoDemo } from '@/lib/demo';

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  /* A mesma tarja que o `Form.html` recebe em `src/app/route.ts`, da mesma
     string — as duas metades do app precisam dizer a mesma coisa. */
  const demo = await modoDemo();
  return (
    <div className="app">
      {demo && <div dangerouslySetInnerHTML={{ __html: TARJA_DEMO }} />}
      {children}
    </div>
  );
}

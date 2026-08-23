/**
 * O shell das telas React — o mesmo do `Form.html`: coluna de 520px no
 * máximo, centralizada, com o cabeçalho fixo e a área rolável no meio.
 *
 * Não é um grupo de rotas por organização: é para estas telas terem o shell e
 * a rota `/`, que ainda serve o `Form.html` por `src/app/route.ts`, não ter.
 */
export default function LayoutApp({ children }: { children: React.ReactNode }) {
  return <div className="app">{children}</div>;
}

/**
 * Cliente tipado da rota única de RPC.
 *
 * As telas React NÃO usam o shim `google.script.run` — ele existe para o
 * `Form.html` rodar sem alteração, e replicá-lo aqui traria de volta os
 * handlers encadeados que só existiam por causa do Apps Script.
 *
 * O que NÃO muda: o transporte e a lista de permissão. Um backend só,
 * `/api/[metodo]`, com os mesmos nomes. Duas portas para os mesmos dados é
 * como se cria divergência.
 *
 * Os tipos vêm por `Awaited<ReturnType<...>>` das funções reais de `lib/api`.
 * Isso é de propósito: `import type` some na compilação, então importar do
 * módulo de servidor aqui não arrasta o driver do Postgres para o bundle — e
 * garante que a tela e a API não podem discordar sobre a forma da resposta,
 * que é a versão em TypeScript do que o `contrato.test.ts` faz com o front
 * antigo.
 */
import type * as api from '@/lib/api';

type Metodos = typeof api;
type Retorno<M extends keyof Metodos> = Metodos[M] extends (...a: never[]) => Promise<infer R>
  ? R
  : never;

export class ErroRpc extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ErroRpc';
  }
}

/**
 * Chama um método do backend.
 *
 * `pessoa` NUNCA vai daqui: quem está olhando é resolvido no servidor, dentro
 * da rota. Mandar do cliente seria deixar a tela escolher de quem é o saldo.
 */
export async function rpc<M extends keyof Metodos>(
  metodo: M,
  ...args: unknown[]
): Promise<Retorno<M>> {
  const r = await fetch(`/api/${String(metodo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });

  const corpo = await r.json().catch(() => null);

  if (!r.ok) {
    // A mensagem do servidor vai para a tela — a checagem de assinatura
    // depende de a palavra "desatualizada" chegar até lá.
    const msg =
      corpo && typeof corpo === 'object' && 'error' in corpo
        ? String((corpo as { error: unknown }).error)
        : `Erro ${r.status}`;
    throw new ErroRpc(msg, r.status);
  }

  return corpo as Retorno<M>;
}

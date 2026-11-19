/**
 * O modo demonstração, e por que a chave não é uma variável de ambiente.
 *
 * Existe um deploy público deste mesmo código, sem login, para quem quiser
 * experimentar o app antes de clonar. É o MESMO código que roda o app de
 * verdade, com o dinheiro de verdade de duas pessoas dentro — então abrir a
 * porta por variável de ambiente seria deixar a segurança do app real
 * depender de ninguém errar uma configuração na Vercel.
 *
 * Aqui são DUAS condições, e a segunda não está sob controle de quem
 * configura: a variável `MODO_DEMO` precisa estar ligada **e** o banco precisa
 * ter a tabela `demo_publico`. Essa tabela não existe em nenhuma migração —
 * quem a cria é `scripts/semear-demo.ts`, que por sua vez recusa rodar fora de
 * um host local sem `--remoto` e recusa escrever num banco que já tem
 * lançamentos sem `--limpar`.
 *
 * O resultado é o que interessa: o banco do casal não tem como responder "sim"
 * a esta pergunta. Ligar `MODO_DEMO` no projeto errado não abre nada, porque a
 * segunda chave não está lá.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';

let resposta: Promise<boolean> | null = null;

async function perguntarAoBanco(): Promise<boolean> {
  try {
    const linhas = await db.execute<{ ok: boolean }>(
      sql`select ok from demo_publico limit 1`,
    );
    return linhas[0]?.ok === true;
  } catch {
    // Tabela inexistente é a resposta "não", e é a resposta esperada em
    // produção. Qualquer outra falha também fecha a porta, que é o lado
    // seguro de errar.
    return false;
  }
}

/**
 * Memorizada por processo: a resposta não muda em quanto o processo vive, e
 * isto roda no caminho de TODA requisição.
 */
export function bancoEhDemo(): Promise<boolean> {
  resposta ??= perguntarAoBanco();
  return resposta;
}

/** A variável sozinha não abre nada. Serve para nem consultar o banco à toa. */
export const DEMO_PEDIDO = process.env.MODO_DEMO === 'sim';

/** As duas chaves juntas. É esta a pergunta que vale. */
export async function modoDemo(): Promise<boolean> {
  return DEMO_PEDIDO && (await bancoEhDemo());
}

/**
 * A tarja do demo, em HTML puro e num lugar só.
 *
 * Ela precisa aparecer nas duas metades do app: as telas React e o
 * `Form.html`, que é servido cru por `src/app/route.ts` e não passa por
 * layout nenhum. Em vez de escrever a tarja duas vezes, as duas metades
 * injetam ESTA string.
 *
 * O conteúdo não é enfeite. Quem abre um link público precisa saber, antes de
 * digitar qualquer coisa, que os números são inventados e que o que ele
 * escrever some de madrugada.
 */
export const TARJA_DEMO =
  '<div style="background:#2F5233;color:#fff;font:500 12px/1.35 system-ui,-apple-system,sans-serif;' +
  'padding:7px 14px;text-align:center">Demonstração · dados fictícios · ' +
  'pode mexer à vontade, a base volta ao início toda madrugada</div>';

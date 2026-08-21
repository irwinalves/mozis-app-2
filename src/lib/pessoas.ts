/**
 * Quem pode entrar, e quem é quem.
 *
 * UMA fonte só para as duas perguntas. Antes existia apenas `EMAILS_PERMITIDOS`,
 * uma lista de e-mails sem nomes; para personalizar a tela seria preciso um
 * segundo mapa de e-mail → pessoa. Duas listas que precisam concordar acabam
 * divergindo, e aqui a divergência tem duas caras ruins: ou ninguém entra, ou
 * alguém vê o sinal da dívida trocado.
 *
 * Formato:  PESSOAS="Irwin=irwin@exemplo.com,Maria=maria@exemplo.com"
 *
 * `EMAILS_PERMITIDOS` continua aceita como reserva, para o app não ficar sem
 * login no intervalo entre publicar este código e cadastrar a variável nova.
 * Quem entra por ela autentica mas NÃO é identificado como pessoa — e a tela
 * cai no comportamento antigo, mostrando os dois lados do acerto.
 */

export type Pessoa = 'Irwin' | 'Maria';

export interface Elenco {
  /** e-mail minúsculo → nome. */
  mapa: ReadonlyMap<string, Pessoa>;
  /** e-mails que entram sem nome associado. */
  reserva: readonly string[];
}

/**
 * O parse, separado do ambiente de propósito: assim o teste consegue variar a
 * entrada. A versão anterior lia `process.env` no topo do módulo, o que deixava
 * a lógica sem como ser exercitada — um teste incapaz de mudar a entrada não é
 * evidência de nada.
 */
export function lerElenco(env: Record<string, string | undefined>): Elenco {
  const mapa = new Map<string, Pessoa>(
    (env.PESSOAS ?? '')
      .split(',')
      .map((par) => par.split('='))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0].trim() && !!p[1].trim())
      .map(([nome, email]) => [email.trim().toLowerCase(), nome.trim() as Pessoa]),
  );
  const reserva = (env.EMAILS_PERMITIDOS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return { mapa, reserva };
}

/**
 * Pode entrar?
 *
 * Elenco vazio recusa TODO MUNDO — de propósito. Uma variável esquecida no
 * deploy não pode virar porta aberta para um app que mostra as finanças de duas
 * pessoas numa URL pública.
 */
export function podeEntrar(elenco: Elenco, email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return elenco.mapa.has(e) || elenco.reserva.includes(e);
}

/**
 * Quem é esta pessoa — ou `null` se o e-mail entra mas não está identificado.
 *
 * `null` não é erro: é o sinal de que a tela deve mostrar os dois lados do
 * acerto em vez de escolher um. Mostrar demais é melhor que mostrar o lado
 * errado de uma dívida.
 */
export function pessoaDoEmail(elenco: Elenco, email: string | null | undefined): Pessoa | null {
  const e = email?.trim().toLowerCase();
  return (e && elenco.mapa.get(e)) || null;
}

/** A outra pessoa do casal. */
export function aOutra(p: Pessoa): Pessoa {
  return p === 'Irwin' ? 'Maria' : 'Irwin';
}

/** O elenco do ambiente atual — o que auth e API usam de fato. */
export function elencoDoAmbiente(): Elenco {
  return lerElenco(process.env);
}

/**
 * Aplica um arquivo .sql no banco apontado por DATABASE_URL.
 *
 * Substitui `psql "$DATABASE_URL" -f ...`, que tinha dois problemas silenciosos:
 * o npm não exporta o `.env` para os scripts, então a variável chegava vazia e o
 * psql caía no Postgres LOCAL — falhando com "database does not exist" se não
 * houver um, ou, pior, aplicando no banco errado se houver. E exigia o psql
 * instalado, que o resto do projeto não exige.
 *
 * Uso: npm run db:views   (ou: npm run db:sql -- caminho/arquivo.sql)
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo .sql.');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida.');

const sql = postgres(url);

async function main() {
  const conteudo = readFileSync(arquivo, 'utf8');
  // Diz em qual banco está aplicando: o erro que este script existe para evitar
  // é justamente acertar o banco errado sem perceber.
  const [{ current_database: banco, inet_server_addr: host }] = await sql<
    { current_database: string; inet_server_addr: string | null }[]
  >`select current_database(), inet_server_addr()::text`;
  console.log(`aplicando ${arquivo} em "${banco}" (${host ?? 'socket local'})`);

  await sql.unsafe(conteudo);
  console.log('ok');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await sql.end();
  process.exit(1);
});

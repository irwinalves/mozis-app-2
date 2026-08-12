import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Conexão única. Em dev aponta para o Postgres local; em produção, para o
 * Postgres da nuvem — a diferença é só a connection string, o que é
 * justamente a vantagem de não haver lock-in de fornecedor aqui.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não definida.');

const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };

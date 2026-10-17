import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';

const useSSL = process.env.DB_SSL === 'true';

const ssl = useSSL
  ? {
      ca: readFileSync(
        resolve(process.cwd(), 'certs/prod-ca-2021.crt'),
        'utf8'
      ),
      rejectUnauthorized: true
    }
  : undefined;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl,
  max: 5,
  connectionTimeoutMillis: 10000
});

export async function testConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT
        current_database() AS database,
        current_user AS usuario,
        NOW() AS fecha`
    );

    console.log('✅ PostgreSQL conectado correctamente');
    console.log('Base de datos:', result.rows[0].database);
    console.log('Servidor:', process.env.DB_HOST);
  } finally {
    client.release();
  }
}
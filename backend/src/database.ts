
import { Pool } from 'pg';
import 'dotenv/config';

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export async function testConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query(
      'SELECT current_database() AS database, NOW() AS fecha'
    );

    console.log('✅ PostgreSQL conectado correctamente');
    console.log('Base de datos:', result.rows[0].database);
  } finally {
    client.release();
  }
}

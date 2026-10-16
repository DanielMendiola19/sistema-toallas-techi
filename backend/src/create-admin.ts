import 'dotenv/config';
import { pool } from './database.js';
import { hashPassword } from './auth.js';
const [name,email,password]=process.argv.slice(2);
if(!name||!email||!password||password.length<12){console.error('Uso: npm run admin -- "Nombre" correo@ejemplo.com "ContraseñaDe12OMas"');process.exit(1);}
try {
 const existing=await pool.query("SELECT 1 FROM app_users WHERE role='admin' LIMIT 1");
 if(existing.rowCount){console.error('Ya hay un administrador. No se creó otro.');process.exitCode=1;}
 else {await pool.query("INSERT INTO app_users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",[name,email.toLowerCase(),await hashPassword(password)]);console.log('Administrador creado');}
} catch(error){console.error(error);process.exitCode=1;} finally{await pool.end();}

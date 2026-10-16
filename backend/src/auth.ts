import { Router, type RequestHandler, type Request } from 'express';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './database.js';
const scrypt = promisify(scryptCb);
export type Role = 'admin' | 'seller';
export type CurrentUser = { id: string; name: string; email: string; role: Role };
declare global { namespace Express { interface Request { currentUser?: CurrentUser } } }
export async function hashPassword(password: string) {
 const salt = randomBytes(16).toString('hex');
 const hash = (await scrypt(password, salt, 64) as Buffer).toString('hex');
 return `${salt}:${hash}`;
}
export async function verifyPassword(password: string, encoded: string) {
 const [salt, hash] = encoded.split(':');
 if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
 const actual = await scrypt(password, salt, 64) as Buffer;
 return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const requireAuth: RequestHandler = async (req,res,next) => {
 try {
  const authorization = req.header('authorization') || '';
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
  if (!match) { res.status(401).json({error:'Inicia sesión'}); return; }
  const result = await pool.query(`SELECT u.id,u.name,u.email,u.role FROM auth_sessions s
    JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active=true`,[tokenHash(match[1])]);
  if (!result.rowCount) { res.status(401).json({error:'Sesión caducada o inválida'}); return; }
  req.currentUser = result.rows[0] as CurrentUser;
  next();
 } catch(nextError) { next(nextError); }
};
export const requireAdmin: RequestHandler = (req,res,next) => {
 if (req.currentUser?.role !== 'admin') { res.status(403).json({error:'Acceso exclusivo del administrador'}); return; }
 next();
};
export const authRouter = Router();
authRouter.post('/login', async (req,res,next) => {
 try {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) { res.status(422).json({error:'Correo y contraseña obligatorios'}); return; }
  const found = await pool.query('SELECT * FROM app_users WHERE email=$1 AND is_active=true',[email]);
  const user = found.rows[0];
  if (!user || !(await verifyPassword(password,user.password_hash))) { res.status(401).json({error:'Credenciales incorrectas'}); return; }
  const token = randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at)
   VALUES($1,$2,now()+interval '8 hours')`,[user.id,tokenHash(token)]);
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
 } catch(error) { next(error); }
});
authRouter.get('/me',requireAuth,(req,res)=>res.json(req.currentUser));
authRouter.post('/logout',requireAuth,async(req,res,next)=>{
 try {
  const token = (req.header('authorization')||'').slice(7);
  await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[tokenHash(token)]);
  res.status(204).send();
 } catch(error) { next(error); }
});
// El administrador puede editar únicamente su propio perfil. No puede cambiarse el rol.
authRouter.patch('/profile',requireAuth,requireAdmin,async(req,res,next)=>{
 const id=req.currentUser!.id;
 const {name,email,password,currentPassword}=req.body||{};
 if(typeof name!=='string'||!name.trim()||name.trim().length>120||typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())||
    (password!==undefined&&(typeof password!=='string'||password.length<12||password.length>200||typeof currentPassword!=='string'||!currentPassword))){
  res.status(422).json({error:'Revisa nombre, correo y contraseña actual (mínimo 12 caracteres para la nueva)'});return;
 }
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const current=await conn.query("SELECT password_hash FROM app_users WHERE id=$1 AND role='admin' AND is_active=true FOR UPDATE",[id]);
  if(!current.rowCount){await conn.query('ROLLBACK');res.status(404).json({error:'Administrador no encontrado'});return;}
  if(password!==undefined && !(await verifyPassword(currentPassword,current.rows[0].password_hash))){
    await conn.query('ROLLBACK');res.status(403).json({error:'La contraseña actual es incorrecta'});return;
  }
  const hash=password===undefined?null:await hashPassword(password);
  const updated=await conn.query(`UPDATE app_users SET name=$1,email=$2,password_hash=COALESCE($3,password_hash)
   WHERE id=$4 RETURNING id,name,email,role,is_active`,[name.trim(),email.trim().toLowerCase(),hash,id]);
  if(hash){const token=(req.header('authorization')||'').slice(7);await conn.query('DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash<>$2',[id,tokenHash(token)]);}
  await conn.query('COMMIT');res.json(updated.rows[0]);
 }catch(error){await conn.query('ROLLBACK');if((error as {code?:string}).code==='23505'){res.status(409).json({error:'Ese correo ya está registrado'});return;}next(error);}
 finally{conn.release();}
});

export const usersRouter = Router();
usersRouter.use(requireAuth,requireAdmin);
usersRouter.get('/',async(_req,res,next)=>{
 try { const result=await pool.query('SELECT id,name,email,role,is_active,created_at FROM app_users ORDER BY id'); res.json(result.rows); }
 catch(error){next(error);}
});
usersRouter.post('/',async(req,res,next)=>{
 try {
  const {name,email,password,role='seller'}=req.body||{};
  if(role!=='admin'&&role!=='seller'){res.status(422).json({error:'Rol inválido'});return;}
  if(typeof name!=='string'||!name.trim()||name.length>120||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<12||password.length>200){
   res.status(422).json({error:'Nombre, correo válido y contraseña de 12 a 200 caracteres obligatorios'});return;
  }
  const passwordHash=await hashPassword(password);
  const result=await pool.query(`INSERT INTO app_users(name,email,password_hash,role)
   VALUES($1,$2,$3,$4) RETURNING id,name,email,role,is_active`,[name.trim(),email.trim().toLowerCase(),passwordHash,role]);
  res.status(201).json(result.rows[0]);
 } catch(error){ if((error as {code?:string}).code==='23505'){res.status(409).json({error:'Ese correo ya existe'});return;} next(error); }
});
usersRouter.patch('/:id/status',async(req:Request,res,next)=>{
 try {
  if(!/^\d+$/.test(req.params.id as string)||typeof req.body?.is_active!=='boolean'){res.status(422).json({error:'Datos inválidos'});return;}
  const result=await pool.query(`UPDATE app_users SET is_active=$1 WHERE id=$2 AND role='seller' RETURNING id,name,email,role,is_active`,[req.body.is_active,req.params.id]);
  if(!result.rowCount){res.status(404).json({error:'Vendedor no encontrado'});return;}
  if(!req.body.is_active) await pool.query('DELETE FROM auth_sessions WHERE user_id=$1',[req.params.id]);
  res.json(result.rows[0]);
 }catch(error){next(error);}
});

// Edita únicamente cuentas de vendedores. No devuelve hashes ni contraseñas.
usersRouter.patch('/:id',async(req:Request,res,next)=>{
 const id = req.params.id as string;
 if(!/^\d+$/.test(id)) {res.status(422).json({error:'ID inválido'});return;}
 const {name,email,password}=req.body||{};
 if(typeof name!=='string'||!name.trim()||name.trim().length>120||
    typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||
    (password!==undefined&&(typeof password!=='string'||password.length<12||password.length>200))){
  res.status(422).json({error:'Nombre y correo válidos obligatorios; la nueva contraseña debe tener de 12 a 200 caracteres'});return;
 }
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  const found=await conn.query("SELECT id FROM app_users WHERE id=$1 AND role='seller' FOR UPDATE",[id]);
  if(!found.rowCount){await conn.query('ROLLBACK');res.status(404).json({error:'Vendedor no encontrado'});return;}
  const hash = password === undefined ? null : await hashPassword(password);
  const result=await conn.query(`UPDATE app_users
    SET name=$1,email=$2,password_hash=COALESCE($3,password_hash)
    WHERE id=$4 AND role='seller'
    RETURNING id,name,email,role,is_active,created_at`,
    [name.trim(),email.trim().toLowerCase(),hash,id]);
  // El cambio de contraseña cierra las sesiones anteriores del vendedor.
  if(hash!==null)await conn.query('DELETE FROM auth_sessions WHERE user_id=$1',[id]);
  await conn.query('COMMIT');
  res.json(result.rows[0]);
 }catch(error){await conn.query('ROLLBACK');
  if((error as {code?:string}).code==='23505'){res.status(409).json({error:'Ese correo ya está registrado'});return;}
  next(error);
 }finally{conn.release();}
});

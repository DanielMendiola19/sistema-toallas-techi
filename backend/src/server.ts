import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { testConnection } from './database.js';
import { productsRouter } from './products.js';
import { authRouter, usersRouter } from './auth.js';
import { pricesRouter } from './prices.js';
import { salesRouter } from './sales.js';
import { reportsRouter } from './reports.js';
import { inventoryRouter } from './inventory.js';
import { managementRouter } from './management.js';
import { importProductsRouter } from './importProducts.js';
const app = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '100kb' }));
app.get('/api/health',(_req,res)=>res.json({success:true,message:'API de Sistema Toallas funcionando',timestamp:new Date().toISOString()}));
app.use('/api/auth',authRouter);
app.use('/api/users',usersRouter);
app.use('/api/products',productsRouter);
app.use('/api/prices',pricesRouter);
app.use('/api/sales',salesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/management', managementRouter);
app.use('/api/imports/products', importProductsRouter);
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
 console.error('Error de API:',error);
 res.status(500).json({error:'Error interno del servidor'});
});
async function start(){
 try {await testConnection();app.listen(PORT,()=>console.log(`🚀 Servidor: http://localhost:${PORT}`));}
 catch(error){console.error(error);process.exit(1);}
}
void start();

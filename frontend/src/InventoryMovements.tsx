import { API } from './apiConfig';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import './InventoryMovements.css';


type Product = {id:string;code:string;name:string;stock:number;min_stock:number};
type Movement = {id:string;product_id:string;product_code:string;product_name:string;movement_type:string;quantity_delta:number;stock_before:number;stock_after:number;reason:string;created_at:string;performed_by_name:string|null};
type Page = {items:Movement[];page:number;pages:number;total:number};
type MovementType = 'entry' | 'loss' | 'count';
const labels: Record<string,string> = {initial:'Inventario inicial',adjustment:'Ajuste anterior',sale:'Venta',sale_reversal:'Anulación de venta',entry:'Entrada',loss:'Daño / pérdida',count:'Conteo físico'};
async function request<T>(path:string,token:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(API+path,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers}});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'No se pudo completar la operación');
 return data as T;
}
export default function InventoryMovements({token,onChanged}:{token:string;onChanged:()=>Promise<void>}){
 const [products,setProducts]=useState<Product[]>([]);
 const [page,setPage]=useState(1);
 const [filter,setFilter]=useState('');
 const [history,setHistory]=useState<Page|null>(null);
 const [open,setOpen]=useState(false);
 const [kind,setKind]=useState<MovementType>('entry');
 const [productId,setProductId]=useState('');
 const [quantity,setQuantity]=useState('1');
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  const [p,h]=await Promise.all([
   request<Product[]>('/products',token),
   request<Page>(`/inventory/movements?page=${page}${filter?`&product_id=${encodeURIComponent(filter)}`:''}`,token)
  ]);
  setProducts(p);setHistory(h);
 },[token,page,filter]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Error al consultar'))},[load]);
 const selected=useMemo(()=>products.find(p=>p.id===productId),[products,productId]);
 const count=Number(quantity);
 const valid=Number.isSafeInteger(count)&&count>=0&&(kind==='count'||count>0)&&Boolean(selected)&&reason.trim().length>=5;
 const projected=selected&&valid?(kind==='entry'?selected.stock+count:kind==='loss'?selected.stock-count:count):null;
 function close(){if(!busy){setOpen(false);setError('');}}
 function show(){setKind('entry');setProductId('');setQuantity('1');setReason('');setError('');setNotice('');setOpen(true);}
 async function save(e:FormEvent){
  e.preventDefault();if(!valid||projected===null||projected<0||projected>2147483647)return;
  setBusy(true);setError('');
  try{
   await request('/inventory/movements',token,{method:'POST',body:JSON.stringify({product_id:productId,type:kind,quantity:count,reason:reason.trim()})});
   setOpen(false);setNotice('Movimiento registrado y stock actualizado');setPage(1);
   await load();await onChanged();
  }catch(err){setError(err instanceof Error?err.message:'Error al guardar');}finally{setBusy(false);}
 }
 return <div className="inventory-movements">
  <section className="panel"><div className="movement-header"><div><h2>Movimientos de inventario</h2><p className="muted">Control de entradas, pérdidas y conteos físicos con historial de responsables.</p></div><button className="primary" onClick={show}>+ Registrar movimiento</button></div>
   {notice&&<p className="notice" role="status">{notice}</p>}{!open&&error&&<p className="error" role="alert">{error}</p>}
   <div className="movement-filter"><label htmlFor="movement-product-filter">Filtrar por producto</label><select id="movement-product-filter" value={filter} onChange={e=>{setPage(1);setFilter(e.target.value)}}><option value="">Todos los productos</option>{products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></div>
   <div className="tablewrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Variación</th><th>Antes</th><th>Después</th><th>Responsable</th><th>Motivo</th></tr></thead><tbody>{history?.items.map(m=><tr key={m.id}><td>{new Date(m.created_at).toLocaleString('es-BO')}</td><td><strong>{m.product_name}</strong><small className="movement-code">{m.product_code}</small></td><td><span className={`movement-tag ${m.quantity_delta>0?'positive':m.quantity_delta<0?'negative':''}`}>{labels[m.movement_type]||m.movement_type}</span></td><td className={m.quantity_delta>0?'movement-positive':m.quantity_delta<0?'movement-negative':''}>{m.quantity_delta>0?'+':''}{m.quantity_delta}</td><td>{m.stock_before}</td><td>{m.stock_after}</td><td>{m.performed_by_name||'Sistema / histórico'}</td><td className="movement-reason">{m.reason}</td></tr>)}</tbody></table>{history?.items.length===0&&<p className="muted">Todavía no hay movimientos para este filtro.</p>}</div>
   <div className="movement-pagination"><span>{history?.total??0} movimientos · Página {page} de {history?.pages??1}</span><div><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><button disabled={!history||page>=history.pages} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div></div>
  </section>
  {open&&<div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="modal-box" role="dialog" aria-modal="true" aria-label="Registrar movimiento"><div className="modal-top"><div><h2>Registrar movimiento</h2><p className="muted">Todos los cambios quedarán registrados en el historial.</p></div><button className="modal-x" onClick={close} type="button" disabled={busy} aria-label="Cerrar">×</button></div>
   <form className="movement-form" onSubmit={e=>void save(e)}>
    <label>Producto<select value={productId} required onChange={e=>setProductId(e.target.value)}><option value="">Selecciona un producto</option>{products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name} ({p.stock} disponibles)</option>)}</select></label>
    <label>Tipo de movimiento<select value={kind} onChange={e=>{setKind(e.target.value as MovementType);setQuantity(e.target.value==='count'?'0':'1')}}><option value="entry">Entrada de mercancía</option><option value="loss">Salida por daño o pérdida</option><option value="count">Corrección por conteo físico</option></select></label>
    <label>{kind==='count'?'Cantidad contada físicamente':'Cantidad de unidades'}<input type="number" min={kind==='count'?0:1} step="1" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>Motivo<textarea rows={3} required minLength={5} maxLength={500} value={reason} placeholder="Ej.: ingreso de proveedor, producto dañado, diferencia en conteo..." onChange={e=>setReason(e.target.value)}/></label>
    {selected&&<div className="movement-preview"><span>Stock actual: <strong>{selected.stock}</strong></span><span>Stock resultante: <strong>{projected===null?'—':projected}</strong></span></div>}
    {projected!==null&&projected<0&&<p className="error">No puedes retirar más unidades de las existentes.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="confirm-actions"><button type="button" className="plain-button" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy||!valid||projected===null||projected<0||projected>2147483647}>{busy?'Guardando...':'Guardar movimiento'}</button></div>
   </form></div></div>}
 </div>;
}

import { API } from './apiConfig';
import { useCallback, useEffect, useState } from 'react';
import './ManagementPanel.css';

type Paginated<T>={items:T[];page:number;pages:number;total:number};
type Audit={id:string;created_at:string;action:string;actor_name:string;entity_type:string;entity_id:string|null;details:Record<string,unknown>};
type Session={id:string;register_name:string;status:'open'|'closed';opened_at:string;closed_at:string|null;closing_limit_at:string;opened_by_name:string;closed_by_name:string|null;opening_cash_bob:string;cash_sales:string;qr_sales:string;transfer_sales:string;other_sales:string;sales_count:number};
type Seller={seller_name:string;sales_count:number;total_bob:string};
const formatMoney=(n:string|number)=>Number(n).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateTime=(value:string|null)=>value?new Date(value).toLocaleString('es-BO',{dateStyle:'short',timeStyle:'short'}):'—';
async function read<T>(path:string,token:string):Promise<T>{
 const r=await fetch(`${API}/management${path}`,{headers:{Authorization:`Bearer ${token}`}});
 const data=await r.json().catch(()=>({error:'Respuesta inesperada del servidor'}));
 if(!r.ok)throw new Error(data.error||`Error HTTP ${r.status}`);
 return data as T;
}
const labels:Record<string,string>={
 'sale.created':'Venta registrada','sale.voided':'Venta anulada',
 'cash.opened':'Apertura de caja','cash.closed':'Cierre de caja','cash.extended':'Extensión de horario',
 'inventory.entry':'Entrada de stock','inventory.loss':'Salida por pérdida/daño','inventory.count':'Conteo físico',
 'inventory.sale':'Salida por venta','inventory.sale_reversal':'Reposición por anulación',
 'inventory.initial':'Stock inicial','inventory.adjustment':'Ajuste de inventario',
 'price.direct_change':'Cambio directo de precio','approved':'Precio aprobado','rejected':'Precio rechazado',
};

// Convertimos los metadatos técnicos existentes en información comprensible.
// Los datos no presentes NO se inventan; permanecen disponibles en PostgreSQL.
const entities:Record<string,string>={sale:'Venta',product:'Producto',price_request:'Solicitud de precio',cash_session:'Sesión de caja',inventory_movement:'Movimiento de inventario',user:'Usuario',cash_register:'Caja'};
const fields:Record<string,string>={
 old_price_bob:'Precio anterior',new_price_bob:'Precio nuevo',price_bob:'Precio',
 product_id:'Producto',sale_id:'Venta',cash_session_id:'Sesión de caja',
 quantity:'Cantidad',quantity_delta:'Variación de unidades',stock_before:'Stock anterior',stock_after:'Stock posterior',
 previous_stock:'Stock anterior',new_stock:'Stock nuevo',reason:'Motivo',
 opening_cash_bob:'Fondo inicial',expected_cash_bob:'Efectivo esperado',
 closing_limit_at:'Hora límite de cierre',old_closing_limit_at:'Cierre anterior',new_closing_limit_at:'Nuevo cierre',
 user_id:'Usuario',request_id:'Solicitud',approved_by:'Aprobado por',name:'Nombre',
 old_value:'Valor anterior',new_value:'Valor nuevo',register_id:'Caja',
 total_bob:'Total',amount_bob:'Importe',method:'Método de pago',status:'Estado'
};
const moneyKeys=new Set(['old_price_bob','new_price_bob','price_bob','opening_cash_bob','expected_cash_bob','total_bob','amount_bob']);
const dateKeys=new Set(['closing_limit_at','old_closing_limit_at','new_closing_limit_at']);
function valueLabel(key:string,value:unknown):string{
 if(value===null||value===undefined||value==='')return 'No registrado';
 if(moneyKeys.has(key)&&Number.isFinite(Number(value)))return `Bs ${formatMoney(Number(value))}`;
 if(dateKeys.has(key)&&typeof value==='string')return dateTime(value);
 if(typeof value==='boolean')return value?'Sí':'No';
 if(typeof value==='string'||typeof value==='number'){
  const string=String(value);
  return key.endsWith('_id')?`#${string}`:string;
 }
 return 'Dato adicional registrado';
}
function auditRows(event:Audit):{label:string;value:string}[]{
 const details=event.details && typeof event.details==='object' && !Array.isArray(event.details)?event.details:{};
 return Object.entries(details).filter(([key,val])=>fields[key]&&val!==undefined&&val!==null&&typeof val!=='object').map(([key,val])=>({label:fields[key],value:valueLabel(key,val)}));
}
function recordLabel(event:Audit){
 const label=entities[event.entity_type]||'Registro';
 return event.entity_id?`${label} #${event.entity_id}`:label;
}
function AuditDetail({event}:{event:Audit}){
 const rows=auditRows(event);
 if(rows.length===0)return <span className="mg-no-detail">Sin detalles adicionales</span>;
 return <details className="mg-detail"><summary>Ver detalles</summary><dl className="mg-detail-list">{rows.map((row,i)=><div key={i} className="mg-detail-row"><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></details>;
}

function Pagination({page,pages,onPage}:{page:number;pages:number;onPage:(p:number)=>void}){
 return <div className="mg-pagination"><span>Página {page} de {pages}</span><div><button type="button" disabled={page<=1} onClick={()=>onPage(page-1)}>Anterior</button><button type="button" disabled={page>=pages} onClick={()=>onPage(page+1)}>Siguiente</button></div></div>;
}
export default function ManagementPanel({token,mode}:{token:string;mode:'audit'|'cash'}){
 const [page,setPage]=useState(1);const [audit,setAudit]=useState<Paginated<Audit>|null>(null);
 const [sessions,setSessions]=useState<Paginated<Session>|null>(null);
 const [action,setAction]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');
 const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [selected,setSelected]=useState<string|null>(null);const [sellers,setSellers]=useState<Seller[]>([]);
 const [sellerLoading,setSellerLoading]=useState(false);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   if(mode==='audit'){
    const qs=new URLSearchParams({page:String(page)});
    if(action)qs.set('action',action);if(from)qs.set('start',from);if(to)qs.set('end',to);
    setAudit(await read<Paginated<Audit>>(`/audit?${qs}`,token));
   } else setSessions(await read<Paginated<Session>>(`/cash-sessions?page=${page}`,token));
  }catch(e){setError(e instanceof Error?e.message:'Error al consultar');}
  finally{setLoading(false);}
 },[mode,token,page,action,from,to]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{setPage(1);setSelected(null);},[mode]);
 useEffect(()=>{if(!selected)return;const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null)};document.addEventListener('keydown',onEscape);return()=>document.removeEventListener('keydown',onEscape)},[selected]);
 async function showSellers(id:string){
  setSelected(id);
  setSellers([]);
  setSellerLoading(true);
  try{setError('');setSellers(await read<Seller[]>(`/cash-sessions/${id}/sellers`,token));}
  catch(e){setError(e instanceof Error?e.message:'Error');setSelected(null);}
  finally{setSellerLoading(false);}
 }
 return <div className="mg-module">
  <section className="panel">
   <div className="mg-head"><div><h2>{mode==='audit'?'Auditoría del sistema':'Historial de cajas'}</h2>
    <p className="muted">{mode==='audit'?'Acciones registradas en el sistema, ordenadas por fecha.':'Cierres calculados automáticamente, sin introducir efectivo contado.'}</p></div>
    <button className="mg-secondary" disabled={loading} onClick={()=>void load()} type="button">{loading?'Cargando…':'Actualizar'}</button>
   </div>
   {mode==='audit'&&<div className="mg-filters">
    <label>Acción<select value={action} onChange={e=>{setPage(1);setAction(e.target.value)}}>
     <option value="">Todas</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>Desde<input type="date" value={from} onChange={e=>{setPage(1);setFrom(e.target.value)}}/></label>
    <label>Hasta<input type="date" value={to} onChange={e=>{setPage(1);setTo(e.target.value)}}/></label>
    <button type="button" className="mg-secondary" onClick={()=>{setAction('');setFrom('');setTo('');setPage(1)}}>Limpiar filtros</button>
   </div>}
   {error&&<div className="error" role="alert">{error}</div>}
   {mode==='audit'?<>
    <div className="tablewrap"><table><thead><tr><th>Fecha</th><th>Responsable</th><th>Acción</th><th>Registro</th><th>Detalle</th></tr></thead>
    <tbody>{audit?.items.map(a=><tr key={a.id}><td>{dateTime(a.created_at)}</td><td>{a.actor_name}</td><td><span className="mg-tag">{labels[a.action]||a.action}</span></td><td>{recordLabel(a)}</td><td><AuditDetail event={a}/></td></tr>)}</tbody></table></div>
    {audit?.items.length===0&&<p className="muted">No hay eventos con estos filtros.</p>}
    {audit&&<Pagination page={page} pages={audit.pages} onPage={setPage}/>}
   </>:<>
    <div className="tablewrap"><table><thead><tr><th>Sesión</th><th>Estado</th><th>Apertura</th><th>Cierre</th><th>Responsable</th><th>Ventas</th><th>Efectivo esperado</th><th>QR</th><th>Transfer.</th><th>Otros</th><th>Detalle</th></tr></thead>
    <tbody>{sessions?.items.map(s=><tr key={s.id}><td><strong>#{s.id}</strong><div className="mg-sub">{s.register_name}</div></td><td><span className={`mg-status ${s.status}`}>{s.status==='open'?'Abierta':'Cerrada'}</span></td><td>{dateTime(s.opened_at)}</td><td>{dateTime(s.closed_at)}</td><td>{s.opened_by_name}<div className="mg-sub">{s.closed_by_name?`Cerró: ${s.closed_by_name}`:''}</div></td><td>{s.sales_count}</td><td>Bs {formatMoney(Number(s.opening_cash_bob)+Number(s.cash_sales))}</td><td>Bs {formatMoney(s.qr_sales)}</td><td>Bs {formatMoney(s.transfer_sales)}</td><td>Bs {formatMoney(s.other_sales)}</td><td><button className="mg-secondary" type="button" onClick={()=>void showSellers(s.id)}>Ver vendedores</button></td></tr>)}</tbody></table></div>
    {sessions?.items.length===0&&<p className="muted">Todavía no hay sesiones de caja.</p>}
    {sessions&&<Pagination page={page} pages={sessions.pages} onPage={p=>{setSelected(null);setPage(p)}}/>}
    {selected&&<div className="mg-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
     <div className="mg-modal-card" role="dialog" aria-modal="true" aria-label={`Ventas por vendedor de la caja ${selected}`}>
      <div className="mg-modal-header"><div><h3>Ventas por vendedor</h3><p>Caja #{selected}</p></div>
       <button className="mg-modal-close" type="button" aria-label="Cerrar ventana" onClick={()=>setSelected(null)}>×</button>
      </div>
      {sellerLoading?<p className="muted">Cargando vendedores…</p>:sellers.length===0?<p className="mg-empty">No hay ventas completadas en esta sesión.</p>:<div className="tablewrap"><table><thead><tr><th>Vendedor</th><th>Ventas</th><th>Total</th></tr></thead><tbody>{sellers.map((s,i)=><tr key={i}><td>{s.seller_name}</td><td>{s.sales_count}</td><td>Bs {formatMoney(s.total_bob)}</td></tr>)}</tbody></table></div>}
      <div className="mg-modal-footer"><button type="button" className="mg-secondary" onClick={()=>setSelected(null)}>Cerrar</button></div>
     </div>
    </div>}
    <p className="mg-note">El efectivo esperado es el fondo inicial histórico más los pagos en efectivo de ventas completadas. No representa un conteo físico.</p>
   </>}
  </section>
 </div>;
}

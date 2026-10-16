import { useCallback, useEffect, useMemo, useState } from 'react';
import './SalesPanel.css';
const API='http://localhost:3000/api';
type Product={id:string;code:string;name:string;price_bob:string;stock:number};
type Session={id:string;cash_register_id:string;register_name:string;closing_limit_at:string;opening_cash_bob:string};
type Register={id:string;name:string};
type Method='cash'|'qr'|'transfer'|'other';
const methods:{value:Method;label:string}[]=[{value:'cash',label:'Efectivo'},{value:'qr',label:'QR'},{value:'transfer',label:'Transferencia'},{value:'other',label:'Otro'}];
const money=(n:number|string)=>Number(n).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
async function req<T>(path:string,token:string,method='GET',body?:unknown):Promise<T>{
 const res=await fetch(API+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await res.json();if(!res.ok)throw Error(data.error||'Error de conexión');return data as T;
}
export default function SalesPanel({token,admin,onInventoryChanged}:{token:string;admin:boolean;onInventoryChanged:()=>Promise<void>}){
 const [products,setProducts]=useState<Product[]>([]);const [sessions,setSessions]=useState<Session[]>([]);const [registers,setRegisters]=useState<Register[]>([]);
 const [search,setSearch]=useState('');const [cart,setCart]=useState<Record<string,number>>({});const [method,setMethod]=useState<Method>('cash');const [split,setSplit]=useState(false);const [cashAmount,setCashAmount]=useState('');const [reference,setReference]=useState('');
 const [selectedSession,setSelectedSession]=useState('');const [registerId,setRegisterId]=useState('');const [closingAt,setClosingAt]=useState('');const [extendAt,setExtendAt]=useState('');const [closeConfirm,setCloseConfirm]=useState(false);
 const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
 const refresh=useCallback(async()=>{
  const [p,s,r]=await Promise.all([req<Product[]>('/products',token),req<Session[]>('/sales/sessions/current',token),req<Register[]>('/sales/registers',token)]);
  setProducts(p);setSessions(s);setRegisters(r);
  setSelectedSession(prev=>s.some(x=>x.id===prev)?prev:(s[0]?.id||''));setRegisterId(prev=>r.some(x=>x.id===prev)?prev:(r[0]?.id||''));
 },[token]);
 useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:'No se pudieron cargar las ventas'));},[refresh]);
 const filtered=products.filter(p=>(p.code+' '+p.name).toLowerCase().includes(search.toLowerCase())).slice(0,40);
 const lines=useMemo(()=>products.filter(p=>cart[p.id]>0).map(p=>({...p,quantity:cart[p.id]})),[products,cart]);
 const totalCents=lines.reduce((s,p)=>s+Math.round(Number(p.price_bob)*100)*p.quantity,0);const total=totalCents/100;
 const session=sessions.find(s=>s.id===selectedSession);const canSell=Boolean(session)&&new Date(session!.closing_limit_at).getTime()>Date.now();
 const safeCents=(value:string)=> /^\d+(\.\d{1,2})?$/.test(value)?Math.round(Number(value)*100):null;
 const cashCents=split?safeCents(cashAmount):null;
 async function act(action:()=>Promise<void>){setLoading(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Error inesperado');}finally{setLoading(false);}}
 const add=(p:Product)=>setCart(c=>({...c,[p.id]:Math.min(p.stock,(c[p.id]||0)+1)}));
 function changeQty(p:Product,n:number){if(!Number.isSafeInteger(n))return;setCart(c=>({...c,[p.id]:Math.max(0,Math.min(p.stock,n))}));}
 async function sell(){
  if(!session||!canSell||!lines.length)return setError('Abre una caja y agrega productos');
  const pay=split?cashCents===null||cashCents<=0||cashCents>=totalCents?null:[{method:'cash',amount_bob:cashCents/100},{method:'qr',amount_bob:(totalCents-cashCents)/100,reference:reference||undefined}]:[{method,amount_bob:total,reference:reference||undefined}];
  if(!pay)return setError('En pago combinado, el efectivo debe ser mayor a cero y menor al total');
  await act(async()=>{
   const saved=await req<{id:string}>('/sales',token,'POST',{request_key:requestKey,cash_session_id:session.id,items:lines.map(p=>({product_id:p.id,quantity:p.quantity})),payments:pay});
   setNotice(`Venta #${saved.id} registrada correctamente`);setCart({});setCashAmount('');setReference('');setRequestKey(crypto.randomUUID());await refresh();await onInventoryChanged();
  });
 }
 async function openSession(){await act(async()=>{
  if(!closingAt)throw Error('Selecciona la fecha y hora de cierre');
  await req('/sales/sessions',token,'POST',{register_id:registerId,closing_limit_at:new Date(closingAt).toISOString()});
  await refresh();setNotice('Caja abierta');
 });}
 async function closeSession(){if(!session)return;await act(async()=>{
  const result=await req<{expected_cash_bob:string;totals_by_method:{qr_sales:string;transfer_sales:string;other_sales:string}}>(`/sales/sessions/${session.id}/close`,token,'POST');
  await refresh();setCloseConfirm(false);setNotice(`Caja cerrada. Efectivo: Bs ${result.expected_cash_bob}; QR: Bs ${money(result.totals_by_method.qr_sales)}; transferencias: Bs ${money(result.totals_by_method.transfer_sales)}; otros: Bs ${money(result.totals_by_method.other_sales)}. Sin conteo físico.`);
 });}
 async function extendSession(){if(!session)return;await act(async()=>{
  await req(`/sales/sessions/${session.id}/extend`,token,'PATCH',{closing_limit_at:new Date(extendAt).toISOString()});await refresh();setNotice('Cierre extendido');
 });}
 return <div className="sales-module">
  {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
  <section className="panel"><div className="sales-heading"><div><h2>Punto de venta</h2><p className="muted">Precios en Bs · Venta presencial</p></div><div className="sales-session">{session?<><span className={canSell?'sale-open':'sale-closed'}>{canSell?'● Caja habilitada':'● Horario vencido'}</span><small>{session.register_name} · hasta {new Date(session.closing_limit_at).toLocaleString('es-BO')}</small></>:<span className="sale-closed">● Sin caja abierta</span>}</div></div>
   {admin&&<div className="cash-admin">
    {!sessions.length?<div className="cash-controls"><strong>Abrir caja</strong><select value={registerId} onChange={e=>setRegisterId(e.target.value)}>{registers.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><label>Cierre programado<input type="datetime-local" value={closingAt} onChange={e=>setClosingAt(e.target.value)}/></label><button className="primary" disabled={loading||!registerId} onClick={()=>void openSession()}>Abrir caja</button></div>
    :<div className="cash-controls"><strong>Administrar caja</strong><label>Extender cierre<input type="datetime-local" value={extendAt} onChange={e=>setExtendAt(e.target.value)}/></label><button disabled={loading||!extendAt} onClick={()=>void extendSession()}>Extender horario</button><button disabled={loading} className="sale-danger" onClick={()=>setCloseConfirm(true)}>Cerrar caja</button></div>}
   </div>}
  </section>
  <div className="pos-layout"><section className="panel"><h2>Productos</h2><input className="sales-search" placeholder="Buscar por nombre o código..." value={search} onChange={e=>setSearch(e.target.value)}/><div className="sales-products">{filtered.map(p=><button type="button" key={p.id} className="sales-product" disabled={loading||p.stock===0||!canSell} onClick={()=>add(p)}><span><strong>{p.name}</strong><small>{p.code} · Stock: {p.stock}</small></span><b>Bs {money(p.price_bob)}</b><span className="sale-plus">+</span></button>)}{!filtered.length&&<p className="muted">No hay productos coincidentes.</p>}</div></section>
   <section className="panel sales-cart"><h2>Carrito <span className="sales-count">{lines.reduce((s,p)=>s+p.quantity,0)}</span></h2>{lines.length===0?<p className="muted">Selecciona un producto para comenzar la venta.</p>:<div className="sales-lines">{lines.map(p=><div key={p.id} className="sales-line"><div><strong>{p.name}</strong><small>Bs {money(p.price_bob)} c/u</small></div><div className="sales-quantity"><button aria-label={`Quitar una unidad de ${p.name}`} onClick={()=>changeQty(p,p.quantity-1)}>−</button><span>{p.quantity}</span><button aria-label={`Agregar una unidad de ${p.name}`} onClick={()=>changeQty(p,p.quantity+1)} disabled={p.quantity>=p.stock}>+</button></div><b>Bs {money(Math.round(Number(p.price_bob)*100)*p.quantity/100)}</b></div>)}</div>}
    <div className="sales-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div>
    <div className="sales-payment"><label className="sales-check"><input type="checkbox" checked={split} onChange={e=>setSplit(e.target.checked)}/> Combinar efectivo + QR</label>{split?<label>Monto en efectivo (resto por QR)<input inputMode="decimal" placeholder="0.00" value={cashAmount} onChange={e=>setCashAmount(e.target.value)}/></label>:<label>Método de pago<select value={method} onChange={e=>setMethod(e.target.value as Method)}>{methods.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></label>}{(split||method!=='cash')&&<label>Referencia (opcional)<input maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Número de operación"/></label>}</div>
    <button className="primary sale-submit" disabled={loading||!canSell||!lines.length} onClick={()=>void sell()}>{loading?'Guardando...':'Confirmar venta'}</button><button className="sale-clear" disabled={loading||!lines.length} onClick={()=>{setCart({});setRequestKey(crypto.randomUUID());}}>Vaciar carrito</button>
    <p className="muted sale-note">Los precios y el stock se vuelven a validar en el servidor antes de confirmar.</p>
   </section></div>
  {closeConfirm&&<div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setCloseConfirm(false)}}><div className="modal-box" role="dialog" aria-modal="true" aria-label="Confirmar cierre de caja"><div className="modal-top"><h2>¿Cerrar caja?</h2><button className="modal-x" type="button" disabled={loading} onClick={()=>setCloseConfirm(false)}>×</button></div><p>Se calculará el efectivo esperado automáticamente. Al cerrar la caja, sus ventas ya no podrán anularse.</p><p className="muted">Esto no es un conteo físico del efectivo.</p><div className="confirm-actions"><button disabled={loading} onClick={()=>setCloseConfirm(false)}>Cancelar</button><button disabled={loading} className="sale-danger" onClick={()=>void closeSession()}>Sí, cerrar caja</button></div></div></div>}
 </div>;
}

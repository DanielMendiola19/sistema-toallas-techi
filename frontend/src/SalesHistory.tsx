import { useCallback, useEffect, useState } from 'react';
import './SalesPanel.css';
const API='http://localhost:3000/api';
type Sale={id:string;total_bob:string;status:'completed'|'voided';created_at:string;cash_session_status:'open'|'closed';seller_name:string;items:{name:string;quantity:number}[];payments:{method:string;amount_bob:string}[]};
type Page={items:Sale[];page:number;total:number;pages:number;pageSize:number};
const money=(v:string|number)=>Number(v).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
function displayDate(input:string){
 const date=new Date(input), now=new Date();
 const localDay=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
 const days=Math.round((localDay(now)-localDay(date))/86400000);
 const label=days===0?'Hoy':days===1?'Ayer':days===2?'Hace 2 días':days===3?'Hace 3 días':date.toLocaleDateString('es-BO');
 return `${label}, ${date.toLocaleTimeString('es-BO',{hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
}
export default function SalesHistory({token,admin,onInventoryChanged}:{token:string;admin:boolean;onInventoryChanged:()=>Promise<void>}){
 const [page,setPage]=useState(1),[data,setData]=useState<Page|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [voidTarget,setVoidTarget]=useState<Sale|null>(null),[reason,setReason]=useState('');
 const load=useCallback(async()=>{
  const res=await fetch(`${API}/sales?page=${page}`,{headers:{Authorization:`Bearer ${token}`}});
  const json=await res.json();if(!res.ok)throw Error(json.error||'No se pudo cargar el historial');setData(json as Page);
 },[token,page]);
 useEffect(()=>{let active=true;const update=()=>void load().catch(e=>{if(active)setError(e instanceof Error?e.message:'Error de conexión')});update();const interval=setInterval(update,15000);return()=>{active=false;clearInterval(interval)}},[load]);
 async function voidSale(){if(!voidTarget)return;setLoading(true);setError('');try{
  const res=await fetch(`${API}/sales/${voidTarget.id}/void`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({reason})});
  const json=await res.json();if(!res.ok)throw Error(json.error||'No se pudo anular');
  setVoidTarget(null);setReason('');setNotice(`Venta anulada. ${json.note||''}`);await load();await onInventoryChanged();
 }catch(e){setError(e instanceof Error?e.message:'Error inesperado');}finally{setLoading(false)}}
 return <div className="sales-module"><section className="panel"><div className="sales-heading"><div><h2>{admin?'Historial de ventas':'Mis ventas'}</h2></div></div>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice">{notice}</p>}
 <div className="tablewrap"><table><thead><tr><th>Venta</th><th>Fecha</th><th>Vendedor</th><th>Productos</th><th>Pago</th><th>Total</th><th>Estado</th>{admin&&<th>Acciones</th>}</tr></thead><tbody>{data?.items.map(s=><tr key={s.id}><td>#{s.id}</td><td>{displayDate(s.created_at)}</td><td>{s.seller_name}</td><td>{s.items.map(i=>`${i.name} ×${i.quantity}`).join(', ')}</td><td>{s.payments.map(p=>`${p.method}: Bs ${money(p.amount_bob)}`).join(' + ')}</td><td>Bs {money(s.total_bob)}</td><td><span className={`tag ${s.status==='completed'?'success':'neutral'}`}>{s.status==='completed'?'Completada':'Anulada'}</span></td>{admin&&<td>{s.status==='completed'&&s.cash_session_status==='open'?<button className="sale-void" disabled={loading} onClick={()=>{setReason('');setVoidTarget(s)}}>Anular</button>:<span className="muted">{s.cash_session_status==='closed'?'Caja cerrada':'—'}</span>}</td>}</tr>)}</tbody></table>{data?.items.length===0&&<p className="muted">No hay ventas registradas.</p>}</div>
 <div className="history-pagination"><span>{data?.total??0} ventas · Página {page} de {data?.pages??1}</span><div><button disabled={page<=1} onClick={()=>setPage(v=>v-1)}>Anterior</button><button disabled={!data||page>=data.pages} onClick={()=>setPage(v=>v+1)}>Siguiente</button></div></div></section>
 {voidTarget&&<div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setVoidTarget(null)}}><div className="modal-box" role="dialog" aria-modal="true" aria-label="Anular venta"><div className="modal-top"><h2>Anular venta #{voidTarget.id}</h2><button className="modal-x" disabled={loading} onClick={()=>setVoidTarget(null)}>×</button></div><p>Esta acción devuelve unidades al inventario. La devolución de dinero se gestiona por separado.</p><label>Motivo de anulación<textarea className="sale-textarea" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="confirm-actions"><button disabled={loading} onClick={()=>setVoidTarget(null)}>Cancelar</button><button disabled={loading||reason.trim().length<5} className="sale-danger" onClick={()=>void voidSale()}>Confirmar anulación</button></div>{error&&<p className="error">{error}</p>}</div></div>}
 </div>;
}

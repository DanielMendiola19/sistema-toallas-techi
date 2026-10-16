import { useCallback, useEffect, useMemo, useState } from 'react';
import './ReportsDashboard.css';

type RowAmount={amount:string};
type Report={
 period:{start:string;end:string;timezone:string};
 summary:{transactions:number;revenue:string;units:number;closed_sessions:number};
 stock:{total:number;out_of_stock:number;low_stock:number};
 payments:(RowAmount&{method:string})[];
 daily:(RowAmount&{day:string;transactions:number})[];
 top_products:(RowAmount&{product_id:string;code:string;name:string;quantity:number})[];
 sellers:(RowAmount&{id:string;name:string;transactions:number})[];
};
type Period='today'|'week'|'month'|'custom';
const fmt=(v:string|number)=>Number(v).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
const money=(v:string|number)=>`Bs ${fmt(v)}`;
const dayString=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const localDate=(s:string)=>new Date(`${s}T00:00:00`);
function bounds(period:Period,from:string,to:string){
 const now=new Date(), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()), end=new Date(start);
 if(period==='week') start.setDate(start.getDate()-(start.getDay()+6)%7);
 if(period==='month')start.setDate(1);
 if(period==='custom'){
  const a=localDate(from),b=localDate(to);b.setDate(b.getDate()+1);
  return {start:a,end:b};
 }
 end.setDate(end.getDate()+1);
 return {start,end};
}
function exportCSV(report:Report){
 const clean=(s:unknown)=>{const text=String(s??'');return `"${(/^[=+@\-\t\r]/.test(text)?"'":"")+text.replaceAll('"','""')}"`;};
 const lines:string[][]=[['REPORTE DE VENTAS - TOALLAS TECHI'],['Desde',report.period.start],['Hasta (exclusivo)',report.period.end],[],['RESUMEN'],['Ingresos en Bs',report.summary.revenue],['Transacciones',String(report.summary.transactions)],['Unidades',String(report.summary.units)],[],['MÉTODOS DE PAGO'],['Método','Monto Bs'],...report.payments.map(p=>[p.method,p.amount]),[],['VENTAS POR DÍA'],['Día','Transacciones','Monto Bs'],...report.daily.map(d=>[d.day,String(d.transactions),d.amount]),[],['PRODUCTOS MÁS VENDIDOS'],['Código','Producto','Unidades','Monto Bs'],...report.top_products.map(p=>[p.code,p.name,String(p.quantity),p.amount]),[],['VENTAS POR VENDEDOR'],['Vendedor','Transacciones','Monto Bs'],...report.sellers.map(s=>[s.name,String(s.transactions),s.amount])];
 const csv='\uFEFF'+lines.map(row=>row.map(clean).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=`reporte-toallas-${dayString(new Date())}.csv`;a.click();URL.revokeObjectURL(url);
}
const paymentNames:Record<string,string>={cash:'Efectivo',qr:'QR',transfer:'Transferencia',other:'Otros'};
export default function ReportsDashboard({token,compact=false}:{token:string;compact?:boolean}){
 const [period,setPeriod]=useState<Period>('week');
 const [from,setFrom]=useState(dayString(new Date()));const [to,setTo]=useState(dayString(new Date()));
 const [report,setReport]=useState<Report|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
 const dateRange=useMemo(()=>bounds(period,from,to),[period,from,to]);
 const valid=dateRange.start.getTime()<dateRange.end.getTime() && dateRange.end.getTime()-dateRange.start.getTime()<=367*86400000;
 const startMs=dateRange.start.getTime(),endMs=dateRange.end.getTime();
 const fetchReport=useCallback(async()=>{
  if(!valid){setError('Selecciona un rango válido de máximo 367 días.');setReport(null);return;}
  setLoading(true);setError('');
  try{
   const args=new URLSearchParams({start:new Date(startMs).toISOString(),end:new Date(endMs).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/La_Paz'});
   const res=await fetch(`http://localhost:3000/api/reports/overview?${args}`,{headers:{Authorization:`Bearer ${token}`}});
   const data=await res.json();if(!res.ok)throw Error(data.error||'No fue posible cargar los reportes');setReport(data as Report);
  }catch(e){setError(e instanceof Error?e.message:'Error al consultar');setReport(null);}finally{setLoading(false)}
 },[startMs,endMs,token,valid]);
 useEffect(()=>{void fetchReport()},[fetchReport]);
 const maxDay=Math.max(1,...(report?.daily??[]).map(x=>Number(x.amount)));
 return <div className="reports-page">
  <section className="panel reports-controls"><div className="reports-heading"><div><h2>{compact?'Actividad de la tienda':'Reportes de ventas'}</h2><p className="muted">Datos reales de ventas completadas. Las anuladas no se suman.</p></div><div className="reports-buttons"><button type="button" onClick={()=>void fetchReport()} disabled={loading} className="reports-secondary">{loading?'Cargando…':'Actualizar datos'}</button><button type="button" className="primary" disabled={!report||loading} onClick={()=>report&&exportCSV(report)}>Exportar CSV</button>{!compact&&<button type="button" className="reports-secondary" disabled={!report||loading} onClick={()=>window.print()}>Guardar como PDF</button>}</div></div>
   <div className="reports-periods" role="group" aria-label="Seleccionar período">{([['today','Hoy'],['week','Semana'],['month','Mes'],['custom','Personalizado']] as [Period,string][]).map(([value,label])=><button key={value} type="button" className={period===value?'is-selected':''} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div>
   {period==='custom'&&<div className="reports-dates"><label>Desde<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta (incluido)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
   {error&&<p className="error" role="alert">{error}</p>}
  </section>
  {report&&<><div className="reports-kpis">
   {([['Ventas totales',money(report.summary.revenue)],['Transacciones',report.summary.transactions],['Unidades vendidas',report.summary.units],['Stock bajo / agotado',report.stock.low_stock+report.stock.out_of_stock]] as [string,string|number][]).map(([label,value])=><article className="reports-kpi" key={label}><span>{label}</span><strong>{value}</strong></article>)}
  </div><div className="reports-columns">
   <section className="panel"><h2>Ventas por día</h2><p className="muted">Ingresos en bolivianos</p>{report.daily.length===0?<p className="reports-empty">No hay ventas en este período.</p>:<div className="reports-chart" role="img" aria-label="Gráfico de ingresos diarios">{report.daily.map(d=><div className="reports-bar-row" key={d.day}><span>{d.day.slice(5)}</span><div className="reports-bar-track"><div className="reports-bar" style={{width:`${Number(d.amount)/maxDay*100}%`}}/></div><b>{money(d.amount)}</b></div>)}</div>}</section>
   <section className="panel"><h2>Métodos de pago</h2><p className="muted">Ingresos por forma de cobro</p>{report.payments.length===0?<p className="reports-empty">Sin pagos en este período.</p>:<div className="reports-payments">{report.payments.map(p=><div className="reports-payment" key={p.method}><span>{paymentNames[p.method]||p.method}</span><strong>{money(p.amount)}</strong></div>)}</div>}<div className="reports-smallstat">Cierres realizados en el período: <strong>{report.summary.closed_sessions}</strong></div></section>
  </div><div className="reports-columns">
   <section className="panel"><h2>Productos más vendidos</h2><div className="tablewrap"><table><thead><tr><th>Producto</th><th>Unidades</th><th>Total</th></tr></thead><tbody>{report.top_products.map(p=><tr key={p.product_id}><td>{p.name}<small className="reports-code">{p.code}</small></td><td>{p.quantity}</td><td>{money(p.amount)}</td></tr>)}</tbody></table>{!report.top_products.length&&<p className="reports-empty">Sin resultados.</p>}</div></section>
   <section className="panel"><h2>Ventas por vendedor</h2><div className="tablewrap"><table><thead><tr><th>Vendedor</th><th>Ventas</th><th>Total</th></tr></thead><tbody>{report.sellers.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.transactions}</td><td>{money(s.amount)}</td></tr>)}</tbody></table>{!report.sellers.length&&<p className="reports-empty">Sin resultados.</p>}</div></section>
  </div><p className="reports-footnote">Importante: ventas e ingresos no equivalen a utilidad. El stock bajo representa el estado actual del inventario, no el estado histórico del período.</p></>}
  {loading&&!report&&<section className="panel">Cargando datos del reporte…</section>}
 </div>;
}

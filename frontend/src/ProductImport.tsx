import { API } from './apiConfig';
import { useState, type ChangeEvent } from 'react';
import './ProductImport.css';

type ImportRow={row:number;code:string;name:string;price_bob:number;stock:number|null;min_stock:number;exists:boolean};
type Preview={sheet:string;sheets:string[];sha256:string;total:number;rows:ImportRow[]};
type Decision={chosen:boolean;stock:string};
export default function ProductImport({token,onImported}:{token:string;onImported:()=>Promise<void>}){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[decisions,setDecisions]=useState<Record<number,Decision>>({});
 const [sheet,setSheet]=useState('');const [sheetNames,setSheetNames]=useState<string[]>([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false);
 function choose(e:ChangeEvent<HTMLInputElement>){setFile(e.target.files?.[0]??null);setPreview(null);setSheet('');setSheetNames([]);setDecisions({});setError('');setNotice('');}
 async function upload(mode:'preview'|'commit'){
  if(!file)return;setLoading(true);setError('');setNotice('');
  try{
   const form=new FormData();form.append('file',file);if(mode==='preview'&&sheet)form.append('sheet',sheet);
   if(mode==='commit'){
    if(!preview)throw Error('Debes revisar primero el Excel.');
    form.append('sha256',preview.sha256);form.append('sheet',preview.sheet);
    const selected=preview.rows.filter(r=>!r.exists&&decisions[r.row]?.chosen).map(r=>({row:r.row,stock:Number(decisions[r.row].stock)}));
    if(selected.some(s=>!Number.isSafeInteger(s.stock)||s.stock<0||s.stock>2147483647||decisions[s.row]?.stock.trim()===''))throw Error('Revisa las cantidades seleccionadas.');
    form.append('decisions',JSON.stringify(selected));
   }
   const response=await fetch(`${API}/imports/products/${mode}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
   const data=await response.json().catch(()=>({error:'Respuesta inesperada del servidor'}));
   if(!response.ok)throw Error(data.error||'No se pudo procesar el Excel');
   if(mode==='preview'){
    const p=data as Preview;setPreview(p);setSheet(p.sheet);setSheetNames(p.sheets);
    setDecisions(Object.fromEntries(p.rows.map(r=>[r.row,{chosen:!r.exists,stock:r.stock===null?'':String(r.stock)}])));
   }else{
    setConfirm(false);setNotice(`Se importaron ${data.created} productos nuevos correctamente.`);setFile(null);setPreview(null);setSheet('');setSheetNames([]);setDecisions({});await onImported();
   }
  }catch(e){setError(e instanceof Error?e.message:'Error inesperado');}finally{setLoading(false);}
 }
 const selected=preview?.rows.filter(r=>!r.exists&&decisions[r.row]?.chosen)??[];
 return <div className="import-module"><section className="panel"><div className="import-top"><div><h2>Importar productos desde Excel</h2><p className="muted">Puedes subir cualquier archivo .xlsx que tenga columnas de Código, Producto, Precio y Stock. Primero revisa, luego confirma.</p></div></div>
  <div className="import-upload"><label htmlFor="excel-import">Archivo Excel (.xlsx)</label><input id="excel-import" type="file" accept=".xlsx" onChange={choose}/><button className="primary" type="button" disabled={!file||loading} onClick={()=>void upload('preview')}>{loading?'Procesando...':'Revisar Excel'}</button></div>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  {sheetNames.length>1&&<div className="import-sheet"><label htmlFor="import-sheet-choice">Hoja del Excel</label><select id="import-sheet-choice" value={sheet} disabled={loading} onChange={e=>{setSheet(e.target.value);setPreview(null);setDecisions({});setNotice('');setError('');}}>{sheetNames.map(name=><option key={name} value={name}>{name}</option>)}</select><button type="button" className="primary" disabled={!file||loading||!!preview} onClick={()=>void upload('preview')}>Revisar esta hoja</button></div>}{preview&&<><p className="muted">Hoja seleccionada: <strong>{preview.sheet}</strong></p><div className="import-summary"><span><strong>{preview.total}</strong> registros en Excel</span><span><strong>{preview.rows.filter(r=>r.exists).length}</strong> ya existentes (no se modifican)</span><span><strong>{selected.length}</strong> para crear</span></div>
   <p className="muted">Si alguna fórmula del Excel no tiene un resultado numérico válido, su stock aparecerá como <strong>Revisar stock</strong>. Indica la cantidad física aprobada antes de importar. Desmarca cualquier producto que no quieras importar. Puedes corregir aquí su <strong>stock inicial físico</strong>; el precio proviene del Excel. Los códigos ya existentes no se sobrescriben.</p>
   <div className="tablewrap"><table className="import-table"><thead><tr><th>Importar</th><th>Fila</th><th>Código</th><th>Artículo</th><th>Precio Bs</th><th>Stock del Excel</th><th>Stock aprobado</th><th>Estado</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td><input aria-label={`Importar ${r.code}`} type="checkbox" disabled={r.exists||loading} checked={decisions[r.row]?.chosen??false} onChange={e=>setDecisions(d=>({...d,[r.row]:{...d[r.row],chosen:e.target.checked}}))}/></td><td>{r.row}</td><td><strong>{r.code}</strong></td><td>{r.name}</td><td>Bs {r.price_bob.toFixed(2)}</td><td>{r.stock===null?<strong className="import-needs-review">Revisar stock</strong>:r.stock}</td><td><input aria-label={`Stock aprobado de ${r.code}`} className="import-stock" type="number" min="0" step="1" disabled={r.exists||loading||!decisions[r.row]?.chosen} value={decisions[r.row]?.stock??''} onChange={e=>setDecisions(d=>({...d,[r.row]:{...d[r.row],stock:e.target.value}}))}/></td><td><span className={`import-status ${r.exists?'existing':'new'}`}>{r.exists?'Ya existe':'Nuevo'}</span></td></tr>)}</tbody></table></div>
   <div className="import-bottom"><p>Se importarán <strong>{selected.length}</strong> productos nuevos. No se modificará el inventario existente.</p><button type="button" className="primary" disabled={loading||selected.length===0} onClick={()=>setConfirm(true)}>Confirmar importación</button></div>
  </>}
 </section>
 {confirm&&preview&&<div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setConfirm(false)}}><div className="modal-box import-confirm" role="dialog" aria-modal="true" aria-label="Confirmar importación"><div className="modal-top"><div><h2>¿Importar {selected.length} productos?</h2><p className="muted">Se guardarán productos nuevos y sus existencias iniciales. No podrás deshacer esto automáticamente.</p></div><button type="button" className="modal-x" disabled={loading} aria-label="Cerrar" onClick={()=>setConfirm(false)}>×</button></div><p>Se omitirán los códigos existentes y no se tocarán ventas anteriores.</p><div className="confirm-actions"><button type="button" disabled={loading} onClick={()=>setConfirm(false)}>Cancelar</button><button type="button" className="primary" disabled={loading} onClick={()=>void upload('commit')}>{loading?'Importando…':'Sí, importar'}</button></div>{error&&<p className="error">{error}</p>}</div></div>}
 </div>;
}

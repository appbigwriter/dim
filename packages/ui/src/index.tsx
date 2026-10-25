'use client';
export function StatusChip({status}:{status:string}){return <span className={`chip ${['active','approved','published','signed','connected','completed'].includes(status)?'positive':['blocked','failed','revoked','restricted','uncertain'].includes(status)?'negative':''}`}>{status.replaceAll('_',' ')}</span>;}
export function ErrorBanner({error,retry}:{error:string;retry?:()=>void}){return <div className="error" role="alert"><span>{error}</span>{retry&&<button onClick={retry}>Tentar novamente</button>}</div>;}
export function Empty({title='Ainda não há registros',description='Os novos registros aparecerão aqui.'}:{title?:string;description?:string}){return <div className="empty"><span aria-hidden="true">◇</span><h3>{title}</h3><p>{description}</p></div>;}
export function Metric({label,value,source}:{label:string;value:string|number;source:string}){return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{source}</small></article>;}

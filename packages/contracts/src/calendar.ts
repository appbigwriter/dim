export function dateKey(date:Date){return date.toISOString().slice(0,10);}
export function shiftDate(day:string,days:number){const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return dateKey(date);}
export function calendarDays(anchor:string,view:'week'|'month') {
  const date=new Date(`${anchor}T12:00:00Z`);if(view==='month')date.setUTCDate(1);
  const monday=shiftDate(dateKey(date),-((date.getUTCDay()+6)%7));return Array.from({length:view==='week'?7:42},(_,index)=>shiftDate(monday,index));
}
export function wallTime(iso:string,timeZone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
  const get=(key:string)=>parts.find(p=>p.type===key)?.value;return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function wallTimeToUtc(wall:string,timeZone:string,ambiguity:'reject'|'earlier'|'later'='reject') {
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(wall))throw new Error('Informe data e hora completas');
  const target=Date.parse(`${wall}:00Z`);if(!Number.isFinite(target)||dateKey(new Date(target))!==wall.slice(0,10))throw new Error('Data inválida');
  const offsets=new Set<number>();for(let hours=-36;hours<=36;hours+=6){const instant=target+hours*3600000;offsets.add(Date.parse(`${wallTime(new Date(instant).toISOString(),timeZone)}:00Z`)-instant);}
  const candidates=[...offsets].map(offset=>target-offset).filter(instant=>wallTime(new Date(instant).toISOString(),timeZone)===wall).sort((a,b)=>a-b);
  if(!candidates.length)throw new Error('Horário inexistente neste fuso devido à mudança de horário de verão');
  if(candidates.length>1&&ambiguity==='reject')throw new Error('Horário ambíguo neste fuso; escolha a primeira ou a segunda ocorrência');
  return new Date(ambiguity==='later'?candidates[candidates.length-1]:candidates[0]).toISOString();
}

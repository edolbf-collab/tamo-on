/* Partner agenda uses full calendar dates. This module never changes schedule data. */
(() => {
  'use strict';
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function iso(value){
    const text=String(value||'');const m=text.match(/^(\d{4})-(\d{2})-(\d{2})$/)||text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)?.map((v,i,a)=>i===1?a[3]:i===3?a[1]:v);
    if(!m)return '';const y=+m[1],mo=+m[2],d=+m[3];if(y<1900||y>9999||mo<1||mo>12||d<1||d>31)return '';
    const dt=new Date(Date.UTC(y,mo-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?`${m[1]}-${m[2]}-${m[3]}`:'';
  }
  const dayIso=day=>iso(day?.date)||iso(day?.isoDate);
  const validMonth=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v))&&+String(v).slice(0,4)>=1900&&+String(v).slice(0,4)<=9999;
  function today(timeZone='America/Sao_Paulo',date=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
  function shiftMonth(month,delta){if(!validMonth(month)||!Number.isInteger(delta))return '';const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+delta,1));const result=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;return validMonth(result)?result:'';}
  const label=month=>validMonth(month)?`${months[Number(month.slice(5))-1]} de ${month.slice(0,4)}`:'';
  function dateMatches(candidate,target,shortDate=''){
    const targetIso=iso(target);if(targetIso)return iso(candidate)===targetIso;
    return /^\d{2}\/\d{2}$/.test(String(target))&&(shortDate===target||String(candidate||'').slice(0,5)===target);
  }
  function resolve({days=[],month='',selectedDate='',today:now=today()}){
    const entries=days.filter(d=>dayIso(d)&&Array.isArray(d.slots)&&d.slots.length).sort((a,b)=>dayIso(a).localeCompare(dayIso(b)));
    let selected=iso(selectedDate);
    if(!selected&&/^\d{2}\/\d{2}$/.test(selectedDate)){
      const matches=entries.filter(d=>d.shortDate===selectedDate);if(matches.length===1)selected=dayIso(matches[0]);
    }
    if(!validMonth(month))month=selected?selected.slice(0,7):entries.some(d=>dayIso(d).startsWith(now.slice(0,7)))?now.slice(0,7):dayIso(entries.find(d=>dayIso(d)>=now)||entries.at(-1)).slice(0,7)||now.slice(0,7);
    const visible=entries.filter(d=>dayIso(d).slice(0,7)===month);
    if(!selected||selected.slice(0,7)!==month)selected=dayIso(visible.find(d=>dayIso(d)>=now)||visible[0]);
    const years=[...new Set([Number(now.slice(0,4)),Number(month.slice(0,4)),...entries.map(d=>Number(dayIso(d).slice(0,4)))])].sort((a,b)=>a-b);
    return {month,selectedDate:selected,days:visible,years,today:now};
  }
  function render(view){
    const [year,month]=view.month.split('-').map(Number);
    const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const cells=view.days.map(day=>{
      const date=dayIso(day),number=Number(date.slice(8)),active=date===view.selectedDate,isToday=date===view.today;
      const weekday=weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
      return `<button type="button" class="schedule-day agenda-list-day${active?' active':''}${isToday?' is-today':''}" data-action="partner-schedule-date" data-date="${date}" aria-label="${number} de ${esc(months[month-1])} de ${year}" aria-pressed="${active}" ${isToday?'aria-current="date"':''}><small>${weekday}</small><strong>${date.slice(8)}/${date.slice(5,7)}</strong></button>`;
    });
    return `<div class="partner-agenda-navigation"><div class="partner-agenda-period"><div class="agenda-period-controls"><button type="button" class="button ghost small" data-action="partner-agenda-prev" aria-label="Mês anterior" ${shiftMonth(view.month,-1)?'':'disabled'}>‹</button><label><span>Mês</span><select data-action="partner-agenda-month" aria-label="Mês da agenda">${months.map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${i+1===month?'selected':''}>${esc(m)}</option>`).join('')}</select></label><label><span>Ano</span><select data-action="partner-agenda-year" aria-label="Ano da agenda">${view.years.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('')}</select></label><button type="button" class="button ghost small" data-action="partner-agenda-next" aria-label="Próximo mês" ${shiftMonth(view.month,1)?'':'disabled'}>›</button><button type="button" class="button secondary small" data-action="partner-agenda-today">Hoje</button></div></div>${cells.length?`<div class="partner-agenda-date-strip schedule-days" role="group" aria-label="Dias publicados em ${esc(label(view.month))}">${cells.join('')}</div>`:'<p class="agenda-period-note">Nenhum horário publicado neste mês.</p>'}</div>`;
  }
  const revealedDays=new WeakMap();
  function showSelected(root){
    const strip=root?.querySelector('.partner-agenda-date-strip'),selected=strip?.querySelector('.agenda-list-day.active');
    if(!selected||revealedDays.get(strip)===selected.dataset.date)return;
    revealedDays.set(strip,selected.dataset.date);
    const row=strip.getBoundingClientRect(),cell=selected.getBoundingClientRect();
    if(cell.left<row.left||cell.right>row.right)strip.scrollLeft+=cell.left-row.left-(row.width-cell.width)/2;
  }
  if(typeof document!=='undefined')globalThis.addEventListener('resize',()=>{
    const strip=document.querySelector('.partner-agenda-date-strip');
    if(strip){revealedDays.delete(strip);showSelected(document);}
  });
  globalThis.MarketplaceAgendaNavigation={iso,dayIso,dateMatches,validMonth,today,shiftMonth,label,resolve,render,showSelected};
})();

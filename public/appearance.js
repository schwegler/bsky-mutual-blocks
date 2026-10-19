/* Applied before stylesheet paint; seasonal selection is a separate preference. */
(() => {
 const key='moots-color-mode:v1',root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)');
 const read=()=>{try{return localStorage.getItem(key)}catch{return null}};
 let mode=['light','dark'].includes(read())?read():'system',buttons=[];
 const apply=()=>{root.dataset.theme=mode==='system'?(system.matches?'dark':'light'):mode;root.dataset.colorMode=mode;buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.colorMode===mode)));};
 apply();system.addEventListener('change',()=>{if(mode==='system')apply()});
 addEventListener('storage',event=>{if(event.key===key||event.key===null){const saved=read();mode=['light','dark'].includes(saved)?saved:'system';apply()}});
 document.addEventListener('DOMContentLoaded',()=>{
  const controls=document.createElement('div');controls.className='seasonal-controls';controls.dataset.appearanceControls='';
  const disclosure=document.createElement('button');disclosure.type='button';disclosure.className='seasonal-appearance-toggle';disclosure.textContent='Appearance';disclosure.setAttribute('aria-expanded','false');disclosure.setAttribute('aria-controls','seasonal-appearance-panel');
  const panel=document.createElement('div');panel.className='seasonal-appearance-panel';panel.id='seasonal-appearance-panel';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','Appearance settings');
  const group=document.createElement('div');group.className='color-mode-options';group.setAttribute('role','group');group.setAttribute('aria-label','Color mode');
  for(const value of ['system','light','dark']){const button=document.createElement('button');button.type='button';button.textContent=value[0].toUpperCase()+value.slice(1);button.dataset.colorMode=value;button.addEventListener('click',()=>{mode=value;try{value==='system'?localStorage.removeItem(key):localStorage.setItem(key,value)}catch{}apply()});buttons.push(button);group.append(button)}
  panel.append(group);controls.append(disclosure,panel);document.querySelector('.header-right').append(controls);
  const close=()=>{panel.hidden=true;disclosure.setAttribute('aria-expanded','false')};
  const place=()=>controls.style.setProperty('--appearance-top',`${Math.max(8,Math.min(disclosure.getBoundingClientRect().bottom+8,innerHeight-260))}px`);
  disclosure.addEventListener('click',()=>{place();panel.hidden=!panel.hidden;disclosure.setAttribute('aria-expanded',String(!panel.hidden))});
  document.addEventListener('click',event=>{if(!controls.contains(event.target))close()});
  document.addEventListener('focusin',event=>{if(!controls.contains(event.target))close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&controls.contains(document.activeElement)){close();disclosure.focus();event.preventDefault()}});
  addEventListener('resize',place,{passive:true});window.SchwegAppearance={controls,disclosure,panel,close};apply();
 });
})();

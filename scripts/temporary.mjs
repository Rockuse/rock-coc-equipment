// CoC7 Universal Equipment 1.7.0: GM-controlled temporary consumable effects.
// Changes are stored in module flags, NOT permanent actor characteristic values.
const ID='coc7-universal-equipment';
const KEY='temporaryEffects';
const now=()=>Number(game.time.worldTime)||0;
const escape=s=>foundry.utils.escapeHTML(String(s));
const consumable=item=>item?.getFlag(ID,'consumable');
async function use(actor,item){
 if(!game.user.isGM){ui.notifications.warn('Ask the Keeper to approve this consumable.');return;}
 const cfg=consumable(item);if(!cfg)return;
 if(Number(item.system?.quantity??0)<=0){ui.notifications.warn(`${item.name} is depleted`);return;}
 const target=canvas?.tokens?.controlled?.[0]?.actor??actor;
 const duration=Number(cfg.effect?.durationSeconds??0);
 const info=cfg.kind==='direct-heal'?'This is optional supernatural/homebrew healing.':duration?`Effect duration: ${Math.round(duration/60)} minutes of world time.`:'This item requires Keeper adjudication.';
 const ok=await foundry.applications.api.DialogV2.confirm({window:{title:`Use ${item.name}`},content:`<p>Apply to <b>${escape(target.name)}</b>?</p><p>${escape(info)}</p><p>Consumes one item. The Keeper must confirm eligibility and consequences.</p>`});
 if(!ok)return;
 if(cfg.kind==='direct-heal'){
  const hp=target.system?.attribs?.hp;
  if(!hp||typeof hp.value!=='number'||typeof hp.max!=='number'){ui.notifications.error('CoC7 HP fields unavailable');return;}
  const formula=cfg.effect?.healFormula||'1d3';const roll=await new Roll(formula).evaluate();
  const amount=Math.max(0,Math.min(hp.max-hp.value,roll.total));
  await target.update({'system.attribs.hp.value':hp.value+amount});
  await ChatMessage.create({content:`<p><b>${escape(item.name)}</b>: ${escape(target.name)} restores ${amount} HP (Keeper-approved homebrew).</p>`});
 }else if(duration){
  const existing=target.getFlag(ID,KEY)||[];
  if(existing.some(e=>e.itemName===item.name&&e.end>now())){ui.notifications.warn('This effect is already active; stacking is disabled.');return;}
  const record={id:foundry.utils.randomID(),itemName:item.name,start:now(),end:now()+duration,effect:cfg.effect,sourceActor:actor.id};
  await target.setFlag(ID,KEY,[...existing,record]);
  await ChatMessage.create({content:`<p><b>${escape(item.name)}</b> used on ${escape(target.name)}. Temporary effect active for ${Math.round(duration/60)} minutes. Keeper applies any characteristic or roll modifiers manually until native CoC7 effect integration is validated.</p>`});
 }else{
  await ChatMessage.create({content:`<p><b>${escape(item.name)}</b> used on ${escape(target.name)}. Keeper adjudicates the effect.</p>`});
 }
 await item.update({'system.quantity':Math.max(0,Number(item.system.quantity)-1)});
}
async function expire(){if(!game.user.isGM)return;for(const actor of game.actors){
 const all=actor.getFlag(ID,KEY)||[];if(!all.length)continue;
 const active=all.filter(e=>e.end>now());if(active.length===all.length)continue;
 await actor.setFlag(ID,KEY,active);
 for(const e of all.filter(e=>e.end<=now())){
  await ChatMessage.create({content:`<p><b>${escape(e.itemName)}</b> expired on ${escape(actor.name)}. Remove any Keeper-applied roll modifiers.</p>`});
 }
}}
function decorate(){for(const row of document.querySelectorAll('li.item.flexrow[data-item-uuid]')){
 if(row.querySelector('.coc7-ue-temp-use'))continue;
 const match=/^Actor\.([^.]+)\.Item\.([^.]+)$/.exec(row.dataset.itemUuid||'');if(!match)continue;
 const actor=game.actors.get(match[1]),item=actor?.items.get(match[2]);const cfg=consumable(item);
 if(!cfg||!['timed','direct-heal','special','resource'].includes(cfg.kind))continue;
 const controls=row.querySelector('.item-controls');if(!controls)continue;
 const b=document.createElement('button');b.type='button';b.className='coc7-ue-temp-use';b.textContent='Use';b.title='Keeper-approved consumable';
 b.style.cssText='font-size:11px;padding:1px 5px;margin-right:3px;cursor:pointer';
 for(const ev of ['mousedown','pointerdown','dblclick'])b.addEventListener(ev,e=>e.stopPropagation());
 b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();b.disabled=true;try{await use(actor,item);}catch(err){console.error(ID,err);ui.notifications.error('Consumable use failed');}finally{b.disabled=false;}});
 controls.prepend(b);
}}
Hooks.once('ready',()=>{
 let scheduled=false;
 new MutationObserver(records=>{if(scheduled||!records.some(r=>r.addedNodes.length))return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;decorate();});}).observe(document.body,{subtree:true,childList:true});
 decorate();Hooks.on('updateWorldTime',()=>{void expire().catch(console.error);});
 if(game.user.isGM)void expire().catch(console.error);
 console.info(`${ID} v1.7.0 consumables ready`);
});

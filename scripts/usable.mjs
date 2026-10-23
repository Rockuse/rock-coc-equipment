// CoC7 Universal Equipment v1.6.0 — opt-in medical item actions and GM status controls.
// Native CoC7 dice rolls remain authoritative; this module does not parse chat HTML to infer success.
const MOD='coc7-universal-equipment';
const pending=new Map();
const SKILLS={firstaid:'First Aid',medicine:'Medicine'};
// Consumable medical supplies use quantity as units. Reusable kits/tools do not lose quantity.
const CONSUMABLE=/^(first aid dressing|bandage roll|antiseptic bottle|antiseptic wipe|sterile gauze pad|antiseptic supplies|surgical supplies|medical gloves pack)$/i;
const isMedicalConsumable=item=>!!item&&CONSUMABLE.test(item.name.trim());
const isMedicalItem=item=>!!medicalKind(item);

function medicalKind(item){
 if(item?.type!=='item')return null;
 const n=item.name.toLowerCase();
 if(/first.?aid|bandage|medical supplies|trauma kit|antiseptic|gauze/.test(n))return 'firstaid';
 if(/doctor.?s bag|medical bag|surgical|antitoxin/.test(n))return 'medicine';
 return null;
}
function findItem(row){
 const match=/^Actor\.([^.]+)\.Item\.([^.]+)$/.exec(row.dataset.itemUuid||'');
 if(!match)return null;
 const actor=game.actors.get(match[1]),item=actor?.items.get(match[2]);
 return item&&item.uuid===row.dataset.itemUuid?{actor,item}:null;
}
function stop(e){e.preventDefault();e.stopPropagation();}
function skillFor(actor,name){return [...actor.items].find(i=>i.type==='skill'&&
 (i.name.toLowerCase()===name.toLowerCase()||i.name.toLowerCase().startsWith(name.toLowerCase()+' (')));}
async function chooseMedicalSkill(item){
 const defaultKind=medicalKind(item);
 if(/doctor.?s bag|medical bag/.test(item.name.toLowerCase())){
  const choice=await foundry.applications.api.DialogV2.wait({window:{title:`Use ${item.name}`},
   content:'<p>Select the treatment skill. Healing eligibility is adjudicated by the Keeper.</p>',
   buttons:[{action:'firstaid',label:'First Aid',default:false,callback:()=> 'firstaid'},
    {action:'medicine',label:'Medicine',default:true,callback:()=> 'medicine'},
    {action:'cancel',label:'Cancel',callback:()=>null}],rejectClose:false});
  return choice;
 }
 return defaultKind;
}
async function useMedical(actor,item){
 if(Number(item.system?.quantity??1)<=0){ui.notifications.warn(`${item.name} is depleted`);return;}
 const kind=await chooseMedicalSkill(item);if(!kind)return;
 const skill=skillFor(actor,SKILLS[kind]);
 if(!skill){ui.notifications.warn(`${actor.name} does not have a ${SKILLS[kind]} skill item`);return;}
 // CoC7 8.16 actor.skillCheck(skillData, fastForward, options) verified in console.
 if(typeof actor.skillCheck==='function'){
  try{
   pending.set(actor.id,{itemId:item.id,kind,at:Date.now()});
   await actor.setFlag(MOD,'pendingMedicalUse',{itemId:item.id,kind,started:Date.now()});
   await actor.skillCheck(skill.name,false,{});
   ui.notifications.info(`${SKILLS[kind]} roll initiated; Keeper confirms healing and consumption.`);
   return;
  }catch(err){pending.delete(actor.id);console.warn(`${MOD}: actor.skillCheck failed`,err);}
 }
 // CoC7 8.16 does not consistently expose a roll method on embedded skill items.
 // Do not silently consume equipment, fake a skill result, or call an unverified API.
 const rollMethod=typeof skill.roll==='function'?'roll':typeof skill.skillCheck==='function'?'skillCheck':null;
 if(rollMethod){
  try{
   await skill[rollMethod]();
   pending.set(actor.id,{itemId:item.id,kind,at:Date.now()});
   await actor.setFlag(MOD,'pendingMedicalUse',{itemId:item.id,kind,started:Date.now()});
   ui.notifications.info(`${SKILLS[kind]} roll started. Keeper must confirm the result and treatment.`);
   return;
  }catch(err){console.warn(`${MOD}: native roll unavailable; using manual workflow`,err);}
 }
 const choice=await foundry.applications.api.DialogV2.wait({
  window:{title:`Use ${item.name}`},
  content:`<p>This CoC7 version does not expose a supported item-roll method.</p><p>Roll <b>${SKILLS[kind]}</b> from the actor's <b>Skills</b> tab. Then the Keeper can confirm treatment. No supplies are consumed automatically.</p>`,
  buttons:[{action:'open',label:'Open Character Sheet',default:true,callback:()=> 'open'},
           {action:'cancel',label:'Cancel',callback:()=>null}],rejectClose:false
 });
 if(choice==='open')actor.sheet.render(true);
}
function renderUse(row){
 const found=findItem(row);if(!found)return;
 const {actor,item}=found,kind=medicalKind(item);if(!kind)return;
 const controls=row.querySelector('.item-controls');if(!controls||controls.querySelector('.coc7-ue-use'))return;
 const b=document.createElement('button');b.type='button';b.className='coc7-ue-use';b.textContent='Use';
 b.title=`Roll ${SKILLS[kind]} using ${item.name}`;
 b.style.cssText='font-size:11px;padding:1px 5px;margin-right:3px;cursor:pointer';
 for(const ev of ['mousedown','pointerdown','dblclick'])b.addEventListener(ev,e=>e.stopPropagation());
 b.addEventListener('click',async e=>{stop(e);b.disabled=true;try{await useMedical(actor,item);}finally{b.disabled=false;}});
 controls.prepend(b);
}
function scan(){for(const row of document.querySelectorAll('li.item.flexrow[data-item-uuid]'))renderUse(row);}
function messageActor(message){return game.actors.get(message.speaker?.actor)||null;}
function isPushed(message){
 const f=message.flags?.CoC7??{};
 return f.pushed===true||f.roll?.pushed===true||f.roll?.isPushed===true||f.check?.pushed===true;
}
function confirmedSuccess(message){
 const f=message.flags?.CoC7??{};
 const results=[f.roll?.successLevel,f.check?.successLevel,f.successLevel];
 // Only use explicit structured result flags, never visual labels.
 return results.some(v=>typeof v==='number'&&v>=1)||f.roll?.isSuccess===true||f.check?.isSuccess===true;
}
function confirmedFailure(message){
 const f=message.flags?.CoC7??{};
 return f.roll?.isFailure===true||f.check?.isFailure===true||f.roll?.successLevel===0||f.check?.successLevel===0;
}
async function pickActor(){
 const selected=canvas?.tokens?.controlled?.[0]?.actor;
 if(selected)return selected;
 ui.notifications.warn('Select a target token on the canvas first.');return null;
}
async function statusDialog(message){
 if(!game.user.isGM)return;
 const actor=await pickActor();if(!actor)return;
 const statuses=[...(CONFIG.statusEffects??[])].filter(s=>s.id&&s.name);
 if(!statuses.length){ui.notifications.warn('No registered status effects found');return;}
 const escape=foundry.utils.escapeHTML;
 const options=statuses.map(s=>`<option value="${escape(s.id)}">${escape(game.i18n.localize(s.name))}</option>`).join('');
 const status=await foundry.applications.api.DialogV2.wait({window:{title:`Status effects — ${actor.name}`},
  content:`<p>Keeper-controlled consequence. No automatic penalties are applied.</p><select name="effect" style="width:100%">${options}</select>`,
  buttons:[{action:'apply',label:'Toggle Status',default:true,callback:(e,b)=>b.form.elements.effect.value},
   {action:'cancel',label:'Cancel',callback:()=>null}],rejectClose:false});
 if(!status)return;
 try{await actor.toggleStatusEffect(status);ui.notifications.info(`Toggled ${status} on ${actor.name}`);}
 catch(err){console.error(`${MOD}: status toggle failed`,err);ui.notifications.error('Unable to toggle status effect');}
}
// v1.7.6: Inspect structured native CoC7 roll data only; ambiguous results require GM choice.
// This is a suggestion, not a license to consume supplies or change HP automatically.
function detectMedicalOutcome(message){
 const f=message.flags?.CoC7??{};
 const objects=[f.roll,f.check,f.skillCheck,f].filter(x=>x&&typeof x==='object');
 const pushed=objects.some(x=>x.pushed===true||x.isPushed===true||x.isPush===true);
 if(pushed)return {outcome:'pushed',source:'structured pushed flag'};
 const candidates=new Set();
 for(const x of objects){
  if(x.isFumble===true||x.fumble===true)candidates.add('fumble');
  if(x.isCritical===true||x.critical===true||x.isExtremeSuccess===true||x.extremeSuccess===true)candidates.add('extreme');
  if(x.isHardSuccess===true||x.isSuccess===true||x.success===true)candidates.add('regular');
  if(x.isFailure===true||x.failure===true)candidates.add('failure');
  // Named outcomes are unambiguous. Numeric success levels vary across CoC7 data models.
  for(const field of ['result','outcome','successLevel','successType']){
   const value=x[field];
   if(typeof value!=='string')continue;
   const v=value.toLowerCase().trim();
   if(/fumble/.test(v))candidates.add('fumble');
   else if(/critical|extreme/.test(v))candidates.add('extreme');
   else if(/hard|regular|success/.test(v))candidates.add('regular');
   else if(/failure|failed|fail/.test(v))candidates.add('failure');
  }
 }
 if(candidates.size!==1)return {outcome:null,source:candidates.size?'conflicting native fields':'no supported structured outcome'};
 return {outcome:[...candidates][0],source:'structured CoC7 roll fields'};
}
// v1.7.7: Parse the native CoC7 dice-result markup as a fallback.
// Multiple rolls on a single chat card are ambiguous: do not infer which one
// represents the treatment. Keeper confirmation remains mandatory.
function detectOutcomeFromHtml(message){
 const container=document.createElement('div');
 container.innerHTML=message.content??'';
 const rolls=[...container.querySelectorAll('.dice-roll .dice-result')];
 if(rolls.length!==1)return {outcome:null,source:rolls.length>1?'multiple native dice results; Keeper must choose':'no native dice result'};
 const roll=rolls[0];
 const total=roll.querySelector('.dice-total');
 if(!total)return {outcome:null,source:'native roll total missing'};
 const classes=new Set([...total.classList,...(roll.querySelector('.dice-formula')?.classList??[])]);
 const tooltip=(total.getAttribute('data-tooltip')??'').toLowerCase();
 const pushed=/\(pushed roll\)/i.test(total.textContent??'');
 if(pushed)return {outcome:'pushed',source:'native CoC7 pushed-roll label'};
 if(classes.has('fumble')||tooltip==='fumble')return {outcome:'fumble',source:'native CoC7 fumble class'};
 if(classes.has('critical')||classes.has('extreme')||/^(critical|extreme)( success)?$/.test(tooltip))return {outcome:'extreme',source:'native CoC7 success class'};
 if(classes.has('failure')||tooltip==='failure')return {outcome:'failure',source:'native CoC7 failure class'};
 if(classes.has('success')||classes.has('hard')||classes.has('regular')||/^(hard|regular)( success)?$/.test(tooltip))return {outcome:'regular',source:'native CoC7 success class'};
 return {outcome:null,source:'unrecognized native CoC7 roll class'};
}
// v1.7.5: Shared medical outcome workflow for consumable supplies and reusable kits.
// Keeper selects the final outcome; native CoC7 chat HTML is never used as an outcome authority.
const OUTCOME_RULES={regular:{heal:1,cost:1},extreme:{heal:2,cost:1},failure:{heal:0,cost:1},fumble:{heal:0,cost:2},pushed:{heal:0,cost:2}};
async function reviewMedical(message,button){
 if(!game.user.isGM)return;
 if(message.getFlag(MOD,'medicalResolved')){ui.notifications.warn('This medical roll is already resolved.');return;}
 const actor=messageActor(message);if(!actor)return;
 const link=actor.getFlag(MOD,'pendingMedicalUse');
 if(!link?.itemId){ui.notifications.warn('No pending medical item use on this investigator.');return;}
 const item=actor.items.get(link.itemId);
 if(!isMedicalItem(item)){ui.notifications.warn('Linked medical equipment is missing.');return;}
 const expendable=isMedicalConsumable(item);
 const escape=foundry.utils.escapeHTML;
 const structured=detectMedicalOutcome(message);
 const detected=structured.outcome?structured:detectOutcomeFromHtml(message);
 const suggested=detected.outcome;
 const outcome=await foundry.applications.api.DialogV2.wait({
  window:{title:`GM: ${item.name} — Final Roll Outcome`},
  content:`<p><b>Detected outcome:</b> ${suggested?escape(suggested.toUpperCase()):'Not determined'} (${escape(detected.source)}). Verify the native CoC7 card; the Keeper must confirm or correct the result. Pushed rolls restore 0 HP and cost 2 units for consumables.</p><p><b>${escape(actor.name)}</b> — <b>${escape(item.name)}</b> (${expendable?'consumable':'reusable equipment'}; quantity ${Number(item.system?.quantity??0)}).</p>`,
  buttons:[
   {action:'regular',default:suggested==='regular',label:'Regular / Hard (+1 HP)',callback:()=> 'regular'},
   {action:'extreme',default:suggested==='extreme',label:'Extreme / Critical (+2 HP)',callback:()=> 'extreme'},
   {action:'failure',default:suggested==='failure',label:'Failure (0 HP)',callback:()=> 'failure'},
   {action:'fumble',default:suggested==='fumble',label:'Fumble (0 HP)',callback:()=> 'fumble'},
   {action:'pushed',default:suggested==='pushed',label:'Pushed — Any Result (0 HP)',callback:()=> 'pushed'},
   {action:'cancel',label:'Cancel',callback:()=>null}
  ],rejectClose:false
 });
 const rule=OUTCOME_RULES[outcome];if(!rule)return;
 const cost=expendable?rule.cost:0;
 const available=Number(item.system?.quantity??0);
 if(!Number.isFinite(available)||available<Math.max(cost,1)){
  ui.notifications.warn(`Requires ${Math.max(cost,1)} available ${item.name} unit(s); only ${available} available.`);return;
 }
 let target=null,before=0,next=0;
 if(rule.heal){
  target=await pickActor();if(!target)return;
  const hp=target.system?.attribs?.hp;
  if(!hp||!Number.isFinite(Number(hp.value))||!Number.isFinite(Number(hp.max))){ui.notifications.error('Target HP fields unavailable.');return;}
  before=Number(hp.value);next=Math.min(Number(hp.max),before+rule.heal);
  if(next<=before){ui.notifications.warn('Target already at maximum HP. No changes made.');return;}
 }
 const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Confirm Medical Outcome'},
  content:`<p><b>${escape(item.name)}</b> — <b>${escape(outcome.toUpperCase())}</b>.</p><p>${target?`Heal <b>${escape(target.name)}</b> by <b>${next-before} HP</b>. `:'No HP restored. '} ${cost?`Consume <b>${cost}</b> supply unit(s).`:'Reusable equipment: no quantity deduction.'}</p><p>Keeper: verify treatment eligibility and the final roll. This chat card may be resolved only once.</p>`});
 if(!confirmed)return;
 button.disabled=true;
 try{
  if(message.getFlag(MOD,'medicalResolved'))throw Error('Already resolved');
  if(Number(item.system?.quantity??0)<Math.max(cost,1))throw Error('Insufficient equipment quantity');
  if(target){
   await target.update({'system.attribs.hp.value':next});
   const actual=Number(target.system?.attribs?.hp?.value);
   if(actual!==next)throw Error(`HP verification failed: expected ${next}, got ${actual}. Supplies not consumed.`);
  }
  if(cost){
   try{await item.update({'system.quantity':Number(item.system.quantity)-cost});}
   catch(err){if(target)await target.update({'system.attribs.hp.value':before});throw err;}
  }
  await message.setFlag(MOD,'medicalResolved',{outcome,heal:target?next-before:0,cost,itemId:item.id,sourceActorUuid:actor.uuid,targetActorUuid:target?.uuid??null,at:Date.now()});
  await actor.unsetFlag(MOD,'pendingMedicalUse');pending.delete(actor.id);
  ui.notifications.info(`${item.name}: ${outcome}; ${target?`+${next-before} HP; `:''}${cost} supplies consumed.`);
 }catch(err){console.error(`${MOD}: medical resolution failed`,err);ui.notifications.error(err.message??'Medical resolution failed');button.disabled=false;}
}
function renderChat(message,html){
 const root=html instanceof HTMLElement?html:html?.[0];if(!root||!game.user.isGM)return;
 const actor=messageActor(message);if(!actor||root.querySelector('.coc7-ue-chat-actions'))return;
 const isCoc7=!!message.flags?.CoC7;
 const cardText=[message.content??'',message.flavor??'',message.flags?.CoC7?.skill?.name??'',message.flags?.CoC7?.roll?.skill?.name??''].join(' ');
 const link=actor.getFlag(MOD,'pendingMedicalUse');
 const item=link?.itemId?actor.items.get(link.itemId):null;
 const expectedSkill=link?.kind==='medicine'?/\bmedicine\b/i:/first\s*aid/i;
 const isMedicalRoll=!!item&&isMedicalItem(item)&&expectedSkill.test(cardText)&&Number(message.timestamp??0)>=Number(link.started??0)-5000;
 if(!isCoc7&&!isMedicalRoll)return;
 const wrap=document.createElement('div');wrap.className='coc7-ue-chat-actions';wrap.style.cssText='display:flex;gap:4px;flex-wrap:wrap;margin-top:6px';
 if(isMedicalRoll){
  const resolved=!!message.getFlag(MOD,'medicalResolved');
  const b=document.createElement('button');b.textContent=resolved?'Medical Item: Resolved':`GM: Resolve ${item.name}`;b.disabled=resolved;
  b.addEventListener('click',e=>{stop(e);void reviewMedical(message,b);});wrap.append(b);
 }
 if(isCoc7){const b=document.createElement('button');b.textContent=isPushed(message)&&confirmedFailure(message)?'Pushed Failure: Status Effects':'GM: Status Effects';b.title='Toggle a Foundry status on the selected target token';b.addEventListener('click',e=>{stop(e);void statusDialog(message);});wrap.append(b);}
 root.append(wrap);
}
Hooks.once('ready',()=>{
 scan();
 let queued=false;
 new MutationObserver(records=>{
  if(!records.some(r=>r.addedNodes.length)||queued)return;
  queued=true;requestAnimationFrame(()=>{queued=false;scan();});
 }).observe(document.body,{childList:true,subtree:true});
 Hooks.on('renderChatMessage',(message,html)=>renderChat(message,html));
 Hooks.on('renderChatMessageHTML',(message,html)=>renderChat(message,html));
 Hooks.on('updateItem',item=>{if(item.parent?.documentName==='Actor')requestAnimationFrame(scan);});
 console.info(`${MOD} v1.7.7: native roll HTML fallback loaded`);
});

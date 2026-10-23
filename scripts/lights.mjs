const MOD = 'coc7-universal-equipment';
const NS = 'coc7UniversalEquipment';
const STATE = 'lightState';
const BUSY = new Set();
const OBSERVERS = new WeakMap();
const lightItems = actor => [...(actor?.items ?? [])].filter(i => i.type === 'item' && i.flags?.[NS]?.light);
const CONDITIONS = Object.freeze({Terrible:-75,Poor:-50,Fair:-25,Normal:0,Good:25,Excellent:50});
const conditionOf = item => {
  const value=item.getFlag(MOD,'condition');
  return Object.hasOwn(CONDITIONS,value) ? value : 'Normal';
};
const COLOR_INTENSITY=Object.freeze({Terrible:0.10,Poor:0.20,Fair:0.30,Normal:0.35,Good:0.45,Excellent:0.55});
const adjustedCapacity = (item,base) => round(Math.max(0, Number(base) * (1+CONDITIONS[conditionOf(item)]/100)));
const resourceOf = item => item.getFlag(MOD, 'resource');
const remaining = item => {const r=resourceOf(item); return r ? Math.max(0,Number(r.remaining ?? 0)) : Number(item.flags?.[NS]?.light?.durationMinutes ?? 0);};
const equipped = i => i.getFlag(MOD, 'equipped') === true && Number(i.system?.quantity ?? 1) > 0 && remaining(i) > 0;
const sourceFor = actor => lightItems(actor).filter(equipped).sort((a,b) =>
  (Number(b.flags[NS].light.priority ?? 0) - Number(a.flags[NS].light.priority ?? 0)) || a.name.localeCompare(b.name))[0];
function dist(feet, scene) {
  const unit = String(scene?.grid?.units ?? 'ft').toLowerCase().trim();
  return ['m','meter','meters','metre','metres'].includes(unit) ? Math.round(feet * .3048 * 100) / 100 : feet;
}
function animation(profile) {
  const a = profile.animation ?? {};
  const type = ['torch','pulse','none'].includes(a.type) ? a.type : 'none';
  return {type, speed: type === 'none' ? 0 : Math.max(1, Math.min(2, Number(a.speed ?? 2))),
    intensity: type === 'none' ? 0 : Math.max(1, Math.min(3, Number(a.intensity ?? 2))), reverse: false};
}
function getState(token) {return token.getFlag(MOD, STATE);}
async function restore(token, state) {
  if (state?.original) await token.update({light: state.original});
  // v14: never write flags.<module>.-=lightState:null into a Token update.
  if (getState(token) != null) await token.unsetFlag(MOD, STATE);
}
async function applyToken(token) {
  if (!game.user.isGM || !token?.actor || BUSY.has(token.uuid)) return;
  const source = sourceFor(token.actor), state = getState(token);
  if (!source && !state) return;
  BUSY.add(token.uuid);
  try {
    if (!source) {await restore(token, state); return;}
    const profile = source.flags[NS].light;
    const condition=conditionOf(source);
    const multiplier=1+CONDITIONS[condition]/100;
    const original = state?.original ?? token.light.toObject();
    const light = {...original,
      bright:dist(Math.max(0,Number(profile.bright ?? 0)*multiplier), token.parent),
      dim:dist(Math.max(0,Number(profile.dim ?? 0)*multiplier), token.parent),
      color:profile.color ?? '#FFFFFF', angle:Number(profile.angle ?? 360),
      alpha:COLOR_INTENSITY[condition], luminosity:0.4, animation:animation(profile)};
    const fingerprint = JSON.stringify({id:source.id,light});
    const current = token.light.toObject();
    // Reapply when a previous release saved the fingerprint but not the animation.
    if (state?.fingerprint === fingerprint && JSON.stringify(current) === JSON.stringify(light)) return;
    await token.update({light});
    await token.setFlag(MOD, STATE, {original,fingerprint,itemId:source.id});
  } catch(error) {console.error(`${MOD}: lighting update failed`,error);}
  finally {BUSY.delete(token.uuid);}
}
async function syncActor(actor) {
  if (!game.user.isGM || !actor) return;
  for (const token of canvas?.scene?.tokens ?? []) {
    if (token.actorId === actor.id || token.actor?.id === actor.id) await applyToken(token);
  }
}
Hooks.on('createItem', i => {if(i.parent?.documentName === 'Actor') void syncActor(i.parent);});
Hooks.on('deleteItem', i => {if(i.parent?.documentName === 'Actor') void syncActor(i.parent);});
Hooks.on('updateItem', i => {if(i.parent?.documentName === 'Actor') void syncActor(i.parent);});
Hooks.on('createToken', t => {void applyToken(t);});
Hooks.on('canvasReady', () => {if(game.user.isGM) for(const t of canvas?.scene?.tokens ?? []) void applyToken(t);});
Hooks.once('ready', () => {if(game.user.isGM) for(const t of canvas?.scene?.tokens ?? []) void applyToken(t);});

// CoC7 v8.16 renders actor inventory rows with a full embedded Actor Item UUID.
// Read the row itself rather than relying on legacy ActorSheet hooks or app.element.
function resolveRow(row) {
  const uuid = row.getAttribute('data-item-uuid') ?? '';
  const match = /^Actor\.([^.]+)\.Item\.([^.]+)$/.exec(uuid);
  if (!match) return null;
  const actor = game.actors.get(match[1]);
  const item = actor?.items.get(match[2]);
  if (!item || item.uuid !== uuid || item.type !== 'item') return null;
  if (!item.flags?.[NS]?.light && !item.flags?.[NS]?.consumable) return null;
  return {actor,item};
}
function renderEquip(row) {
  const found = resolveRow(row);
  if (!found) return;
  const {actor,item} = found;
  if (!item.flags?.[NS]?.light) return;
  const controls = row.querySelector('.item-controls');
  if (!controls) return;
  let label = controls.querySelector('.coc7-ue-equip');
  if (label) {
    const input = label.querySelector('input');
    if (input && !input.disabled && input.checked !== equipped(item)) input.checked = equipped(item);
    return;
  }
  label = document.createElement('label');
  label.className = 'coc7-ue-equip';
  label.title = `Equip or unequip ${item.name}`;
  label.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-right:8px;white-space:nowrap;cursor:pointer;font-size:11px;';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = equipped(item);
  checkbox.setAttribute('aria-label',`Equip ${item.name}`);
  checkbox.style.cssText = 'width:13px;height:13px;margin:0;cursor:pointer;';
  const caption = document.createElement('span');
  caption.textContent = 'Equip';
  label.append(checkbox,caption);
  // Prevent the CoC7 row's drag, detail and click handlers from firing.
  for (const event of ['click','mousedown','pointerdown','dblclick']) {
    label.addEventListener(event,e=>e.stopPropagation());
  }
  checkbox.addEventListener('change',async e=>{
    e.stopPropagation();
    const value=checkbox.checked;
    checkbox.disabled=true;
    try {
      if (value && !resourceOf(item)) await initializeResource(item);
      if (value && remaining(item) <= 0) throw new Error('Resource depleted; replenish first');
      await item.setFlag(MOD,'equipped',value);
      if (game.user.isGM) await syncActor(actor);
    } catch(err) {
      checkbox.checked=!value;
      console.error(`${MOD}: unable to change equipment state`,err);
      ui.notifications.error(`Unable to change equipment state: ${item.name}`);
    } finally {checkbox.disabled=false;}
  });
  controls.prepend(label);
}
function scanInventory(root=document) {
  for(const row of root.querySelectorAll('li.item.flexrow[data-item-uuid]')) renderEquip(row);
  if(root.matches?.('li.item.flexrow[data-item-uuid]')) renderEquip(root);
}
Hooks.once('ready',()=>{
  scanInventory();
  // V14 CoC7 replaces tab contents dynamically. Observe inserted DOM nodes
  // independently of sheet app classes, including already-open windows.
  let queued=false;
  const observer=new MutationObserver(records=>{
    if (!records.some(r=>r.addedNodes.length)) return;
    if(queued) return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;scanInventory();});
  });
  observer.observe(document.body,{childList:true,subtree:true});
  Hooks.on('updateItem',item=>{
    if(item.parent?.documentName==='Actor') requestAnimationFrame(()=>scanInventory());
  });
  console.info(`${MOD} v1.3.2: inventory equipment controls ready`);
});


// v1.4.0: all consumable state lives on embedded Actor Items, never on compendium sources.
// Light resource units are minutes. Medical and single-use supplies consume item quantity.
const RESOURCE_BUSY = new Set();
const round = n => Math.round(n * 1000) / 1000;
const resourceConfig = item => item.flags?.[NS]?.light ? {
  capacity: adjustedCapacity(item, Number(item.flags[NS].light.durationMinutes ?? 60)),
  kind: 'minutes',
  supply: supplyKind(item.name)
} : item.flags?.[NS]?.consumable ?? null;
function supplyKind(name) {
  const n=name.toLowerCase();
  if (/match/.test(n)) return 'matches';
  if (/candle/.test(n)) return 'candles';
  if (/torch \(burning\)/.test(n)) return 'torch';
  if (/gas lantern/.test(n)) return 'gas';
  if (/lantern/.test(n) && !/led|blue flame/.test(n)) return 'oil';
  if (/blue flame/.test(n)) return 'oil';
  if (/flashlight|led camping|phone flashlight/.test(n)) return 'battery';
  return 'none';
}
async function initializeResource(item) {
  if (resourceOf(item)) return resourceOf(item);
  const cfg=resourceConfig(item);
  if (!cfg?.capacity) return null;
  const r={remaining:cfg.capacity,capacity:cfg.capacity,kind:cfg.kind ?? 'minutes',supply:cfg.supply ?? 'none'};
  await item.setFlag(MOD,'resource',r);
  return r;
}
async function writeResource(item,remainingValue) {
  const old=resourceOf(item) ?? await initializeResource(item);
  if (!old) return;
  const next={...old,remaining:round(Math.max(0,Math.min(old.capacity,remainingValue)))};
  await item.setFlag(MOD,'resource',next);
  if (next.remaining<=0 && item.getFlag(MOD,'equipped')) await item.setFlag(MOD,'equipped',false);
}
// Resource packs are consumed from the actor's actual inventory, never compendium UUIDs.
function availableSupplies(actor,kind) {
  return [...actor.items].filter(i=>i.type==='item' &&
    i.flags?.[NS]?.supplyType===kind && Number(i.system?.quantity ?? 0)>0);
}
async function replenish(item) {
  const actor=item.parent, cfg=resourceConfig(item);
  if (!actor || !cfg || !cfg.supply || cfg.supply==='none' || cfg.supply==='torch' || cfg.supply==='matches' || cfg.supply==='candles') return false;
  const stock=availableSupplies(actor,cfg.supply)[0];
  if (!stock) {ui.notifications.warn(`No ${cfg.supply} supplies in inventory`);return false;}
  const old=resourceOf(item) ?? await initializeResource(item);
  if (!old || old.remaining>=old.capacity) return false;
  const units=Number(stock.system.quantity);
  await stock.update({'system.quantity':units-1});
  await writeResource(item,old.capacity);
  return true;
}
// Keeper override: refill without consuming any inventory supplies.
// Keep equipment switched off until the player explicitly equips it again.
async function forceRefill(item) {
  if (!game.user.isGM) {
    ui.notifications.warn('Only the GM can force-refill equipment.');
    return false;
  }
  const cfg=resourceConfig(item);
  if (!cfg || cfg.supply==='torch' || cfg.supply==='matches' || cfg.supply==='candles' || !item.parent || item.parent.documentName!=='Actor') return false;
  const old=resourceOf(item) ?? await initializeResource(item);
  if (!old) return false;
  await writeResource(item,old.capacity);
  ui.notifications.info(`${item.name}: force refilled to ${old.capacity} ${old.kind === 'minutes' ? 'minutes' : 'units'} (no supplies consumed).`);
  return true;
}
async function useConsumable(item) {
  const count=Number(item.system?.quantity ?? 0);
  if (count<=0) return;
  await item.update({'system.quantity':count-1});
  ui.notifications.info(`${item.name}: used 1 (${count-1} remaining). Apply any healing or roll manually according to CoC7 rules.`);
}
// A world-time jump (e.g. advancing 30 minutes) burns 30 minutes on each active
// light. Backwards time travel does not restore spent resources.
let previousWorldTime=null;
let clockQueue=Promise.resolve();
Hooks.once('ready',()=>{previousWorldTime=Number(game.time?.worldTime ?? 0);});
Hooks.on('updateWorldTime',(worldTime)=>{
  const now=Number(worldTime);
  const elapsed=previousWorldTime===null?0:Math.max(0,now-previousWorldTime);
  previousWorldTime=now;
  if(!game.user.isGM || elapsed<=0) return;
  clockQueue=clockQueue.then(async()=>{
    for(const actor of game.actors) {
      for(const item of lightItems(actor)) {
        if(item.getFlag(MOD,'equipped')!==true || Number(item.system?.quantity ?? 1)<=0) continue;
        const r=resourceOf(item) ?? await initializeResource(item);
        if(!r || r.remaining<=0) continue;
        await writeResource(item,r.remaining-elapsed/60);
      }
    }
  }).catch(e=>console.error(`${MOD}: world-time consumption failed`,e));
});
// Include synthetic/token actors on the active scene (if not already in game.actors).
Hooks.on('updateWorldTime',()=>{
  // The base actor is authoritative for linked tokens; unlinked actors are handled
  // by the same clock queue to avoid racing updates.
  if(!game.user.isGM) return;
});
function renderResources(row) {
  const found=resolveRow(row);
  if(!found) return;
  const {item}=found, cfg=resourceConfig(item);
  if(!cfg) return;
  const controls=row.querySelector('.item-controls');
  if(!controls) return;
  let wrap=controls.querySelector('.coc7-ue-resource');
  if(!wrap) {
    wrap=document.createElement('span');
    wrap.className='coc7-ue-resource';
    wrap.style.cssText='display:inline-flex;align-items:center;gap:4px;margin-right:6px;white-space:nowrap;font-size:10px';
    controls.prepend(wrap);
  }
  const r=resourceOf(item);
  const value=r?.remaining ?? cfg.capacity;
  const capacity=r?.capacity ?? cfg.capacity;
  const display=cfg.kind==='minutes' ? `${Math.ceil(value)}/${capacity}m` : `${value}/${capacity}`;
  const text=wrap.querySelector('.coc7-ue-counter') ?? document.createElement('span');
  text.className='coc7-ue-counter';if(text.textContent!==display)text.textContent=display;
  text.title='Remaining resource / capacity';
  if(!text.parentNode) wrap.append(text);
  const addButton=(cls,label,title,action)=>{
    let b=wrap.querySelector('.'+cls);
    if(!b){b=document.createElement('button');b.type='button';b.className=cls;
      b.style.cssText='cursor:pointer;padding:0 3px;font-size:10px;line-height:16px;';
      b.textContent=label;b.title=title;
      b.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();b.disabled=true;
        try{await action();}catch(err){console.error(err);ui.notifications.error(err.message);}finally{b.disabled=false;scanInventory();}
      });wrap.append(b);
    }return b;
  };
  if(item.flags?.[NS]?.light) {
    const refill=addButton('coc7-ue-refill','↻','Replace battery / refill fuel / replace candle using inventory supplies',()=>replenish(item));
    refill.style.display=['torch','matches','candles'].includes(cfg.supply)?'none':'';
    refill.disabled= !availableSupplies(item.parent,cfg.supply).length || value>=capacity;
    const force=addButton('coc7-ue-force-refill','⚡↻','GM: Force refill to full capacity without using any supplies',()=>forceRefill(item));
    force.style.display=game.user.isGM && !['torch','matches','candles'].includes(cfg.supply) ? '' : 'none';
    force.disabled= !game.user.isGM || value>=capacity;

    // Manual burn is optional, useful if the Keeper does not advance world time.
    const burn=addButton('coc7-ue-burn','−15m','Manually consume 15 minutes',async()=>{
      await initializeResource(item);await writeResource(item,remaining(item)-15);
    });burn.disabled=value<=0;
  } else if(item.flags?.[NS]?.consumable && !/first.?aid|bandage|medical supplies|trauma kit|doctor.?s bag|medical bag|surgical kit/i.test(item.name)) {
    const use=addButton('coc7-ue-use','Use 1','Consume one item (does not automatically heal)',()=>useConsumable(item));
    use.disabled=Number(item.system?.quantity ?? 0)<=0;
  }
  for(const evt of ['click','mousedown','pointerdown','dblclick'])wrap.addEventListener(evt,e=>e.stopPropagation());
}
Hooks.once('ready',()=>{
  const refresh=()=>{for(const row of document.querySelectorAll('li.item.flexrow[data-item-uuid]'))renderResources(row);};
  refresh();
  const obs=new MutationObserver(records=>{
    if(records.some(r=>r.addedNodes.length)) requestAnimationFrame(refresh);
  });
  obs.observe(document.body,{childList:true,subtree:true});
  Hooks.on('updateItem',i=>{if(i.parent?.documentName==='Actor')requestAnimationFrame(refresh);});
  console.info(`${MOD} v1.4.1: resource tracking and GM force refill ready`);
});

// v1.5.0: GM-only equipment condition. Capacity is derived from the base
// duration and never compounded across repeated condition changes.
async function setCondition(item,next) {
  if(!game.user.isGM) throw new Error('Only the GM can change equipment condition');
  if(!Object.hasOwn(CONDITIONS,next)) throw new Error('Unknown condition');
  if(item.parent?.documentName!=='Actor') throw new Error('Expected an embedded Actor Item');
  const old=resourceOf(item) ?? await initializeResource(item);
  const base=Number(item.flags?.[NS]?.light?.durationMinutes ?? 0);
  if(!base) throw new Error('No base duration for this item');
  const ratio=old?.capacity>0 ? Math.max(0,Math.min(1,old.remaining/old.capacity)) : 0;
  // Update condition first; update resource second. On failure restore condition.
  const previous=item.getFlag(MOD,'condition');
  await item.setFlag(MOD,'condition',next);
  try {
    const capacity=adjustedCapacity(item,base);
    await item.setFlag(MOD,'resource',{...old,capacity,remaining:round(capacity*ratio)});
    if(capacity*ratio<=0 && item.getFlag(MOD,'equipped')) await item.setFlag(MOD,'equipped',false);
    await syncActor(item.parent);
  } catch(error) {
    if(previous==null) await item.unsetFlag(MOD,'condition');
    else await item.setFlag(MOD,'condition',previous);
    throw error;
  }
}
function renderCondition(row) {
  const found=resolveRow(row);
  if(!found?.item.flags?.[NS]?.light) return;
  const {item}=found;
  const controls=row.querySelector('.item-controls');
  if(!controls) return;
  let select=controls.querySelector('.coc7-ue-condition');
  if(!game.user.isGM) {
    if(select) select.remove();
    return;
  }
  if(!select) {
    select=document.createElement('select');
    select.className='coc7-ue-condition';
    select.title='GM only: equipment condition (changes operating duration)';
    select.setAttribute('aria-label',`Condition of ${item.name}`);
    select.style.cssText='max-width:87px;font-size:10px;margin-right:4px;background:#29252e;color:#eee;';
    for(const [name,percent] of Object.entries(CONDITIONS)) {
      const option=document.createElement('option');
      option.value=name;
      option.textContent=`${name} ${percent>0?'+':''}${percent}%`;
      select.append(option);
    }
    for(const evt of ['click','mousedown','pointerdown','dblclick'])select.addEventListener(evt,e=>e.stopPropagation());
    select.addEventListener('change',async e=>{
      e.stopPropagation();
      const next=select.value;
      select.disabled=true;
      try {await setCondition(item,next);}
      catch(error) {console.error(`${MOD}: condition update failed`,error);ui.notifications.error(error.message);}
      finally {select.disabled=false;select.value=conditionOf(item);scanInventory();}
    });
    controls.prepend(select);
  }
  if(!select.disabled) select.value=conditionOf(item);
}
Hooks.once('ready',()=>{
  const refresh=()=>{for(const row of document.querySelectorAll('li.item.flexrow[data-item-uuid]'))renderCondition(row);};
  refresh();
  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.addedNodes.length))requestAnimationFrame(refresh);
  });
  observer.observe(document.body,{childList:true,subtree:true});
  Hooks.on('updateItem',item=>{if(item.parent?.documentName==='Actor')requestAnimationFrame(refresh);});
  console.info(`${MOD} v1.5.0: GM-only equipment condition controls ready`);
});

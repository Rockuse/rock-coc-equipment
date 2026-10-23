const ID='coc7-universal-equipment';
const CONFIG=[
 ['weapon-classic','Weapon - Classic','weapon-classic'],
 ['weapon-modern','Weapon - Modern','weapon-modern'],
 ['item-universal','Item Universal','item-universal'],
 ['armor-classic','Armor - Classic','armor-classic'],
 ['armor-modern','Armor - Modern','armor-modern']
];
async function ensureFolder(name,parent=null){
 let f=game.folders.find(f=>f.type==='Compendium'&&f.name===name&&(f.folder?.id??null)===(parent?.id??null));
 if(!f)f=await Folder.create({name,type:'Compendium',folder:parent?.id??null});return f;
}
async function install(){
 if(!game.user.isGM)throw Error('GM permissions required');
 const root=await ensureFolder('Compendium Item');
 const weapons=await ensureFolder('Weapon',root),armors=await ensureFolder('Armor',root);
 const results=[];
 for(const [key,label,name] of CONFIG){
  const data=await (await fetch(`modules/${ID}/data/${key}.json`)).json();
  let pack=game.packs.find(p=>p.collection===`world.coc7-equipment-${name}`);
  if(!pack)pack=await CompendiumCollection.createCompendium({label,name:`coc7-equipment-${name}`,type:'Item',package:'world',system:'CoC7'});
  if(pack.locked)await pack.configure({locked:false});
  const parent=key.startsWith('weapon')?weapons:key.startsWith('armor')?armors:root;
  if(pack.folder?.id!==parent.id)await pack.configure({folder:parent.id});
  const index=await pack.getIndex();const existing=new Map(index.map(e=>[e.name.toLowerCase(),e._id]));
  let created=0,updated=0;
  for(const item of data){
   const old=existing.get(item.name.toLowerCase());
   if(old){const doc=await pack.getDocument(old);await doc.update({img:item.img,system:item.system,flags:item.flags});updated++;}
   else {await pack.importDocument(new Item.implementation(item,{temporary:true}));created++;}
  }
  results.push({pack:label,total:data.length,created,updated});
 }
 console.table(results);ui.notifications.info('CoC7 Universal Equipment installed into five compendiums. World Items untouched.');return results;
}
Hooks.once('ready',()=>{
 game.modules.get(ID).api={install};
 // Existing actor inventory is separate from the compendium; repair only known broken icons.
 if(game.user.isGM){
  const fix=async()=>{
   for(const actor of game.actors){
    const updates=actor.items.filter(i=>['Pocket First-Aid Kit','Trauma First-Aid Kit'].includes(i.name)&&i.img==='icons/svg/heart.svg')
      .map(i=>({_id:i.id,img:'icons/svg/item-bag.svg'}));
    if(updates.length)await actor.updateEmbeddedDocuments('Item',updates);
   }
  };
  fix().catch(err=>console.warn(`${ID}: icon migration failed`,err));
 }
});

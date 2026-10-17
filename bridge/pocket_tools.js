// Owned-character equipment and storage. All entry points run on Unity Update.
// Uses normal PlayerActions prediction/network paths, never writes homes/holders.
const pocketTools = (() => {
  const objectClass=new NativeFunction(exp('il2cpp_object_get_class'),'pointer',['pointer']);
  const fieldOffset=new NativeFunction(exp('il2cpp_field_get_offset'),'int',['pointer']);
  const assignable=new NativeFunction(exp('il2cpp_class_is_assignable_from'),'bool',['pointer','pointer']);
  const homeClass=klass(gameImage,'','PropHome'),registryClass=klass(gameImage,'','PlayerRegistry');
  const actionsClass=klass(gameImage,'','PlayerActions'),handsClass=klass(gameImage,'','PlayerHands');
  const slots=[{slot:'backpack',name:'Backpack',offset:0xb8,group:24,storage:25},
    {slot:'holster',name:'Holster',offset:0xc0,group:30,storage:31}];
  let error='',job=null,place=ptr(0),pickup=ptr(0),safePlace=ptr(0),safePickup=ptr(0),currentHome=ptr(0),matches=ptr(0),heldCharacter=ptr(0);
  const groupCache=new Map();
  function checked(type,name,offset) {
    if(type.isNull()) throw Error('Equipment type is unavailable');
    const field=fieldFromName(type,Memory.allocUtf8String(name));
    if(field.isNull() || fieldOffset(field)!==offset) throw Error('Equipment layout changed: '+name);
  }
  try {
    checked(pcClass,'registry',0xf0);checked(pcClass,'hands',0x68);checked(pcClass,'actions',0x120);checked(pcClass,'playerNetworking',0x1a0);
    for(const spec of slots) checked(registryClass,spec.slot+'Pocket',spec.offset);
    for(const [name,offset] of [['parentCharacter',0x30],['parentProp',0x38],['pinGroup',0x60],['blockGrabbing',0x64],['blockPlacing',0x65],['isInventory',0x9d],['pinnedProp',0xd8]]) checked(homeClass,name,offset);
    for(const [name,offset] of [['childPropHomes',0x2f8],['exclusiveHolder',0x2c0],['networkIdentity',0x2d8],['_isInInventory',0x338]]) checked(propType,name,offset);
    checked(actionsClass,'playerCharacter',0x18);checked(actionsClass,'heldActionNumber',0x20);
    checked(handsClass,'playerCharacter',0x28);checked(handsClass,'heldProp',0x38);
    checked(pnClass,'playerHeldInformation',0x88);checked(pnClass,'isGhost',0xec);checked(pnClass,'isSleeping',0x148);
    place=method(actionsClass,'ActionPlaceInHome',2);pickup=method(actionsClass,'ActionPickUpProp',2);
    safePlace=method(homeClass,'IsSafeToPlace',1);safePickup=method(handsClass,'IsSafeToPickUp',1);
    currentHome=method(propType,'get_currentHome',0);matches=method(propType,'MatchesGroup',1);heldCharacter=method(handsClass,'get_heldCharacter',0);
  } catch(cause) {error=String(cause);}
  function params(values) {
    const out=Memory.alloc(Math.max(1,values.length)*Process.pointerSize);
    values.forEach((value,i)=>out.add(i*Process.pointerSize).writePointer(value));return out;
  }
  function bool(box) {return !box.isNull() && box.add(0x10).readU8()===1;}
  function exact(value,type,label) {
    if(value.isNull() || type.isNull() || !objectClass(value).equals(type)) throw Error(label+' is unavailable');
    return value;
  }
  function ownerFor(expected) {
    if(error) throw Error(error);
    const roster=describePlayers(),owners=roster.filter(row=>row.isLocalPlayer && row.isOwned && row.backrefMatches);
    if(owners.length!==1) throw Error('Waiting for your locally owned character');
    const owner=owners[0];
    if(expected && (owner.pc!==(expected.owner_pc || expected.pc) || owner.pn!==(expected.owner_pn || expected.pn))) throw Error('Your character changed; wait for a fresh update');
    const pc=exact(ptr(owner.pc),pcClass,'Your character'),pn=exact(ptr(owner.pn),pnClass,'Your network character');
    if(pc.add(0x10).readPointer().isNull() || pn.add(0x10).readPointer().isNull()) throw Error('Your character is no longer active');
    if(!pc.add(0x1a0).readPointer().equals(pn)) throw Error('Your network character changed');
    const registry=exact(pc.add(0xf0).readPointer(),registryClass,'Your equipment registry');
    const hands=exact(pc.add(0x68).readPointer(),handsClass,'Your hands');
    // PlayerActions is a managed helper, not a Unity object (no cached pointer).
    const actions=pc.add(0x120).readPointer();
    if(actions.isNull() || !objectClass(actions).equals(actionsClass) || !hands.add(0x28).readPointer().equals(pc) || !actions.add(0x18).readPointer().equals(pc)) throw Error('Your item controls changed');
    return {owner,pc,pn,registry,hands,actions,roster,listed:propList()};
  }
  function propInfo(info,prop) {
    if(prop.isNull()) return null;
    if(!info.listed.some(row=>row.p.equals(prop)) || !assignable(propType,objectClass(prop)) || prop.add(0x10).readPointer().isNull()) throw Error('The equipment item is no longer loaded');
    const identity=prop.add(0x2d8).readPointer();
    if(identity.isNull() || identity.add(0x10).readPointer().isNull()) throw Error('The equipment item has no live network identity');
    const net_id=identity.add(0x30).readU32();if(!net_id) throw Error('The equipment item is not network registered');
    return {prop,identity,net_id,key:String(prop)+':'+String(identity),name:objectName(prop)};
  }
  function groupMatches(item,group) {
    const value=Memory.alloc(4);value.writeS32(group);
    return bool(invoke(matches,item.prop,params([value])));
  }
  function homeFor(info,spec) {
    const home=exact(info.registry.add(spec.offset).readPointer(),homeClass,spec.name+' slot');
    if(home.add(0x10).readPointer().isNull()) throw Error(spec.name+' slot is no longer active');
    if(!home.add(0x30).readPointer().equals(info.pc) || !home.add(0x38).readPointer().isNull() || home.add(0x60).readS32()!==spec.group) throw Error(spec.name+' slot ownership or group changed');
    return home;
  }
  function stableIn(home,item) {return home.add(0xd8).readPointer().equals(item.prop) && invoke(currentHome,item.prop).equals(home);}
  function storageHomes(info,spec,gear) {
    if(spec.storage===null || !gear) return [];
    if(!groupMatches(gear,spec.group)) throw Error('The equipped item no longer matches this slot');
    const list=gear.prop.add(0x2f8).readPointer();if(list.isNull()) return [];
    const count=list.add(0x18).readS32(),array=list.add(0x10).readPointer();
    if(count<0 || count>64 || array.isNull() || array.add(0x18).readU32()<count) throw Error('Equipment storage list changed');
    const found=[],seen=new Set();
    for(let i=0;i<count;i++) {
      const home=array.add(0x20+i*Process.pointerSize).readPointer();
      if(home.isNull() || seen.has(String(home))) continue;
      exact(home,homeClass,'Equipment storage');seen.add(String(home));
      if(home.add(0x10).readPointer().isNull()) continue;
      if(!home.add(0x38).readPointer().equals(gear.prop)) continue;
      const character=home.add(0x30).readPointer();
      if(!character.isNull() && !character.equals(info.pc)) continue;
      if(home.add(0x60).readS32()!==spec.storage) continue;
      // Group 25/31 and direct parentProp identify actual contents receptacles;
      // the isInventory flag affects hiding/saving, rather than group acceptance.
      found.push({home,key:gear.key+':'+String(home),index:found.length+1});
    }
    return found;
  }
  function held(info) {
    const prop=info.hands.add(0x38).readPointer(),identity=info.pn.add(0x88).readPointer();
    if(!invoke(heldCharacter,info.hands).isNull()) throw Error('Drop the player you are carrying first');
    if(prop.isNull()) {if(!identity.isNull()) throw Error('Waiting for your hands to synchronize');return null;}
    const item=propInfo(info,prop);
    if(!item.identity.equals(identity) || !prop.add(0x2c0).readPointer().equals(info.pc)) throw Error('Waiting for your held item to synchronize');
    return item;
  }
  function characterReady(info) {
    if(info.pn.add(0xec).readU8() || info.pn.add(0x148).readU8()) throw Error('Your character cannot move equipment in this state');
  }
  function canPlace(info,home,item) {
    characterReady(info);if(!item) throw Error('Hold an item first');
    if(!home.add(0xd8).readPointer().isNull()) throw Error('This slot is occupied');
    if(!bool(invoke(safePlace,home,params([item.prop])))) throw Error('This item does not fit, or the game blocks placement');
  }
  function canTake(info,home,item,heldItem) {
    characterReady(info);if(heldItem) throw Error('Empty your hands first');
    if(!item) throw Error('This slot is empty');
    if(!stableIn(home,item)) throw Error('Waiting for this slot to synchronize');
    const holder=item.prop.add(0x2c0).readPointer();
    if(!holder.isNull() && !holder.equals(info.pc)) throw Error('Another player is holding this item');
    if(home.add(0x64).readU8() || !bool(invoke(safePickup,info.hands,params([item.prop])))) throw Error('The game blocks removing this item');
  }
  function nearestGear(info,spec,home,fresh=false) {
    characterReady(info);
    if(!home.add(0xd8).readPointer().isNull()) throw Error('You are already wearing a '+spec.name.toLowerCase());
    const at=position(info.pc);if(!at) throw Error('Your position is unavailable');
    if(groupCache.size>8192) groupCache.clear();
    let best=null;
    for(const entry of info.listed) {
      const prop=entry.p;
      if(prop.add(0x10).readPointer().isNull() || !assignable(propType,objectClass(prop)) ||
         !prop.add(0x2c0).readPointer().isNull() || prop.add(0x338).readU8()) continue;
      const identity=prop.add(0x2d8).readPointer();
      if(identity.isNull() || !identity.add(0x30).readU32()) continue;
      const key=String(prop)+':'+String(identity)+':'+identity.add(0x30).readU32()+':'+spec.group;
      let matching=fresh?undefined:groupCache.get(key);
      if(matching===undefined) {matching=groupMatches({prop},spec.group);groupCache.set(key,matching);}
      if(!matching || !invoke(currentHome,prop).isNull()) continue;
      if(info.roster.some(player=>!ptr(player.pn).isNull() && ptr(player.pn).add(0x88).readPointer().equals(identity))) continue;
      const atItem=position(prop),metres=distance(at,atItem);
      if(metres===null || !Number.isFinite(metres) || (best && metres>=best.distance)) continue;
      const item=propInfo(info,prop);
      if(!bool(invoke(safePickup,info.hands,params([prop])))) continue;
      if(!bool(invoke(safePlace,home,params([prop])))) continue;
      best={...item,distance:metres};
    }
    if(!best) throw Error('No unused '+spec.name.toLowerCase()+' is available');
    return best;
  }
  function allowed(fn) {try {if(job) throw Error('Waiting for the current equipment action');fn();return {ok:true,reason:''};} catch(cause) {return {ok:false,reason:String(cause).replace(/^Error: /,'')};}}
  function emptyRow(spec,reason) {
    return {slot:spec.slot,name:spec.name,item_name:null,item_key:null,net_id:0,available:false,reason,
      can_equip:false,can_equip_nearest:false,can_store:false,can_take:false,can_unequip:false,equip_reason:reason,equip_nearest_reason:reason,store_reason:reason,take_reason:reason,unequip_reason:reason,stored:[]};
  }
  function slotState(info,spec,heldItem,heldError) {
    const row=emptyRow(spec,''),home=homeFor(info,spec),gear=propInfo(info,home.add(0xd8).readPointer());
    row.available=true;
    if(gear) {row.item_name=gear.name;row.item_key=gear.key;row.net_id=gear.net_id;}
    const equip=allowed(()=>{if(heldError) throw Error(heldError);canPlace(info,home,heldItem);});
    const unequip=allowed(()=>{if(heldError) throw Error(heldError);canTake(info,home,gear,heldItem);});
    row.can_equip=equip.ok;row.equip_reason=equip.reason;row.can_unequip=unequip.ok;row.unequip_reason=unequip.reason;
    if(!gear) {
      const nearest=allowed(()=>{if(heldError) throw Error(heldError);if(heldItem) throw Error('Empty your hands to equip gear');nearestGear(info,spec,home);});
      row.can_equip_nearest=nearest.ok;row.equip_nearest_reason=nearest.reason;
    }
    if(gear && !stableIn(home,gear)) throw Error('Waiting for '+spec.name.toLowerCase()+' to synchronize');
    for(const entry of storageHomes(info,spec,gear)) {
      const item=propInfo(info,entry.home.add(0xd8).readPointer());
      const store=allowed(()=>{if(heldError) throw Error(heldError);if(heldItem && heldItem.key===gear.key) throw Error('Cannot store equipment inside itself');canPlace(info,entry.home,heldItem);});
      const take=allowed(()=>{if(heldError) throw Error(heldError);canTake(info,entry.home,item,heldItem);});
      row.stored.push({home_key:entry.key,name:'Storage '+entry.index,item_name:item?item.name:null,item_key:item?item.key:null,net_id:item?item.net_id:0,
        can_store:store.ok,can_take:take.ok,store_reason:store.reason,take_reason:take.reason,reason:item?take.reason:store.reason});
    }
    row.can_store=row.stored.some(entry=>entry.can_store);row.can_take=row.stored.some(entry=>entry.can_take);
    row.store_reason=row.can_store?'':(row.stored[0]?.store_reason || (spec.storage===null?'This equipment has no storage':(gear?'No compatible storage homes were found':'Equip this item first')));
    row.take_reason=row.can_take?'':(row.stored.find(entry=>entry.item_key)?.take_reason || (row.stored.length?'Storage is empty':row.store_reason));
    return row;
  }
  function snapshot(expected) {
    let info;try {info=ownerFor(expected);} catch(cause) {const reason=String(cause);return {pockets:slots.map(spec=>emptyRow(spec,reason)),reason};}
    let item=null,heldError='';try {item=held(info);} catch(cause) {heldError=String(cause);}
    return {pockets:slots.map(spec=>{try {return slotState(info,spec,item,heldError);} catch(cause) {return emptyRow(spec,String(cause));}}),reason:''};
  }
  function apply(req) {
    if(req.target_kind!=='pocket') throw Error('Unsupported equipment target');
    if(job) throw Error('Waiting for the current equipment action');
    const spec=slots.find(entry=>entry.slot===req.slot);if(!spec) throw Error('Choose backpack or holster');
    if(!['pocket_equip','pocket_equip_nearest','pocket_store','pocket_take','pocket_unequip'].includes(req.action)) throw Error('Unsupported equipment action');
    const info=ownerFor(req),heldItem=held(info),slotHome=homeFor(info,spec),gear=propInfo(info,slotHome.add(0xd8).readPointer());
    if(req.action==='pocket_equip_nearest') {
      if(heldItem) throw Error('Empty your hands to equip gear');
      const item=nearestGear(info,spec,slotHome,true);
      const before=info.actions.add(0x20).readS32();if(before>=2147483645 || before<0) throw Error('Your item action counter is unavailable');
      const at=position(info.pc);if(!at || !at.every(value=>Number.isFinite(value) && Math.abs(value)<=10000)) throw Error('Your position is unavailable');
      const vector=Memory.alloc(12);at.forEach((value,i)=>vector.add(i*4).writeFloat(value));
      job={req:{...req},spec,home:String(slotHome),gear:null,target:{key:item.key,net_id:item.net_id,name:item.name},placing:false,nearest:true,stage:'pickup',started:Date.now(),stageAt:Date.now(),settledAt:0};
      try {invoke(pickup,info.actions,params([item.prop,vector]));} catch(cause) {job=null;throw cause;}
      return null;
    }
    let home=slotHome,item=heldItem;
    const placing=req.action==='pocket_equip' || req.action==='pocket_store';
    if(req.action==='pocket_store' || req.action==='pocket_take') {
      if(!gear || !stableIn(slotHome,gear)) throw Error('Equip the '+spec.name.toLowerCase()+' first');
      const candidates=storageHomes(info,spec,gear);
      if(!candidates.length) throw Error('This equipment has no compatible storage homes');
      const states=candidates.map(entry=>({entry,item:propInfo(info,entry.home.add(0xd8).readPointer())}));
      const selected=req.home_key?states.find(entry=>entry.entry.key===req.home_key):states.find(entry=>req.action==='pocket_store'?!entry.item:!!entry.item);
      if(!selected) throw Error('The selected storage slot changed, or no suitable slot is available');
      home=selected.entry.home;if(!placing) item=selected.item;
      if(placing && item && item.key===gear.key) throw Error('Cannot store equipment inside itself');
    } else if(!placing) item=gear;
    if(placing) canPlace(info,home,item);else canTake(info,home,item,heldItem);
    const before=info.actions.add(0x20).readS32();if(before>=2147483646 || before<0) throw Error('Your item action counter is unavailable');
    const next={req:{...req},spec,home:String(home),gear:gear?gear.key:null,target:{key:item.key,net_id:item.net_id,name:item.name},placing,started:Date.now(),settledAt:0};
    // Set pending first: a managed exception cannot leave an untracked operation.
    job=next;
    try {
      if(placing) invoke(place,info.actions,params([item.prop,home]));
      else {
        const at=position(info.pc);if(!at || !at.every(value=>Number.isFinite(value) && Math.abs(value)<=10000)) throw Error('Your position is unavailable');
        const vector=Memory.alloc(12);at.forEach((value,i)=>vector.add(i*4).writeFloat(value));
        invoke(pickup,info.actions,params([item.prop,vector]));
      }
    } catch(cause) {job=null;throw cause;}
    return null;
  }
  function finish(ok,message) {
    if(!job) return;const current=job;job=null;
    send({type:'action_result',request_id:current.req.request_id,ok,message,cancelled:!!current.cancel});
  }
  function tick(now) {
    if(!job) return;const current=job;
    try {
      const info=ownerFor(current.req),slotHome=homeFor(info,current.spec),slotGear=propInfo(info,slotHome.add(0xd8).readPointer());
      let home=slotHome;
      if(current.req.action==='pocket_store' || current.req.action==='pocket_take') {
        if(!slotGear || slotGear.key!==current.gear || !stableIn(slotHome,slotGear)) throw Error('Your equipped item changed during the storage action');
        const entry=storageHomes(info,current.spec,slotGear).find(entry=>String(entry.home)===current.home);
        if(!entry) throw Error('The equipment storage changed');home=entry.home;
      } else if(String(home)!==current.home) throw Error('Your equipment slot changed');
      const loaded=info.listed.find(entry=>String(entry.p)+':'+String(entry.p.add(0x2d8).readPointer())===current.target.key);
      if(!loaded) throw Error('The selected equipment item unloaded');
      const item=propInfo(info,loaded.p);
      if(item.net_id!==current.target.net_id || item.name!==current.target.name) throw Error('The selected equipment item changed identity');
      // Hands and SyncVar updates can arrive on separate frames. An intermediate
      // disagreement is not a failed operation; wait for both to settle.
      const heldProp=info.hands.add(0x38).readPointer(),heldIdentity=info.pn.add(0x88).readPointer();
      const noPlayer=invoke(heldCharacter,info.hands).isNull();
      const empty=noPlayer && heldProp.isNull() && heldIdentity.isNull();
      const owns=noPlayer && heldProp.equals(item.prop) && heldIdentity.equals(item.identity) && item.prop.add(0x2c0).readPointer().equals(info.pc);
      if(current.nearest && current.stage==='pickup') {
        if(slotGear && slotGear.key!==item.key) throw Error('Your equipment slot became occupied');
        if(empty && stableIn(slotHome,item)) {
          current.placing=true;current.stage='observe';current.settledAt=0;
          return;
        }
        if(owns) {
          if(!current.settledAt) current.settledAt=now;
          if(now-current.settledAt>=120) {
            if(current.cancel) {finish(false,'Equip closest cancelled after pickup; the item is in your hands');return;}
            canPlace(info,slotHome,item);
            current.placing=true;current.stage='observe';current.settledAt=0;
            invoke(place,info.actions,params([item.prop,slotHome]));
          }
        } else {
          current.settledAt=0;
          const holder=item.prop.add(0x2c0).readPointer();
          if(!holder.isNull() && !holder.equals(info.pc)) throw Error('Another player picked up the selected gear');
          if(now-current.stageAt>3000) throw Error('Pickup of the closest gear was not confirmed');
        }
        return;
      }
      const confirmed=current.placing?empty && stableIn(home,item):owns && !home.add(0xd8).readPointer().equals(item.prop) && !invoke(currentHome,item.prop).equals(home);
      if(confirmed) {
        if(!current.settledAt) current.settledAt=now;
        if(now-current.settledAt>=120) {finish(!current.cancel,current.cancel?'Equipment action cancelled after its normal in-flight action settled':'Equipment state change observed');return;}
      } else current.settledAt=0;
      if(now-current.started>(current.nearest?6500:3000)) finish(false,'Equipment state change was not confirmed; check the game before retrying');
    } catch(cause) {finish(false,String(cause));}
  }
  function cancel(id) {if(job && (!id || job.req.request_id===id)) job.cancel=true;}
  function stop() {if(job) finish(false,'Equipment observation stopped; the normal game action may still complete');return true;}
  return {snapshot,apply,tick,cancel,stop,busy:()=>!!job,needsCleanup:()=>!!job};
})();

// Bounded Big Fun actions. Called only on the locally owned Unity Update.
const bigFun = (() => {
  let api=null, corpseApi=null, corpseClearApi=null, gatherApi=null, itemApi=null, job=null;
  let corpsePrefab=null;
  let nextAllowed=0;
  const roots=[];
  function base() {
    if(api) return api;
    const native=(name,result,args)=>new NativeFunction(exp(name),result,args);
    const a={
      methods:native('il2cpp_class_get_methods','pointer',['pointer','pointer']),
      methodName:native('il2cpp_method_get_name','pointer',['pointer']),
      paramCount:native('il2cpp_method_get_param_count','uint',['pointer']),
      param:native('il2cpp_method_get_param','pointer',['pointer','uint']),
      typeName:native('il2cpp_type_get_name','pointer',['pointer']),
      generic:native('il2cpp_method_is_generic','bool',['pointer']),
      classType:native('il2cpp_class_get_type','pointer',['pointer']),
      typeObject:native('il2cpp_type_get_object','pointer',['pointer']),
      offset:native('il2cpp_field_get_offset','int',['pointer']),
      // This Unity build uses pointer-sized handles; uint truncates them.
      hold:native('il2cpp_gchandle_new','pointer',['pointer','bool']),
      target:native('il2cpp_gchandle_get_target','pointer',['pointer']),
      release:native('il2cpp_gchandle_free','void',['pointer']),
      objectClass:native('il2cpp_object_get_class','pointer',['pointer']),
      arrayNew:native('il2cpp_array_new','pointer',['pointer','uint64']),
      setReference:native('il2cpp_gc_wbarrier_set_field','void',['pointer','pointer','pointer']),
    };
    api=a;
    try {
    a.instantiate=method(objectType,'Internal_InstantiateSingle',3);
    a.destroy=method(objectType,'Destroy',2);
    a.exists=method(objectType,'op_Implicit',1);
    a.getComponent=exact(klass(coreImage,'UnityEngine','GameObject'),'GetComponent',['System.Type']);
    a.getChildComponent=exact(klass(coreImage,'UnityEngine','GameObject'),'GetComponentInChildren',['System.Type','System.Boolean']);
    return a;
    } catch(error) {api=null;throw error;}
  }
  function image(name) {
    for(let i=0;i<assemblyCount;i++) {
      const found=assemblyGetImage(assemblies.add(i*Process.pointerSize).readPointer());
      if(imageGetName(found).readCString()===name) return found;
    }
    throw Error(name+' is unavailable');
  }
  function exact(type,name,types) {
    const a=api || base(), iterator=Memory.alloc(Process.pointerSize);iterator.writePointer(ptr(0));
    if(type.isNull()) throw Error('Missing class for '+name);
    for(let mi=a.methods(type,iterator);!mi.isNull();mi=a.methods(type,iterator)) {
      if(a.methodName(mi).readCString()!==name || a.paramCount(mi)!==types.length || a.generic(mi)) continue;
      if(types.every((t,i)=>a.typeName(a.param(mi,i)).readCString()===t)) return mi;
    }
    throw Error('Missing exact signature: '+name+'('+types.join(',')+')');
  }
  function layout(type,name,expected) {
    if(type.isNull()) throw Error('Missing class for '+name);
    const field=fieldFromName(type,Memory.allocUtf8String(name));
    if(field.isNull() || base().offset(field)!==expected) throw Error('Big Fun layout changed: '+name);
  }
  function params(values) {
    const out=Memory.alloc(Math.max(1,values.length)*Process.pointerSize);
    values.forEach((value,i)=>out.add(i*Process.pointerSize).writePointer(value));return out;
  }
  function scalar(value,type='float') {
    const out=Memory.alloc(4);
    if(type==='int') out.writeS32(value); else if(type==='uint') out.writeU32(value); else if(type==='bool') out.writeU8(value?1:0); else out.writeFloat(value);
    return out;
  }
  function boxedBool(box) {return !box.isNull() && box.add(0x10).readU8()!==0;}
  function alive(object) {return !object.isNull() && boxedBool(invoke(base().exists,ptr(0),params([object])));}
  function typeObject(type) {
    if(type.isNull()) throw Error('Big Fun component type unavailable');
    return base().typeObject(base().classType(type));
  }
  function component(go,type) {return invoke(base().getComponent,go,params([typeObject(type)]));}
  function hold(object) {const handle=base().hold(object,0);roots.push(handle);return handle;}
  function corpseSpawning() {
    if(corpseApi) return corpseApi;
    const mirror=image('Mirror.dll'), server=klass(mirror,'Mirror','NetworkServer'), client=klass(mirror,'Mirror','NetworkClient');
    const manager=klass(mirror,'Mirror','NetworkManager'), identity=klass(mirror,'Mirror','NetworkIdentity');
    const corpse=klass(gameImage,'','Corpse');
    layout(manager,'spawnPrefabs',0x68);
    layout(propType,'saveablePropName',0xb8);layout(propType,'propSaveType',0xc8);
    layout(identity,'sceneId',0x38);layout(identity,'_assetId',0x40);layout(identity,'<netId>k__BackingField',0x30);
    layout(corpse,'prop',0x88);layout(corpse,'identifier',0x78);
    layout(corpse,'headColorIndex',0x68);layout(corpse,'torsoColorIndex',0x6c);layout(corpse,'legsColorIndex',0x70);
    layout(pnClass,'lookIdHead',0x7c);layout(pnClass,'lookIdTorso',0x80);layout(pnClass,'lookIdLegs',0x84);
    const prefabs=fieldFromName(client,Memory.allocUtf8String('prefabs'));
    if(prefabs.isNull()) throw Error('Runtime prefab registry is unavailable');
    const registeredMethod=method(client,'GetPrefab',2);
    const spawnMethod=exact(server,'Spawn',['UnityEngine.GameObject','System.UInt32','Mirror.NetworkConnection']);
    corpseApi={manager,identity,corpse,prefabs,active:method(server,'get_active',0),singleton:method(manager,'get_singleton',0),
      destroy:method(server,'Destroy',1),
      spawn:new NativeFunction(spawnMethod.readPointer(),'void',['pointer','uint','pointer','pointer']),spawnMethod,
      registered:new NativeFunction(registeredMethod.readPointer(),'bool',['uint','pointer','pointer']),registeredMethod,
      identifier:fieldFromName(corpse,Memory.allocUtf8String('identifier')),
      colorSetters:['head','torso','legs'].map(part=>{
        const info=method(corpse,'set_Network'+part+'ColorIndex',1);
        return {info,call:new NativeFunction(info.readPointer(),'void',['pointer','int','pointer'])};
      })};
    return corpseApi;
  }
  function host() {return boxedBool(invoke(corpseSpawning().active,ptr(0)));}
  function corpseClearing() {
    if(corpseClearApi) return corpseClearApi;
    const g=corpseSpawning(),mirror=image('Mirror.dll'),server=klass(mirror,'Mirror','NetworkServer');
    const homes=klass(gameImage,'','PropHome');
    layout(klass(mirror,'Mirror','NetworkBehaviour'),'<netIdentity>k__BackingField',0x40);
    layout(g.identity,'<isServer>k__BackingField',0x21);
    layout(propType,'networkIdentity',0x2d8);
    for(const [name,offset] of [['backpackHome',0x90],['holsterHome',0x98],['grasperHome',0xa0],['blindfoldHome',0xa8]]) layout(g.corpse,name,offset);
    layout(homes,'pinnedProp',0xd8);
    const all=fieldFromName(g.corpse,Memory.allocUtf8String('allCorpses'));
    const spawned=fieldFromName(server,Memory.allocUtf8String('spawned'));
    if(all.isNull() || spawned.isNull()) throw Error('The corpse registry is unavailable');
    corpseClearApi={all,spawned,homes,
      assignable:new NativeFunction(exp('il2cpp_class_is_assignable_from'),'bool',['pointer','pointer']),
      empty:method(g.corpse,'ServerEmptyAllPockets',0),prepare:method(propType,'PrepareForDestroy',0),
      gameObject:method(componentType,'get_gameObject',0)};
    return corpseClearApi;
  }
  function loadedCorpses(limit=4096,target=null) {
    const a=corpseClearing(),g=corpseSpawning(),out=Memory.alloc(Process.pointerSize);
    fieldStaticGet(a.all,out);const list=out.readPointer();if(list.isNull()) return [];
    const count=list.add(0x18).readS32(),array=list.add(0x10).readPointer();
    if(count<0 || count>4096 || (count && (array.isNull() || array.add(0x18).readU64().toNumber()<count))) throw Error('Unexpected active corpse list');
    const result=[],targetPointer=target?ptr(target.pointer):null;
    for(let i=0;i<count;i++) {
      const body=array.add(0x20+i*Process.pointerSize).readPointer();
      if(targetPointer && !body.equals(targetPointer)) continue;
      if(body.isNull() || !a.assignable(g.corpse,base().objectClass(body)) || !alive(body)) continue;
      const identity=body.add(0x40).readPointer();
      if(identity.isNull() || !base().objectClass(identity).equals(g.identity) || identity.add(0x21).readU8()!==1) continue;
      const net_id=identity.add(0x30).readU32();if(!net_id) continue;
      result.push({pointer:body.toString(),identity:identity.toString(),net_id,identifier:readString(body.add(0x78).readPointer(),256)});
      if(result.length>=limit) break;
    }
    return result;
  }
  function resolveCorpse(target) {
    const listed=loadedCorpses(1,target).find(body=>body.identity===target.identity && body.net_id===target.net_id && body.identifier===target.identifier);
    if(!listed) return null;
    const a=corpseClearing(),g=corpseSpawning(),body=ptr(listed.pointer),prop=body.add(0x88).readPointer();
    if(prop.isNull() || !a.assignable(propType,base().objectClass(prop)) || !alive(prop) || !prop.add(0x2d8).readPointer().equals(ptr(target.identity))) throw Error('Corpse prop identity changed');
    const go=invoke(a.gameObject,body);
    if(!alive(go) || !component(go,g.corpse).equals(body) || !component(go,g.identity).equals(ptr(target.identity))) throw Error('Corpse root identity changed');
    return {body,prop,go};
  }
  function corpseNetworkGone(target) {
    const out=Memory.alloc(Process.pointerSize);fieldStaticGet(corpseClearing().spawned,out);
    const dictionary=out.readPointer();if(dictionary.isNull()) throw Error('The host spawn registry is unavailable');
    const result=invoke(method(base().objectClass(dictionary),'ContainsKey',1),dictionary,params([scalar(target.net_id,'uint')]));
    if(result.isNull()) throw Error('The host spawn registry did not return a result');
    return !boxedBool(result);
  }
  function corpsePocketsEmpty(body) {
    const a=corpseClearing();
    return [0x90,0x98,0xa0,0xa8].every(offset=>{
      const home=body.add(offset).readPointer();
      if(home.isNull() || !a.assignable(a.homes,base().objectClass(home)) || !alive(home)) throw Error('Corpse pocket changed');
      return !alive(home.add(0xd8).readPointer());
    });
  }
  function advanceCorpseClear(current,status,reason='') {
    if(status==='cleared') current.done++;
    else if(status==='skipped') current.skipped++;
    else current.failures.push({net_id:current.target.net_id,reason});
    current.index++;current.target=null;current.stage='next';progress(current);
  }
  function tickCorpseClear(current,now) {
    if(!host()) throw Error('The host session ended');
    if(current.stage==='next') {
      if(current.index>=current.total) return true;
      current.target=current.targets[current.index];
      const target=resolveCorpse(current.target);
      if(!target) {advanceCorpseClear(current,'skipped');return current.index>=current.total;}
      // Use the normal revival cleanup to drop stored gear/items, without moving
      // another player's backpack or holster into the local player's inventory.
      invoke(corpseClearing().empty,target.body);
      current.stage='empty';current.stageAt=now;
    } else if(current.stage==='empty') {
      const target=resolveCorpse(current.target);
      if(!target && corpseNetworkGone(current.target)) advanceCorpseClear(current,'skipped');
      else if(target && corpsePocketsEmpty(target.body)) {
        invoke(corpseClearing().prepare,target.prop);
        invoke(corpseSpawning().destroy,ptr(0),params([target.go]));
        current.stage='destroy';current.stageAt=now;
      } else if(now-current.stageAt>2000) advanceCorpseClear(current,'failed','Pocket contents did not release; corpse retained');
    } else if(current.stage==='destroy') {
      if(!resolveCorpse(current.target) && corpseNetworkGone(current.target)) advanceCorpseClear(current,'cleared');
      else if(now-current.stageAt>1500) throw Error('Corpse removal was not observed; clearing stopped');
    }
    return current.index>=current.total;
  }
  function validatePrefab(go) {
    const g=corpseSpawning();if(!alive(go)) return null;
    const name=objectName(go).replace(/\(Clone\)$/,'').replace(/[\s_]/g,'').toLowerCase();
    if(name!=='corpse') return null;
    const prop=invoke(base().getChildComponent,go,params([typeObject(propType),scalar(true,'bool')])), identity=component(go,g.identity);
    const body=component(go,g.corpse);
    if(body.isNull() || prop.isNull() || identity.isNull() || identity.add(0x38).readU64().toString()!=='0' || identity.add(0x30).readU32()!==0) return null;
    const assetId=identity.add(0x40).readU32();if(!assetId) return null;
    const output=Memory.alloc(Process.pointerSize);output.writePointer(ptr(0));
    if(!g.registered(assetId,output,g.registeredMethod) || !output.readPointer().equals(go)) return null;
    return {go,assetId};
  }
  let prefabScannedAt=0;
  function registeredPrefabs() {
    const output=Memory.alloc(Process.pointerSize);fieldStaticGet(corpseSpawning().prefabs,output);
    const dictionary=output.readPointer();if(dictionary.isNull()) return [];
    const type=base().objectClass(dictionary);
    const countBox=invoke(method(type,'get_Count',0),dictionary);
    if(countBox.isNull()) throw Error('Could not read runtime prefab count');
    const count=countBox.add(0x10).readS32();
    if(count<0 || count>4096) throw Error('Unexpected runtime prefab count');
    if(!count) return [];
    const values=invoke(method(type,'get_Values',0),dictionary);
    if(values.isNull()) return [];
    const array=base().arrayNew(klass(coreImage,'UnityEngine','GameObject'),count);
    if(array.isNull()) throw Error('Could not read runtime prefab registry');
    invoke(method(base().objectClass(values),'CopyTo',2),values,params([array,scalar(0,'int')]));
    const result=[];
    for(let i=0;i<count;i++) result.push(array.add(0x20+i*Process.pointerSize).readPointer());
    return result;
  }
  function findCorpse() {
    if(corpsePrefab) {const found=validatePrefab(base().target(corpsePrefab));if(found) return found;}
    if(Date.now()-prefabScannedAt<5000) return null;prefabScannedAt=Date.now();
    const g=corpseSpawning();
    for(const go of registeredPrefabs()) {
      const found=validatePrefab(go);
      if(found) {corpsePrefab=hold(found.go);return found;}
    }
    const manager=invoke(g.singleton,ptr(0));if(!alive(manager)) return null;
    const list=manager.add(0x68).readPointer();if(list.isNull()) return null;
    const count=list.add(0x18).readS32(),array=list.add(0x10).readPointer();
    if(count<0 || count>2048 || array.isNull() || array.add(0x18).readU32()<count) throw Error('Unexpected spawn prefab list');
    for(let i=0;i<count;i++) {
      const found=validatePrefab(array.add(0x20+i*Process.pointerSize).readPointer());
      if(found) {corpsePrefab=hold(found.go);return found;}
    }
    return null;
  }
  function gathering() {
    if(gatherApi) return gatherApi;
    const pose=klass(gameImage,'','PlayerPose'), poser=klass(gameImage,'','PlayerPoser'), registry=klass(gameImage,'','PlayerRegistry');
    layout(pcClass,'registry',0xf0);layout(pcClass,'poser',0xa0);layout(registry,'grabPose',0x18);
    layout(pose,'occupant',0x150);layout(pose,'isCarryPoseOfCharacter',0x158);
    layout(poser,'currentPose',0x18);layout(poser,'playerCharacter',0x10);
    gatherApi={drop:method(pnClass,'CmdDropHeldPlayer',0),safe:method(poser,'PoseIsSafe',2)};return gatherApi;
  }
  function grab(owner) {
    gathering();const pc=ptr(owner.pc), pose=through(pc,[0xf0,0x18]);
    if(!alive(pose) || !pose.add(0x158).readPointer().equals(pc)) throw Error('Your carry pose changed');
    if(!through(pc,[0xa0,0x18]).isNull()) throw Error('Stand freely before bringing the party');
    return pose;
  }
  function freeHands(owner,pose) {
    return ptr(owner.pn).add(0x88).readPointer().isNull() && pose.add(0x150).readPointer().isNull();
  }
  function itemActions() {
    if(itemApi) return itemApi;
    const hands=klass(gameImage,'','PlayerHands'),actions=klass(gameImage,'','PlayerActions');
    layout(pcClass,'hands',0x68);layout(pcClass,'actions',0x120);
    layout(hands,'playerCharacter',0x28);layout(hands,'heldProp',0x38);
    layout(actions,'playerCharacter',0x18);layout(actions,'heldActionNumber',0x20);
    layout(pnClass,'playerHeldInformation',0x88);
    layout(propType,'exclusiveHolder',0x2c0);layout(propType,'networkIdentity',0x2d8);layout(propType,'_isInInventory',0x338);
    const pickup=method(actions,'ActionPickUpProp',2),safeMethod=method(hands,'IsSafeToPickUp',1);
    itemApi={pickup,callPickup:new NativeFunction(pickup.readPointer(),'void',['pointer','pointer','pointer','pointer']),
      cmd:new NativeFunction(pickItem.readPointer(),'void',['pointer','pointer','pointer']),
      safe:safeMethod,callSafe:new NativeFunction(safeMethod.readPointer(),'bool',['pointer','pointer','pointer'])};
    return itemApi;
  }
  function itemOwner(owner) {
    itemActions();const pc=ptr(owner.pc),hands=pc.add(0x68).readPointer(),actions=pc.add(0x120).readPointer();
    if(hands.isNull() || actions.isNull() || !hands.add(0x28).readPointer().equals(pc) || !actions.add(0x18).readPointer().equals(pc)) throw Error('Your item controls changed');
    return {hands,actions};
  }
  function resolveItem(target) {
    const found=propList().find(entry=>entry.p.toString()===target.pointer);
    if(!found || !alive(found.p)) return null;
    const prop=found.p,identity=prop.add(0x2d8).readPointer();
    if(identity.isNull() || identity.toString()!==target.identity || identity.add(0x30).readU32()!==target.net_id || objectName(prop)!==target.name) return null;
    return {prop,identity};
  }
  function emptyItemHands(owner) {
    const state=itemOwner(owner);
    return freeHands(owner,grab(owner)) && state.hands.add(0x38).readPointer().isNull();
  }
  function ownsItem(owner,target) {
    const item=resolveItem(target);if(!item) return false;
    const state=itemOwner(owner);
    return ptr(owner.pn).add(0x88).readPointer().equals(item.identity) && state.hands.add(0x38).readPointer().equals(item.prop) && item.prop.add(0x2c0).readPointer().equals(ptr(owner.pc));
  }
  function releaseItem(current,owner) {
    if(!current.target || !ownsItem(owner,current.target)) return false;
    if(!grab(owner).add(0x150).readPointer().isNull()) throw Error('A player entered your carry pose');
    const state=itemOwner(owner),pn=ptr(owner.pn),at=position(ptr(owner.pc));
    if(!at) throw Error('Your current position is unavailable');
    // Normal CmdPickUp also accepts a Nothing value to release an item.
    // Explicit drop data and zero wind-up avoid launching it with throw tuning.
    const drop=Memory.alloc(0x38);drop.writeByteArray(new Array(0x38).fill(0));
    drop.add(0xc).writeU8(1);drop.add(0x2c).writeFloat(1);
    const angle=current.index*2.39996323,radius=2.5+(current.index%7)*0.4;
    const destination=[at[0]+Math.cos(angle)*radius,at[1]+0.5,at[2]+Math.sin(angle)*radius];
    if(!destination.every(v=>Number.isFinite(v) && Math.abs(v)<=10000)) throw Error('Drop destination is unavailable');
    destination.forEach((value,i)=>drop.add(0x14+i*4).writeFloat(value));
    const nextAction=Math.max(state.actions.add(0x20).readS32(),pn.add(0xb8).readS32())+1;
    if(!Number.isSafeInteger(nextAction) || nextAction>=2147483647) throw Error('Item action counter is unavailable');
    state.actions.add(0x20).writeS32(nextAction);drop.add(0x30).writeS32(nextAction);
    itemActions().cmd(pn,drop,pickItem);return true;
  }
  function progress(current) {
    send({type:'action_progress',request_id:current.req.request_id,action:current.req.action,
      completed:current.done,processed:current.index,total:current.total,skipped:current.skipped,failed:current.failures.length});
  }
  function skipItem(current,reason,failed=false) {
    if(failed) current.failures.push({net_id:current.target.net_id,name:current.target.name,reason});
    else current.skipped++;
    current.index++;current.target=null;current.stage='next';progress(current);
  }
  function tickItems(current,owner,now) {
    if(current.stage==='next') {
      if(current.cancel || current.index>=current.total) return true;
      if(!emptyItemHands(owner)) throw Error('Your hands became occupied; collection stopped');
      current.target=current.targets[current.index];const item=resolveItem(current.target);
      if(!item || item.prop.add(0x338).readU8() || !item.prop.add(0x2c0).readPointer().isNull()) {skipItem(current,'Unloaded, held, or in inventory');return false;}
      const state=itemOwner(owner),api=itemActions();
      if(!api.callSafe(state.hands,item.prop,api.safe)) {skipItem(current,'The game blocks pickup');return false;}
      const at=position(ptr(owner.pc));if(!at) throw Error('Your position is unavailable');
      const vector=Memory.alloc(12);at.forEach((v,i)=>vector.add(i*4).writeFloat(v));
      api.callPickup(state.actions,item.prop,vector,api.pickup);current.stage='pickup';current.stageAt=now;
    } else if(current.stage==='pickup') {
      if(ownsItem(owner,current.target)) {current.stage='hold';current.stageAt=now;}
      else if(now-current.stageAt>2000) {
        if(!emptyItemHands(owner)) throw Error('Pickup did not settle; collection stopped');
        skipItem(current,'Pickup was not accepted',true);
      }
    } else if(current.stage==='hold') {
      if(!ownsItem(owner,current.target)) throw Error('The collected item changed hands; collection stopped');
      if(now-current.stageAt>=200) {releaseItem(current,owner);current.stage='release';current.stageAt=now;}
    } else if(current.stage==='release') {
      const item=resolveItem(current.target);
      if(emptyItemHands(owner) && (!item || !item.prop.add(0x2c0).readPointer().equals(ptr(owner.pc)))) {
        const itemPosition=item?position(item.prop):null,ownerPosition=position(ptr(owner.pc));
        if(itemPosition && ownerPosition && distance(itemPosition,ownerPosition)<=12) current.done++;
        else current.failures.push({net_id:current.target.net_id,name:current.target.name,reason:'Release observed, but arrival was not confirmed nearby'});
        current.index++;current.target=null;current.stage='next';progress(current);
      } else if(now-current.stageAt>1500) throw Error('Item release was not observed; collection stopped');
    }
    return current.index>=current.total || (current.cancel && current.stage==='next');
  }
  function capability(fn,note='') {
    try {fn();return {available:true,reason:'',note};}
    catch(error) {return {available:false,reason:String(error).replace(/^Error: /,''),note:''};}
  }
  function capabilities(owner,roster) {
    return {
      corpses:capability(()=>{if(!host()) throw Error('Host a session to spawn corpses.');if(!findCorpse()) throw Error('No registered corpse prefab is loaded.');}),
      clear_corpses:capability(()=>{if(!host()) throw Error('Host a session to clear corpses.');if(!loadedCorpses(1).length) throw Error('No active corpses to clear.');},'Removes all active corpses in this session, including regular corpses.'),
      items:capability(()=>{if(!emptyItemHands(owner)) throw Error('Drop what you are carrying first.');if(!items.some(item=>item.holder_pc==='0x0' && !item.in_inventory)) throw Error('No available loaded items.');},'Brings unheld, loaded items to you.'),
      gather:capability(()=>{const pose=grab(owner);if(!freeHands(owner,pose)) throw Error('Drop what you are carrying first.');if(!roster.some(p=>p.backrefMatches && !p.isLocalPlayer)) throw Error('No other party members are connected.');},'Uses pickup and drop, one person at a time.'),
    };
  }
  function clone(source,at,rotation=[0,0,0,1]) {
    if(!at.every(v=>Number.isFinite(v) && Math.abs(v)<=10000)) throw Error('Your position is unavailable');
    const vec=Memory.alloc(12),rot=Memory.alloc(16);
    at.forEach((v,i)=>vec.add(i*4).writeFloat(v));rotation.forEach((v,i)=>rot.add(i*4).writeFloat(v));
    const result=invoke(base().instantiate,ptr(0),params([source,vec,rot]));
    if(!alive(result)) throw Error('The game did not create the requested object');return result;
  }
  function destroy(object,delay=0) {invoke(base().destroy,ptr(0),params([object,scalar(delay)]));}
  function bowlingPlacements(owner,at) {
    const forward=cameraTools.placementFacing(owner),right=[forward[2],0,-forward[0]];
    const spacing=1,firstRow=4,rowSpacing=spacing*Math.sqrt(3)/2;
    const yaw=Math.atan2(forward[0],forward[2])+Math.PI;
    const rotation=[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],placements=[];
    // Ten-pin triangle: nearest row has one, then two, three and four.
    // Capture the whole layout once so moving/turning during spawning cannot bend it.
    for(let row=0;row<4;row++) {
      for(let column=0;column<=row;column++) {
        const depth=firstRow+row*rowSpacing,side=(column-row/2)*spacing;
        const position=[at[0]+forward[0]*depth+right[0]*side,at[1]+1,at[2]+forward[2]*depth+right[2]*side];
        if(!position.every(v=>Number.isFinite(v) && Math.abs(v)<=10000)) throw Error('Bowling pin position is unavailable');
        placements.push({position,rotation});
      }
    }
    return placements;
  }
  function spawnCorpse(at,index,owner,requestId,placement=null) {
    if(!host()) throw Error('The host session ended');
    const prefab=findCorpse();if(!prefab) throw Error('The registered corpse prefab unloaded');
    const angle=index*Math.PI/5;
    const go=placement?clone(prefab.go,placement.position,placement.rotation):clone(prefab.go,[at[0]+3*Math.cos(angle),at[1]+1,at[2]+3*Math.sin(angle)]);
    let identity=null;
    try {
      const g=corpseSpawning(),prop=invoke(base().getChildComponent,go,params([typeObject(propType),scalar(true,'bool')]));identity=component(go,g.identity);
      const body=component(go,g.corpse);
      if(body.isNull() || prop.isNull() || identity.isNull() || identity.add(0x38).readU64().toString()!=='0') throw Error('Spawned corpse identity is not a prefab identity');
      const identifierText='BigHack-corpse-'+requestId+'-'+index;
      const identifier=stringNew(Memory.allocUtf8String(identifierText));
      base().setReference(body,body.add(0x78),identifier);
      if(readString(body.add(0x78).readPointer(),256)!==identifierText) throw Error('Corpse identifier did not read back');
      for(let i=0;i<3;i++) {
        const color=ptr(owner.pn).add(0x7c+4*i).readS32();
        g.colorSetters[i].call(body,color,g.colorSetters[i].info);
        if(body.add(0x68+4*i).readS32()!==color) throw Error('Corpse appearance did not read back');
      }
      prop.add(0xb8).writeS32(0);prop.add(0xc8).writeS32(2); // notSavable / Never.
      g.spawn(go,prefab.assetId,ptr(0),g.spawnMethod);
      if(identity.add(0x30).readU32()===0) throw Error('The host rejected the corpse spawn');
      return {net_id:identity.add(0x30).readU32(),pointer:body.toString(),prop:prop.toString(),position:position(prop),identifier:readString(body.add(0x78).readPointer(),256)};
    } catch(error) {
      safe(()=>{if(identity && !identity.isNull() && identity.add(0x30).readU32()!==0) invoke(corpseSpawning().destroy,ptr(0),params([go]));else destroy(go);});
      throw error;
    }
  }
  function start(req,owner,roster) {
    if(job || Date.now()<nextAllowed) throw Error('Wait a moment before starting another Big Fun action');
    const keys={spawn_corpses:'corpses',spawn_corpse_pins:'corpses',clear_corpses:'clear_corpses',grab_all_items:'items',gather_party:'gather'};
    if(!Object.hasOwn(keys,req.action)) throw Error('Unknown Big Fun action');
    const cap=capabilities(owner,roster)[keys[req.action]];if(!cap.available) throw Error(cap.reason);
    const at=position(ptr(owner.pc));if(!at) throw Error('Your position is unavailable');
    const next={req,started:Date.now(),next:0,done:0,index:0,skipped:0,failures:[],total:10,at,stage:'next',target:null,pose:null,spawned:[],deadline:44000};
    if(req.action==='spawn_corpse_pins') next.placements=bowlingPlacements(owner,at);
    if(req.action==='clear_corpses') {
      next.targets=loadedCorpses();next.total=next.targets.length;
      if(!next.total) throw Error('No active corpses to clear.');
      next.deadline=next.total*4000+5000;
    }
    if(req.action==='grab_all_items') {
      if(!Array.isArray(req.items) || req.items.length<1 || req.items.length>4096) throw Error('Expected 1 to 4096 loaded items');
      if(req.items.some(item=>!item || typeof item.pointer!=='string' || typeof item.identity!=='string' || typeof item.name!=='string' || !Number.isInteger(item.net_id) || item.net_id<=0 || item.net_id>4294967295)) throw Error('Invalid item selection');
      if(new Set(req.items.map(item=>item.pointer+':'+item.identity)).size!==req.items.length) throw Error('Duplicate item selection');
      next.targets=req.items;next.total=req.items.length;next.deadline=next.total*4000+5000;
    }
    if(req.action==='gather_party') {
      if(!Array.isArray(req.targets) || req.targets.length<1 || req.targets.length>12) throw Error('Gather requires 1 to 12 party members');
      if(new Set(req.targets.map(p=>p.pc+':'+p.pn)).size!==req.targets.length) throw Error('Duplicate party target');
      for(const target of req.targets) if(!roster.some(p=>p.pc===target.pc && p.pn===target.pn && p.name===target.name && p.backrefMatches && !p.isLocalPlayer)) throw Error('The party changed; wait for a fresh update');
      next.targets=req.targets;next.total=req.targets.length;next.pose=grab(owner).toString();
    }
    job=next;if(req.action==='grab_all_items' || req.action==='clear_corpses') progress(next);return null;
  }
  function releaseCarried(current,owner) {
    if(!current.target || !current.pose) return;
    const pose=grab(owner);
    if(pose.toString()===current.pose && pose.add(0x150).readPointer().equals(ptr(current.target.pc))) invoke(gathering().drop,ptr(owner.pn));
  }
  function finish(ok,message,owner) {
    if(!job) return;
    const current=job;job=null;nextAllowed=Date.now()+1500;
    if(!ok && owner) safe(()=>current.req.action==='grab_all_items'?releaseItem(current,owner):releaseCarried(current,owner));
    send({type:'action_result',request_id:current.req.request_id,ok,
      message:message+' ('+current.done+'/'+current.total+').',completed:current.done,total:current.total,spawned:current.spawned,
      processed:current.index,skipped:current.skipped,failures:current.failures,cancelled:!!current.cancel});
  }
  function tick(now) {
    if(!job || now<job.next) return;
    const current=job;let owner=null;
    try {
      const roster=describePlayers();owner=validateOwner(current.req,roster);
      if(current.cancel && current.req.action!=='grab_all_items') throw Error('Big Fun action cancelled');
      if(now-current.started>current.deadline) throw Error('Big Fun stopped at its time limit');
      if(current.req.action==='clear_corpses') {
        const done=tickCorpseClear(current,now);current.next=now+50;
        if(done) finish(current.failures.length===0,'Corpse clearing completed; '+current.skipped+' skipped, '+current.failures.length+' failed',owner);
        return;
      } else if(current.req.action==='grab_all_items') {
        const done=tickItems(current,owner,now);current.next=now+50;
        if(done) finish(!current.cancel && current.failures.length===0,'Item collection '+(current.cancel?'stopped':'completed')+'; '+current.skipped+' skipped, '+current.failures.length+' failed',owner);
        return;
      } else if(current.req.action==='spawn_corpses' || current.req.action==='spawn_corpse_pins') {
        current.spawned.push(spawnCorpse(current.at,current.done,owner,current.req.request_id,current.placements?current.placements[current.done]:null));
        current.done++;current.next=now+200;
      } else {
        const pose=grab(owner);if(pose.toString()!==current.pose) throw Error('Your carry pose changed');
        if(current.stage==='next') {
          if(!freeHands(owner,pose)) throw Error('Your hands became occupied');
          const target=current.targets[current.done];
          if(!roster.some(p=>p.pc===target.pc && p.pn===target.pn && p.name===target.name && p.backrefMatches && !p.isLocalPlayer)) throw Error('A party member left or changed identity');
          const pc=ptr(target.pc),pn=ptr(target.pn),poser=pc.add(0xa0).readPointer();
          if(poser.isNull() || !poser.add(0x10).readPointer().equals(pc) || !poser.add(0x18).readPointer().isNull() || !pn.add(0x88).readPointer().isNull() || !through(pc,[0xf0,0x18,0x150]).isNull()) throw Error(target.name+' must stand freely with empty hands');
          if(!boxedBool(invoke(gathering().safe,poser,params([pose,ptr(owner.pc)])))) throw Error('The game does not allow picking up '+target.name+' right now');
          current.target=target;pickPlayer(ptr(owner.pn),pc,cmdMethod);
          current.stage='attach';current.stageAt=now;
        } else {
          const target=current.target,exists=roster.some(p=>p.pc===target.pc && p.pn===target.pn && p.backrefMatches);
          if(!exists) throw Error('A party member disconnected during gather');
          const occupant=pose.add(0x150).readPointer();
          const attached=occupant.equals(ptr(target.pc)) && through(ptr(target.pc),[0xa0,0x18]).equals(pose);
          if(current.stage==='attach') {
            if(attached) {current.stage='hold';current.stageAt=now;}
            else if(now-current.stageAt>2000) throw Error('The game did not accept pickup of '+target.name);
          } else if(current.stage==='hold') {
            if(!attached) throw Error(target.name+' left the carry pose');
            if(now-current.stageAt>=750) {invoke(gathering().drop,ptr(owner.pn));current.stage='drop';current.stageAt=now;}
          } else if(current.stage==='drop') {
            if(occupant.isNull() && !through(ptr(target.pc),[0xa0,0x18]).equals(pose)) {current.done++;current.target=null;current.stage='next';}
            else if(now-current.stageAt>1500) throw Error('Drop was not observed for '+target.name);
          }
        }
        current.next=now+50;
      }
      if(current.done>=current.total) finish(true,current.req.action==='gather_party'?'Pickup/drop sequence completed; check arrival in game':current.req.action==='spawn_corpse_pins'?'Corpse bowling pin spawn sequence completed':'Big Fun sequence completed',owner);
    } catch(error) {finish(false,String(error),owner);}
  }
  function cancel(id) {if(job && (!id || job.req.request_id===id)) {job.cancel=true;job.next=0;}}
  function stop() {
    if(job) {job.cancel=true;job.next=0;tick(Date.now());if(job) return false;}
    for(const handle of roots) safe(()=>base().release(handle));roots.length=0;
    corpsePrefab=null;
    return true;
  }
  return {capabilities,start,tick,cancel,stop,busy:()=>!!job,needsCleanup:()=>!!job || roots.length>0};
})();

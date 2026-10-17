// Build-specific, owned-character tools. Calls run only inside the existing
// PlayerCharacter.Update queue; appearance uses the host's normal save/network path.
const characterTools = (() => {
  const objectClass=new NativeFunction(exp('il2cpp_object_get_class'),'pointer',['pointer']);
  const fieldOffset=new NativeFunction(exp('il2cpp_field_get_offset'),'int',['pointer']);
  const fieldType=new NativeFunction(exp('il2cpp_field_get_type'),'pointer',['pointer']);
  const typeClass=new NativeFunction(exp('il2cpp_class_from_type'),'pointer',['pointer']);
  const elementClass=new NativeFunction(exp('il2cpp_class_get_element_class'),'pointer',['pointer']);
  const valueSize=new NativeFunction(exp('il2cpp_class_value_size'),'int',['pointer','pointer']);
  const assignable=new NativeFunction(exp('il2cpp_class_is_assignable_from'),'bool',['pointer','pointer']);
  const looksClass=klass(gameImage,'','PlayerLooks'),paletteClass=klass(gameImage,'','PlayerLookSet');
  const actionsClass=klass(gameImage,'','PlayerActions'),handsClass=klass(gameImage,'','PlayerHands');
  const registryClass=klass(gameImage,'','PlayerRegistry'),homeClass=klass(gameImage,'','PropHome');
  const switchClass=klass(gameImage,'','PeckSwitch');
  let appearanceError='',heldError='',pocketsError='',serverSetLook=ptr(0),serverActive=ptr(0),identityClass=ptr(0),useHeld=ptr(0),releaseHeld=ptr(0),dropHeld=ptr(0),heldCharacter=ptr(0),notBlocked=ptr(0);
  let paletteStride=0;
  let pendingUse=null;
  let pendingAppearance=null;
  const useLeaseMs=1500;
  function checked(type,name,offset) {
    if(type.isNull()) throw Error('Missing character tools type');
    const f=fieldFromName(type,Memory.allocUtf8String(name));
    if(f.isNull() || fieldOffset(f)!==offset) throw Error('Character tools layout changed: '+name);
    return f;
  }
  function exact(value,type,label) {
    if(value.isNull() || type.isNull() || !objectClass(value).equals(type)) throw Error(label+' is unavailable');
    return value;
  }
  function ownerFor(expected) {
    const roster=describePlayers(),owners=roster.filter(p=>p.isLocalPlayer && p.isOwned && p.backrefMatches);
    if(owners.length!==1) throw Error('Waiting for your locally owned character');
    const owner=owners[0];
    if(expected && (owner.pc!==(expected.owner_pc || expected.pc) || owner.pn!==(expected.owner_pn || expected.pn))) throw Error('Your character changed; wait for a fresh update');
    const pc=exact(ptr(owner.pc),pcClass,'Your character'),pn=exact(ptr(owner.pn),pnClass,'Your network character');
    if(!pc.add(0x1a0).readPointer().equals(pn)) throw Error('Your network character changed');
    return {owner,pc,pn,roster};
  }
  try {
    checked(pcClass,'playerNetworking',0x1a0);checked(pcClass,'looks',0x98);
    checked(looksClass,'playerCharacter',0x68);checked(looksClass,'lookSet',0x30);
    const colors=checked(paletteClass,'colors',0x18);
    const colorClass=elementClass(typeClass(fieldType(colors)));
    if(colorClass.isNull()) throw Error('Appearance palette type is unavailable');
    const colorField=fieldFromName(colorClass,Memory.allocUtf8String('color'));
    const fontField=fieldFromName(colorClass,Memory.allocUtf8String('fontStyle'));
    const rewardField=fieldFromName(colorClass,Memory.allocUtf8String('rewardOnly'));
    if(colorField.isNull() || fontField.isNull() || rewardField.isNull()) throw Error('Appearance palette fields are unavailable');
    const base=fieldOffset(colorField);
    if(![0,0x10].includes(base) || fieldOffset(fontField)-base!==0x10 || fieldOffset(rewardField)-base!==0x14) throw Error('Appearance palette layout changed');
    const alignment=Memory.alloc(4);paletteStride=valueSize(colorClass,alignment);
    if(paletteStride!==0x18) throw Error('Appearance palette stride changed');
    for(const [name,offset] of [['lookIdHead',0x7c],['lookIdTorso',0x80],['lookIdLegs',0x84]]) checked(pnClass,name,offset);
    // In this build CmdChangeLook's receiver is just RET (RVA 0x2da6b0).
    // SetAllLooks only sends that command, so it cannot implement this control.
    // ServerSetLook is the actual dye interaction's host-side path. Retain its
    // authority guard and expose it only for the host's own owned character.
    let mirror=ptr(0);
    for(let i=0;i<assemblyCount;i++) {
      const image=assemblyGetImage(assemblies.add(i*Process.pointerSize).readPointer());
      if(imageGetName(image).readCString()==='Mirror.dll') {mirror=image;break;}
    }
    if(mirror.isNull()) throw Error('Mirror appearance authority is unavailable');
    identityClass=klass(mirror,'Mirror','NetworkIdentity');
    checked(klass(mirror,'Mirror','NetworkBehaviour'),'<netIdentity>k__BackingField',0x40);
    checked(identityClass,'<isServer>k__BackingField',0x21);
    serverActive=method(klass(mirror,'Mirror','NetworkServer'),'get_active',0);
    serverSetLook=method(pnClass,'ServerSetLook',3);
    if(!serverSetLook.readPointer().equals(mod.base.add(0x39a9a0))) throw Error('Appearance setter changed');
  } catch(error) {appearanceError=String(error);}
  try {
    checked(pcClass,'hands',0x68);checked(pcClass,'actions',0x120);
    checked(actionsClass,'playerCharacter',0x18);checked(handsClass,'playerCharacter',0x28);checked(handsClass,'heldProp',0x38);
    const heldField=checked(pnClass,'playerHeldInformation',0x88),heldType=typeClass(fieldType(heldField));
    const identityField=fieldFromName(heldType,Memory.allocUtf8String('identity'));
    if(identityField.isNull() || ![0,0x10].includes(fieldOffset(identityField))) throw Error('Held information layout changed');
    checked(pnClass,'isGhost',0xec);checked(pnClass,'isSleeping',0x148);
    for(const [name,offset] of [['useHeldSwitch',0x228],['useHeldUpSwitch',0x230],['exclusiveHolder',0x2c0],['networkIdentity',0x2d8]]) checked(propType,name,offset);
    for(const [name,offset] of [['trackedStateSystem',0x20],['needsKey',0x54],['playerHoldingThis',0x68]]) checked(switchClass,name,offset);
    useHeld=method(actionsClass,'ActionUseHeldSwitch',0);releaseHeld=method(actionsClass,'ActionUseHeldUpSwitch',0);
    dropHeld=method(actionsClass,'ActionDropPropOrPlayer',0);heldCharacter=method(handsClass,'get_heldCharacter',0);notBlocked=method(switchClass,'get_isNotBlocked',0);
  } catch(error) {heldError=String(error);}
  try {
    checked(pcClass,'registry',0xf0);
    for(const [name,offset] of [['blindfoldPocket',0xb0],['backpackPocket',0xb8],['holsterPocket',0xc0]]) checked(registryClass,name,offset);
    checked(homeClass,'parentCharacter',0x30);checked(homeClass,'pinnedProp',0xd8);
  } catch(error) {pocketsError=String(error);}
  function appearance(info) {
    if(appearanceError) throw Error(appearanceError);
    const looks=exact(info.pc.add(0x98).readPointer(),looksClass,'Your appearance controller');
    if(!looks.add(0x68).readPointer().equals(info.pc)) throw Error('Your appearance controller changed');
    const palette=exact(looks.add(0x30).readPointer(),paletteClass,'Your appearance palette');
    const array=palette.add(0x18).readPointer();
    if(array.isNull()) throw Error('Appearance palette is empty');
    const n=array.add(0x18).readU64().toNumber();
    if(!Number.isSafeInteger(n) || n<1 || n>512) throw Error('Unexpected appearance palette size');
    const colors=[];
    for(let id=0;id<n;id++) {
      const p=array.add(0x20+id*paletteStride),color=[0,1,2,3].map(i=>p.add(i*4).readFloat()),reward=p.add(0x14).readU8();
      if(!color.every(v=>Number.isFinite(v) && v>=0 && v<=16) || reward>1) throw Error('Unexpected appearance palette entry');
      colors.push({id,color,available:reward===0});
    }
    const head=info.pn.add(0x7c).readS32(),torso=info.pn.add(0x80).readS32(),legs=info.pn.add(0x84).readS32();
    if(![head,torso,legs].every(v=>Number.isInteger(v) && v>=0 && v<n)) throw Error('Current appearance is outside the palette');
    const identity=exact(info.pn.add(0x40).readPointer(),identityClass,'Your appearance network identity');
    const active=invoke(serverActive,ptr(0));
    const available=identity.add(0x21).readU8()===1 && !active.isNull() && active.add(0x10).readU8()===1;
    return {looks,available,reason:available?'':'Appearance editing requires hosting. This game build has no working client appearance command.',head,torso,legs,colors};
  }
  function readPockets(info) {
    if(pocketsError) return [];
    const registry=exact(info.pc.add(0xf0).readPointer(),registryClass,'Your pocket registry');
    const listed=propList();
    return [['Blindfold',0xb0],['Backpack',0xb8],['Holster',0xc0]].map(([name,off])=>{
      try {
        const home=exact(registry.add(off).readPointer(),homeClass,name+' pocket');
        if(!home.add(0x30).readPointer().equals(info.pc)) throw Error(name+' pocket belongs to another character');
        const prop=home.add(0xd8).readPointer();
        if(prop.isNull()) return {name,item_name:null,item_key:null,net_id:0,available:true,reason:''};
        if(!listed.some(e=>e.p.equals(prop)) || !assignable(propType,objectClass(prop))) throw Error(name+' pocket item is no longer loaded');
        const identity=prop.add(0x2d8).readPointer();
        if(identity.isNull()) throw Error(name+' pocket item has no network identity');
        return {name,item_name:objectName(prop),item_key:String(prop)+':'+String(identity),net_id:identity.add(0x30).readU32(),available:true,reason:''};
      } catch(error) {return {name,item_name:null,item_key:null,net_id:0,available:false,reason:String(error)};}
    });
  }
  function heldState(info) {
    if(heldError) throw Error(heldError);
    const hands=exact(info.pc.add(0x68).readPointer(),handsClass,'Your hands'),actions=exact(info.pc.add(0x120).readPointer(),actionsClass,'Your action controller');
    if(!hands.add(0x28).readPointer().equals(info.pc) || !actions.add(0x18).readPointer().equals(info.pc)) throw Error('Your carrying controller changed');
    const prop=hands.add(0x38).readPointer(),identity=info.pn.add(0x88).readPointer();
    const carried=invoke(heldCharacter,hands);
    if(!carried.isNull() && (!info.roster.some(p=>p.pc===String(carried) && p.backrefMatches && !p.isLocalPlayer) || !objectClass(carried).equals(pcClass))) throw Error('Your carried player changed');
    if(!prop.isNull()) {
      if(!carried.isNull() || !propList().some(e=>e.p.equals(prop)) || !assignable(propType,objectClass(prop))) throw Error('Your held item changed');
      if(prop.add(0x10).readPointer().isNull()) throw Error('Your held item is no longer active');
      if(identity.isNull() || !prop.add(0x2d8).readPointer().equals(identity) || !prop.add(0x2c0).readPointer().equals(info.pc)) throw Error('Waiting for your held item to synchronize');
    } else if(!identity.isNull()) throw Error('Waiting for your hands to synchronize');
    return {hands,actions,prop,identity,carried};
  }
  function safeSwitch(info,prop,offset,activating=true) {
    const sw=exact(prop.add(offset).readPointer(),switchClass,'Held item switch');
    if(sw.add(0x10).readPointer().isNull() || sw.add(0x20).readPointer().isNull()) throw Error('Held item switch is inactive');
    if(activating && sw.add(0x54).readU8()!==0) throw Error('This item requires its normal key interaction');
    const holder=sw.add(0x68).readPointer();
    if(!holder.isNull() && !holder.equals(info.pc)) throw Error('Held item switch belongs to another player');
    if(activating) {
      const allowed=invoke(notBlocked,sw);
      if(allowed.isNull() || allowed.add(0x10).readU8()!==1) throw Error('Held item switch is blocked');
    }
    return sw;
  }
  function usable(info,state) {
    if(state.prop.isNull()) throw Error('Your hands have no item');
    if(info.pn.add(0x148).readU8() || info.pn.add(0xec).readU8()) throw Error('Your character cannot use a held item in this state');
    safeSwitch(info,state.prop,0x228);
    // Verify the release path before ever pressing an item that has one.
    if(!state.prop.add(0x230).readPointer().isNull()) safeSwitch(info,state.prop,0x230,false);
  }
  function discardStaleUse(info,state) {
    if(!pendingUse) return;
    if(pendingUse.pc!==info.owner.pc || pendingUse.pn!==info.owner.pn ||
       (state && (pendingUse.prop!==String(state.prop) || pendingUse.identity!==String(state.identity)))) {
      // The game handles release during a character/item transition. Forget the
      // old context without invoking either the old or the newly held switch.
      pendingUse=null;
    }
  }
  function snapshot(expected) {
    let info;
    try {info=ownerFor(expected);} catch(error) {return {appearance:{available:false,reason:String(error),head:0,torso:0,legs:0,colors:[]},pockets:[],held:{can_use:false,can_drop:false,can_release:false,is_using:false,reason:String(error)}};}
    discardStaleUse(info);
    let look;
    try {const {looks,...data}=appearance(info);look=data;} catch(error) {look={available:false,reason:String(error),head:0,torso:0,legs:0,colors:[]};}
    let pockets=[],pocketReason=pocketsError;
    try {pockets=readPockets(info);} catch(error) {pocketReason=String(error);}
    let held;
    try {
      const state=heldState(info);
      discardStaleUse(info,state);
      const isUsing=!!pendingUse;
      let reason='',canUse=false;
      try {usable(info,state);canUse=!isUsing;} catch(error) {reason=String(error);}
      held={can_use:canUse,can_drop:!state.prop.isNull() || !state.carried.isNull(),can_release:isUsing,is_using:isUsing,reason:(pendingUse && pendingUse.releaseError) || reason};
    } catch(error) {held={can_use:false,can_drop:false,can_release:false,is_using:false,reason:String(error)};}
    return {appearance:look,pockets,pockets_reason:pocketReason,held};
  }
  function releasePending(info,state) {
    if(!pendingUse) return;
    if(pendingUse.pc!==info.owner.pc || pendingUse.pn!==info.owner.pn || pendingUse.prop!==String(state.prop) || pendingUse.identity!==String(state.identity)) {
      // A drop/item switch is handled by the game's normal held-state cleanup.
      // Never release a new item's unrelated switch using a stale context.
      pendingUse=null;return;
    }
    if(!state.prop.add(0x230).readPointer().isNull()) {
      safeSwitch(info,state.prop,0x230,false);invoke(releaseHeld,state.actions);
    }
    pendingUse=null;
  }
  function apply(req) {
    if(req.target_kind!=='tools') throw Error('Unsupported character tool');
    const info=ownerFor(req);
    discardStaleUse(info);
    if(req.action==='appearance_set' || req.action==='appearance_randomize') {
      if(pendingAppearance) throw Error('Waiting for the previous appearance change');
      const palette=appearance(info);
      if(!palette.available) throw Error(palette.reason);
      let looks=req.looks;
      if(req.action==='appearance_randomize') {
        const ids=palette.colors.filter(color=>color.available).map(color=>color.id);
        if(!ids.length) throw Error('No ordinary appearance colors are available');
        looks={};
        for(const part of ['head','torso','legs']) {
          // Choose each part independently, avoiding its current color whenever
          // another ordinary palette color exists. Cosmetic randomness only.
          const alternatives=ids.filter(id=>id!==palette[part]);
          const choices=alternatives.length?alternatives:ids;
          looks[part]=choices[Math.floor(Math.random()*choices.length)];
        }
      }
      if(!looks || !['head','torso','legs'].every(part=>Number.isInteger(looks[part]) && palette.colors.some(color=>color.id===looks[part] && (color.available || looks[part]===palette[part])))) throw Error('Choose ordinarily available appearance colors');
      const parts=['head','torso','legs'];
      for(let i=0;i<parts.length;i++) {
        const part=parts[i];
        if(looks[part]===palette[part]) continue;
        const params=Memory.alloc(3*Process.pointerSize),values=[Memory.alloc(4),Memory.alloc(4),Memory.alloc(4)];
        values[0].writeS32(looks[part]);values[1].writeS32(i);values[2].writeU8(1);
        values.forEach((value,index)=>params.add(index*Process.pointerSize).writePointer(value));
        invoke(serverSetLook,info.pn,params);
        // Keep argument buffers rooted until the managed invocation returns.
        if(values[0].readS32()!==looks[part]) throw Error('Appearance argument changed');
      }
      const requestedLooks={head:looks.head,torso:looks.torso,legs:looks.legs};
      // A wrapper return is not confirmation. Observe the synchronized look IDs
      // on subsequent owned-character updates before reporting completion.
      pendingAppearance={requestId:req.request_id,owner:info.owner,looks:requestedLooks,deadline:Date.now()+3000,matchedAt:null};
      return null;
    }
    const state=heldState(info);
    discardStaleUse(info,state);
    if(req.action==='held_use') {
      if(pendingUse) throw Error('Release the active held item before using it again');
      if(typeof req.hold_id!=='string' || req.hold_id!==req.request_id || req.hold_id.length>160) throw Error('Invalid held-use request identity');
      usable(info,state);
      // Save before invoking, so detach still attempts release if managed code
      // partially performs the press and subsequently raises an exception.
      pendingUse={pc:info.owner.pc,pn:info.owner.pn,prop:String(state.prop),identity:String(state.identity),holdId:req.hold_id,expires:Date.now()+useLeaseMs,releaseError:''};
      invoke(useHeld,state.actions);
    } else if(req.action==='held_release') {
      if(pendingUse && pendingUse.holdId!==req.hold_id) throw Error('The held-use press changed; ignoring its stale release');
      releasePending(info,state);
    }
    else if(req.action==='held_drop') {
      if(state.prop.isNull() && state.carried.isNull()) throw Error('Your hands are empty');
      releasePending(info,state);invoke(dropHeld,state.actions);
    } else throw Error('Unsupported character tool');
    return {message:'Held item action returned.',tools:snapshot(info.owner)};
  }
  function hasChanges() {return pendingUse!==null;}
  function keepAlive(req) {
    // Called off the Unity thread: update only this script's lease state.
    // No Unity methods, field reads, or game writes occur in the heartbeat.
    if(!req || !pendingUse || req.hold_id!==pendingUse.holdId || req.owner_pc!==pendingUse.pc || req.owner_pn!==pendingUse.pn || pendingUse.releaseError) return {ok:false};
    pendingUse.expires=Date.now()+useLeaseMs;return {ok:true};
  }
  function tick(now) {
    if(pendingAppearance) {
      const pending=pendingAppearance;
      try {
        const current=appearance(ownerFor(pending.owner));
        if(!current.available) throw Error(current.reason);
        const matched=['head','torso','legs'].every(part=>current[part]===pending.looks[part]);
        pending.matchedAt=matched?(pending.matchedAt===null?now:pending.matchedAt):null;
        if(matched && now-pending.matchedAt>=100) {
          pendingAppearance=null;
          send({type:'action_result',request_id:pending.requestId,ok:true,message:'Appearance change observed.',requested_looks:pending.looks});
        } else if(now>=pending.deadline) {
          throw Error('Appearance did not update in the game. The change was not confirmed.');
        }
      } catch(error) {
        pendingAppearance=null;
        send({type:'action_result',request_id:pending.requestId,ok:false,message:String(error)});
      }
    }
    if(!pendingUse || now<pendingUse.expires) return;
    try {
      const info=ownerFor();discardStaleUse(info);
      if(!pendingUse) return;
      const state=heldState(info);discardStaleUse(info,state);
      releasePending(info,state);
    } catch(error) {
      if(pendingUse) {
        pendingUse.expires=now+500;
        pendingUse.releaseError='Waiting to release held use: '+String(error);
      }
    }
  }
  function restoreAll() {
    pendingAppearance=null;
    if(!pendingUse) return;
    const owners=describePlayers().filter(p=>p.isLocalPlayer && p.isOwned && p.backrefMatches && p.pc===pendingUse.pc && p.pn===pendingUse.pn);
    if(owners.length!==1) {pendingUse=null;return;}
    const info=ownerFor(owners[0]);releasePending(info,heldState(info));
  }
  return {snapshot,apply,hasChanges,restoreAll,keepAlive,tick};
})();

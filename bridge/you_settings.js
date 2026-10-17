// Per-owned-character settings. All mutations run on that character's Update.
const youSettings = (() => {
  const fields = [
    ['walk', 'forwardSpeed', 0x10], ['sprint', 'forwardSprintSpeed', 0x14],
    ['crouchWalk', 'crouchForwardSpeed', 0x18], ['crouchSprint', 'crouchForwardSprintSpeed', 0x1c],
    ['swimWalk', 'swimForwardSpeed', 0x20], ['swimSprint', 'swimForwardSprintSpeed', 0x24],
    ['ghostSprint', 'forwardSprintGhostSpeed', 0x28],
    ['jumpForce', 'jumpForce', 0x40], ['upwardCap', 'maxUpwardsVelocity', 0x44],
    ['chargeDuration', 'maxWindUpDuration', 0x48], ['kickForce', 'kickSettings', 0x50],
    ['throwNormal', 'throwSettings', 0x68], ['throwLow', 'lowThrowSettings', 0x80],
  ];
  const groups = {
    movement:['walk','sprint','crouchWalk','crouchSprint','swimWalk','swimSprint','ghostSprint'],
    jump:['jumpForce','upwardCap'], throw:['throwNormal','throwLow','kickForce'], charge:['chargeDuration'],
  };
  const tuningsClass = classFromName(gameImage, Memory.allocUtf8String(''), Memory.allocUtf8String('PlayerTunings'));
  const fallerClass = classFromName(gameImage, Memory.allocUtf8String(''), Memory.allocUtf8String('PlayerFaller'));
  const objectClass = new NativeFunction(exp('il2cpp_object_get_class'), 'pointer', ['pointer']);
  const fieldOffset = new NativeFunction(exp('il2cpp_field_get_offset'), 'int', ['pointer']);
  const fieldType = new NativeFunction(exp('il2cpp_field_get_type'), 'pointer', ['pointer']);
  const typeClass = new NativeFunction(exp('il2cpp_class_from_type'), 'pointer', ['pointer']);
  function checkedField(type, name, offset) {
    if(type.isNull()) throw Error('Missing character settings class');
    const field=fieldFromName(type,Memory.allocUtf8String(name));
    if(field.isNull() || fieldOffset(field)!==offset) throw Error('Character setting layout changed: '+name);
    return field;
  }
  checkedField(pcClass,'tunings',0x78);
  for(const [key,name,offset] of fields) {
    const field=checkedField(tuningsClass,name,offset);
    // LaunchSettings is an inline value type; maxForce is its first float.
    if(key.startsWith('throw') || key==='kickForce') {
      const launch=typeClass(fieldType(field));
      if(launch.isNull()) throw Error('Throw settings type is unavailable');
      const force=fieldFromName(launch,Memory.allocUtf8String('maxForce'));
      const torque=fieldFromName(launch,Memory.allocUtf8String('maxTorque'));
      // Some IL2CPP metadata presents boxed value-type field offsets.
      if(force.isNull() || torque.isNull() || ![0,Process.pointerSize*2].includes(fieldOffset(force)) || fieldOffset(torque)-fieldOffset(force)!==4) throw Error('Throw settings layout changed');
    }
  }
  let fallerLayoutError='', clearNextFall=ptr(0);
  try {
    checkedField(pcClass,'faller',0x110);
    checkedField(fallerClass,'playerCharacter',0x38);
    checkedField(fallerClass,'ignoreFalling',0x1b);
    clearNextFall=methodFromName(fallerClass,Memory.allocUtf8String('ClearNextFall'),0);
    if(clearNextFall.isNull()) throw Error('ClearNextFall was not found');
  } catch(error) {fallerLayoutError=String(error);}
  const entries=new Map(), fallers=new Map();
  function resolve(expectedPc,expectedPn) {
    const roster=describePlayers();
    const owners=roster.filter(p=>p.isLocalPlayer && p.isOwned && p.backrefMatches);
    if(owners.length!==1) throw Error('Waiting for your locally owned character');
    const owner=owners[0];
    if(expectedPc && (owner.pc!==expectedPc || owner.pn!==expectedPn)) throw Error('Your character changed; wait for a fresh update');
    const tuning=ptr(owner.pc).add(0x78).readPointer();
    if(tuning.isNull() || !objectClass(tuning).equals(tuningsClass)) throw Error('Your character settings are unavailable');
    const shared=roster.some(p=>p.pc!==owner.pc && ptr(p.pc).add(0x78).readPointer().equals(tuning));
    const tuningKey=owner.pc+':'+owner.pn+':'+tuning;
    let faller=null, fallerReason=fallerLayoutError;
    if(!fallerReason) {
      try {
        const candidate=ptr(owner.pc).add(0x110).readPointer();
        if(candidate.isNull() || !objectClass(candidate).equals(fallerClass) || !candidate.add(0x38).readPointer().equals(ptr(owner.pc))) throw Error('Your landing controller is unavailable');
        if(roster.some(p=>p.pc!==owner.pc && ptr(p.pc).add(0x110).readPointer().equals(candidate))) throw Error('Your landing controller is shared');
        if(candidate.add(0x1b).readU8()>1) throw Error('Unexpected landing setting');
        faller=candidate;
      } catch(error) {fallerReason=String(error);}
    }
    const fallerKey=owner.pc+':'+owner.pn+':'+(faller || 'none');
    return {owner,tuning,tuningKey,shared,faller,fallerKey,fallerReason,key:tuningKey+':'+(faller || 'none')};
  }
  function valueLimit(key) {
    if(['throwNormal','throwLow','kickForce'].includes(key)) return 1000000;
    if(['jumpForce','upwardCap'].includes(key)) return 100000;
    return 10000;
  }
  function raw(tuning,original=false) {
    const result={};
    for(const [key,,offset] of fields) {
      const value=tuning.add(offset).readFloat();
      if(!Number.isFinite(value) || value<=0 || value>(original?10000:valueLimit(key))) throw Error('Unexpected character setting: '+key);
      result[key]=value;
    }
    return result;
  }
  function entryFor(info) {
    let entry=entries.get(info.tuningKey);
    if(!entry) {
      entry={pc:info.owner.pc,pn:info.owner.pn,tuning:String(info.tuning),original:raw(info.tuning,true),changed:new Set()};
      entries.set(info.tuningKey,entry);
    }
    return entry;
  }
  function fallerFor(info) {
    if(!info.faller) return null;
    let entry=fallers.get(info.fallerKey);
    if(!entry) {
      entry={pc:info.owner.pc,pn:info.owner.pn,faller:String(info.faller),original:info.faller.add(0x1b).readU8(),changed:false};
      fallers.set(info.fallerKey,entry);
    }
    return entry;
  }
  function snapshot() {
    try {
      const info=resolve(),entry=entryFor(info),current=raw(info.tuning),fall=fallerFor(info);
      const movement=current.walk/entry.original.walk;
      const noDizziness=!!(info.faller && info.faller.add(0x1b).readU8());
      return {available:!info.shared,key:info.key,reason:info.shared?'Movement settings are shared with another character.':'',
        values:{movement,jump:Math.pow(current.jumpForce/entry.original.jumpForce,2),throw:current.throwNormal/entry.original.throwNormal,
          charge:entry.original.chargeDuration/current.chargeDuration},
        movement_mixed:groups.movement.some(key=>Math.abs(current[key]/entry.original[key]-movement)>0.0001),
        strength_mixed:groups.throw.some(key=>Math.abs(current[key]/entry.original[key]-current.throwNormal/entry.original.throwNormal)>0.0001),
        dizziness_available:!!fall,dizziness_reason:info.fallerReason,no_landing_dizziness:noDizziness,
        modified:fields.some(([key])=>Math.abs(current[key]-entry.original[key])>Math.max(0.0001,Math.abs(entry.original[key])*0.00001)) || !!(fall && Number(noDizziness)!==fall.original),
        current,original:entry.original};
    } catch(error) {return {available:false,key:'',reason:String(error),modified:false};}
  }
  function writeFields(info,next) {
    const before=raw(info.tuning);
    for(const key of Object.keys(next)) {
      if(!fields.some(f=>f[0]===key) || !Number.isFinite(next[key]) || next[key]<=0 || next[key]>valueLimit(key)) throw Error('Invalid character setting value');
    }
    try {
      for(const [key,,offset] of fields) if(Object.hasOwn(next,key)) info.tuning.add(offset).writeFloat(next[key]);
      const after=raw(info.tuning);
      for(const key of Object.keys(next)) if(Math.abs(after[key]-next[key])>Math.max(0.0001,Math.abs(next[key])*0.00001)) throw Error('Character value did not read back');
    } catch(error) {
      for(const [key,,offset] of fields) if(Object.hasOwn(next,key)) {try{info.tuning.add(offset).writeFloat(before[key]);}catch(_){}}
      throw error;
    }
  }
  function writeLanding(info,ignore) {
    if(!info.faller) throw Error(info.fallerReason || 'Landing setting is unavailable');
    const before=info.faller.add(0x1b).readU8();
    // Ignoring falls stops height baseline updates. Reset it when re-enabling
    // falls using the game's method so an old height cannot trigger a fall.
    if(before && !ignore) {
      const exception=Memory.alloc(Process.pointerSize);exception.writePointer(ptr(0));
      runtimeInvoke(clearNextFall,info.faller,ptr(0),exception);
      if(!exception.readPointer().isNull()) throw Error('Could not reset the landing baseline');
    }
    try {
      info.faller.add(0x1b).writeU8(ignore?1:0);
      if(info.faller.add(0x1b).readU8()!==(ignore?1:0)) throw Error('Landing setting did not read back');
    } catch(error) {try{info.faller.add(0x1b).writeU8(before);}catch(_){} throw error;}
  }
  function apply(req) {
    const info=resolve(req.owner_pc,req.owner_pn);
    if(info.key!==req.settings_key) throw Error('Your character settings changed; wait for a fresh update');
    if(req.action==='settings_toggle') {
      if(req.setting!=='no_landing_dizziness' || typeof req.enabled!=='boolean') throw Error('Unknown character toggle');
      const fall=fallerFor(info);
      if(!fall) throw Error(info.fallerReason || 'Landing setting is unavailable');
      writeLanding(info,req.enabled);fall.changed=Number(req.enabled)!==fall.original;
      return {message:'Landing setting updated.',settings:snapshot()};
    }
    const entry=entryFor(info);
    if(req.action==='settings_restore') {
      if(info.shared && entry.changed.size) throw Error('This tuning object is shared with another character');
      if(!info.shared) {writeFields(info,entry.original);entry.changed.clear();}
      const fall=fallerFor(info);
      if(fall && fall.changed) {writeLanding(info,!!fall.original);fall.changed=false;}
      return {message:'Your original character settings were restored.',settings:snapshot()};
    }
    if(info.shared) throw Error('This tuning object is shared with another character');
    if(req.action==='settings_preset') {
      if(!req.values || typeof req.values!=='object' || typeof req.no_landing_dizziness!=='boolean') throw Error('Incomplete settings preset');
      const next={};
      for(const setting of Object.keys(groups)) Object.assign(next,scaledFields(entry,setting,req.values[setting]));
      const fall=fallerFor(info);
      if(!fall) throw Error(info.fallerReason || 'Landing setting is unavailable');
      const before=raw(info.tuning),landingBefore=!!info.faller.add(0x1b).readU8();
      try {writeFields(info,next);writeLanding(info,req.no_landing_dizziness);}
      catch(error) {
        const rollback=[];
        try {writeFields(info,before);} catch(failure) {rollback.push(String(failure));}
        try {writeLanding(info,landingBefore);} catch(failure) {rollback.push(String(failure));}
        if(rollback.length) {
          // Retain restoration responsibility if a rollback itself fails.
          for(const group of Object.keys(groups)) entry.changed.add(group);
          fall.changed=true;
          throw Error(String(error)+'; rollback incomplete: '+rollback.join('; '));
        }
        throw error;
      }
      for(const group of Object.keys(groups)) entry.changed.add(group);
      fall.changed=Number(req.no_landing_dizziness)!==fall.original;
      return {message:'Character preset updated.',settings:snapshot()};
    }
    if(req.action!=='settings_set' || !Object.hasOwn(groups,req.setting)) throw Error('Unknown character setting');
    const next=scaledFields(entry,req.setting,req.multiplier);
    writeFields(info,next);entry.changed.add(req.setting);
    return {message:'Character setting updated.',settings:snapshot()};
  }
  function scaledFields(entry,setting,amount) {
    const maximum=['jump','throw'].includes(setting)?99:20;
    if(typeof amount!=='number' || !Number.isFinite(amount) || amount<0.25 || amount>maximum) throw Error('This character multiplier must be between 0.25 and '+maximum);
    const scale=setting==='jump'?Math.sqrt(amount):setting==='charge'?1/amount:amount,next={};
    for(const key of groups[setting]) next[key]=entry.original[key]*scale;
    if(setting==='jump') next.upwardCap=Math.max(next.upwardCap,next.jumpForce);
    if(setting==='charge' && next.chargeDuration<0.0001) throw Error('Throw charge duration would be too small');
    return next;
  }
  function hasChanges() {return [...entries.values()].some(e=>e.changed.size>0) || [...fallers.values()].some(e=>e.changed);}
  function restoreAll() {
    const errors=[];
    for(const entry of entries.values()) {
      if(!entry.changed.size) continue;
      try {
        if(!describePlayers().some(p=>p.pc===entry.pc && p.pn===entry.pn)) {entry.changed.clear();continue;}
        const info=resolve(entry.pc,entry.pn);
        if(String(info.tuning)!==entry.tuning) {entry.changed.clear();continue;}
        if(info.shared) throw Error('Could not restore settings because the tuning object is now shared');
        const original={};
        for(const group of entry.changed) for(const key of groups[group]) original[key]=entry.original[key];
        writeFields(info,original);entry.changed.clear();
      } catch(error) {errors.push(String(error));}
    }
    for(const entry of fallers.values()) {
      if(!entry.changed) continue;
      try {
        if(!describePlayers().some(p=>p.pc===entry.pc && p.pn===entry.pn)) {entry.changed=false;continue;}
        const info=resolve(entry.pc,entry.pn);
        if(!info.faller || String(info.faller)!==entry.faller) {entry.changed=false;continue;}
        writeLanding(info,!!entry.original);entry.changed=false;
      } catch(error) {errors.push(String(error));}
    }
    if(errors.length) throw Error(errors.join('; '));
  }
  return {snapshot,apply,hasChanges,restoreAll};
})();

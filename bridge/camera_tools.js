// Camera-only controls for the audited Big Walk build. All entry points run on Unity Update.
// Native CameraCheatMover.Attach is deliberately never called: it teleports the character.
const cameraTools = (() => {
  let api=null, entry=null;
  function args(values) {
    const p=Memory.alloc(Math.max(1,values.length)*Process.pointerSize);
    values.forEach((v,i)=>p.add(i*Process.pointerSize).writePointer(v));return p;
  }
  function scalar(value,bool=false) {const p=Memory.alloc(4);if(bool)p.writeU8(value?1:0);else p.writeFloat(value);return p;}
  function vector(values) {const p=Memory.alloc(values.length*4);values.forEach((v,i)=>p.add(i*4).writeFloat(v));return p;}
  function base() {
    if(api)return api;
    const native=(name,result,types)=>new NativeFunction(exp(name),result,types);
    const a={
      objectClass:native('il2cpp_object_get_class','pointer',['pointer']),
      offset:native('il2cpp_field_get_offset','int',['pointer']),
      setReference:native('il2cpp_gc_wbarrier_set_field','void',['pointer','pointer','pointer']),
      hold:native('il2cpp_gchandle_new','pointer',['pointer','bool']),
      target:native('il2cpp_gchandle_get_target','pointer',['pointer']),
      release:native('il2cpp_gchandle_free','void',['pointer']),
      minder:klass(gameImage,'','PlayerCameraMinder'),refs:klass(gameImage,'','PlayerCameraReferences'),
      cheater:klass(gameImage,'','PlayerCheater'),mover:klass(gameImage,'','CameraCheatMover'),
      camera:klass(coreImage,'UnityEngine','Camera'),behaviour:klass(coreImage,'UnityEngine','Behaviour'),
    };
    function layout(type,name,offset) {
      if(type.isNull())throw Error('Camera type unavailable: '+name);
      const f=fieldFromName(type,Memory.allocUtf8String(name));
      if(f.isNull() || a.offset(f)!==offset)throw Error('Camera layout changed: '+name);
    }
    layout(pcClass,'cameraMinder',0xd0);layout(pcClass,'cheater',0xd8);
    layout(a.minder,'playerCharacter',0x28);layout(a.minder,'zoomLevel',0x34);
    layout(a.minder,'_cameraGuide',0x40);layout(a.minder,'playerCameraReferences',0x68);
    layout(a.refs,'playerCamera',0x20);layout(a.cheater,'playerCharacter',0x10);
    layout(a.cheater,'cameraCheatMover',0x20);layout(a.mover,'pc',0x30);layout(a.mover,'_detached',0x50);
    a.exists=method(objectType,'op_Implicit',1);
    a.instanceId=method(objectType,'GetInstanceID',0);
    a.parent=method(transformType,'get_parent',0);a.setParent=method(transformType,'SetParent',2);
    a.localPosition=method(transformType,'get_localPosition',0);a.setLocalPosition=method(transformType,'set_localPosition',1);
    a.localRotation=method(transformType,'get_localRotation',0);a.setLocalRotation=method(transformType,'set_localRotation',1);
    a.localScale=method(transformType,'get_localScale',0);a.setLocalScale=method(transformType,'set_localScale',1);
    a.position=method(transformType,'get_position',0);a.setPosition=method(transformType,'set_position',1);
    a.rotation=method(transformType,'get_rotation',0);a.setRotation=method(transformType,'set_rotation',1);
    a.forward=method(transformType,'get_forward',0);a.right=method(transformType,'get_right',0);
    a.fieldOfView=method(a.camera,'get_fieldOfView',0);a.enabled=method(a.behaviour,'get_enabled',0);
    a.setEnabled=method(a.behaviour,'set_enabled',1);a.setZoom=method(a.minder,'SetZoom',1);
    api=a;return a;
  }
  function call(mi,obj,values=[]) {return invoke(mi,obj,args(values));}
  function bool(box) {return !box.isNull() && box.add(0x10).readU8()!==0;}
  function alive(obj) {return !obj.isNull() && bool(call(base().exists,ptr(0),[obj]));}
  function instanceId(obj) {const box=call(base().instanceId,obj);if(box.isNull())throw Error('Camera identity unavailable');return box.add(0x10).readS32();}
  function readVector(mi,obj,n=3) {
    const box=call(mi,obj);if(box.isNull())throw Error('Camera transform unavailable');
    const result=Array.from({length:n},(_,i)=>box.add(0x10+i*4).readFloat());
    if(!result.every(Number.isFinite))throw Error('Invalid camera transform');return result;
  }
  function readFloat(mi,obj) {const box=call(mi,obj);if(box.isNull())throw Error('Camera setting unavailable');return box.add(0x10).readFloat();}
  function resolve(req) {
    const a=base(),roster=describePlayers(),owners=roster.filter(p=>p.isLocalPlayer && p.isOwned && p.backrefMatches);
    if(owners.length!==1)throw Error('Waiting for your locally owned character');
    const owner=owners[0],pc=ptr(owner.pc);
    if(req && (req.owner_pc!==owner.pc || req.owner_pn!==owner.pn))throw Error('Your character changed; wait for a fresh snapshot');
    const minder=pc.add(0xd0).readPointer();
    if(minder.isNull() || !a.objectClass(minder).equals(a.minder) || !minder.add(0x28).readPointer().equals(pc))throw Error('Your camera controller is unavailable');
    const refs=minder.add(0x68).readPointer();
    if(!alive(refs) || !a.objectClass(refs).equals(a.refs))throw Error('Your camera references are not loaded');
    const camera=refs.add(0x20).readPointer();
    if(!alive(camera) || !a.objectClass(camera).equals(a.camera) || !bool(call(a.enabled,camera)))throw Error('Your active camera is unavailable');
    const transform=call(getTransform,camera);
    if(!alive(transform))throw Error('Your camera transform is unavailable');
    if(roster.some(p=>p.pc!==owner.pc && ptr(p.pc).add(0xd0).readPointer().equals(minder)))throw Error('Camera controller is shared with another character');
    const key=owner.pc+':'+owner.pn+':'+minder+':'+refs+':'+camera+':'+instanceId(camera);
    const zoom=minder.add(0x34).readFloat(),fov=readFloat(a.fieldOfView,camera);
    if(!Number.isFinite(zoom) || zoom<=0 || zoom>100 || !Number.isFinite(fov) || fov<=0 || fov>=180)throw Error('Your camera zoom state is invalid');
    return {a,owner,pc,minder,refs,camera,transform,key,zoom,fov};
  }
  function freeCapability(info) {
    const a=info.a,guide=info.minder.add(0x40).readPointer();
    if(entry && entry.key!==info.key)throw Error('The active camera changed; restore the previous camera before continuing');
    if(entry && entry.detached) {
      if(!guide.isNull())throw Error('The game reclaimed camera rotation; return the camera before continuing');
      if(!call(a.parent,info.transform).isNull())throw Error('The game reclaimed the camera hierarchy; return the camera before continuing');
      if(entry.photo && entry.photo.mover) {
        const mover=a.target(entry.photo.mover);
        if(!alive(mover) || instanceId(mover)!==entry.photo.moverId || bool(call(a.enabled,mover)))throw Error('The game changed the camera debug controller; return the camera before continuing');
      }
      return;
    }
    if(!guide.isNull() && !alive(guide))throw Error('The current camera guide is no longer loaded');
    const cheater=info.pc.add(0xd8).readPointer();
    if(!cheater.isNull()) {
      if(!a.objectClass(cheater).equals(a.cheater) || !cheater.add(0x10).readPointer().equals(info.pc))throw Error('Your camera debug controller changed');
      const mover=cheater.add(0x20).readPointer();
      if(!mover.isNull()) {
        if(!alive(mover) || !a.objectClass(mover).equals(a.mover) || !mover.add(0x30).readPointer().equals(info.pc))throw Error('Your camera debug component changed');
        if(mover.add(0x50).readU8()!==0)throw Error('The game already has a detached camera; reattach it in the game first');
      }
    }
  }
  function keep(e,object) {
    if(object.isNull())return null;
    const handle=base().hold(object,0);if(handle.isNull())throw Error('Could not retain the camera reference');
    e.handles.push(handle);return handle;
  }
  function ensureEntry(info) {
    if(entry) {if(entry.key!==info.key)throw Error('The active camera changed; restore the previous camera before continuing');return entry;}
    const e={key:info.key,ownerPc:info.owner.pc,ownerPn:info.owner.pn,handles:[],zoomOriginal:info.zoom,
      fovOriginal:info.fov,zoom:1,zoomChanged:false,detached:false,photo:null};
    try {e.camera=keep(e,info.camera);e.minder=keep(e,info.minder);e.transform=keep(e,info.transform);entry=e;return e;}
    catch(error) {e.handles.forEach(h=>base().release(h));throw error;}
  }
  function clearEntry(e) {e.handles.forEach(h=>base().release(h));if(entry===e)entry=null;}
  function discardInactive(info=null) {
    if(!entry)return;
    const e=entry,oldCamera=base().target(e.camera);
    // A destroyed Unity camera has no native hierarchy left to restore. Its managed
    // wrapper can remain alive only because we retained it; release those roots.
    if(!alive(oldCamera)) {clearEntry(e);return;}
    if(info && info.key!==e.key && !e.detached) {
      const originalStillOwned=describePlayers().some(p=>p.pc===e.ownerPc && p.pn===e.ownerPn && p.isLocalPlayer && p.isOwned && p.backrefMatches);
      // Do not write an old controller after respawn. An alive detached camera,
      // however, still has a restoration obligation and must remain visible.
      if(!originalStillOwned)clearEntry(e);
    }
  }
  function checkEntry(info,e) {
    if(info.key!==e.key || !base().target(e.camera).equals(info.camera) || !base().target(e.minder).equals(info.minder) || !base().target(e.transform).equals(info.transform))throw Error('The original camera identity is no longer active');
  }
  function detach(info) {
    freeCapability(info);const e=ensureEntry(info);checkEntry(info,e);if(e.detached)return;
    const a=info.a,parent=call(a.parent,info.transform),guide=info.minder.add(0x40).readPointer(),handleStart=e.handles.length;
    const photo={handleStart,parent:keep(e,parent),guide:keep(e,guide),localPosition:readVector(a.localPosition,info.transform),
      localRotation:readVector(a.localRotation,info.transform,4),localScale:readVector(a.localScale,info.transform),
      parentId:parent.isNull()?null:instanceId(parent),guideId:guide.isNull()?null:instanceId(guide),mover:null,moverId:null,moverEnabled:false};
    const cheater=info.pc.add(0xd8).readPointer();
    if(!cheater.isNull()) {
      const mover=cheater.add(0x20).readPointer();
      if(!mover.isNull()) {photo.mover=keep(e,mover);photo.moverId=instanceId(mover);photo.moverEnabled=bool(call(a.enabled,mover));}
    }
    // Store the restore record before making the first mutation, including partial-failure recovery.
    e.photo=photo;e.detached=true;
    try {
      if(photo.moverEnabled)call(a.setEnabled,a.target(photo.mover),[scalar(false,true)]);
      // Update reads this guide only to own rotation; a null guide leaves the camera alone.
      a.setReference(info.minder,info.minder.add(0x40),ptr(0));
      call(a.setParent,info.transform,[ptr(0),scalar(true,true)]);
      freeCapability(info);
    } catch(error) {
      let restore='';try {returnCamera(info,e);}catch(failure){restore='; restore failed: '+failure;}
      throw Error('Camera detach failed: '+error+restore);
    }
  }
  function returnCamera(info,e) {
    checkEntry(info,e);if(!e.detached || !e.photo)return;
    const a=info.a,p=e.photo,parent=p.parent?a.target(p.parent):ptr(0),guide=p.guide?a.target(p.guide):ptr(0);
    if(p.parent && (!alive(parent) || instanceId(parent)!==p.parentId))throw Error('The original camera parent is no longer loaded');
    if(p.guide && (!alive(guide) || instanceId(guide)!==p.guideId))throw Error('The original camera guide is no longer loaded');
    const currentParent=call(a.parent,info.transform),currentGuide=info.minder.add(0x40).readPointer();
    if(!currentParent.isNull() && !currentParent.equals(parent))throw Error('The camera was reparented by the game; refusing to overwrite its new hierarchy');
    if(!currentGuide.isNull() && !currentGuide.equals(guide))throw Error('The camera guide changed; refusing to overwrite its new controller');
    call(a.setParent,info.transform,[parent,scalar(false,true)]);
    call(a.setLocalPosition,info.transform,[vector(p.localPosition)]);
    call(a.setLocalRotation,info.transform,[vector(p.localRotation)]);
    call(a.setLocalScale,info.transform,[vector(p.localScale)]);
    a.setReference(info.minder,info.minder.add(0x40),guide);
    if(p.mover) {
      const mover=a.target(p.mover);
      if(!alive(mover) || instanceId(mover)!==p.moverId || !a.objectClass(mover).equals(a.mover) || !mover.add(0x30).readPointer().equals(info.pc))throw Error('The original camera debug component is no longer loaded');
      if(p.moverEnabled)call(a.setEnabled,mover,[scalar(true,true)]);
    }
    e.detached=false;e.photo=null;
    e.handles.splice(p.handleStart).forEach(h=>a.release(h));
  }
  function apply(req) {
    discardInactive();const info=resolve(req),a=info.a;discardInactive(info);
    if(req.action==='camera_zoom') {
      const multiplier=req.zoom;
      if(typeof multiplier!=='number' || !Number.isFinite(multiplier) || multiplier<0.25 || multiplier>8)throw Error('Camera zoom must be between 0.25 and 8');
      const e=ensureEntry(info);checkEntry(info,e);
      // The native Update uses 60 * zoomLevel, except exactly 1 follows the settings FOV.
      // Keep normal exactly at its captured native value and avoid that special case elsewhere.
      const fov=Math.max(5,Math.min(170,e.fovOriginal/multiplier));
      let value=multiplier===1?e.zoomOriginal:fov/60;
      if(multiplier!==1 && Math.abs(value-1)<0.000001)value=1.000001;
      // Mark first so native partial exceptions still leave a restore attempt pending.
      e.zoomChanged=true;call(a.setZoom,info.minder,[scalar(value)]);e.zoom=multiplier;
      if(multiplier===1)e.zoomChanged=false;
      if(!e.zoomChanged && !e.detached)clearEntry(e);
      return {zoom:multiplier,field_of_view:multiplier===1?e.fovOriginal:fov};
    }
    if(req.action==='camera_detach') {detach(info);return {detached:true};}
    if(req.action==='camera_return') {
      if(entry) {returnCamera(info,entry);if(!entry.zoomChanged)clearEntry(entry);}
      return {detached:false};
    }
    if(req.action==='camera_move') {
      if(!entry || !entry.detached)throw Error('Detach the camera before moving it');
      checkEntry(info,entry);freeCapability(info);
      const step=req.step===undefined?1:req.step,direction=req.direction;
      if(typeof step!=='number' || !Number.isFinite(step) || step<0.25 || step>20)throw Error('Camera move step must be between 0.25 and 20 metres');
      let axis;
      if(direction==='forward' || direction==='back')axis=readVector(a.forward,info.transform).map(v=>v*(direction==='back'?-1:1));
      else if(direction==='left' || direction==='right')axis=readVector(a.right,info.transform).map(v=>v*(direction==='left'?-1:1));
      else if(direction==='up' || direction==='down')axis=[0,direction==='up'?1:-1,0];
      else throw Error('Unsupported camera direction');
      const destination=readVector(a.position,info.transform).map((v,i)=>v+axis[i]*step);
      if(!destination.every(v=>Number.isFinite(v) && Math.abs(v)<=10000))throw Error('Camera destination is outside the supported world bounds');
      call(a.setPosition,info.transform,[vector(destination)]);return {detached:true,position:readVector(a.position,info.transform)};
    }
    if(req.action==='camera_turn') {
      if(!entry || !entry.detached)throw Error('Detach the camera before turning it');
      checkEntry(info,entry);freeCapability(info);
      const degrees=req.degrees===undefined?15:req.degrees,direction=req.direction;
      if(typeof degrees!=='number' || !Number.isFinite(degrees) || degrees<0.25 || degrees>45)throw Error('Camera turn angle must be between 0.25 and 45 degrees');
      let rotation=readVector(a.rotation,info.transform,4);
      function multiply(q,r) {
        const [x,y,z,w]=q,[X,Y,Z,W]=r;
        return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
      }
      if(direction==='left' || direction==='right') {
        const angle=degrees*(direction==='left'?-1:1)*Math.PI/360;
        rotation=multiply([0,Math.sin(angle),0,Math.cos(angle)],rotation);
      } else if(direction==='up' || direction==='down') {
        const forward=readVector(a.forward,info.transform),pitch=Math.asin(Math.max(-1,Math.min(1,forward[1])))*180/Math.PI;
        const target=Math.max(-85,Math.min(85,pitch+degrees*(direction==='up'?1:-1))),angle=-(target-pitch)*Math.PI/360;
        rotation=multiply(rotation,[Math.sin(angle),0,0,Math.cos(angle)]);
      } else throw Error('Unsupported camera turn direction');
      const length=Math.hypot(...rotation);
      if(!Number.isFinite(length) || length<0.0001)throw Error('Camera rotation is invalid');
      rotation=rotation.map(v=>v/length);
      call(a.setRotation,info.transform,[vector(rotation)]);
      return {detached:true,rotation:readVector(a.rotation,info.transform,4)};
    }
    throw Error('Unsupported camera action');
  }
  function snapshot() {
    const out={available:false,reason:'',zoom:entry?entry.zoom:1,detached:!!(entry && entry.detached),
      free_available:false,free_reason:'',speed:1};
    try {
      discardInactive();const info=resolve();discardInactive(info);
      out.zoom=entry?entry.zoom:1;out.detached=!!(entry && entry.detached);
      if(entry)checkEntry(info,entry);
      out.available=true;out.field_of_view=info.fov;out.position=readVector(info.a.position,info.transform);
      try {freeCapability(info);out.free_available=true;}catch(error){out.free_reason=String(error);}
    } catch(error) {out.reason=String(error);out.free_reason=out.reason;}
    out.zoom=entry?entry.zoom:1;out.detached=!!(entry && entry.detached);
    return out;
  }
  function restoreAll() {
    discardInactive();
    if(!entry)return;
    const info=resolve();discardInactive(info);if(!entry)return;
    const e=entry;checkEntry(info,e);
    returnCamera(info,e);
    if(e.zoomChanged) {call(info.a.setZoom,info.minder,[scalar(e.zoomOriginal)]);e.zoomChanged=false;e.zoom=1;}
    clearEntry(e);
  }
  function placementFacing(owner) {
    const info=resolve({owner_pc:owner.pc,owner_pn:owner.pn});
    if(entry && entry.detached) throw Error('Return the camera before placing bowling pins.');
    if(entry) checkEntry(info,entry);
    const forward=readVector(info.a.forward,info.transform);
    let length=Math.hypot(forward[0],forward[2]);
    if(length>=0.001) return [forward[0]/length,0,forward[2]/length];
    // Looking straight up/down still has a horizontal heading from camera right.
    const right=readVector(info.a.right,info.transform);
    length=Math.hypot(right[0],right[2]);
    if(length<0.001) throw Error('Your facing direction is unavailable');
    return [-right[2]/length,0,right[0]/length];
  }
  return {snapshot,apply,hasChanges:()=>entry!==null,restoreAll,placementFacing};
})();

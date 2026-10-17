// Saved locations move only the validated, locally owned character.
const locationTools = (() => {
  const build='df3f2da21746121cfa3e1936615082492aed0b4df8d6af14fb70d960d035c478';
  let getRotation=null, returnPoint=null;
  function args(values) {
    const out=Memory.alloc(Math.max(values.length,1)*Process.pointerSize);
    values.forEach((value,i)=>out.add(i*Process.pointerSize).writePointer(value));
    return out;
  }
  function vector(values,n,limit) {
    if(!Array.isArray(values) || values.length!==n || !values.every(v=>typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=limit)) throw Error('Saved location has invalid coordinates');
    return values.slice();
  }
  function rotation(values) {
    const q=vector(values,4,2), magnitude=Math.hypot(...q);
    if(magnitude<0.5 || magnitude>2) throw Error('Saved location has an invalid rotation');
    return q.map(v=>v/magnitude);
  }
  function readLocation(owner,label='') {
    const pc=ptr(owner.pc), at=position(pc);
    if(!at) throw Error('Your position is unavailable');
    if(!getRotation) getRotation=method(transformType,'get_rotation',0);
    const transform=invoke(getTransform,pc);
    if(transform.isNull()) throw Error('Your transform is unavailable');
    const boxed=invoke(getRotation,transform);
    if(boxed.isNull()) throw Error('Your rotation is unavailable');
    const facing=rotation([0,1,2,3].map(i=>boxed.add(0x10+i*4).readFloat()));
    return {label:typeof label==='string'?label.trim().slice(0,64):'',position:vector(at,3,10000),rotation:facing,build};
  }
  function validReturn(owner) {
    return returnPoint && returnPoint.pc===owner.pc && returnPoint.pn===owner.pn;
  }
  function snapshot() {
    const owners=safe(()=>describePlayers().filter(p=>p.isLocalPlayer && p.isOwned && p.backrefMatches),[]);
    const can=owners.length===1 && !!validReturn(owners[0]);
    return {build,can_return:can,reason:can?'':'Teleport somewhere to create a return point.'};
  }
  function teleportTo(owner,at,facing=null) {
    if(cameraTools.snapshot().detached) throw Error('Return the camera before teleporting your character.');
    const destination=vector(at,3,10000), before=readLocation(owner);
    const q=facing?rotation(facing):before.rotation;
    const pc=ptr(owner.pc), grease=pc.add(0x100).readPointer();
    if(grease.isNull() || !grease.add(0x10).readPointer().equals(pc)) throw Error('Your movement controller changed');
    const vec=Memory.alloc(12),rot=Memory.alloc(16),preserve=Memory.alloc(1);
    destination.forEach((v,i)=>vec.add(i*4).writeFloat(v));
    q.forEach((v,i)=>rot.add(i*4).writeFloat(v));
    preserve.writeU8(facing?0:1);
    invoke(teleport,grease,args([vec,rot,preserve]));
    // Record only after the native call returns, without claiming peer receipt.
    returnPoint={...before,pc:owner.pc,pn:owner.pn};
    return {message:'Teleport returned.',before:before.position,destination,after:position(pc)};
  }
  function apply(req,owner) {
    if(req.action==='location_capture') {
      if(cameraTools.snapshot().detached) throw Error('Return the camera before saving a character location.');
      return {message:'Location captured.',location:readLocation(owner,req.label)};
    }
    if(req.action==='teleport_back') {
      if(!validReturn(owner)) throw Error('No return point for your current character.');
      return teleportTo(owner,returnPoint.position,returnPoint.rotation);
    }
    if(req.action==='location_teleport') {
      const spot=req.location;
      if(!spot || spot.build!==build) throw Error('This location belongs to a different game build.');
      return teleportTo(owner,spot.position,spot.rotation);
    }
    throw Error('Unknown location action');
  }
  return {build,snapshot,apply,teleportTo};
})();

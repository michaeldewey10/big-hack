// Build-specific IL2CPP fields. Loaded after the existing audited helper.JS.
let coreImage = ptr(0);
for (let i = 0; i < assemblyCount; i++) {
  const image = assemblyGetImage(assemblies.add(i * Process.pointerSize).readPointer());
  if (imageGetName(image).readCString() === 'UnityEngine.CoreModule.dll') coreImage = image;
}
if (coreImage.isNull()) throw Error('Unity CoreModule unavailable');
function klass(image, ns, name) { return classFromName(image, Memory.allocUtf8String(ns), Memory.allocUtf8String(name)); }
function method(type, name, count) {
  if (type.isNull()) throw Error('Missing class for ' + name);
  const result = methodFromName(type, Memory.allocUtf8String(name), count);
  if (result.isNull()) throw Error('Missing method ' + name);
  return result;
}
const objectType = klass(coreImage, 'UnityEngine', 'Object');
const componentType = klass(coreImage, 'UnityEngine', 'Component');
const transformType = klass(coreImage, 'UnityEngine', 'Transform');
const propType = klass(gameImage, '', 'Prop');
const greaseType = klass(gameImage, '', 'PlayerGrease');
const propsField = fieldFromName(propType, Memory.allocUtf8String('allProps'));
if (propsField.isNull()) throw Error('Prop.allProps unavailable');
const getName = method(objectType, 'get_name', 0);
const getTransform = method(componentType, 'get_transform', 0);
const getPosition = method(transformType, 'get_position', 0);
const teleport = method(greaseType, 'Teleport', 3);
const pickItem = method(pnClass, 'CmdPickUp', 1);
const pickPlayer = new NativeFunction(cmdAddress, 'void', ['pointer', 'pointer', 'pointer'], 'win64');
function invoke(mi, instance, params) {
  const exception = Memory.alloc(Process.pointerSize);
  exception.writePointer(ptr(0));
  const value = runtimeInvoke(mi, instance, params || ptr(0), exception);
  if (!exception.readPointer().isNull()) throw Error('Managed method raised an exception');
  return value;
}
function objectName(obj) { return readString(invoke(getName, obj), 256) || 'Unnamed item'; }
function position(obj) {
  const transform = invoke(getTransform, obj);
  if (transform.isNull()) return null;
  const box = invoke(getPosition, transform);
  if (box.isNull()) return null;
  const p = [box.add(0x10).readFloat(), box.add(0x14).readFloat(), box.add(0x18).readFloat()];
  return p.every(Number.isFinite) ? p : null;
}
function distance(a, b) { return a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : null; }
function safe(fn, fallback = null) { try { return fn(); } catch (_) { return fallback; } }
function through(pc, offsets) {
  let p = pc;
  for (const off of offsets) { if (p.isNull()) return ptr(0); p = p.add(off).readPointer(); }
  return p;
}
function propList() {
  const out = Memory.alloc(Process.pointerSize);
  fieldStaticGet(propsField, out);
  const list = out.readPointer();
  if (list.isNull()) return [];
  const n = list.add(0x18).readS32(), array = list.add(0x10).readPointer();
  if (n < 0 || n > 4096 || array.isNull() || array.add(0x18).readU32() < n) throw Error('Unexpected prop list');
  const result = [];
  for (let i = 0; i < n; i++) {
    const p = array.add(0x20 + i * Process.pointerSize).readPointer();
    if (!p.isNull()) result.push({p, index:i});
  }
  return result;
}
let items = [], itemsAt = 0, lastTick = 0, sequence = 0, queued = null, names = new Map();
function scanItems(now) {
  const updated = [];
  const present = new Set();
  for (const entry of propList()) {
    safe(() => {
      const p = entry.p, identity = p.add(0x2d8).readPointer();
      if (identity.isNull()) return;
      const key = p.toString() + ':' + identity.toString();
      present.add(key);
      let name = names.get(key);
      if (!name) { name = objectName(p); names.set(key, name); }
      updated.push({key, index:entry.index, pointer:p.toString(), identity:identity.toString(),
        net_id:identity.add(0x30).readU32(), name, position:position(p),
        holder_pc:p.add(0x2c0).readPointer().toString(), in_inventory:p.add(0x338).readU8() !== 0});
    });
  }
  for (const key of names.keys()) if (!present.has(key)) names.delete(key);
  items = updated; itemsAt = now;
}
function readPlayers(roster) {
  return roster.filter(p => p.backrefMatches).map(p => {
    const pc = ptr(p.pc), pn = ptr(p.pn), identity = pn.add(0x40).readPointer();
    const bool = off => pn.add(off).readU8() !== 0;
    const held = pn.add(0x88).readPointer();
    const heldItem = items.find(item => item.identity === held.toString());
    const carried = safe(() => through(pc, [0xf0, 0x18, 0x150]).toString(), '0x0');
    const carrier = safe(() => through(pc, [0xa0, 0x18, 0x158]).toString(), '0x0');
    return {...p, key:p.pc + ':' + p.pn, position:safe(() => position(pc)),
      // The field called username is an account identifier in this build.
      // describePlayers reads moderationName, which contains the visible name.
      name:typeof p.name === 'string' && p.name.trim() ? p.name.trim() : (p.isLocalPlayer ? 'You' : 'Player #' + (identity.isNull() ? '?' : identity.add(0x30).readU32())),
      moderation_name:p.name, identity:identity.toString(), net_id:identity.isNull() ? 0 : identity.add(0x30).readU32(),
      is_local:p.isLocalPlayer, is_owned:p.isOwned, is_host:bool(0x128),
      crouchness:pn.add(0xd0).readFloat(), sitting:bool(0x14b), sleeping:bool(0x148),
      menu_open:bool(0x149), muted:bool(0x14a), text_chatting:bool(0x14c), ghost:bool(0xec),
      left_wave:bool(0xd4), right_wave:bool(0xd5), left_point:bool(0xd6), right_point:bool(0xd7),
      controls_velocity:p.controlsVelocity && p.controlsVelocity.every(Number.isFinite) ? p.controlsVelocity : null, held_identity:held.toString(),
      held_item:heldItem ? heldItem.name : (!held.isNull() ? 'Unknown prop' : null),
      held_player_pc:carried, held_by_pc:carrier};
  });
}
function validateOwner(req, roster) {
  const found = roster.filter(p => p.pc === req.owner_pc && p.pn === req.owner_pn && p.isLocalPlayer && p.isOwned && p.backrefMatches);
  if (found.length !== 1) throw Error('Local player changed; waiting for a fresh snapshot');
  return found[0];
}
function perform(req) {
  const roster = describePlayers();
  const owner = validateOwner(req, roster), pc = ptr(owner.pc), pn = ptr(owner.pn);
  if (req.target_kind === 'self') return youSettings.apply(req);
  if (req.target_kind === 'tools') return characterTools.apply(req);
  if (req.target_kind === 'pocket') {
    if(characterTools.hasChanges()) throw Error('Release Use before changing equipment or storage.');
    return pocketTools.apply(req);
  }
  if (req.target_kind === 'camera') return {message:'Camera action returned.',...cameraTools.apply(req)};
  if (req.target_kind === 'location') return locationTools.apply(req,owner);
  if (req.target_kind === 'fun' && ['flare_auto','flare_auto_off'].includes(req.action)) return flareTools.start(req,owner);
  if (req.target_kind === 'fun') return bigFun.start(req,owner,roster);
  let targetPosition, label;
  if (req.target_kind === 'player') {
    const targets = roster.filter(p => p.pc === req.target_pc && p.pn === req.target_pn && p.backrefMatches && !p.isLocalPlayer);
    if (targets.length !== 1) throw Error('Selected player is no longer in the party');
    const target = targets[0];
    if (target.name !== req.target_moderation_name) throw Error('Selected player identity changed');
    label = req.target_name;
    if (req.action === 'pickup') {
      if (!pn.add(0x88).readPointer().isNull() || !through(pc, [0xf0, 0x18, 0x150]).isNull()) throw Error('Your hands are occupied; drop what you are carrying first');
      pickPlayer(pn, ptr(target.pc), cmdMethod);
      return {message:'Pickup wrapper returned for ' + label + '. Check the game for the result.'};
    }
    targetPosition = position(ptr(target.pc));
  } else if (req.target_kind === 'item') {
    const found = propList().filter(entry => entry.index === req.item_index && entry.p.toString() === req.item_pointer);
    if (found.length !== 1) throw Error('Selected item changed or unloaded');
    const prop = found[0].p;
    if (prop.add(0x2d8).readPointer().toString() !== req.item_identity || objectName(prop) !== req.item_name) throw Error('Selected item identity changed');
    label = req.item_name;
    if (req.action === 'pickup') {
      if (!pn.add(0x88).readPointer().isNull() || !through(pc, [0xf0, 0x18, 0x150]).isNull()) throw Error('Your hands are occupied; drop what you are carrying first');
      if (!prop.add(0x2c0).readPointer().isNull()) throw Error('This item is already held by a player');
      const held = Memory.alloc(0x38); held.writeByteArray(new Array(0x38).fill(0));
      held.writePointer(ptr(req.item_identity)); held.add(8).writeS32(1); held.add(0x2c).writeFloat(1);
      const params = Memory.alloc(Process.pointerSize); params.writePointer(held);
      invoke(pickItem, pn, params);
      return {message:'Pickup wrapper returned for ' + label + '. Check the game for the result.'};
    }
    targetPosition = position(prop);
  } else throw Error('Unsupported selected target');
  if (req.action !== 'teleport') throw Error('Unsupported action');
  const before = position(pc);
  if (!before || !targetPosition) throw Error('Current destination is unavailable');
  const dx = before[0]-targetPosition[0], dz = before[2]-targetPosition[2], h = Math.hypot(dx,dz);
  const destination = [targetPosition[0] + (h > 0.01 ? 1.5*dx/h : 1.5), targetPosition[1]+1, targetPosition[2] + (h > 0.01 ? 1.5*dz/h : 0)];
  if (!destination.every(v => Number.isFinite(v) && Math.abs(v) <= 10000)) throw Error('Destination is outside the supported world bounds');
  return locationTools.teleportTo(owner,destination);
}
rpc.exports.enqueue = function(req) {
  if (queued || bigFun.busy() || pocketTools.busy() || flareTools.busy()) return {ok:false, reason:'Another action is still running'};
  const characterAction=req && req.target_kind==='self' && ['settings_set','settings_toggle','settings_restore','settings_preset'].includes(req.action);
  const targetAction=req && ['player','item'].includes(req.target_kind) && ['pickup','teleport'].includes(req.action);
  const funAction=req && req.target_kind==='fun' && ['spawn_corpses','spawn_corpse_pins','clear_corpses','grab_all_items','gather_party','flare_auto','flare_auto_off'].includes(req.action);
  const toolsAction=req && req.target_kind==='tools' && ['appearance_set','appearance_randomize','held_use','held_release','held_drop'].includes(req.action);
  const cameraAction=req && req.target_kind==='camera' && ['camera_zoom','camera_detach','camera_return','camera_move','camera_turn'].includes(req.action);
  const locationAction=req && req.target_kind==='location' && ['teleport_back','location_capture','location_teleport'].includes(req.action);
  const pocketAction=req && req.target_kind==='pocket' && ['pocket_equip','pocket_equip_nearest','pocket_store','pocket_take','pocket_unequip'].includes(req.action);
  if ((!characterAction && !targetAction && !funAction && !toolsAction && !cameraAction && !locationAction && !pocketAction) || typeof req.request_id !== 'string') return {ok:false, reason:'Unsupported action request'};
  validateOwner(req, describePlayers());
  queued = req;
  return {ok:true};
};
rpc.exports.heldHeartbeat = function(req) {return characterTools.keepAlive(req);};
rpc.exports.cancelPending = function(id) {
  const queuedCancelled=!!(queued && queued.request_id===id);
  if(queuedCancelled) queued=null;
  bigFun.cancel(id);pocketTools.cancel(id);flareTools.cancel(id);return {queued_cancelled:queuedCancelled,running:bigFun.busy() || pocketTools.busy() || flareTools.busy()};
};
let restoreSettingsOnUpdate=false;
rpc.exports.prepareDetach = function() {
  queued=null;
  bigFun.cancel();
  pocketTools.cancel();
  flareTools.cancel();
  restoreSettingsOnUpdate=flareTools.hasChanges() || youSettings.hasChanges() || bigFun.needsCleanup() || characterTools.hasChanges() || cameraTools.hasChanges() || pocketTools.needsCleanup();
  return {pending:restoreSettingsOnUpdate};
};
const telemetryListener = Interceptor.attach(updateAddress, {onEnter(args) {
  const now = Date.now();
  if (!restoreSettingsOnUpdate) flareTools.fire(args[0], now);
  if (!queued && !restoreSettingsOnUpdate && !bigFun.busy() && !pocketTools.busy() && !flareTools.busy() && now-lastTick < 200) return;
  const roster = safe(() => describePlayers(), []);
  const owners = roster.filter(p => p.isLocalPlayer && p.isOwned && p.backrefMatches);
  if (owners.length !== 1 || !args[0].equals(ptr(owners[0].pc))) return;
  if(restoreSettingsOnUpdate) {
    try {
      if(!bigFun.stop()) return;
      if(!pocketTools.stop()) return;
      restoreSettingsOnUpdate=false;
      const restoreErrors=[];
      for(const restore of [()=>flareTools.restoreAll(),()=>characterTools.restoreAll(),()=>cameraTools.restoreAll(),()=>youSettings.restoreAll()]) {
        try {restore();} catch(error) {restoreErrors.push(String(error));}
      }
      if(restoreErrors.length) throw Error(restoreErrors.join('; '));
      send({type:'settings_restored',ok:true});
    }
    catch(error) {restoreSettingsOnUpdate=false;send({type:'settings_restored',ok:false,message:String(error)});}
  }
  if (queued) {
    const req = queued; queued = null;
    try { const result=perform(req);if(result!==null) send({type:'action_result', request_id:req.request_id, ok:true, ...result}); }
    catch (error) { send({type:'action_result', request_id:req.request_id, ok:false, message:String(error)}); }
  }
  bigFun.tick(now);
  pocketTools.tick(now);
  flareTools.tick(now);
  characterTools.tick(now);
  if (now-lastTick < 200) return;
  lastTick = now;
  try {
    if (now-itemsAt > 1000) scanItems(now);
    const players = readPlayers(roster), owner = players.find(p => p.is_local && p.is_owned);
    if (!owner) return;
    for (const player of players) player.distance = distance(player.position, owner.position);
    const liveItems = items.map(item => ({...item, distance:distance(item.position, owner.position)}));
    const tools=characterTools.snapshot(owner),pockets=pocketTools.snapshot(owner);
    tools.pockets=pockets.pockets;tools.pockets_reason=pockets.reason;
    send({type:'snapshot', sequence:++sequence, sampled_at_ms:now, items_at_ms:itemsAt,
      owner_pc:owner.pc, owner_pn:owner.pn, players, items:liveItems, build:locationTools.build,
      character_settings:youSettings.snapshot(),fun:{...bigFun.capabilities(owner,roster),flare:flareTools.capability(owner)},
      tools,camera:cameraTools.snapshot(),location:locationTools.snapshot()});
  } catch (error) { send({type:'telemetry_error', message:String(error)}); }
}});

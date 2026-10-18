// Flare gun full auto. Called only on the locally owned Unity Update.
// The flare gun's OnReloadedSwitch carries a PeckEffectBlockSwitch that blocks
// its OnClickSwitch (Prop.useHeldSwitch) while the gun is in its fired state,
// until a 20-second PeckEffectTimer reloads it. Arming clears that block on the
// armed gun only; the original values are restored on disarm, drop or detach.
const flareTools = (() => {
  const shotIntervalMs = 120;
  let api = null, apiError = '', job = null, armed = null, triggerDown = false, lastShot = 0;
  function load() {
    if (api) return api;
    if (apiError) throw Error(apiError);
    try {
      const offset = new NativeFunction(exp('il2cpp_field_get_offset'), 'int', ['pointer']);
      const checked = (type, name, expected) => {
        const field = type.isNull() ? ptr(0) : fieldFromName(type, Memory.allocUtf8String(name));
        if (field.isNull() || offset(field) !== expected) throw Error('Flare gun layout changed: ' + name);
      };
      const hands = klass(gameImage, '', 'PlayerHands'), actions = klass(gameImage, '', 'PlayerActions');
      const blocker = klass(gameImage, '', 'PeckEffectBlockSwitch'), peckSwitch = klass(gameImage, '', 'PeckSwitch');
      checked(pcClass, 'hands', 0x68); checked(pcClass, 'actions', 0x120);
      checked(hands, 'playerCharacter', 0x28); checked(hands, 'heldProp', 0x38);
      checked(actions, 'playerCharacter', 0x18);
      checked(pnClass, 'playerHeldInformation', 0x88); checked(pnClass, 'isGhost', 0xec); checked(pnClass, 'isSleeping', 0x148);
      checked(propType, 'useHeldSwitch', 0x228); checked(propType, 'exclusiveHolder', 0x2c0);
      checked(propType, 'networkIdentity', 0x2d8); checked(propType, '_isInInventory', 0x338);
      checked(blocker, 'target', 0x48); checked(blocker, 'blockedPerState', 0x50); checked(blocker, 'isBlocking', 0x58);
      const gameObjectType = klass(coreImage, 'UnityEngine', 'GameObject'), cursor = klass(coreImage, 'UnityEngine', 'Cursor');
      const methods = new NativeFunction(exp('il2cpp_class_get_methods'), 'pointer', ['pointer', 'pointer']);
      const methodName = new NativeFunction(exp('il2cpp_method_get_name'), 'pointer', ['pointer']);
      const paramCount = new NativeFunction(exp('il2cpp_method_get_param_count'), 'uint', ['pointer']);
      const param = new NativeFunction(exp('il2cpp_method_get_param'), 'pointer', ['pointer', 'uint']);
      const typeName = new NativeFunction(exp('il2cpp_type_get_name'), 'pointer', ['pointer']);
      const generic = new NativeFunction(exp('il2cpp_method_is_generic'), 'bool', ['pointer']);
      const exact = (type, name, types) => {
        const iterator = Memory.alloc(Process.pointerSize); iterator.writePointer(ptr(0));
        for (let mi = methods(type, iterator); !mi.isNull(); mi = methods(type, iterator)) {
          if (methodName(mi).readCString() !== name || paramCount(mi) !== types.length || generic(mi)) continue;
          if (types.every((t, i) => typeName(param(mi, i)).readCString() === t)) return mi;
        }
        throw Error('Missing exact signature: ' + name);
      };
      const classType = new NativeFunction(exp('il2cpp_class_get_type'), 'pointer', ['pointer']);
      const typeObject = new NativeFunction(exp('il2cpp_type_get_object'), 'pointer', ['pointer']);
      const pickup = method(actions, 'ActionPickUpProp', 2), safeMethod = method(hands, 'IsSafeToPickUp', 1);
      const user32 = Process.getModuleByName('user32.dll');
      const user = name => user32.getExportByName(name);
      api = {
        blockerType: typeObject(classType(blocker)),
        objectClass: new NativeFunction(exp('il2cpp_object_get_class'), 'pointer', ['pointer']),
        blockerClass: blocker, switchClass: peckSwitch,
        gameObject: method(componentType, 'get_gameObject', 0),
        components: exact(gameObjectType, 'GetComponentsInChildren', ['System.Type', 'System.Boolean']),
        lockState: method(cursor, 'get_lockState', 0),
        notBlocked: method(peckSwitch, 'get_isNotBlocked', 0),
        use: method(actions, 'ActionUseHeldSwitch', 0),
        pickup, callPickup: new NativeFunction(pickup.readPointer(), 'void', ['pointer', 'pointer', 'pointer', 'pointer']),
        safe: safeMethod, callSafe: new NativeFunction(safeMethod.readPointer(), 'bool', ['pointer', 'pointer', 'pointer']),
        keyState: new NativeFunction(user('GetAsyncKeyState'), 'int16', ['int']),
        foreground: new NativeFunction(user('GetForegroundWindow'), 'pointer', []),
        windowProcess: new NativeFunction(user('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']),
      };
      return api;
    } catch (error) { apiError = String(error); throw error; }
  }
  function isFlareGun(name) { return typeof name === 'string' && /^FlareGunProp/.test(name); }
  function controls(owner) {
    const pc = ptr(owner.pc), hands = pc.add(0x68).readPointer(), actions = pc.add(0x120).readPointer();
    if (hands.isNull() || actions.isNull() || !hands.add(0x28).readPointer().equals(pc) || !actions.add(0x18).readPointer().equals(pc)) throw Error('Your item controls changed');
    return {hands, actions};
  }
  function heldProp(owner) { return controls(owner).hands.add(0x38).readPointer(); }
  function owns(owner, prop, identity) {
    return heldProp(owner).equals(prop) && ptr(owner.pn).add(0x88).readPointer().equals(identity) && prop.add(0x2c0).readPointer().equals(ptr(owner.pc));
  }
  function loaded(pointer, identity) {
    const entry = propList().find(e => e.p.toString() === pointer);
    return entry && entry.p.add(0x2d8).readPointer().toString() === identity ? entry.p : null;
  }
  function nearest(owner) {
    const at = position(ptr(owner.pc));
    if (!at) return null;
    let best = null;
    for (const item of items) {
      if (!isFlareGun(item.name) || item.holder_pc !== '0x0' || item.in_inventory || !item.position) continue;
      const d = distance(item.position, at);
      if (d !== null && (!best || d < best.distance)) best = {...item, distance: d};
    }
    return best;
  }
  function arm(owner, prop) {
    const a = load(), identity = prop.add(0x2d8).readPointer(), trigger = prop.add(0x228).readPointer();
    if (trigger.isNull() || !a.objectClass(trigger).equals(a.switchClass)) throw Error('This flare gun has no trigger switch');
    const go = invoke(a.gameObject, prop);
    const include = Memory.alloc(4); include.writeU8(1);
    const args = Memory.alloc(2 * Process.pointerSize); args.writePointer(a.blockerType); args.add(Process.pointerSize).writePointer(include);
    const array = invoke(a.components, go, args), changes = [];
    const count = array.isNull() ? 0 : array.add(0x18).readS32();
    if (count < 0 || count > 64) throw Error('Unexpected flare gun component list');
    for (let i = 0; i < count; i++) {
      const blocker = array.add(0x20 + i * Process.pointerSize).readPointer();
      if (blocker.isNull() || !a.objectClass(blocker).equals(a.blockerClass) || !blocker.add(0x48).readPointer().equals(trigger)) continue;
      const states = blocker.add(0x50).readPointer(), n = states.isNull() ? 0 : states.add(0x18).readS32();
      if (n < 0 || n > 16) throw Error('Unexpected flare gun block states');
      for (let s = 0; s < n; s++) {
        const at = states.add(0x20 + s);
        if (at.readU8()) { changes.push({at, value: 1}); at.writeU8(0); }
      }
      const blocking = blocker.add(0x58);
      if (blocking.readU8()) { changes.push({at: blocking, value: 1}); blocking.writeU8(0); }
    }
    if (!changes.length) throw Error('This flare gun has no cooldown block to remove');
    armed = {pc: owner.pc, pointer: prop.toString(), identity: identity.toString(), name: objectName(prop), changes};
    triggerDown = false;
    return armed.name;
  }
  function disarm() {
    if (!armed) return;
    const current = armed; armed = null; triggerDown = false;
    // Only write back while the same prop is still loaded; its arrays live with it.
    if (loaded(current.pointer, current.identity)) for (const change of current.changes) change.at.writeU8(change.value);
  }
  function triggerHeld(a) {
    if (!(a.keyState(0x01) & 0x8000)) return false; // VK_LBUTTON
    const pid = Memory.alloc(4); pid.writeU32(0);
    a.windowProcess(a.foreground(), pid);
    if (pid.readU32() !== Process.id) return false;
    const mode = invoke(a.lockState, ptr(0));
    return !mode.isNull() && mode.add(0x10).readS32() === 1; // CursorLockMode.Locked: in gameplay, not a menu.
  }
  // Runs on every Update before telemetry throttling, so it must stay cheap.
  function fire(pc, now) {
    if (!armed || !pc.equals(ptr(armed.pc))) return;
    try {
      const a = load(), roster = describePlayers();
      const owner = roster.find(p => p.pc === armed.pc && p.isLocalPlayer && p.isOwned && p.backrefMatches);
      const prop = loaded(armed.pointer, armed.identity);
      if (!owner || !prop || !owns(owner, prop, ptr(armed.identity))) { disarm(); return; }
      const down = triggerHeld(a);
      // The game fires the first shot on press itself; repeat after an interval.
      if (down && !triggerDown) lastShot = now;
      triggerDown = down;
      if (!down || now - lastShot < shotIntervalMs) return;
      const pn = ptr(owner.pn);
      if (pn.add(0x148).readU8() || pn.add(0xec).readU8()) return;
      const allowed = invoke(a.notBlocked, prop.add(0x228).readPointer());
      if (allowed.isNull() || allowed.add(0x10).readU8() !== 1) return;
      lastShot = now;
      invoke(a.use, controls(owner).actions);
    } catch (error) { disarm(); send({type: 'telemetry_error', message: 'Flare full auto stopped: ' + String(error)}); }
  }
  function capability(owner) {
    try {
      load();
      if (armed) return {available: true, reason: '', note: 'Hold the left mouse button in game to fire. Fully reliable when you host.', active: true};
      const held = heldProp(owner);
      if (!held.isNull()) {
        if (isFlareGun(objectName(held))) return {available: true, reason: '', note: 'Uses the flare gun in your hands.', active: false};
        return {available: false, reason: 'Drop what you are carrying first.', note: '', active: false};
      }
      const found = nearest(owner);
      if (!found) return {available: false, reason: 'No free flare gun is loaded nearby.', note: '', active: false};
      return {available: true, reason: '', note: 'Picks up the nearest flare gun (' + Math.round(found.distance) + ' m away).', active: false};
    } catch (error) { return {available: false, reason: String(error).replace(/^Error: /, ''), note: '', active: false}; }
  }
  function start(req, owner) {
    if (job) throw Error('The flare gun is still being picked up');
    if (req.action === 'flare_auto_off') {
      if (!armed) throw Error('Flare gun full auto is not on');
      disarm(); return {message: 'Flare gun full auto off; normal cooldown restored.'};
    }
    if (armed) throw Error('Flare gun full auto is already on');
    const a = load(), state = controls(owner), held = state.hands.add(0x38).readPointer();
    if (!held.isNull()) {
      if (!isFlareGun(objectName(held)) || !owns(owner, held, held.add(0x2d8).readPointer())) throw Error('Drop what you are carrying first.');
      return {message: 'Flare gun full auto on for ' + arm(owner, held) + '. Hold the left mouse button to fire.'};
    }
    if (!through(ptr(owner.pc), [0xf0, 0x18, 0x150]).isNull()) throw Error('Drop what you are carrying first.');
    const found = nearest(owner);
    if (!found) throw Error('No free flare gun is loaded nearby.');
    const prop = loaded(found.pointer, found.identity);
    if (!prop || !prop.add(0x2c0).readPointer().isNull() || prop.add(0x338).readU8()) throw Error('That flare gun is no longer available');
    if (!a.callSafe(state.hands, prop, a.safe)) throw Error('The game blocks picking up that flare gun right now');
    const at = position(ptr(owner.pc));
    if (!at) throw Error('Your position is unavailable');
    const vector = Memory.alloc(12); at.forEach((v, i) => vector.add(i * 4).writeFloat(v));
    a.callPickup(state.actions, prop, vector, a.pickup);
    job = {req, pointer: found.pointer, identity: found.identity, started: Date.now()};
    return null;
  }
  function finish(ok, message) {
    const current = job; job = null;
    send({type: 'action_result', request_id: current.req.request_id, ok, message});
  }
  function tick(now) {
    if (!job) return;
    try {
      if (job.cancel) throw Error('Flare gun pickup cancelled');
      const owner = validateOwner(job.req, describePlayers()), prop = loaded(job.pointer, job.identity);
      if (!prop) throw Error('The flare gun unloaded before pickup');
      if (owns(owner, prop, ptr(job.identity))) {
        finish(true, 'Picked up ' + arm(owner, prop) + ' with full auto on. Hold the left mouse button to fire.');
      } else if (now - job.started > 2500) throw Error('The game did not accept the flare gun pickup');
    } catch (error) { finish(false, String(error)); }
  }
  function cancel(id) { if (job && (!id || job.req.request_id === id)) job.cancel = true; }
  return {capability, start, tick, fire, cancel, busy: () => !!job, hasChanges: () => !!armed || !!job,
    restoreAll: () => { job = null; disarm(); }};
})();

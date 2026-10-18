// Train speed boost. Called only on the locally owned Unity Update, and only
// while hosting: the server's NetworkedTrain.FixedUpdate moves _currentSpeed
// toward targetSpeed using acceleration/deceleration and re-syncs
// syncSpeed/syncDistance to clients, and EnginePeck sets targetSpeed to
// fullSpeed when the engine starts. Boosting scales those three tuning values
// on the main train (not the cable chairlift) and restores them afterwards.
const trainTools = (() => {
  const factor = 20;
  let api = null, apiError = '', handle = null, searchedAt = 0, boost = null, settling = null;
  function load() {
    if (api) return api;
    if (apiError) throw Error(apiError);
    try {
      const offset = new NativeFunction(exp('il2cpp_field_get_offset'), 'int', ['pointer']);
      const train = klass(gameImage, '', 'NetworkedTrain');
      const checked = (name, expected) => {
        const field = train.isNull() ? ptr(0) : fieldFromName(train, Memory.allocUtf8String(name));
        if (field.isNull() || offset(field) !== expected) throw Error('Train layout changed: ' + name);
      };
      for (const [name, at] of [['engineSystem', 0x68], ['targetSpeed', 0xdc], ['acceleration', 0xe0], ['deceleration', 0xe4],
        ['fullSpeed', 0xe8], ['hasCable', 0xec], ['_currentSpeed', 0xfc]]) checked(name, at);
      const methods = new NativeFunction(exp('il2cpp_class_get_methods'), 'pointer', ['pointer', 'pointer']);
      const methodName = new NativeFunction(exp('il2cpp_method_get_name'), 'pointer', ['pointer']);
      const paramCount = new NativeFunction(exp('il2cpp_method_get_param_count'), 'uint', ['pointer']);
      const param = new NativeFunction(exp('il2cpp_method_get_param'), 'pointer', ['pointer', 'uint']);
      const typeName = new NativeFunction(exp('il2cpp_type_get_name'), 'pointer', ['pointer']);
      const generic = new NativeFunction(exp('il2cpp_method_is_generic'), 'bool', ['pointer']);
      let findAll = ptr(0);
      const iterator = Memory.alloc(Process.pointerSize); iterator.writePointer(ptr(0));
      for (let mi = methods(objectType, iterator); !mi.isNull(); mi = methods(objectType, iterator)) {
        if (methodName(mi).readCString() !== 'FindObjectsOfType' || paramCount(mi) !== 2 || generic(mi)) continue;
        if (typeName(param(mi, 0)).readCString() === 'System.Type' && typeName(param(mi, 1)).readCString() === 'System.Boolean') findAll = mi;
      }
      if (findAll.isNull()) throw Error('Missing exact signature: FindObjectsOfType');
      const classType = new NativeFunction(exp('il2cpp_class_get_type'), 'pointer', ['pointer']);
      const typeObject = new NativeFunction(exp('il2cpp_type_get_object'), 'pointer', ['pointer']);
      api = {train, findAll, trainType: typeObject(classType(train)),
        setTarget: method(train, 'set_NetworktargetSpeed', 1), exists: method(objectType, 'op_Implicit', 1),
        objectClass: new NativeFunction(exp('il2cpp_object_get_class'), 'pointer', ['pointer']),
        hold: new NativeFunction(exp('il2cpp_gchandle_new'), 'pointer', ['pointer', 'bool']),
        target: new NativeFunction(exp('il2cpp_gchandle_get_target'), 'pointer', ['pointer']),
        release: new NativeFunction(exp('il2cpp_gchandle_free'), 'void', ['pointer'])};
      return api;
    } catch (error) { apiError = String(error); throw error; }
  }
  function args(values) {
    const out = Memory.alloc(Math.max(1, values.length) * Process.pointerSize);
    values.forEach((value, i) => out.add(i * Process.pointerSize).writePointer(value)); return out;
  }
  function alive(object) {
    const box = invoke(load().exists, ptr(0), args([object]));
    return !box.isNull() && box.add(0x10).readU8() !== 0;
  }
  function usable(object) { return !object.isNull() && load().objectClass(object).equals(load().train) && alive(object) && !object.add(0xec).readU8(); }
  function engineLabel(object) {
    const system = object.add(0x68).readPointer();
    return system.isNull() ? '' : objectName(system);
  }
  // FindObjectsOfType is costly, so a missing train is looked up again at most every 3 s.
  function find(force = false) {
    const a = load();
    if (handle) {
      const cached = a.target(handle);
      if (usable(cached)) return cached;
      a.release(handle); handle = null;
    }
    const now = Date.now();
    if (!force && now - searchedAt < 3000) return null;
    searchedAt = now;
    const include = Memory.alloc(4); include.writeU8(1);
    const array = invoke(a.findAll, ptr(0), args([a.trainType, include]));
    const count = array.isNull() ? 0 : array.add(0x18).readS32();
    if (count < 0 || count > 32) throw Error('Unexpected train list');
    const found = [];
    for (let i = 0; i < count; i++) {
      const object = array.add(0x20 + i * Process.pointerSize).readPointer();
      if (usable(object)) found.push(object);
    }
    const chosen = found.find(o => engineLabel(o) === 'TrainEngineSystem') || (found.length === 1 ? found[0] : null);
    if (!chosen) return null;
    handle = a.hold(chosen, 0);
    return chosen;
  }
  function hosting(train) {
    const identity = train.add(0x40).readPointer();
    return !identity.isNull() && identity.add(0x21).readU8() === 1;
  }
  function speed(train) { return train.add(0xfc).readFloat(); }
  function setTarget(train, value) { invoke(load().setTarget, train, args([(() => { const f = Memory.alloc(4); f.writeFloat(value); return f; })()])); }
  function capability() {
    try {
      const train = find();
      if (!train) return {available: false, reason: 'No train is loaded.', note: '', active: false};
      if (!hosting(train)) return {available: false, reason: 'Host a session to change the train speed.', note: '', active: !!boost};
      const now = Math.round(speed(train) * 10) / 10;
      return {available: true, reason: '', active: !!boost,
        note: boost ? 'Train speed is ' + now + ' m/s (normally ' + boost.full + ').' : 'Train speed is ' + now + ' m/s. Riders may be thrown off at 20x.'};
    } catch (error) { return {available: false, reason: String(error).replace(/^Error: /, ''), note: '', active: false}; }
  }
  function restore(train, immediate) {
    const original = boost; boost = null;
    train.add(0xe8).writeFloat(original.full); train.add(0xe0).writeFloat(original.accel);
    if (train.add(0xdc).readFloat() > 0) setTarget(train, original.full);
    if (immediate) {
      if (speed(train) > original.full) train.add(0xfc).writeFloat(original.full);
      train.add(0xe4).writeFloat(original.decel);
    } else settling = {full: original.full, decel: original.decel}; // Keep braking fast until back to normal speed.
  }
  function start(req) {
    const train = find(true);
    if (!train) throw Error('No train is loaded.');
    if (!hosting(train)) throw Error('Host a session to change the train speed.');
    if (req.action === 'train_normal') {
      if (!boost) throw Error('The train is already at normal speed');
      restore(train, false);
      return {message: 'Train returning to normal speed.'};
    }
    if (boost) throw Error('The train is already at 20x speed');
    const base = settling ? {full: settling.full, decel: settling.decel} : {full: train.add(0xe8).readFloat(), decel: train.add(0xe4).readFloat()};
    const values = {full: base.full, accel: train.add(0xe0).readFloat(), decel: base.decel};
    if (![values.full, values.accel, values.decel].every(v => Number.isFinite(v) && v > 0 && v < 1000)) throw Error('Unexpected train tuning values');
    settling = null; boost = values;
    train.add(0xe8).writeFloat(values.full * factor);
    train.add(0xe0).writeFloat(values.accel * factor);
    train.add(0xe4).writeFloat(values.decel * factor);
    const running = train.add(0xdc).readFloat() > 0;
    if (running) setTarget(train, values.full * factor);
    return {message: running ? 'Train speeding up to ' + values.full * factor + ' m/s.' : 'Train set to 20x; it will go fast once its engine starts.'};
  }
  function tick() {
    if (!settling) return;
    try {
      const train = find();
      if (!train) { settling = null; return; }
      if (speed(train) <= settling.full + 0.01) { train.add(0xe4).writeFloat(settling.decel); settling = null; }
    } catch (_) { settling = null; }
  }
  function restoreAll() {
    const train = (boost || settling) ? find(true) : null;
    if (train && boost) restore(train, true);
    if (train && settling) {
      if (speed(train) > settling.full) train.add(0xfc).writeFloat(settling.full);
      train.add(0xe4).writeFloat(settling.decel);
    }
    boost = null; settling = null;
    if (handle) { load().release(handle); handle = null; }
  }
  return {capability, start, tick, restoreAll, hasChanges: () => !!boost || !!settling};
})();

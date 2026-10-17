# Equipment and storage

`pocket_tools.js` implements owned-character equipment and real equipped-item
storage. It runs only through the existing Unity Update queue.

## Recovery evidence

Build-specific recovered declarations and native bodies are in the sibling
2026-10-11 workspace, under `work/cpp2il/auth_cs/DiffableCs/Assembly-CSharp/`
and `work/cpp2il/out/IsilDump/Assembly-CSharp/`.

- `PlayerRegistry.blindfoldPocket +0xB0`, `backpackPocket +0xB8`, and
  `holsterPocket +0xC0` are wearable `PropHome` slots. Their direct
  `parentCharacter +0x30` must match the locally owned player.
- Recovered `PropGroup` values distinguish wearable Blindfold (22), Backpack
  (24), and WearHolster (30) from GoesInBackpack (25) and GoesInHolster (31).
- Equipped gear's `Prop.childPropHomes +0x2F8` supplies its actual contents
  receptacles. Only direct `PropHome.parentProp +0x38` matches with the
  appropriate storage group are exposed. Blindfold has no fabricated storage.
- `PropHome.IsSafeToPlace` recovered native body checks
  `blockPlacing +0x65`, a live input prop, an empty `pinnedProp +0xD8`, and
  `Prop.MatchesGroup(pinGroup +0x60)`. The bridge calls that normal method.
- `PlayerHands.IsSafeToPickUp` native body checks blocked homes, removal
  restrictions, poses, and other game conditions. The bridge calls it before
  taking off gear or taking a stored item into empty hands.
- `PlayerActions.ActionPlaceInHome` recovered native body performs
  predictive placement, increments `heldActionNumber`, then invokes the normal
  `PlayerNetworking.CmdPlaceInHome` wrapper. The bridge invokes ActionPlaceInHome.
- `PlayerActions.ActionPickUpProp` recovered native body constructs
  normal held information, increments the action counter, performs normal
  pickup prediction, and invokes CmdPickUp. The bridge supplies the current
  character position as the ordinary caster-position vector.
- `Prop.get_currentHome` resolves the synchronized `propHomeShellReference
  +0x28C`, rather than merely reading `predictedPropHome +0x320`.

The recovered method bodies identify the evidence; runtime methods resolve by
type/name/arity and runtime field offsets are checked before enabling controls.

## Contract

`snapshot(owner)` returns `{pockets, reason}` with Backpack and Holster only.
The blindfold row and blindfold action target are removed. Rows expose equipped
item identity, `can_equip_nearest`, `equip_nearest_reason`, storage availability,
and actual occupied/empty storage homes for the UI's actions.

The You page shows Equip closest only for empty gear slots. Worn slots expose
one Store held item control when holding an item, Take off, and a Take out control
for each occupied storage home. Empty storage rows and Equip held are hidden.

Actions use `target_kind: pocket`, `slot: backpack|holster`, and the named
`pocket_equip_nearest|pocket_store|pocket_take|pocket_unequip` actions. The old
`pocket_equip` held-item action remains compatible internally but is not shown.
Store/take use a live-resolved `home_key`. No caller-supplied pointer is used as
an unchecked home or prop.

Equip closest requires an empty owned equipment slot and empty hands. It uses
the actual wearable PropGroup, excluding every item with an exclusive holder,
any player's network-held identity, a current PropHome, or an inventory flag.
World positions determine the nearest eligible gear. Both IsSafeToPickUp and
IsSafeToPlace must allow it. Group matches are cached for passive snapshots;
the action re-evaluates groups, availability and distance before selecting.
It invokes normal ActionPickUpProp, observes matching PN/Hands/exclusive holder
state stable for 120 ms, then calls ActionPlaceInHome and observes the worn
home plus empty hands for another 120 ms. The complete sequence has a 6.5 second
observation deadline; ordinary one-action operations retain three seconds.
Identity/net ID/name and the same owned slot are checked on every update.

Cancellation does not start the second equip step. A normal in-flight pickup
can still finish and leave the selected gear in the user's hands. Detaching
ends observation without forcing inventory writes or dropping held items.
No gear is spawned and no holder, home, transform or counter is written directly.

## Validation boundary

This feature is based on recovered declarations and the native bodies above.
The new equipment/storage operations have not been executed in a live game.
An observed local state change does not establish what another peer rendered.

The simplified UI and nearest-gear sequence were compiled and syntax checked; no new equip, store, take or unequip gameplay action was executed during this update.

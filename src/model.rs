use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Player {
    pub key: String,
    pub pc: String,
    pub pn: String,
    pub name: String,
    pub moderation_name: Option<String>,
    pub net_id: u32,
    pub is_local: bool,
    pub is_owned: bool,
    pub is_host: bool,
    pub position: Option<[f32; 3]>,
    pub distance: Option<f32>,
    pub controls_velocity: Option<[f32; 3]>,
    pub crouchness: Option<f32>,
    pub sitting: bool,
    pub sleeping: bool,
    pub menu_open: bool,
    pub muted: bool,
    pub text_chatting: bool,
    pub ghost: bool,
    pub left_wave: bool,
    pub right_wave: bool,
    pub left_point: bool,
    pub right_point: bool,
    pub held_identity: String,
    pub held_item: Option<String>,
    pub held_player_pc: String,
    pub held_by_pc: String,
}

impl Player {
    pub fn state(&self) -> String {
        let mut states = vec![];
        if self.ghost {
            states.push("Ghost");
        }
        if self.sleeping {
            states.push("Sleeping");
        }
        if self.sitting {
            states.push("Sitting");
        }
        if self.crouchness.unwrap_or(0.) > 0.5 {
            states.push("Crouching");
        }
        if self.menu_open {
            states.push("In menu");
        }
        if self.text_chatting {
            states.push("Typing");
        }
        if self.left_wave || self.right_wave {
            states.push("Waving");
        }
        if self.left_point || self.right_point {
            states.push("Pointing");
        }
        if states.is_empty() {
            let moving = self
                .controls_velocity
                .is_some_and(|v| v.iter().map(|n| n * n).sum::<f32>() > 0.04);
            states.push(if self.controls_velocity.is_none() {
                "Unknown"
            } else if moving {
                "Moving"
            } else {
                "Standing"
            });
        }
        states.join(" · ")
    }
    pub fn carrying(&self, players: &[Player]) -> String {
        if let Some(p) = players.iter().find(|p| p.pc == self.held_player_pc) {
            return p.name.clone();
        }
        self.held_item
            .as_deref()
            .map(friendly_name)
            .unwrap_or_else(|| "Empty hands".into())
    }
    pub fn hands_empty(&self, players: &[Player]) -> bool {
        (self.held_identity.is_empty() || self.held_identity == "0x0")
            && !players.iter().any(|p| p.pc == self.held_player_pc)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Item {
    pub key: String,
    pub index: usize,
    pub pointer: String,
    pub identity: String,
    pub net_id: u32,
    pub name: String,
    pub position: Option<[f32; 3]>,
    pub distance: Option<f32>,
    pub holder_pc: String,
    pub in_inventory: bool,
}
impl Item {
    pub fn available(&self) -> bool {
        self.holder_pc == "0x0" || self.holder_pc.is_empty()
    }
    pub fn holder(&self, players: &[Player]) -> String {
        players
            .iter()
            .find(|p| p.pc == self.holder_pc)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| {
                if self.available() {
                    "On the ground".into()
                } else {
                    "Held by a player".into()
                }
            })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct MovementMultipliers {
    pub movement: f32,
    pub jump: f32,
    #[serde(rename = "throw")]
    pub throw_strength: f32,
    pub charge: f32,
}
impl Default for MovementMultipliers {
    fn default() -> Self {
        Self {
            movement: 1.,
            jump: 1.,
            throw_strength: 1.,
            charge: 1.,
        }
    }
}
impl MovementMultipliers {
    pub fn clamp_supported(&mut self) {
        for (value, maximum) in [
            (&mut self.movement, 20.),
            (&mut self.jump, 99.),
            (&mut self.throw_strength, 99.),
            (&mut self.charge, 20.),
        ] {
            *value = if value.is_finite() {
                value.clamp(0.25, maximum)
            } else {
                1.
            };
        }
    }
    pub fn get(&self, setting: &str) -> Option<f32> {
        let value = match setting {
            "movement" => self.movement,
            "jump" => self.jump,
            "throw" => self.throw_strength,
            "charge" => self.charge,
            _ => return None,
        };
        value.is_finite().then_some(value)
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct CharacterSettings {
    pub available: bool,
    pub key: String,
    pub reason: String,
    pub values: MovementMultipliers,
    pub movement_mixed: bool,
    pub strength_mixed: bool,
    pub dizziness_available: bool,
    pub dizziness_reason: String,
    pub no_landing_dizziness: bool,
    pub modified: bool,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct FunCapability {
    pub available: bool,
    pub reason: String,
    pub note: String,
    pub active: bool,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct FunCapabilities {
    pub corpses: FunCapability,
    pub clear_corpses: FunCapability,
    pub items: FunCapability,
    pub gather: FunCapability,
    pub flare: FunCapability,
}
impl FunCapabilities {
    pub fn get(&self, action: &str) -> Option<&FunCapability> {
        match action {
            "spawn_corpses" | "spawn_corpse_pins" => Some(&self.corpses),
            "clear_corpses" => Some(&self.clear_corpses),
            "grab_all_items" => Some(&self.items),
            "gather_party" => Some(&self.gather),
            "flare_auto" | "flare_auto_off" => Some(&self.flare),
            _ => None,
        }
    }
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct FunProgress {
    pub action: String,
    pub completed: usize,
    pub processed: usize,
    pub total: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PaletteColor {
    pub id: i32,
    pub color: [f32; 4],
    pub available: bool,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Appearance {
    pub available: bool,
    pub reason: String,
    pub head: i32,
    pub torso: i32,
    pub legs: i32,
    pub colors: Vec<PaletteColor>,
}
fn default_true() -> bool {
    true
}
#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct Pocket {
    #[serde(default = "default_true")]
    pub available: bool,
    pub reason: String,
    pub name: String,
    pub slot: String,
    pub item_name: Option<String>,
    pub item_key: Option<String>,
    pub net_id: u32,
    pub can_equip: bool,
    pub can_equip_nearest: bool,
    pub equip_nearest_reason: String,
    pub can_store: bool,
    pub store_reason: String,
    pub can_unequip: bool,
    pub equip_reason: String,
    pub unequip_reason: String,
    pub stored: Vec<PocketStorage>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PocketStorage {
    pub home_key: String,
    pub name: String,
    pub item_name: Option<String>,
    pub item_key: Option<String>,
    pub net_id: u32,
    pub can_store: bool,
    pub can_take: bool,
    pub reason: String,
}
impl Default for Pocket {
    fn default() -> Self {
        Self {
            available: true,
            reason: String::new(),
            name: String::new(),
            slot: String::new(),
            item_name: None,
            item_key: None,
            net_id: 0,
            can_equip: false,
            can_equip_nearest: false,
            equip_nearest_reason: String::new(),
            can_store: false,
            store_reason: String::new(),
            can_unequip: false,
            equip_reason: String::new(),
            unequip_reason: String::new(),
            stored: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct HeldTools {
    pub can_use: bool,
    pub can_release: bool,
    pub is_using: bool,
    pub can_drop: bool,
    pub reason: String,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Tools {
    pub appearance: Appearance,
    pub pockets: Vec<Pocket>,
    pub pockets_reason: String,
    pub held: HeldTools,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct Camera {
    pub available: bool,
    pub reason: String,
    pub zoom: f32,
    pub detached: bool,
    pub free_available: bool,
    pub free_reason: String,
    pub speed: f32,
}
impl Default for Camera {
    fn default() -> Self {
        Self {
            available: false,
            reason: String::new(),
            zoom: 1.,
            detached: false,
            free_available: false,
            free_reason: String::new(),
            speed: 1.,
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct LocationState {
    pub can_return: bool,
    pub reason: String,
    pub build: Value,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct Snapshot {
    pub generation: String,
    pub pid: u32,
    pub sequence: u64,
    pub sampled_at_ms: u64,
    pub items_at_ms: u64,
    pub owner_pc: String,
    pub owner_pn: String,
    pub character_settings: Option<CharacterSettings>,
    pub fun: FunCapabilities,
    pub tools: Tools,
    pub camera: Camera,
    pub location: LocationState,
    pub build: Value,
    pub players: Vec<Player>,
    pub items: Vec<Item>,
}
impl Snapshot {
    pub fn owner(&self) -> Option<&Player> {
        self.players
            .iter()
            .find(|p| p.pc == self.owner_pc && p.is_local && p.is_owned)
    }
    pub fn request(&self, action: &str, kind: &str) -> Value {
        json!({"type":"action", "generation":self.generation, "action":action, "target_kind":kind, "owner_pc":self.owner_pc, "owner_pn":self.owner_pn})
    }
    pub fn preview() -> Self {
        let mut players = vec![];
        for (i, (name, pos, vel)) in [
            ("You", [104.2, 23.8, -62.1], [0., 0., 0.]),
            ("dean", [112.6, 24.0, -58.3], [0., 0., 0.]),
            ("milo", [134.1, 22.7, -43.8], [1.8, 0., 0.4]),
            ("rosie", [90.0, 24.3, -72.9], [0., 0., 0.]),
        ]
        .into_iter()
        .enumerate()
        {
            players.push(Player {
                key: format!("sample-player-{i}"),
                pc: format!("sample-pc-{i}"),
                pn: format!("sample-pn-{i}"),
                name: name.into(),
                moderation_name: Some(name.into()),
                net_id: i as u32 + 1,
                is_local: i == 0,
                is_owned: i == 0,
                is_host: i == 1,
                position: Some(pos),
                distance: Some(((pos[0] - 104.2_f32).powi(2) + (pos[2] + 62.1_f32).powi(2)).sqrt()),
                controls_velocity: Some(vel),
                held_item: if i == 1 {
                    Some("LaserProp".into())
                } else {
                    None
                },
                held_identity: if i == 1 {
                    "sample-item-0".into()
                } else {
                    "0x0".into()
                },
                sitting: i == 3,
                ..Default::default()
            });
        }
        let names = [
            "LaserProp",
            "WalkieTalkieProp",
            "BinocularsProp",
            "FootballProp",
            "TrafficConeProp",
            "CameraProp",
            "AppleProp",
            "TorchProp",
            "LaserProp",
            "BucketProp",
            "WalkieTalkieProp",
            "ShovelProp",
            "TrafficConeProp",
            "CameraProp",
            "AppleProp",
            "FootballProp",
            "LaserProp",
            "TorchProp",
        ];
        let items = names
            .iter()
            .enumerate()
            .map(|(i, name)| Item {
                key: format!("sample-item-{i}"),
                index: i,
                pointer: format!("sample-prop-{i}"),
                identity: format!("sample-item-{i}"),
                net_id: 42 + i as u32,
                name: (*name).into(),
                position: Some([
                    111.5 + i as f32 * 3.2,
                    23.9,
                    -58.5 + (i as f32 * 1.7).sin() * 14.,
                ]),
                distance: Some(8.3 + i as f32 * 7.2),
                holder_pc: if i == 0 {
                    "sample-pc-1".into()
                } else {
                    "0x0".into()
                },
                in_inventory: false,
            })
            .collect();
        Self {
            generation: "preview".into(),
            pid: 0,
            sequence: 1,
            owner_pc: players[0].pc.clone(),
            owner_pn: players[0].pn.clone(),
            character_settings: Some(CharacterSettings {
                available: true,
                dizziness_available: true,
                key: "preview".into(),
                ..Default::default()
            }),
            players,
            items,
            ..Default::default()
        }
    }
}

pub fn friendly_name(raw: &str) -> String {
    let text = raw
        .trim_end_matches("(Clone)")
        .trim()
        .trim_end_matches("Prop")
        .trim_end_matches('_');
    let mut result = String::new();
    let mut previous_lower = false;
    for c in text.chars() {
        if c.is_uppercase() && previous_lower {
            result.push(' ');
        }
        if c == '_' {
            result.push(' ');
            previous_lower = false;
        } else {
            result.push(c);
            previous_lower = c.is_lowercase();
        }
    }
    if result.is_empty() {
        raw.into()
    } else {
        result
    }
}
pub fn position_label(pos: Option<[f32; 3]>) -> String {
    pos.map(|p| format!("{:.1}    {:.1}    {:.1}", p[0], p[1], p[2]))
        .unwrap_or_else(|| "Position unavailable".into())
}
pub fn distance_label(distance: Option<f32>) -> String {
    distance
        .map(|d| format!("{d:.1} m"))
        .unwrap_or_else(|| "—".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captured_bridge_snapshot_contract() {
        let Some(path) = std::env::var_os("BIG_HACK_SNAPSHOT") else {
            return;
        };
        let text = std::fs::read_to_string(path).expect("read captured bridge snapshot");
        let data: Snapshot = serde_json::from_str(&text).expect("decode live bridge snapshot");
        assert!(data.owner().is_some());
        assert!(data.sequence > 0);
        assert!(!data.generation.is_empty());
        let keys: std::collections::HashSet<_> = data.items.iter().map(|i| &i.key).collect();
        assert_eq!(keys.len(), data.items.len());
        assert!(
            data.players
                .iter()
                .all(|p| p.position.is_none_or(|v| v.iter().all(|n| n.is_finite())))
        );
    }
    #[test]
    fn held_player_takes_priority_over_prop_and_blocks_pickup() {
        let mut data = Snapshot::preview();
        data.players[0].held_player_pc = data.players[1].pc.clone();
        assert_eq!(data.players[0].carrying(&data.players), "dean");
        assert!(!data.players[0].hands_empty(&data.players));
    }
    #[test]
    fn display_names_and_nullable_positions() {
        assert_eq!(friendly_name("WalkieTalkieProp(Clone)"), "Walkie Talkie");
        assert_eq!(position_label(None), "Position unavailable");
        let p: Player =
            serde_json::from_value(json!({"name":"test", "position":null, "crouchness":null}))
                .unwrap();
        assert_eq!(p.state(), "Unknown");
    }
}

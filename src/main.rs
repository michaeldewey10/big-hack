#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod art;
mod backend;
mod diagnostics;
mod features;
mod library;
mod menu;
mod model;
mod scrollbars;
use art::*;
use backend::Bridge;
use gpui::{prelude::*, *};
use model::*;
use serde_json::json;
use std::time::{Duration, Instant};

const SETTING_MIN: f32 = 0.25;
const SETTING_MAX: f32 = 20.;
const SETTING_STEP: f32 = 0.25;
#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
}

#[derive(Clone, Copy, PartialEq)]
enum Page {
    You,
    Party,
    Items,
    BigFun,
    Camera,
    Places,
}
impl Page {
    fn accent(self) -> u32 {
        match self {
            Self::You => 0xc12f21,
            Self::Party => 0x326bb3,
            Self::Items => 0xcfaa20,
            Self::Camera => GREEN,
            Self::Places => 0xce6d1b,
            Self::BigFun => 0x8652b0,
        }
    }
}
struct SliderDrag {
    setting: &'static str,
    settings_key: String,
    bounds: Bounds<Pixels>,
    value: f32,
}
struct HeldUse {
    request: serde_json::Value,
    press_id: String,
    press_complete: bool,
    release_requested: bool,
    release_id: Option<String>,
    last_heartbeat: Instant,
}
struct ScrollbarDrag {
    handle: ScrollHandle,
    rail: Bounds<Pixels>,
    grab_offset: Pixels,
}
struct BigHack {
    bridge: Option<Bridge>,
    snapshot: Snapshot,
    page: Page,
    selected_player: Option<String>,
    selected_item: Option<String>,
    query: String,
    search_active: bool,
    visible_items: Vec<usize>,
    focus: FocusHandle,
    state: String,
    connection_message: String,
    received: Option<Instant>,
    pending: Option<(String, Instant)>,
    pending_timeout: Duration,
    fun_progress: Option<FunProgress>,
    fun_cancel_requested: bool,
    notice: Option<(String, bool)>,
    counter: u64,
    preview: bool,
    slider_drag: Option<SliderDrag>,
    setting_preview: Option<(&'static str, f32)>,
    dizziness_preview: Option<bool>,
    library: library::Library,
    selected_preset: Option<usize>,
    selected_spot: Option<usize>,
    collection_radius: Option<f32>,
    camera_step: f32,
    held_use: Option<HeldUse>,
    page_scroll: [ScrollHandle; 6],
    item_scroll: UniformListScrollHandle,
    scrollbar_drag: Option<ScrollbarDrag>,
}
impl BigHack {
    fn new(
        preview: bool,
        items: bool,
        big_fun: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        focus.focus(window);
        cx.observe_window_activation(window, |this, window, cx| {
            if !window.is_window_active() {
                this.release_held_use(cx);
                this.scrollbar_drag = None;
            }
        })
        .detach();
        let snapshot = if preview {
            Snapshot::preview()
        } else {
            Snapshot::default()
        };
        let selected_player = snapshot
            .players
            .iter()
            .find(|p| !p.is_local)
            .map(|p| p.key.clone());
        let selected_item = snapshot
            .items
            .iter()
            .find(|p| p.available())
            .map(|p| p.key.clone());
        let timer = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            loop {
                timer.timer(Duration::from_millis(100)).await;
                if this.update(cx, |v, cx| v.poll(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        let mut view = Self {
            bridge: if preview { None } else { Some(Bridge::start()) },
            snapshot,
            page: if big_fun {
                Page::BigFun
            } else if items {
                Page::Items
            } else {
                Page::You
            },
            selected_player,
            selected_item,
            query: String::new(),
            search_active: false,
            visible_items: vec![],
            focus,
            state: if preview {
                "preview".into()
            } else {
                "searching".into()
            },
            connection_message: if preview {
                "Layout preview. Sample data; actions are disabled.".into()
            } else {
                "Looking for Big Walk.exe…".into()
            },
            received: if preview { Some(Instant::now()) } else { None },
            pending: None,
            pending_timeout: Duration::from_secs(11),
            fun_progress: None,
            fun_cancel_requested: false,
            notice: None,
            counter: 0,
            preview,
            slider_drag: None,
            setting_preview: None,
            dizziness_preview: None,
            library: library::Library::load(),
            selected_preset: None,
            selected_spot: None,
            collection_radius: Some(20.),
            camera_step: 1.,
            held_use: None,
            page_scroll: std::array::from_fn(|_| ScrollHandle::new()),
            item_scroll: UniformListScrollHandle::new(),
            scrollbar_drag: None,
        };
        view.log(
            if preview {
                "Opened layout preview. All actions are disabled."
            } else {
                "Big Hack started. Scanning for Big Walk.exe."
            },
            true,
        );
        view
    }
    fn log(&mut self, message: impl Into<String>, good: bool) {
        diagnostics::log(&format!(
            "{}: {}",
            if good { "Info" } else { "Error" },
            message.into()
        ));
    }
    fn poll(&mut self, cx: &mut Context<Self>) {
        #[cfg(windows)]
        if self.scrollbar_drag.is_some() && unsafe { GetAsyncKeyState(0x01) } >= 0 {
            self.scrollbar_drag = None;
        }
        if self.preview {
            return;
        }
        let mut events = vec![];
        if let Some(b) = &self.bridge {
            while let Ok(v) = b.events.try_recv() {
                events.push(v);
            }
        }
        let mut changed = false;
        for event in events {
            changed = true;
            match event["type"].as_str().unwrap_or("") {
                "snapshot" => match serde_json::from_value::<Snapshot>(event) {
                    Ok(mut data) => {
                        let new_session = data.generation != self.snapshot.generation;
                        if new_session
                            || self.slider_drag.as_ref().is_some_and(|drag| {
                                Self::slider_key(&data, drag.setting)
                                    .is_none_or(|key| key != drag.settings_key)
                            })
                        {
                            self.slider_drag = None;
                        }
                        data.players
                            .sort_by_key(|p| (!p.is_local, !p.is_host, p.name.to_lowercase()));
                        if new_session {
                            self.held_use = None;
                            for pocket in &data.tools.pockets {
                                if matches!(pocket.slot.as_str(), "backpack" | "holster") {
                                    diagnostics::log(&format!(
                                        "Equipment {}: available={}, equip closest={}, {}",
                                        pocket.name,
                                        pocket.available,
                                        pocket.can_equip_nearest,
                                        pocket.equip_nearest_reason
                                    ));
                                }
                            }
                            diagnostics::log(&format!(
                                "Appearance: {} {}",
                                if data.tools.appearance.available {
                                    "available"
                                } else {
                                    "unavailable"
                                },
                                data.tools.appearance.reason
                            ));
                            for (label, cap) in [
                                ("corpses", &data.fun.corpses),
                                ("clear corpses", &data.fun.clear_corpses),
                                ("items", &data.fun.items),
                                ("gather", &data.fun.gather),
                                ("flare", &data.fun.flare),
                            ] {
                                diagnostics::log(&format!(
                                    "Big Fun {label}: {} {}",
                                    if cap.available {
                                        "available"
                                    } else {
                                        "unavailable"
                                    },
                                    cap.reason
                                ));
                            }
                            self.selected_player = None;
                            self.selected_item = None;
                            self.pending = None;
                            self.fun_progress = None;
                            self.fun_cancel_requested = false;
                            self.setting_preview = None;
                            self.dizziness_preview = None;
                        }
                        if !data
                            .players
                            .iter()
                            .any(|p| Some(&p.key) == self.selected_player.as_ref())
                        {
                            self.selected_player = data
                                .players
                                .iter()
                                .find(|p| !p.is_local)
                                .or(data.players.first())
                                .map(|p| p.key.clone());
                        }
                        if !data
                            .items
                            .iter()
                            .any(|p| Some(&p.key) == self.selected_item.as_ref())
                        {
                            self.selected_item = data
                                .items
                                .iter()
                                .filter(|i| i.available())
                                .min_by(|a, b| {
                                    a.distance
                                        .unwrap_or(f32::MAX)
                                        .total_cmp(&b.distance.unwrap_or(f32::MAX))
                                })
                                .map(|p| p.key.clone());
                        }
                        if self.state != "live" {
                            self.log(format!("Connected to Big Walk, process {}. Live character data received.",data.pid),true);
                        }
                        self.state = "live".into();
                        self.connection_message = format!("Big Walk.exe  ·  PID {}", data.pid);
                        self.received = Some(Instant::now());
                        self.snapshot = data;
                        if self
                            .held_use
                            .as_ref()
                            .is_some_and(|hold| !self.held_owner_matches(hold))
                        {
                            self.held_use = None;
                        }
                    }
                    Err(e) => {
                        self.state = "error".into();
                        self.connection_message = format!("Snapshot format error: {e}");
                    }
                },
                "status" => {
                    let state = event["state"].as_str().unwrap_or("error").to_string();
                    let message = event["message"]
                        .as_str()
                        .unwrap_or("Connection unavailable")
                        .to_string();
                    if state != self.state || message != self.connection_message {
                        if state != self.state {
                            self.log(message.clone(), !matches!(state.as_str(), "error" | "unsupported"));
                        }
                        if state != "attached" && state != "live" {
                            self.received = None;
                        }
                        self.state = state;
                        self.connection_message = message;
                    }
                }
                "action_progress" => {
                    if self
                        .pending
                        .as_ref()
                        .is_some_and(|p| event["request_id"].as_str() == Some(p.0.as_str()))
                    {
                        if event["action"].as_str() == Some("clear_corpses") {
                            if let Some(total) =
                                event["total"].as_u64().filter(|n| (1..=4096).contains(n))
                            {
                                self.pending_timeout = Duration::from_secs(total * 4 + 12);
                            }
                        }
                        self.fun_progress = serde_json::from_value::<FunProgress>(event).ok();
                    }
                }
                "action_result" => {
                    let result_id = event["request_id"].as_str().unwrap_or("");
                    if let Some(hold) = &mut self.held_use {
                        if result_id == hold.press_id {
                            hold.press_complete = true;
                            if !event["ok"].as_bool().unwrap_or(false) {
                                hold.release_requested = true;
                            }
                        } else if hold.release_id.as_deref() == Some(result_id) {
                            self.held_use = None;
                        }
                    }
                    let message = event["message"]
                        .as_str()
                        .unwrap_or("No result returned")
                        .to_string();
                    let ok = event["ok"].as_bool().unwrap_or(false);
                    if ok {
                        if let Some(zoom) = event["zoom"]
                            .as_f64()
                            .filter(|v| v.is_finite() && (0.25..=8.).contains(v))
                        {
                            self.snapshot.camera.zoom = zoom as f32;
                        }
                        if let Ok(settings) =
                            serde_json::from_value::<CharacterSettings>(event["settings"].clone())
                        {
                            self.snapshot.character_settings = Some(settings);
                        }
                    }
                    if self
                        .pending
                        .as_ref()
                        .is_some_and(|p| event["request_id"].as_str() == Some(p.0.as_str()))
                    {
                        self.pending = None;
                        self.fun_progress = None;
                        self.fun_cancel_requested = false;
                        self.setting_preview = None;
                        self.dizziness_preview = None;
                    }
                    self.notice = if ok {
                        None
                    } else {
                        Some((message.clone(), false))
                    };
                    self.log(message, ok);
                    if ok {
                        let location = event
                            .get("location")
                            .or_else(|| event.get("result").and_then(|r| r.get("location")));
                        if let Some(location) = location.filter(|v| v.get("position").is_some()) {
                            self.remember_location(location.clone());
                        }
                    }
                }
                _ => {}
            }
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.1.elapsed() > self.pending_timeout)
        {
            if let Some(hold) = &mut self.held_use {
                if self
                    .pending
                    .as_ref()
                    .is_some_and(|pending| pending.0 == hold.press_id)
                {
                    hold.press_complete = true;
                    hold.release_requested = true;
                } else if hold.release_id.is_some() {
                    self.held_use = None;
                }
            }
            self.pending = None;
            self.fun_progress = None;
            self.fun_cancel_requested = false;
            self.setting_preview = None;
            self.dizziness_preview = None;
            self.notice = Some((
                "No result received. Check the game before retrying.".into(),
                false,
            ));
            changed = true;
        }
        #[cfg(windows)]
        if self
            .held_use
            .as_ref()
            .is_some_and(|hold| !hold.release_requested)
            && unsafe { GetAsyncKeyState(0x01) } >= 0
        {
            self.release_held_use(cx);
        }
        if !self.live() {
            self.release_held_use(cx);
        }
        self.pump_held_use(cx);
        if self
            .received
            .is_some_and(|t| t.elapsed() > Duration::from_secs(2))
            && self.state == "live"
        {
            self.state = "stale".into();
            self.connection_message =
                "Updates paused. Waiting for the game’s next character update…".into();
            changed = true;
        }
        if changed {
            cx.notify();
        }
    }
    fn live(&self) -> bool {
        !self.preview
            && self.state == "live"
            && self
                .received
                .is_some_and(|t| t.elapsed() < Duration::from_secs(2))
    }
    fn change_page(&mut self, page: Page, cx: &mut Context<Self>) {
        self.release_held_use(cx);
        diagnostics::log(match page {
            Page::You => "Open you",
            Page::Party => "Open party",
            Page::Items => "Open items",
            Page::BigFun => "Open Big Fun",
            Page::Camera => "Open camera",
            Page::Places => "Open places",
        });
        self.page = page;
        self.slider_drag = None;
        self.scrollbar_drag = None;
        self.query.clear();
        self.search_active = false;
        cx.notify();
    }
    fn control(&mut self, kind: &str, cx: &mut Context<Self>) {
        self.release_held_use(cx);
        if self.preview {
            if kind != "reconnect" {
                return;
            }
            self.preview = false;
            self.snapshot = Snapshot::default();
            self.selected_player = None;
            self.selected_item = None;
            self.bridge = Some(Bridge::start());
        }
        if let Some(b) = &mut self.bridge {
            b.send(&json!({"type":kind}));
        }
        self.received = None;
        self.held_use = None;
        self.pending = None;
        self.fun_progress = None;
        self.fun_cancel_requested = false;
        self.slider_drag = None;
        self.setting_preview = None;
        self.dizziness_preview = None;
        self.notice = None;
        self.state = if kind == "pause" {
            "paused".into()
        } else {
            "searching".into()
        };
        self.connection_message = if kind == "pause" {
            "Detached from the game.".into()
        } else {
            "Looking for Big Walk.exe…".into()
        };
        cx.notify();
    }
    fn action(&mut self, action: &str, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let empty = self
            .snapshot
            .owner()
            .is_some_and(|p| p.hands_empty(&self.snapshot.players));
        let req = match self.page {
            Page::You | Page::BigFun | Page::Camera | Page::Places => return,
            Page::Party => {
                let Some(t) = self
                    .snapshot
                    .players
                    .iter()
                    .find(|p| Some(&p.key) == self.selected_player.as_ref())
                else {
                    return;
                };
                if t.is_local || (action == "pickup" && !empty) {
                    return;
                }
                let mut r = self.snapshot.request(action, "player");
                r["target_pc"] = json!(t.pc);
                r["target_pn"] = json!(t.pn);
                r["target_name"] = json!(t.name);
                r["target_moderation_name"] = json!(t.moderation_name);
                r
            }
            Page::Items => {
                let Some(t) = self
                    .snapshot
                    .items
                    .iter()
                    .find(|p| Some(&p.key) == self.selected_item.as_ref())
                else {
                    return;
                };
                if action == "pickup" && (!empty || !t.available()) {
                    return;
                }
                let mut r = self.snapshot.request(action, "item");
                r["item_index"] = json!(t.index);
                r["item_pointer"] = json!(t.pointer);
                r["item_identity"] = json!(t.identity);
                r["item_name"] = json!(t.name);
                r
            }
        };
        self.submit(req, cx);
    }
    fn slider_key(snapshot: &Snapshot, setting: &str) -> Option<String> {
        if setting == "camera_zoom" {
            return snapshot.camera.available.then(|| {
                format!(
                    "camera:{}:{}:{}",
                    snapshot.generation, snapshot.owner_pc, snapshot.owner_pn
                )
            });
        }
        snapshot
            .character_settings
            .as_ref()
            .filter(|s| s.available && !s.key.is_empty())
            .map(|s| s.key.clone())
    }
    fn setting_max(setting: &str) -> f32 {
        match setting {
            "jump" | "throw" => 99.,
            "camera_zoom" => 8.,
            _ => SETTING_MAX,
        }
    }
    fn slider_value(setting: &str, bounds: Bounds<Pixels>, x: Pixels) -> f32 {
        let width = (f32::from(bounds.size.width) - 24.).max(1.);
        let fraction = ((f32::from(x - bounds.origin.x) - 12.) / width).clamp(0., 1.);
        let maximum = Self::setting_max(setting);
        ((SETTING_MIN + fraction * (maximum - SETTING_MIN)) / SETTING_STEP).round() * SETTING_STEP
    }
    fn start_slider(
        &mut self,
        setting: &'static str,
        bounds: Bounds<Pixels>,
        x: Pixels,
        cx: &mut Context<Self>,
    ) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let Some(settings_key) = Self::slider_key(&self.snapshot, setting) else {
            return;
        };
        self.slider_drag = Some(SliderDrag {
            setting,
            settings_key,
            bounds,
            value: Self::slider_value(setting, bounds, x),
        });
        cx.notify();
    }
    fn move_slider(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        let Some(drag) = self.slider_drag.as_mut() else {
            return;
        };
        if !event.dragging() {
            self.slider_drag = None;
            cx.notify();
            return;
        }
        let next = Self::slider_value(drag.setting, drag.bounds, event.position.x);
        if (next - drag.value).abs() > 0.001 {
            drag.value = next;
            cx.notify();
        }
    }
    fn finish_slider(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        let Some(drag) = self.slider_drag.take() else {
            return;
        };
        if Self::slider_key(&self.snapshot, drag.setting)
            .is_some_and(|key| key == drag.settings_key)
        {
            let value = Self::slider_value(drag.setting, drag.bounds, event.position.x);
            if drag.setting == "camera_zoom" {
                self.camera_zoom(value, cx);
            } else {
                self.character_setting(drag.setting, value, cx);
            }
        }
        cx.notify();
    }
    fn character_setting(&mut self, setting: &'static str, value: f32, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let Some(settings) = self.snapshot.character_settings.as_ref().filter(|s| {
            (s.available || (setting == "restore" && s.dizziness_available)) && !s.key.is_empty()
        }) else {
            return;
        };
        let mut req = self.snapshot.request(
            if setting == "restore" {
                "settings_restore"
            } else {
                "settings_set"
            },
            "self",
        );
        req["settings_key"] = json!(settings.key);
        if setting != "restore" {
            let Some(current) = settings.values.get(setting) else {
                return;
            };
            if !value.is_finite() {
                return;
            }
            let next = value.clamp(SETTING_MIN, Self::setting_max(setting));
            if (next - current).abs() < 0.0001
                && !(setting == "movement" && settings.movement_mixed)
                && !(setting == "throw" && settings.strength_mixed)
            {
                return;
            }
            req["setting"] = json!(setting);
            req["multiplier"] = json!(next);
        }
        self.submit(req, cx);
        if setting != "restore" && self.pending.is_some() {
            self.setting_preview = Some((
                setting,
                value.clamp(SETTING_MIN, Self::setting_max(setting)),
            ));
        }
    }
    fn set_landing_dizziness(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let Some(settings) = self
            .snapshot
            .character_settings
            .as_ref()
            .filter(|s| s.dizziness_available && !s.key.is_empty())
        else {
            return;
        };
        let ignore = !enabled;
        if ignore == settings.no_landing_dizziness {
            return;
        }
        let mut req = self.snapshot.request("settings_toggle", "self");
        req["settings_key"] = json!(settings.key);
        req["setting"] = json!("no_landing_dizziness");
        req["enabled"] = json!(ignore);
        self.submit(req, cx);
        if self.pending.is_some() {
            self.dizziness_preview = Some(ignore);
        }
    }
    fn fun_action(&mut self, action: &'static str, cx: &mut Context<Self>) {
        if !self.live()
            || self.interaction_busy()
            || !self.snapshot.fun.get(action).is_some_and(|c| c.available)
        {
            return;
        }
        let mut req = self.snapshot.request(action, "fun");
        if action == "gather_party" {
            req["targets"] = json!(
                self.snapshot
                    .players
                    .iter()
                    .filter(|p| !p.is_local)
                    .map(|p| json!({"pc":p.pc,"pn":p.pn,"name":p.moderation_name}))
                    .collect::<Vec<_>>()
            );
        } else if action == "grab_all_items" {
            req["items"] = json!(self.snapshot.items.iter()
                .filter(|item| item.available() && !item.in_inventory && item.net_id!=0)
                .map(|item| json!({"pointer":item.pointer,"identity":item.identity,"net_id":item.net_id,"name":item.name}))
                .collect::<Vec<_>>());
            if req["items"]
                .as_array()
                .is_none_or(|items| items.is_empty() || items.len() > 4096)
            {
                return;
            }
        }
        self.submit(req, cx);
    }
    fn stop_fun(&mut self, cx: &mut Context<Self>) {
        if self.fun_cancel_requested {
            return;
        }
        if let Some((id, _)) = &self.pending {
            if self
                .bridge
                .as_mut()
                .is_some_and(|b| b.send(&json!({"type":"cancel", "request_id":id})))
            {
                self.fun_cancel_requested = true;
            }
        }
        cx.notify();
    }
    fn submit(&mut self, mut req: serde_json::Value, cx: &mut Context<Self>) {
        if self.pending.is_some() || (self.held_use.is_some() && req["action"] != "held_release") {
            return;
        }
        self.counter += 1;
        let id = format!("{}-{}", self.snapshot.generation, self.counter);
        req["request_id"] = json!(id);
        if self.bridge.as_mut().is_some_and(|b| b.send(&req)) {
            self.pending_timeout = Duration::from_secs(if req["action"] == "grab_all_items" {
                req["items"]
                    .as_array()
                    .map_or(12, |items| items.len().min(4096) as u64 * 4 + 12)
            } else if req["target_kind"] == "fun" {
                50
            } else {
                11
            });
            self.fun_progress = None;
            self.fun_cancel_requested = false;
            self.pending = Some((id, Instant::now()));
            self.notice = None;
        } else {
            self.notice = Some((
                "The local bridge is unavailable. Restart Big Hack.".into(),
                false,
            ));
        }
        cx.notify();
    }
    fn keydown(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = &event.keystroke;
        if key.modifiers.control {
            match key.key.as_str() {
                "f" if self.page == Page::Items => {
                    self.search_active = true;
                    self.focus.focus(window);
                }
                "1" => self.change_page(Page::You, cx),
                "2" => self.change_page(Page::Party, cx),
                "3" => self.change_page(Page::Items, cx),
                "4" => self.change_page(Page::Camera, cx),
                "5" => self.change_page(Page::Places, cx),
                "6" => self.change_page(Page::BigFun, cx),
                "v" if self.search_active => {
                    if let Some(text) = cx.read_from_clipboard().and_then(|i| i.text()) {
                        self.query.push_str(
                            &text
                                .chars()
                                .filter(|c| !c.is_control())
                                .take(128)
                                .collect::<String>(),
                        );
                    }
                }
                "a" if self.search_active => {
                    self.query.clear();
                }
                _ => {}
            }
        } else if key.key == "escape" {
            self.release_held_use(cx);
            self.slider_drag = None;
            self.scrollbar_drag = None;
            self.search_active = false;
            self.query.clear();
        } else if self.search_active {
            match key.key.as_str() {
                "backspace" => {
                    self.query.pop();
                }
                "enter" | "tab" => self.search_active = false,
                _ => {
                    if let Some(text) = &key.key_char {
                        if self.query.len() < 256 {
                            self.query.push_str(
                                &text.chars().filter(|c| !c.is_control()).collect::<String>(),
                            );
                        }
                    }
                }
            }
        }
        cx.notify();
    }
}
fn main() {
    diagnostics::install();
    let args = std::env::args().collect::<Vec<_>>();
    let preview = args.iter().any(|a| a == "--preview");
    let items = args.iter().any(|a| a == "--items");
    let big_fun = args.iter().any(|a| a == "--fun");
    Application::new().run(move |cx: &mut App| {
        cx.on_window_closed(|cx| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        let bounds = Bounds::centered(None, size(px(1040.), px(700.)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Big Hack".into()),
                    ..Default::default()
                }),
                window_min_size: Some(size(px(820.), px(560.))),
                ..Default::default()
            },
            move |window, cx| cx.new(|cx| BigHack::new(preview, items, big_fun, window, cx)),
        )
        .expect("open Big Hack window");
        cx.activate(true);
    });
}

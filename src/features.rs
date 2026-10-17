use super::*;

impl BigHack {
    pub(super) fn interaction_busy(&self) -> bool {
        self.pending.is_some() || self.held_use.is_some()
    }
    pub(super) fn held_owner_matches(&self, hold: &HeldUse) -> bool {
        hold.request["generation"] == self.snapshot.generation
            && hold.request["owner_pc"] == self.snapshot.owner_pc
            && hold.request["owner_pn"] == self.snapshot.owner_pn
    }
    pub(super) fn press_held_use(&mut self, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() || !self.snapshot.tools.held.can_use {
            return;
        }
        let mut request = self.snapshot.request("held_use", "tools");
        let press_id = format!("{}-{}", self.snapshot.generation, self.counter + 1);
        request["hold_id"] = json!(press_id);
        self.submit(request.clone(), cx);
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.0 == press_id)
        {
            self.held_use = Some(HeldUse {
                request,
                press_id,
                press_complete: false,
                release_requested: false,
                release_id: None,
                last_heartbeat: Instant::now(),
            });
        }
        cx.notify();
    }
    pub(super) fn release_held_use(&mut self, cx: &mut Context<Self>) {
        if let Some(hold) = &mut self.held_use {
            hold.release_requested = true;
            self.pump_held_use(cx);
            cx.notify();
        }
    }
    pub(super) fn pump_held_use(&mut self, cx: &mut Context<Self>) {
        let Some(hold) = self.held_use.as_ref() else {
            return;
        };
        // Never release against a replacement player or a new game session.
        if !self.held_owner_matches(hold) {
            self.held_use = None;
            cx.notify();
            return;
        }
        if hold.release_requested {
            if hold.press_complete && hold.release_id.is_none() && self.pending.is_none() {
                // A quick mouse-up can arrive before the press acknowledgement.
                // Keep the release queued, independent of the telemetry use flag.
                let mut request = hold.request.clone();
                request["action"] = json!("held_release");
                self.submit(request, cx);
                if let Some((id, _)) = &self.pending {
                    if let Some(hold) = &mut self.held_use {
                        hold.release_id = Some(id.clone());
                    }
                } else {
                    self.held_use = None;
                }
            }
        } else if hold.last_heartbeat.elapsed() >= Duration::from_millis(200) {
            let mut heartbeat = hold.request.clone();
            heartbeat["type"] = json!("held_heartbeat");
            heartbeat.as_object_mut().unwrap().remove("action");
            heartbeat.as_object_mut().unwrap().remove("target_kind");
            if let Some(bridge) = &mut self.bridge {
                bridge.send(&heartbeat);
            }
            if let Some(hold) = &mut self.held_use {
                hold.last_heartbeat = Instant::now();
            }
        }
    }
    pub(super) fn marked_label(
        &self,
        text: impl Into<SharedString>,
        size: f32,
        selected: bool,
        hoverable: bool,
    ) -> Div {
        marked_label_with_color(text, size, selected, hoverable, self.page.accent())
    }
    pub(super) fn save_library(&mut self) {
        if let Err(error) = self.library.save() {
            self.notice = Some((format!("Could not save your library: {error}"), false));
        }
    }
    pub(super) fn remember_location(&mut self, mut location: serde_json::Value) {
        if !library::valid_location(&location) {
            return;
        }
        if self.library.spots.len() >= 500 {
            self.notice = Some((
                "Your saved spots are full. Delete a spot first.".into(),
                false,
            ));
            return;
        }
        if location["label"].as_str().is_none_or(|s| s.is_empty()) {
            location["label"] = json!(format!("Spot {}", self.library.spots.len() + 1));
        }
        self.library.spots.push(location);
        self.selected_spot = Some(self.library.spots.len() - 1);
        self.save_library();
    }
    pub(super) fn save_preset(&mut self, cx: &mut Context<Self>) {
        let Some(settings) = self
            .snapshot
            .character_settings
            .as_ref()
            .filter(|s| self.live() && s.available && !self.interaction_busy())
        else {
            return;
        };
        if self.library.presets.len() >= 100 {
            return;
        }
        let mut values = settings.values.clone();
        if ["movement", "jump", "throw", "charge"]
            .iter()
            .any(|key| values.get(key).is_none_or(|v| !v.is_finite()))
        {
            return;
        }
        values.movement = values
            .movement
            .clamp(SETTING_MIN, Self::setting_max("movement"));
        values.jump = values.jump.clamp(SETTING_MIN, Self::setting_max("jump"));
        values.throw_strength = values
            .throw_strength
            .clamp(SETTING_MIN, Self::setting_max("throw"));
        values.charge = values
            .charge
            .clamp(SETTING_MIN, Self::setting_max("charge"));
        let label = format!("Preset {}", self.library.presets.len() + 1);
        self.library.presets.push(library::Preset {
            label,
            values,
            no_landing_dizziness: settings.no_landing_dizziness,
        });
        self.selected_preset = Some(self.library.presets.len() - 1);
        self.save_library();
        cx.notify();
    }
    pub(super) fn apply_preset(&mut self, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let Some(settings) = self
            .snapshot
            .character_settings
            .as_ref()
            .filter(|s| s.available && !s.key.is_empty())
        else {
            return;
        };
        let Some(preset) = self
            .selected_preset
            .and_then(|i| self.library.presets.get(i))
        else {
            return;
        };
        let mut req = self.snapshot.request("settings_preset", "self");
        req["settings_key"] = json!(settings.key);
        let mut values = preset.values.clone();
        values.clamp_supported();
        req["values"] = json!(values);
        req["no_landing_dizziness"] = json!(preset.no_landing_dizziness);
        self.submit(req, cx);
    }
    pub(super) fn tool_action(&mut self, action: &'static str, cx: &mut Context<Self>) {
        let held = &self.snapshot.tools.held;
        let allowed = match action {
            "held_drop" => held.can_drop,
            _ => false,
        };
        if self.live() && !self.interaction_busy() && allowed {
            self.submit(self.snapshot.request(action, "tools"), cx);
        }
    }
    pub(super) fn pocket_action(
        &mut self,
        action: &'static str,
        slot: String,
        home_key: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if !self.live() || self.interaction_busy() {
            return;
        }
        let Some(pocket) = self.snapshot.tools.pockets.iter().find(|p| p.slot == slot) else {
            return;
        };
        let permitted = match action {
            "pocket_equip" => pocket.can_equip,
            "pocket_equip_nearest" => pocket.can_equip_nearest,
            "pocket_unequip" => pocket.can_unequip,
            "pocket_store" | "pocket_take" => pocket.stored.iter().any(|home| {
                Some(home.home_key.as_str()) == home_key.as_deref()
                    && if action == "pocket_store" {
                        home.can_store
                    } else {
                        home.can_take
                    }
            }),
            _ => false,
        };
        if !permitted {
            return;
        }
        let mut request = self.snapshot.request(action, "pocket");
        request["slot"] = json!(slot);
        if let Some(home_key) = home_key {
            request["home_key"] = json!(home_key);
        }
        self.submit(request, cx);
    }
    pub(super) fn appearance_step(
        &mut self,
        part: &'static str,
        direction: i32,
        cx: &mut Context<Self>,
    ) {
        diagnostics::log(&format!("Appearance arrow: {part}, direction {direction}"));
        if !self.live() || self.interaction_busy() {
            diagnostics::log(
                "Appearance arrow ignored: connection stale or another action is active",
            );
            return;
        }
        let appearance = &self.snapshot.tools.appearance;
        if !appearance.available {
            return;
        }
        let ids = appearance
            .colors
            .iter()
            .filter(|c| c.available)
            .map(|c| c.id)
            .collect::<Vec<_>>();
        if ids.is_empty() {
            return;
        }
        let current = match part {
            "head" => appearance.head,
            "torso" => appearance.torso,
            _ => appearance.legs,
        };
        let next = match ids.iter().position(|id| *id == current) {
            Some(i) => ids[(i as i32 + direction).rem_euclid(ids.len() as i32) as usize],
            None if direction < 0 => *ids.last().unwrap(),
            None => ids[0],
        };
        let mut looks =
            json!({"head":appearance.head,"torso":appearance.torso,"legs":appearance.legs});
        looks[part] = json!(next);
        let mut req = self.snapshot.request("appearance_set", "tools");
        req["looks"] = looks;
        self.submit(req, cx);
    }
    pub(super) fn randomize_appearance(&mut self, cx: &mut Context<Self>) {
        if !self.live()
            || self.interaction_busy()
            || !self.snapshot.tools.appearance.available
            || !self
                .snapshot
                .tools
                .appearance
                .colors
                .iter()
                .any(|color| color.available)
        {
            return;
        }
        let request = self.snapshot.request("appearance_randomize", "tools");
        self.submit(request, cx);
    }
    fn appearance_arrow(
        &self,
        part: &'static str,
        index: usize,
        direction: i32,
        enabled: bool,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        // A fixed target keeps the entire arrow clickable, including its padding.
        // Dispatch on press so telemetry/scroll re-layout between down and up
        // cannot discard the pending click. One press sends exactly one request.
        div()
            .id((
                if direction < 0 {
                    "color-prev"
                } else {
                    "color-next"
                },
                index,
            ))
            .w(px(36.))
            .h(px(38.))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .text_color(rgb(if enabled { INK } else { 0xaaa99f }))
            .when(enabled, |el| el.cursor_pointer())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _, _, cx| {
                    if enabled {
                        this.appearance_step(part, direction, cx);
                    }
                }),
            )
            .child(self.marked_label(if direction < 0 { "←" } else { "→" }, 22., false, enabled))
    }
    pub(super) fn location_action(&mut self, action: &'static str, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() || self.snapshot.owner().is_none() {
            return;
        }
        let mut req = self.snapshot.request(action, "location");
        if action == "teleport_back" && !self.snapshot.location.can_return {
            return;
        }
        if action == "location_capture" {
            req["label"] = json!(format!("Spot {}", self.library.spots.len() + 1));
        } else if action == "location_teleport" {
            let Some(spot) = self.selected_spot.and_then(|i| self.library.spots.get(i)) else {
                return;
            };
            if !self.spot_compatible(spot) {
                return;
            }
            req["location"] = spot.clone();
        }
        self.submit(req, cx);
    }
    pub(super) fn spot_compatible(&self, spot: &serde_json::Value) -> bool {
        let build = if self.snapshot.build.is_null() {
            &self.snapshot.location.build
        } else {
            &self.snapshot.build
        };
        library::valid_location(spot) && !build.is_null() && spot["build"] == *build
    }
    pub(super) fn camera_action(
        &mut self,
        action: &'static str,
        direction: Option<&'static str>,
        cx: &mut Context<Self>,
    ) {
        let camera = &self.snapshot.camera;
        if !self.live() || self.interaction_busy() || !camera.available {
            return;
        }
        if action == "camera_detach" && !camera.free_available {
            return;
        }
        if matches!(action, "camera_move" | "camera_turn")
            && (!camera.detached || !camera.free_available)
        {
            return;
        }
        if action == "camera_return" && !camera.detached {
            return;
        }
        let mut req = self.snapshot.request(action, "camera");
        if let Some(direction) = direction {
            req["direction"] = json!(direction);
            req["step"] = json!(self.camera_step);
        }
        self.submit(req, cx);
    }
    pub(super) fn camera_zoom(&mut self, value: f32, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() || !self.snapshot.camera.available {
            return;
        }
        let current = self.snapshot.camera.zoom;
        if !current.is_finite() || !value.is_finite() {
            return;
        }
        let zoom = value.clamp(0.25, 8.);
        if (zoom - current).abs() < 0.0001 {
            return;
        }
        let mut req = self.snapshot.request("camera_zoom", "camera");
        req["zoom"] = json!(zoom);
        self.submit(req, cx);
        if self.pending.is_some() {
            self.setting_preview = Some(("camera_zoom", zoom));
        }
    }
    pub(super) fn collect_items(&mut self, item_type: Option<String>, cx: &mut Context<Self>) {
        if !self.live() || self.interaction_busy() || !self.snapshot.fun.items.available {
            return;
        }
        let mut req = self.snapshot.request("grab_all_items", "fun");
        let query = self.query.to_lowercase();
        req["items"] = json!(self.snapshot.items.iter().filter(|item| {
            item.available() && !item.in_inventory && item.net_id != 0
                && self.collection_radius.is_none_or(|r| item.distance.is_some_and(|d| d.is_finite() && d <= r))
                && item_type.as_ref().map_or_else(|| query.is_empty() || item.name.to_lowercase().contains(&query) || friendly_name(&item.name).to_lowercase().contains(&query), |name| friendly_name(&item.name) == friendly_name(name))
        }).take(4096).map(|item| json!({"pointer":item.pointer,"identity":item.identity,"net_id":item.net_id,"name":item.name})).collect::<Vec<_>>());
        if req["items"].as_array().is_none_or(|items| items.is_empty()) {
            self.notice = Some(("No available items match this selection.".into(), false));
            cx.notify();
            return;
        }
        self.submit(req, cx);
        if self.pending.is_some() {
            // Keep progress and Stop visible for collection started in Items.
            self.page = Page::BigFun;
            self.search_active = false;
            self.query.clear();
            cx.notify();
        }
    }
    pub(super) fn feature_button(
        &self,
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        enabled: bool,
        handler: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        self.selected_feature_button(id, label, enabled, false, handler, cx)
    }
    fn selected_feature_button(
        &self,
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        enabled: bool,
        selected: bool,
        handler: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .flex()
            .items_center()
            .py(px(5.))
            .text_color(rgb(if enabled { INK } else { 0xaaa99f }))
            .when(enabled, |el| el.cursor_pointer())
            .on_click(cx.listener(move |this, _, _, cx| {
                if enabled {
                    handler(this, cx);
                }
            }))
            .child(self.marked_label(label, 22., selected, enabled))
    }
    pub(super) fn section_title(text: &'static str) -> Div {
        div()
            .mt(px(26.))
            .mb(px(10.))
            .font_family("Consolas")
            .text_size(px(13.))
            .child(text)
    }
    pub(super) fn you_extras(&self, cx: &Context<Self>) -> Div {
        let ready = self.live() && !self.interaction_busy();
        let mut content = div().flex().flex_col().flex_none();
        content = content.child(Self::section_title("PRESETS"));
        let mut list = div().flex().flex_wrap().gap(px(14.));
        for (i, preset) in self.library.presets.iter().enumerate() {
            list = list.child(self.selected_feature_button(
                ("preset", i),
                preset.label.clone(),
                true,
                self.selected_preset == Some(i),
                move |this, cx| {
                    this.selected_preset = Some(i);
                    cx.notify();
                },
                cx,
            ));
        }
        content = content.child(list).child(
            div()
                .flex()
                .gap(px(22.))
                .child(
                    self.feature_button(
                        "preset-save",
                        "Save preset",
                        ready
                            && self
                                .snapshot
                                .character_settings
                                .as_ref()
                                .is_some_and(|s| s.available),
                        |this, cx| this.save_preset(cx),
                        cx,
                    ),
                )
                .child(self.feature_button(
                    "preset-apply",
                    "Apply",
                    ready && self.selected_preset.is_some(),
                    |this, cx| this.apply_preset(cx),
                    cx,
                ))
                .child(self.feature_button(
                    "preset-delete",
                    "Delete",
                    self.selected_preset.is_some(),
                    |this, cx| {
                        if let Some(i) = this
                            .selected_preset
                            .take()
                            .filter(|i| *i < this.library.presets.len())
                        {
                            this.library.presets.remove(i);
                            this.save_library();
                            cx.notify();
                        }
                    },
                    cx,
                )),
        );
        let held = &self.snapshot.tools.held;
        content = content
            .child(Self::section_title("IN YOUR HANDS"))
            .child(serif(
                self.snapshot
                    .owner()
                    .map(|p| p.carrying(&self.snapshot.players))
                    .unwrap_or_else(|| "Empty hands".into()),
                24.,
            ))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(22.))
                    .child(
                        div()
                            .id("held-use")
                            .flex()
                            .items_center()
                            .py(px(5.))
                            .text_color(rgb(
                                if (ready && held.can_use) || self.held_use.is_some() {
                                    INK
                                } else {
                                    0xaaa99f
                                },
                            ))
                            .when((ready && held.can_use) || self.held_use.is_some(), |el| {
                                el.cursor_pointer()
                            })
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _, _, cx| {
                                    this.press_held_use(cx);
                                }),
                            )
                            .child(self.marked_label(
                                "Use",
                                22.,
                                self.held_use.as_ref().is_some_and(|h| !h.release_requested),
                                ready && held.can_use,
                            )),
                    )
                    .child(self.feature_button(
                        "held-drop",
                        "Drop",
                        ready && held.can_drop,
                        |this, cx| this.tool_action("held_drop", cx),
                        cx,
                    )),
            );
        if !held.reason.is_empty() {
            content = content.child(
                div()
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child(held.reason.clone()),
            );
        }
        content = content.child(Self::section_title("EQUIPMENT"));
        let holding_item = self
            .snapshot
            .owner()
            .is_some_and(|owner| owner.held_item.is_some());
        let pockets = self
            .snapshot
            .tools
            .pockets
            .iter()
            .filter(|pocket| matches!(pocket.slot.as_str(), "backpack" | "holster"))
            .collect::<Vec<_>>();
        if !self.snapshot.tools.pockets_reason.is_empty() {
            content = content.child(
                div()
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child(self.snapshot.tools.pockets_reason.clone()),
            );
        }
        if holding_item && pockets.iter().any(|pocket| pocket.item_key.is_none()) {
            content = content.child(
                div()
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child("Empty your hands to equip gear."),
            );
        }
        for (i, pocket) in pockets.iter().enumerate() {
            let wearing = pocket.item_key.is_some();
            if wearing {
                let key = pocket.item_key.clone();
                content = content.child(
                    self.feature_button(
                        ("pocket", i),
                        format!("{} (equipped)", pocket.name),
                        pocket.available,
                        move |this, cx| {
                            if let Some(key) = key.clone() {
                                this.selected_item = Some(key);
                                this.change_page(Page::Items, cx);
                            }
                        },
                        cx,
                    )
                    .mt(px(12.)),
                );
            } else {
                content = content.child(serif(pocket.name.clone(), 22.).mt(px(12.)));
            }
            if !pocket.available {
                if !pocket.reason.is_empty() {
                    content = content.child(
                        div()
                            .text_size(px(13.))
                            .text_color(rgb(MUTED))
                            .child(pocket.reason.clone()),
                    );
                }
                continue;
            }
            if !wearing {
                let slot = pocket.slot.clone();
                content = content.child(self.feature_button(
                    ("pocket-equip-closest", i),
                    "Equip closest",
                    ready && pocket.can_equip_nearest,
                    move |this, cx| {
                        this.pocket_action("pocket_equip_nearest", slot.clone(), None, cx)
                    },
                    cx,
                ));
                if !pocket.can_equip_nearest
                    && !pocket.equip_nearest_reason.is_empty()
                    && pocket.equip_nearest_reason != "Empty your hands to equip gear"
                {
                    content = content.child(
                        div()
                            .text_size(px(13.))
                            .text_color(rgb(MUTED))
                            .child(pocket.equip_nearest_reason.clone()),
                    );
                }
                continue;
            }
            let store_slot = pocket.slot.clone();
            let store_home = pocket
                .stored
                .iter()
                .find(|home| home.can_store)
                .map(|home| home.home_key.clone());
            let unequip_slot = pocket.slot.clone();
            let mut actions = div().flex().flex_wrap().gap(px(22.));
            if holding_item {
                actions = actions.child(self.feature_button(
                    ("pocket-store", i),
                    "Store held item",
                    ready && pocket.can_store && store_home.is_some(),
                    move |this, cx| {
                        this.pocket_action(
                            "pocket_store",
                            store_slot.clone(),
                            store_home.clone(),
                            cx,
                        )
                    },
                    cx,
                ));
            }
            actions = actions.child(self.feature_button(
                ("pocket-unequip", i),
                "Take off",
                ready && pocket.can_unequip,
                move |this, cx| {
                    this.pocket_action("pocket_unequip", unequip_slot.clone(), None, cx)
                },
                cx,
            ));
            content = content.child(actions);
            if holding_item && !pocket.can_store && !pocket.store_reason.is_empty() {
                content = content.child(
                    div()
                        .text_size(px(13.))
                        .text_color(rgb(MUTED))
                        .child(pocket.store_reason.clone()),
                );
            }
            for (j, storage) in pocket
                .stored
                .iter()
                .filter(|home| home.item_key.is_some())
                .enumerate()
            {
                let slot = pocket.slot.clone();
                let home = storage.home_key.clone();
                let name = storage
                    .item_name
                    .as_deref()
                    .map(friendly_name)
                    .unwrap_or_else(|| "item".into());
                content = content.child(self.feature_button(
                    ("pocket-take", i * 100 + j),
                    format!("Take out {name}"),
                    ready && storage.can_take,
                    move |this, cx| {
                        this.pocket_action("pocket_take", slot.clone(), Some(home.clone()), cx)
                    },
                    cx,
                ));
            }
        }
        let appearance = &self.snapshot.tools.appearance;
        content = content.child(Self::section_title("APPEARANCE"));
        for (i, part, label, id) in [
            (0usize, "head", "Head", appearance.head),
            (1, "torso", "Torso", appearance.torso),
            (2, "legs", "Legs", appearance.legs),
        ] {
            let color = appearance
                .colors
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.color)
                .unwrap_or([0.5, 0.5, 0.5, 1.]);
            let rgb_color = ((color[0].clamp(0., 1.) * 255.) as u32) << 16
                | ((color[1].clamp(0., 1.) * 255.) as u32) << 8
                | (color[2].clamp(0., 1.) * 255.) as u32;
            let enabled =
                ready && appearance.available && appearance.colors.iter().any(|c| c.available);
            content = content.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(20.))
                    .child(serif(label, 22.).w(px(100.)))
                    .child(self.appearance_arrow(part, i, -1, enabled, cx))
                    .child(
                        div()
                            .size(px(24.))
                            .rounded_full()
                            .bg(rgb(rgb_color))
                            .border_1()
                            .border_color(rgb(INK)),
                    )
                    .child(serif(format!("{}", id), 18.).w(px(30.)))
                    .child(self.appearance_arrow(part, i, 1, enabled, cx)),
            );
        }
        if !appearance.available && !appearance.reason.is_empty() {
            content = content.child(
                div()
                    .mt(px(6.))
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child(appearance.reason.clone()),
            );
        }
        content.pb(px(26.))
    }
    pub(super) fn camera_menu(&self, cx: &Context<Self>) -> Stateful<Div> {
        let camera = &self.snapshot.camera;
        let ready = self.live() && !self.interaction_busy() && camera.available;
        let available = self.live() && camera.available;
        let zoom = self
            .slider_drag
            .as_ref()
            .filter(|d| d.setting == "camera_zoom")
            .map(|d| d.value)
            .or_else(|| {
                self.setting_preview
                    .filter(|(key, _)| *key == "camera_zoom")
                    .map(|(_, value)| value)
            })
            .unwrap_or(camera.zoom);
        let color = if available { INK } else { 0xaaa99f };
        let fraction = ((zoom - 0.25) / 7.75).clamp(0., 1.);
        let measured = std::rc::Rc::new(std::cell::Cell::new(None::<Bounds<Pixels>>));
        let bounds_out = measured.clone();
        let slider = div()
            .id("camera-zoom-slider")
            .flex_1()
            .min_w_0()
            .h(px(36.))
            .when(available, |el| el.cursor_pointer())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                    if ready {
                        if let Some(bounds) = measured.get() {
                            this.start_slider("camera_zoom", bounds, event.position.x, cx);
                            cx.stop_propagation();
                        }
                    }
                }),
            )
            .child(
                canvas(
                    move |bounds, _, _| {
                        bounds_out.set(Some(bounds));
                    },
                    move |bounds, _, window, _| {
                        let width = (f32::from(bounds.size.width) - 24.).max(1.);
                        let y = bounds.origin.y + bounds.size.height / 2.;
                        window.paint_quad(fill(
                            Bounds::new(
                                point(bounds.origin.x + px(12.), y - px(1.)),
                                size(px(width), px(2.)),
                            ),
                            rgb(color),
                        ));
                        let x = bounds.origin.x + px(12. + width * fraction);
                        window.paint_quad(quad(
                            Bounds::new(point(x - px(12.), y - px(12.)), size(px(24.), px(24.))),
                            px(12.),
                            rgba(0),
                            px(2.),
                            rgb(color),
                            BorderStyle::Solid,
                        ));
                    },
                )
                .size_full(),
            );
        let mut content = div()
            .id("camera-menu")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(12.));
        content = content
            .child(Self::section_title("ZOOM"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .max_w(px(620.))
                    .gap(px(24.))
                    .child(slider)
                    .child(
                        serif(format!("{zoom:.2}×"), 28.)
                            .w(px(90.))
                            .flex_none()
                            .text_right()
                            .text_color(rgb(color)),
                    ),
            )
            .child(Self::section_title("PHOTO CAMERA"))
            .child(
                div()
                    .flex()
                    .gap(px(24.))
                    .child(self.feature_button(
                        "camera-detach",
                        "Detach camera",
                        ready && camera.free_available && !camera.detached,
                        |this, cx| this.camera_action("camera_detach", None, cx),
                        cx,
                    ))
                    .child(self.feature_button(
                        "camera-return",
                        "Return camera",
                        ready && camera.detached,
                        |this, cx| this.camera_action("camera_return", None, cx),
                        cx,
                    )),
            );
        let mut steps = div()
            .flex()
            .gap(px(20.))
            .items_center()
            .child(serif("Move by", 20.));
        for (i, step) in [(0usize, 0.25), (1, 1.), (2, 5.), (3, 20.)] {
            steps = steps.child(self.selected_feature_button(
                ("camera-step", i),
                format!("{step} m"),
                true,
                (self.camera_step - step).abs() < 0.001,
                move |this, cx| {
                    this.camera_step = step;
                    cx.notify();
                },
                cx,
            ));
        }
        content = content.child(steps);
        let mut moves = div().flex().flex_wrap().gap(px(22.));
        for (i, direction, label) in [
            (0usize, "forward", "Forward"),
            (1, "back", "Back"),
            (2, "left", "Left"),
            (3, "right", "Right"),
            (4, "up", "Up"),
            (5, "down", "Down"),
        ] {
            moves = moves.child(self.feature_button(
                ("camera-move", i),
                label,
                ready && camera.free_available && camera.detached,
                move |this, cx| this.camera_action("camera_move", Some(direction), cx),
                cx,
            ));
        }
        content = content.child(moves);
        let mut turns = div().flex().flex_wrap().gap(px(22.));
        for (i, direction, label) in [
            (0usize, "left", "Look left"),
            (1, "right", "Look right"),
            (2, "up", "Look up"),
            (3, "down", "Look down"),
        ] {
            turns = turns.child(self.feature_button(
                ("camera-turn", i),
                label,
                ready && camera.free_available && camera.detached,
                move |this, cx| this.camera_action("camera_turn", Some(direction), cx),
                cx,
            ));
        }
        content = content.child(turns);

        for reason in [&camera.reason, &camera.free_reason]
            .into_iter()
            .filter(|r| !r.is_empty())
        {
            content = content.child(
                div()
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child(reason.clone()),
            );
        }
        content
    }
    pub(super) fn places_menu(&self, cx: &Context<Self>) -> Stateful<Div> {
        let ready = self.live() && !self.interaction_busy() && self.snapshot.owner().is_some();
        let mut content = div()
            .id("places-menu")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(14.))
            .child(self.feature_button(
                "teleport-back",
                "Teleport back",
                ready && self.snapshot.location.can_return,
                |this, cx| this.location_action("teleport_back", cx),
                cx,
            ))
            .child(Self::section_title("SAVED SPOTS"));
        for (i, spot) in self.library.spots.iter().enumerate() {
            let compatible = self.spot_compatible(spot);
            let label = spot["label"].as_str().unwrap_or("Saved spot");
            content = content.child(self.selected_feature_button(
                ("spot", i),
                format!(
                    "{}{}",
                    label,
                    if self.live() && !compatible {
                        " (different game build)"
                    } else {
                        ""
                    }
                ),
                true,
                self.selected_spot == Some(i),
                move |this, cx| {
                    this.selected_spot = Some(i);
                    cx.notify();
                },
                cx,
            ));
        }
        if let Some(spot) = self.selected_spot.and_then(|i| self.library.spots.get(i)) {
            let position = serde_json::from_value::<[f32; 3]>(spot["position"].clone()).ok();
            content = content.child(
                div()
                    .text_color(rgb(MUTED))
                    .text_size(px(13.))
                    .child(position_label(position)),
            );
        }
        content.child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(26.))
                .child(self.feature_button(
                    "spot-save",
                    "Save this spot",
                    ready && self.library.spots.len() < 500,
                    |this, cx| this.location_action("location_capture", cx),
                    cx,
                ))
                .child(
                    self.feature_button(
                        "spot-go",
                        "Teleport to",
                        ready
                            && self
                                .selected_spot
                                .and_then(|i| self.library.spots.get(i))
                                .is_some_and(|s| self.spot_compatible(s)),
                        |this, cx| this.location_action("location_teleport", cx),
                        cx,
                    ),
                )
                .child(self.feature_button(
                    "spot-delete",
                    "Delete",
                    self.selected_spot.is_some(),
                    |this, cx| {
                        if let Some(i) = this
                            .selected_spot
                            .take()
                            .filter(|i| *i < this.library.spots.len())
                        {
                            this.library.spots.remove(i);
                            this.save_library();
                            cx.notify();
                        }
                    },
                    cx,
                )),
        )
    }
    pub(super) fn collection_controls(&self, item_type: Option<String>, cx: &Context<Self>) -> Div {
        let mut choices = div().flex().flex_wrap().gap(px(20.));
        for (i, radius, label) in [
            (0usize, Some(20.), "20 m"),
            (1, Some(100.), "100 m"),
            (2, None, "All distances"),
        ] {
            choices = choices.child(self.selected_feature_button(
                ("collect-radius", i),
                label,
                true,
                self.collection_radius == radius,
                move |this, cx| {
                    this.collection_radius = radius;
                    cx.notify();
                },
                cx,
            ));
        }
        let ready = self.live() && !self.interaction_busy() && self.snapshot.fun.items.available;
        div()
            .mt(px(16.))
            .child(Self::section_title("COLLECT ITEMS"))
            .child(choices)
            .child(self.feature_button(
                "selective-collect",
                if item_type.is_some() {
                    "Collect this type"
                } else {
                    "Collect nearby / matching items"
                },
                ready,
                move |this, cx| this.collect_items(item_type.clone(), cx),
                cx,
            ))
    }
}

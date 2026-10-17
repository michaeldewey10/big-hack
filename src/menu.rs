use super::*;

impl BigHack {
    fn connection_label(&self) -> &'static str {
        match self.state.as_str() {
            "live" => "Connected to Big Walk",
            "preview" => "Preview",
            "attached" => "Waiting for your character…",
            "paused" => "Disconnected",
            "checking" => "Checking game…",
            "error" => "Could not connect",
            "stale" => "Waiting for updates…",
            _ => "Looking for Big Walk…",
        }
    }

    fn navigation(&self, cx: &Context<Self>) -> Div {
        let mut links = div().flex().flex_col().gap(px(22.)).pt(px(40.));
        for (index, page, label) in [
            (0usize, Page::You, "You"),
            (1, Page::Party, "Party"),
            (2, Page::Items, "Items"),
            (3, Page::Camera, "Camera"),
            (4, Page::Places, "Places"),
            (5, Page::BigFun, "Big Fun"),
        ] {
            let active = self.page == page;
            links = links.child(
                div()
                    .id(("page", index))
                    .flex()
                    .justify_end()
                    .text_right()
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| this.change_page(page, cx)))
                    .child(marked_label_with_color(
                        label,
                        28.,
                        active,
                        true,
                        page.accent(),
                    )),
            );
        }
        div()
            .w(px(185.))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .pr(px(32.))
            .border_r_2()
            .border_color(rgb(INK))
            .text_right()
            .child(links)
            .child(div().flex_1())
            .child(
                div()
                    .text_size(px(14.))
                    .text_color(rgb(MUTED))
                    .line_height(px(20.))
                    .child(self.connection_label()),
            )
            .child(
                div()
                    .id("reconnect")
                    .flex()
                    .justify_end()
                    .mt(px(15.))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.control("reconnect", cx)))
                    .child(self.marked_label(
                        if self.preview {
                            "Connect to game"
                        } else {
                            "Reconnect"
                        },
                        20.,
                        false,
                        true,
                    )),
            )
    }

    fn you_menu(&self, cx: &Context<Self>) -> Stateful<Div> {
        let settings = self.snapshot.character_settings.as_ref();
        let available = self.live() && settings.is_some_and(|s| s.available);
        let ready = available && !self.interaction_busy();
        let mut content = div()
            .id("you-settings")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .max_w(px(620.))
            .flex()
            .flex_col();
        for (index, setting, label) in [
            (0usize, "movement", "Movement speed"),
            (1, "jump", "Jump height"),
            (2, "throw", "Throw / kick strength"),
            (3, "charge", "Throw charge speed"),
        ] {
            let value = self
                .slider_drag
                .as_ref()
                .filter(|drag| drag.setting == setting)
                .map(|drag| drag.value)
                .or_else(|| {
                    self.setting_preview
                        .filter(|(key, _)| *key == setting)
                        .map(|(_, value)| value)
                })
                .or_else(|| settings.and_then(|s| s.values.get(setting)));
            let enabled = ready && value.is_some();
            // Pending requests gate input without changing the sliders' appearance.
            let color = if available && value.is_some() {
                INK
            } else {
                0xaaa99f
            };
            let measured = std::rc::Rc::new(std::cell::Cell::new(None::<Bounds<Pixels>>));
            let bounds_out = measured.clone();
            let fraction = ((value.unwrap_or(1.) - SETTING_MIN)
                / (Self::setting_max(setting) - SETTING_MIN))
                .clamp(0., 1.);
            let slider = div()
                .id(("character-slider", index))
                .flex_1()
                .min_w_0()
                .h(px(36.))
                .when(available && value.is_some(), |el| el.cursor_pointer())
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                        if enabled {
                            if let Some(bounds) = measured.get() {
                                this.start_slider(setting, bounds, event.position.x, cx);
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
                            let center_y = bounds.origin.y + bounds.size.height / 2.;
                            window.paint_quad(fill(
                                Bounds::new(
                                    point(bounds.origin.x + px(12.), center_y - px(1.)),
                                    size(px(width), px(2.)),
                                ),
                                rgb(color),
                            ));
                            let center_x = bounds.origin.x + px(12. + width * fraction);
                            window.paint_quad(quad(
                                Bounds::new(
                                    point(center_x - px(12.), center_y - px(12.)),
                                    size(px(24.), px(24.)),
                                ),
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
            content = content.child(
                div()
                    .h(px(72.))
                    .flex_none()
                    .child(
                        div()
                            .font_family("Consolas")
                            .text_size(px(13.))
                            .child(label.to_uppercase()),
                    )
                    .child(
                        div()
                            .mt(px(5.))
                            .flex()
                            .items_center()
                            .gap(px(24.))
                            .child(slider)
                            .child(
                                serif(
                                    value
                                        .map(|v| format!("{v:.2}×"))
                                        .unwrap_or_else(|| "—".into()),
                                    27.,
                                )
                                .w(px(90.))
                                .flex_none()
                                .text_right()
                                .text_color(rgb(color)),
                            ),
                    ),
            );
        }
        let landing_available = self.live() && settings.is_some_and(|s| s.dizziness_available);
        let landing_ready = landing_available && !self.interaction_busy();
        let no_dizziness = self
            .dizziness_preview
            .unwrap_or_else(|| settings.is_some_and(|s| s.no_landing_dizziness));
        let mut choices = div()
            .flex()
            .justify_center()
            .items_center()
            .gap(px(28.))
            .mt(px(10.));
        for (index, label, enabled) in [(0usize, "On", true), (1, "Off", false)] {
            choices = choices.child(
                div()
                    .id(("landing-dizziness", index))
                    .flex()
                    .text_color(rgb(if landing_available { INK } else { 0xaaa99f }))
                    .when(landing_available, |el| el.cursor_pointer())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if landing_ready {
                            this.set_landing_dizziness(enabled, cx);
                        }
                    }))
                    .child(self.marked_label(
                        label,
                        27.,
                        landing_available && enabled != no_dizziness,
                        landing_available,
                    )),
            );
            if index == 0 {
                choices = choices.child(serif("/", 32.));
            }
        }
        content = content.child(
            div()
                .h(px(94.))
                .flex_none()
                .child(
                    div()
                        .font_family("Consolas")
                        .text_size(px(13.))
                        .child("LANDING DIZZINESS"),
                )
                .child(choices),
        );
        if self.live() {
            if let Some(reason) = settings
                .filter(|s| !s.dizziness_available && !s.dizziness_reason.is_empty())
                .map(|s| s.dizziness_reason.clone())
            {
                content = content.child(
                    div()
                        .text_size(px(13.))
                        .text_color(rgb(MUTED))
                        .mb(px(12.))
                        .child(reason),
                );
            }
        }
        let modified = (available || landing_available) && settings.is_some_and(|s| s.modified);
        let restore = modified && !self.interaction_busy();
        content
            .child(
                div()
                    .mt(px(16.))
                    .flex()
                    .justify_center()
                    .id("restore-character")
                    .text_color(rgb(if modified { INK } else { 0xaaa99f }))
                    .when(modified, |el| el.cursor_pointer())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if restore {
                            this.character_setting("restore", 0., cx);
                        }
                    }))
                    .child(self.marked_label("• Restore original •", 27., false, modified)),
            )
            .child(self.you_extras(cx))
    }

    fn fun_menu(&self, cx: &Context<Self>) -> Stateful<Div> {
        let mut content = div()
            .id("big-fun")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(28.))
            .pt(px(28.));
        for (index, action, label) in [
            (0usize, "spawn_corpses", "Spawn 10 corpses around you"),
            (1, "spawn_corpse_pins", "Spawn 10 corpse bowling pins"),
            (2, "clear_corpses", "Clear all corpses"),
            (3, "grab_all_items", "Grab every item"),
            (4, "gather_party", "Bring everyone to you"),
        ] {
            let capability = self.snapshot.fun.get(action);
            let available = self.live() && capability.is_some_and(|c| c.available);
            let enabled = available && !self.interaction_busy();
            let mut row = div().flex().flex_col().gap(px(5.)).child(
                div()
                    .id(("fun-action", index))
                    .flex()
                    .text_color(rgb(if available { INK } else { 0xaaa99f }))
                    .when(available, |el| el.cursor_pointer())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if enabled {
                            this.fun_action(action, cx);
                        }
                    }))
                    .child(self.marked_label(label, 27., false, available)),
            );
            if self.live() {
                if let Some(cap) = capability.filter(|c| !c.available && !c.reason.is_empty()) {
                    row = row.child(
                        div()
                            .text_size(px(13.))
                            .text_color(rgb(MUTED))
                            .child(cap.reason.clone()),
                    );
                }
                if let Some(cap) = capability.filter(|c| c.available && !c.note.is_empty()) {
                    row = row.child(
                        div()
                            .text_size(px(13.))
                            .text_color(rgb(MUTED))
                            .child(cap.note.clone()),
                    );
                }
            }
            content = content.child(row);
        }
        let appearance = &self.snapshot.tools.appearance;
        let colors_available = self.live()
            && appearance.available
            && appearance.colors.iter().any(|color| color.available);
        let colors_enabled = colors_available && !self.interaction_busy();
        content = content.child(
            div()
                .flex()
                .flex_col()
                .gap(px(5.))
                .child(
                    div()
                        .id("randomize-my-colors")
                        .flex()
                        .text_color(rgb(if colors_available { INK } else { 0xaaa99f }))
                        .when(colors_available, |el| el.cursor_pointer())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if colors_enabled {
                                this.randomize_appearance(cx);
                            }
                        }))
                        .child(self.marked_label(
                            "Randomize my colors",
                            27.,
                            false,
                            colors_available,
                        )),
                )
                .when(
                    self.live() && !appearance.available && !appearance.reason.is_empty(),
                    |el| {
                        el.child(
                            div()
                                .text_size(px(13.))
                                .text_color(rgb(MUTED))
                                .child(appearance.reason.clone()),
                        )
                    },
                ),
        );
        if let Some(progress) = self
            .fun_progress
            .as_ref()
            .filter(|_| self.pending.is_some())
        {
            content = content.child(
                div()
                    .mt(px(10.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(serif(
                        format!("{} / {}", progress.processed, progress.total),
                        24.,
                    ))
                    .child(
                        div()
                            .text_size(px(13.))
                            .text_color(rgb(MUTED))
                            .child(format!(
                                "{} {} · {} skipped · {} failed",
                                progress.completed,
                                if progress.action == "clear_corpses" {
                                    "cleared"
                                } else {
                                    "collected"
                                },
                                progress.skipped,
                                progress.failed
                            )),
                    )
                    .child(
                        div()
                            .id("stop-fun")
                            .flex()
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| this.stop_fun(cx)))
                            .child(self.marked_label(
                                if self.fun_cancel_requested {
                                    "Stopping…"
                                } else {
                                    "Stop"
                                },
                                24.,
                                false,
                                true,
                            )),
                    ),
            );
        }
        content
    }

    fn simple_search(&self, cx: &Context<Self>) -> Stateful<Div> {
        div()
            .id("search")
            .flex()
            .items_center()
            .h(px(37.))
            .mb(px(14.))
            .border_b_1()
            .border_color(rgb(if self.search_active { INK } else { LINE }))
            .cursor_text()
            .on_click(cx.listener(|this, _, window, cx| {
                this.search_active = true;
                this.focus.focus(window);
                cx.notify();
            }))
            .child(
                serif(
                    if self.query.is_empty() {
                        "Search…".into()
                    } else {
                        format!(
                            "{}{}",
                            self.query,
                            if self.search_active { "|" } else { "" }
                        )
                    },
                    18.,
                )
                .text_color(rgb(if self.query.is_empty() { MUTED } else { INK }))
                .overflow_hidden()
                .whitespace_nowrap(),
            )
    }

    fn person_list(&self, cx: &Context<Self>) -> Stateful<Div> {
        let mut list = div()
            .id("party-list")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll();
        for (index, player) in self.snapshot.players.iter().enumerate() {
            let key = player.key.clone();
            let selected = self.selected_player.as_ref() == Some(&key);
            list = list.child(
                div()
                    .id(("person", index))
                    .w_full()
                    .h(px(48.))
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .cursor_pointer()
                    .hover(|el| el.text_color(rgb(self.page.accent())))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.selected_player = Some(key.clone());
                        this.search_active = false;
                        cx.notify();
                    }))
                    .child(if selected {
                        dot(self.page.accent())
                    } else {
                        div().size(px(10.))
                    })
                    .child(
                        serif(player.name.clone(), 23.)
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap(),
                    )
                    .child(
                        serif(
                            if player.is_local {
                                "you".into()
                            } else {
                                distance_label(player.distance)
                            },
                            16.,
                        )
                        .text_color(rgb(MUTED)),
                    ),
            );
        }
        if self.snapshot.players.is_empty() {
            list = list
                .child(serif("Your party will appear here.", 22.).mt(px(22.)))
                .child(
                    div()
                        .mt(px(12.))
                        .text_size(px(15.))
                        .text_color(rgb(MUTED))
                        .child("Enter a Big Walk session to connect."),
                );
        }
        list
    }

    fn prepare_items(&mut self) {
        let query = self.query.to_lowercase();
        self.visible_items = self
            .snapshot
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                query.is_empty()
                    || item.name.to_lowercase().contains(&query)
                    || friendly_name(&item.name).to_lowercase().contains(&query)
            })
            .map(|(index, _)| index)
            .collect();
        self.visible_items.sort_by(|a, b| {
            let a = &self.snapshot.items[*a];
            let b = &self.snapshot.items[*b];
            a.distance
                .unwrap_or(f32::MAX)
                .total_cmp(&b.distance.unwrap_or(f32::MAX))
                .then(a.index.cmp(&b.index))
        });
    }

    fn simple_item(&self, index: usize, item: &Item, cx: &Context<Self>) -> Stateful<Div> {
        let key = item.key.clone();
        let selected = self.selected_item.as_ref() == Some(&key);
        div()
            .id(("item", index))
            .w_full()
            .h(px(43.))
            .flex()
            .items_center()
            .gap(px(12.))
            .cursor_pointer()
            .hover(|el| el.text_color(rgb(self.page.accent())))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.selected_item = Some(key.clone());
                this.search_active = false;
                cx.notify();
            }))
            .child(if selected {
                dot(self.page.accent())
            } else {
                div().size(px(10.))
            })
            .child(
                serif(friendly_name(&item.name), 21.)
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap(),
            )
            .child(
                serif(distance_label(item.distance), 16.)
                    .w(px(85.))
                    .flex_none()
                    .text_right()
                    .text_color(rgb(MUTED)),
            )
    }

    fn simple_action(
        &self,
        id: &'static str,
        label: &'static str,
        action: &'static str,
        enabled: bool,
        cx: &Context<Self>,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .py(px(6.))
            .cursor_pointer()
            .text_color(rgb(if enabled { INK } else { 0xaaa99f }))
            .when(enabled, |el| {
                el.hover(|el| el.text_color(rgb(self.page.accent())))
            })
            .on_click(cx.listener(move |this, _, _, cx| {
                if enabled {
                    this.action(action, cx);
                }
            }))
            .child(serif(label, 23.))
    }

    fn selection_details(&self, cx: &Context<Self>) -> Div {
        let player = if self.page == Page::Party {
            self.snapshot
                .players
                .iter()
                .find(|p| Some(&p.key) == self.selected_player.as_ref())
        } else {
            None
        };
        let item = if self.page == Page::Items {
            self.snapshot
                .items
                .iter()
                .find(|p| Some(&p.key) == self.selected_item.as_ref())
        } else {
            None
        };
        let mut details = div()
            .mt(px(18.))
            .pt(px(15.))
            .border_t_1()
            .border_color(rgb(LINE))
            .flex_none();
        let target_exists;
        let position_available;
        let mut available = true;
        if let Some(player) = player {
            target_exists = !player.is_local;
            position_available = player.position.is_some();
            details = details
                .child(serif(format!("{} · {}", player.name, player.state()), 18.))
                .child(
                    div()
                        .mt(px(5.))
                        .text_size(px(14.))
                        .text_color(rgb(MUTED))
                        .child(format!(
                            "Carrying: {}",
                            player.carrying(&self.snapshot.players)
                        )),
                );
        } else if let Some(item) = item {
            target_exists = true;
            available = item.available();
            position_available = item.position.is_some();
            details = details.child(serif(friendly_name(&item.name), 18.)).child(
                div()
                    .mt(px(5.))
                    .text_size(px(14.))
                    .text_color(rgb(MUTED))
                    .child(item.holder(&self.snapshot.players)),
            );
        } else {
            return details.child(serif("Select a player or item.", 18.).text_color(rgb(MUTED)));
        }
        let selected_position = player
            .and_then(|p| p.position)
            .or_else(|| item.and_then(|i| i.position));
        details = details.child(
            div()
                .mt(px(5.))
                .text_size(px(13.))
                .text_color(rgb(MUTED))
                .child(format!("Position: {}", position_label(selected_position))),
        );
        let enabled = self.live() && !self.interaction_busy() && target_exists;
        let hands_empty = self
            .snapshot
            .owner()
            .is_some_and(|p| p.hands_empty(&self.snapshot.players));
        details = details.child(
            div()
                .mt(px(10.))
                .flex()
                .gap(px(32.))
                .child(self.simple_action(
                    "pickup",
                    "Pick up",
                    "pickup",
                    enabled && hands_empty && available,
                    cx,
                ))
                .child(self.simple_action(
                    "teleport",
                    "Teleport to",
                    "teleport",
                    enabled && position_available,
                    cx,
                )),
        );
        let hint = if self.preview {
            "Preview — connect to the game to use actions."
        } else if self.pending.is_some() {
            "Waiting for the game…"
        } else if !self.live() {
            "Waiting for a fresh game update."
        } else if player.is_some_and(|p| p.is_local) {
            "This is your character."
        } else if !hands_empty {
            "Drop what you’re carrying to pick something up."
        } else if !available {
            "This item is already being held."
        } else {
            ""
        };
        if !hint.is_empty() {
            details = details.child(
                div()
                    .mt(px(5.))
                    .text_size(px(13.))
                    .text_color(rgb(MUTED))
                    .child(hint),
            );
        }
        if let Some(item) = item {
            details = details.child(self.collection_controls(Some(item.name.clone()), cx));
        }
        details
    }
}

impl Render for BigHack {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut body = div().flex_1().min_w_0().h_full().flex().flex_col().child(
            div()
                .flex()
                .flex_col()
                .items_end()
                .mb(px(18.))
                .child(self.marked_label(
                    match self.page {
                        Page::You => "YOU",
                        Page::Party => "PARTY",
                        Page::Items => "ITEMS",
                        Page::BigFun => "BIG FUN",
                        Page::Camera => "CAMERA",
                        Page::Places => "PLACES",
                    },
                    32.,
                    true,
                    false,
                ))
                .child(div().text_size(px(14.)).text_color(rgb(MUTED)).child(
                    if matches!(self.page, Page::You | Page::Camera | Page::Places) {
                        self.snapshot
                            .owner()
                            .map(|p| p.name.clone())
                            .unwrap_or_default()
                    } else {
                        format!(
                            "{} {}",
                            if self.page == Page::Party || self.page == Page::BigFun {
                                self.snapshot.players.len()
                            } else {
                                self.snapshot.items.len()
                            },
                            if self.page == Page::Party || self.page == Page::BigFun {
                                "players"
                            } else {
                                "items"
                            }
                        )
                    },
                )),
        );
        let scroll_handle = self.scroll_handle();
        if self.page == Page::You {
            body = body.child(self.scroll_panel(
                self.you_menu(cx).track_scroll(&scroll_handle),
                scroll_handle.clone(),
                cx,
            ));
        } else if self.page == Page::Camera {
            body = body.child(self.scroll_panel(
                self.camera_menu(cx).track_scroll(&scroll_handle),
                scroll_handle.clone(),
                cx,
            ));
        } else if self.page == Page::Places {
            body = body.child(self.scroll_panel(
                self.places_menu(cx).track_scroll(&scroll_handle),
                scroll_handle.clone(),
                cx,
            ));
        } else if self.page == Page::Party {
            body = body.child(self.scroll_panel(
                self.person_list(cx).track_scroll(&scroll_handle),
                scroll_handle.clone(),
                cx,
            ));
        } else if self.page == Page::BigFun {
            body = body.child(self.scroll_panel(
                self.fun_menu(cx).track_scroll(&scroll_handle),
                scroll_handle.clone(),
                cx,
            ));
        } else {
            body = body.child(self.simple_search(cx));
            self.prepare_items();
            if self.visible_items.is_empty() {
                body = body.child(
                    div().flex_1().child(
                        serif(
                            if self.snapshot.items.is_empty() {
                                "Waiting for items…"
                            } else {
                                "No matching items."
                            },
                            20.,
                        )
                        .mt(px(20.)),
                    ),
                );
            } else {
                let count = self.visible_items.len();
                body = body.child(
                    self.scroll_panel(
                        uniform_list(
                            "items",
                            count,
                            cx.processor(|this, range: std::ops::Range<usize>, _, cx| {
                                range
                                    .filter_map(|index| {
                                        this.visible_items
                                            .get(index)
                                            .and_then(|i| this.snapshot.items.get(*i))
                                            .cloned()
                                            .map(|item| (index, item))
                                    })
                                    .map(|(index, item)| this.simple_item(index, &item, cx))
                                    .collect::<Vec<_>>()
                            }),
                        )
                        .track_scroll(self.item_scroll.clone())
                        .flex_1()
                        .min_h_0(),
                        scroll_handle.clone(),
                        cx,
                    ),
                );
            }
        }
        if matches!(self.page, Page::Party | Page::Items) {
            body = body.child(self.selection_details(cx));
        }
        if let Some((message, good)) = &self.notice {
            body = body.child(
                div()
                    .mt(px(10.))
                    .text_size(px(13.))
                    .line_height(px(18.))
                    .text_color(rgb(if *good { MUTED } else { RED }))
                    .child(message.clone()),
            );
        } else if matches!(self.state.as_str(), "error" | "stale") {
            body = body.child(
                div()
                    .mt(px(10.))
                    .text_size(px(13.))
                    .line_height(px(18.))
                    .text_color(rgb(RED))
                    .child(self.connection_message.clone()),
            );
        }
        div()
            .key_context("BigHack")
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::keydown))
            .on_mouse_move(cx.listener(|this, event, _, cx| {
                this.move_scrollbar(event, cx);
                this.move_slider(event, cx);
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, event, _, cx| {
                    this.release_held_use(cx);
                    this.finish_slider(event, cx);
                    this.scrollbar_drag = None;
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, event, _, cx| {
                    this.release_held_use(cx);
                    this.finish_slider(event, cx);
                    this.scrollbar_drag = None;
                }),
            )
            .size_full()
            .bg(rgb(PAPER))
            .text_color(rgb(INK))
            .font_family("Segoe UI")
            .text_size(px(15.))
            .child(
                paper().size_full().child(
                    div()
                        .relative()
                        .size_full()
                        .px(px(36.))
                        .py(px(32.))
                        .flex()
                        .gap(px(36.))
                        .child(self.navigation(cx))
                        .child(body),
                ),
            )
    }
}

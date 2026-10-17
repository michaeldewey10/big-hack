use super::*;

struct ScrollMetrics {
    track: Bounds<Pixels>,
    thumb: Bounds<Pixels>,
    max_offset: Pixels,
    travel: Pixels,
}

fn metrics(handle: &ScrollHandle, rail: Bounds<Pixels>) -> Option<ScrollMetrics> {
    let viewport = handle.bounds().size.height;
    let max_offset = handle.max_offset().height;
    let height = (rail.size.height - px(8.)).max(px(0.));
    if viewport <= px(0.) || max_offset <= px(0.5) || height <= px(1.) {
        return None;
    }
    let track = Bounds::new(
        point(
            rail.left() + (rail.size.width - px(6.)) / 2.,
            rail.top() + px(4.),
        ),
        size(px(6.), height),
    );
    let thumb_height =
        (height * (viewport / (viewport + max_offset))).clamp(px(24.).min(height), height);
    let travel = height - thumb_height;
    let fraction = (-handle.offset().y / max_offset).clamp(0., 1.);
    Some(ScrollMetrics {
        track,
        thumb: Bounds::new(
            point(track.left(), track.top() + travel * fraction),
            size(track.size.width, thumb_height),
        ),
        max_offset,
        travel,
    })
}

impl BigHack {
    pub(super) fn scroll_handle(&self) -> ScrollHandle {
        if self.page == Page::Items {
            self.item_scroll.0.borrow().base_handle.clone()
        } else {
            self.page_scroll[self.page as usize].clone()
        }
    }

    pub(super) fn scroll_panel(
        &self,
        content: impl IntoElement,
        handle: ScrollHandle,
        cx: &Context<Self>,
    ) -> Div {
        let paint_handle = handle.clone();
        let entity = cx.entity();
        let accent = self.page.accent();
        div()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .gap(px(8.))
            .child(content)
            .child(
                canvas(
                    move |bounds, window, _| {
                        metrics(&handle, bounds)
                            .map(|_| window.insert_hitbox(bounds, HitboxBehavior::Normal))
                    },
                    move |bounds, hitbox, window, _| {
                        let Some(layout) = metrics(&paint_handle, bounds) else {
                            return;
                        };
                        let Some(hitbox) = hitbox else {
                            return;
                        };
                        window.paint_quad(fill(
                            Bounds::new(
                                point(layout.track.left() + px(2.), layout.track.top()),
                                size(px(2.), layout.track.size.height),
                            ),
                            rgb(LINE),
                        ));
                        let mut thumb = fill(layout.thumb, rgb(accent));
                        thumb.corner_radii = px(3.).into();
                        window.paint_quad(thumb);
                        window.on_mouse_event({
                            let handle = paint_handle.clone();
                            let entity = entity.clone();
                            let hitbox = hitbox.clone();
                            move |event: &MouseDownEvent, phase, window, cx| {
                                if phase != DispatchPhase::Bubble
                                    || event.button != MouseButton::Left
                                    || !hitbox.is_hovered(window)
                                {
                                    return;
                                }
                                entity.update(cx, |this, cx| {
                                    let Some(layout) = metrics(&handle, bounds) else {
                                        return;
                                    };
                                    let grab_offset = if layout.thumb.contains(&event.position) {
                                        event.position.y - layout.thumb.top()
                                    } else {
                                        layout.thumb.size.height / 2.
                                    };
                                    this.scrollbar_drag = Some(ScrollbarDrag {
                                        handle: handle.clone(),
                                        rail: bounds,
                                        grab_offset,
                                    });
                                    this.position_scrollbar(event.position.y, cx);
                                });
                                cx.stop_propagation();
                            }
                        });
                        window.on_mouse_event(
                            move |event: &ScrollWheelEvent, phase, window, cx| {
                                if phase != DispatchPhase::Bubble
                                    || !hitbox.should_handle_scroll(window)
                                {
                                    return;
                                }
                                let current = paint_handle.offset();
                                let max = paint_handle.max_offset().height;
                                let delta = event.delta.pixel_delta(px(24.));
                                paint_handle.set_offset(point(
                                    current.x,
                                    (current.y + delta.y).clamp(-max, px(0.)),
                                ));
                                cx.notify(entity.entity_id());
                                window.refresh();
                                cx.stop_propagation();
                            },
                        );
                    },
                )
                .w(px(16.))
                .h_full()
                .flex_none(),
            )
    }

    fn position_scrollbar(&mut self, y: Pixels, cx: &mut Context<Self>) {
        let Some(drag) = &self.scrollbar_drag else {
            return;
        };
        let Some(layout) = metrics(&drag.handle, drag.rail) else {
            self.scrollbar_drag = None;
            return;
        };
        let fraction = if layout.travel > px(0.) {
            ((y - layout.track.top() - drag.grab_offset) / layout.travel).clamp(0., 1.)
        } else {
            0.
        };
        drag.handle
            .set_offset(point(drag.handle.offset().x, -layout.max_offset * fraction));
        cx.notify();
    }

    pub(super) fn move_scrollbar(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !event.dragging() {
            self.scrollbar_drag = None;
            return;
        }
        self.position_scrollbar(event.position.y, cx);
    }
}

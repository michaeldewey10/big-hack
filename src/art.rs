use gpui::{prelude::*, *};
pub const PAPER: u32 = 0xe7e7e5;
pub const INK: u32 = 0x20211e;
pub const MUTED: u32 = 0x7d7d6d;
pub const RED: u32 = 0xb83212;
pub const LINE: u32 = 0xdad8c9;
pub const GREEN: u32 = 0x29935f;
pub fn marked_label_with_color(
    text: impl Into<SharedString>,
    s: f32,
    selected: bool,
    hoverable: bool,
    color: u32,
) -> Div {
    let height = (s * 0.22).clamp(4., 8.);
    let stroke = div()
        .absolute()
        .left(px(-1.))
        .right(px(-1.))
        .bottom(px(1.))
        .h(px(height))
        .opacity(if selected { 1. } else { 0. })
        .when(hoverable, |el| {
            el.group_hover("marker-label", |style| style.opacity(1.))
        })
        .child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    let width = f32::from(bounds.size.width);
                    let count = ((width / 5.).ceil() as usize).max(2);
                    let edge = [0.15_f32, 0.6, 0.25, 0.85, 0.35, 0.05, 0.55, 0.2, 0.7];
                    let mut path = PathBuilder::fill();
                    for i in 0..=count {
                        let p = point(
                            bounds.origin.x + px(width * i as f32 / count as f32),
                            bounds.origin.y + px(edge[i % edge.len()]),
                        );
                        if i == 0 {
                            path.move_to(p);
                        } else {
                            path.line_to(p);
                        }
                    }
                    for i in (0..=count).rev() {
                        path.line_to(point(
                            bounds.origin.x + px(width * i as f32 / count as f32),
                            bounds.origin.y + px(height - edge[(i + 4) % edge.len()]),
                        ));
                    }
                    path.close();
                    if let Ok(path) = path.build() {
                        window.paint_path(path, rgb(color));
                    }
                },
            )
            .size_full(),
        );
    div()
        .relative()
        .flex_none()
        .pb(px(6.))
        .group("marker-label")
        .child(serif(text, s))
        .child(stroke)
}
pub fn paper() -> Div {
    div().relative().bg(rgb(PAPER))
}
pub fn dot(color: u32) -> Div {
    div()
        .size(px(10.))
        .rounded_full()
        .bg(rgb(color))
        .flex_none()
}
pub fn serif(text: impl Into<SharedString>, s: f32) -> Div {
    div()
        .font_family("Georgia")
        .text_size(px(s))
        .line_height(px(s * 1.2))
        .child(text.into())
}

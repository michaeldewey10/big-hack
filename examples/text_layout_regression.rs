//! Run the Windows text shaper directly; no game attachment or UI actions.
use gpui::{
    Application, Context, SharedString, TextRun, TextStyle, Window, WindowOptions, div, prelude::*,
    px,
};
use std::panic::{AssertUnwindSafe, catch_unwind};

struct Empty;
impl Render for Empty {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}
fn main() {
    Application::new().run(|cx| {
        cx.open_window(WindowOptions { show:false, focus:false, ..Default::default() }, |window,cx| {
        let text_system = cx.text_system().clone();
        let system = window.text_system().clone();
        let style = TextStyle::default();
        let mut reproduced = false;
        'cases: for prefix in 1..36 {
            let text =
                SharedString::from(format!("{} · Carrying a laser pointer", "a".repeat(prefix)));
            let original_run = style.to_run(text.len());
            for width in (8..180).step_by(2) {
                let mut runs: Vec<TextRun> = vec![original_run.clone()];
                let mut wrapper = text_system.line_wrapper(style.font(), px(13.));
                // GPUI 0.2.2's measured-text closure keeps this mutated runs list
                // while measuring the original text again at a different width.
                let _ = wrapper.truncate_line(text.clone(), px(width as f32), "…", &mut runs);
                let second = wrapper.truncate_line(text.clone(), px(1000.), "…", &mut runs);
                let end = runs[0].len;
                if end <= second.len() && !second.is_char_boundary(end) {
                    let failed = catch_unwind(AssertUnwindSafe(|| {
                        system.layout_line(&second, px(13.), &runs, None);
                    }))
                    .is_err();
                    assert!(failed, "Expected the same invalid UTF-8 boundary panic");
                    println!(
                        "Reproduced original GPUI truncation failure: run end {end}, text bytes {}",
                        second.len()
                    );
                    reproduced = true;
                    break 'cases;
                }
            }
        }
        assert!(
            reproduced,
            "Failed to reproduce the original text-run mismatch"
        );
        // The app now clips the element without mutating text runs. Unicode
        // text reaches DirectWrite intact for every width/layout measurement.
        let cases = [
            "In menu · Empty hands",
            "Crouching · Waving · Laser",
            "玩家 · ラジオ",
            "Zoë · 🎈",
            "A very long item instance name · with Unicode",
        ];
        let mut checks = 0;
        for text in cases {
            for _ in 0..100 {
                let run = style.to_run(text.len());
                system.layout_line(text, px(13.), &[run], None);
                checks += 1;
            }
        }
        println!("PASS: {checks} intact Unicode text measurements completed");
        cx.new(|_| Empty)
        }).expect("create hidden text-test context");
        cx.quit();
    });
}

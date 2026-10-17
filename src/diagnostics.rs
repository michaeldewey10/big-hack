use std::{
    backtrace::Backtrace,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn log(message: &str) {
    let directory = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("BigHack")
        .join("logs");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let file = directory.join(format!("BigHack-{}.log", std::process::id()));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(file) {
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let _ = writeln!(file, "[{at}] {message}");
    }
}

pub fn install() {
    std::panic::set_hook(Box::new(|info| {
        log(&format!("PANIC: {info}\n{}", Backtrace::force_capture()));
    }));
    log("Big Hack started");
}

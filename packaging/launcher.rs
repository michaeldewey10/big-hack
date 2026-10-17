#![windows_subsystem = "windows"]

use std::{
    env, fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::{self, Command},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static PAYLOAD: &[u8] = include_bytes!(env!("BIG_HACK_PAYLOAD"));

fn main() {
    match run() {
        Ok(code) => process::exit(code),
        Err(error) => {
            show_error(&format!("Big Hack could not start.\n\n{error}"));
            process::exit(1);
        }
    }
}

fn run() -> io::Result<i32> {
    let directory = create_runtime_directory()?;
    let result = (|| {
        extract(&directory)?;
        let mut child = Command::new(directory.join("BigHack.exe"))
            .args(env::args_os().skip(1))
            .current_dir(&directory)
            .spawn()?;
        Ok(child.wait()?.code().unwrap_or(1))
    })();
    // The bridge can still be detaching after the UI exits. Only remove this
    // launch's unique directory; leave locked files alone after the allowance.
    for _ in 0..40 {
        if fs::remove_dir_all(&directory).is_ok() || !directory.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }
    result
}

fn create_runtime_directory() -> io::Result<PathBuf> {
    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::other("Windows LOCALAPPDATA is unavailable."))?;
    let root = PathBuf::from(local).join("BigHack").join("runtime");
    fs::create_dir_all(&root)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?.as_nanos();
    for attempt in 0..100 {
        let directory = root.join(format!("{}-{}-{stamp}-{attempt}",
            env!("BIG_HACK_BUNDLE_ID"), process::id()));
        match fs::create_dir(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("Could not create a private runtime folder."))
}

fn extract(directory: &Path) -> io::Result<()> {
    let mut input = PAYLOAD;
    let mut magic = [0; 8];
    input.read_exact(&mut magic)?;
    if &magic != b"BIGHACK1" {
        return Err(io::Error::other("Invalid embedded package."));
    }
    let count = read_u32(&mut input)?;
    if count > 4096 { return Err(io::Error::other("Invalid package file count.")); }
    for _ in 0..count {
        let name_length = read_u32(&mut input)? as usize;
        if name_length == 0 || name_length > 4096 {
            return Err(io::Error::other("Invalid package path length."));
        }
        let mut size = [0; 8];
        input.read_exact(&mut size)?;
        let length = usize::try_from(u64::from_le_bytes(size)).map_err(io::Error::other)?;
        let name_bytes = input.get(..name_length)
            .ok_or_else(|| io::Error::other("Truncated package path."))?;
        let name = std::str::from_utf8(name_bytes).map_err(io::Error::other)?;
        let relative = Path::new(name);
        if name.contains(':') || relative.components().any(|p| !matches!(p, Component::Normal(_))) {
            return Err(io::Error::other("Invalid embedded package path."));
        }
        input = &input[name_length..];
        let contents = input.get(..length)
            .ok_or_else(|| io::Error::other("Truncated package file."))?;
        let target = directory.join(relative);
        if let Some(parent) = target.parent() { fs::create_dir_all(parent)?; }
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(target)?;
        file.write_all(contents)?;
        input = &input[length..];
    }
    if !input.is_empty() { return Err(io::Error::other("Unexpected package data.")); }
    Ok(())
}

fn read_u32(input: &mut &[u8]) -> io::Result<u32> {
    let mut bytes = [0; 4];
    input.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn show_error(message: &str) {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, title: *const u16, flags: u32) -> i32;
    }
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Big Hack".encode_utf16().chain(Some(0)).collect();
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10); }
}

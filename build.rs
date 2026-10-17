use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=assets/big-hack.ico");
    println!("cargo:rerun-if-changed=assets/icon.rc");
    println!("cargo:rerun-if-env-changed=RC");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let compiler = env::var_os("RC").map(PathBuf::from).unwrap_or_else(|| {
        if Command::new("rc.exe").arg("/?").output().is_ok() {
            return PathBuf::from("rc.exe");
        }
        let kits = PathBuf::from(env::var_os("ProgramFiles(x86)").expect("Windows SDK location"))
            .join("Windows Kits/10/bin");
        let mut versions: Vec<_> = std::fs::read_dir(kits)
            .expect("Install the Windows SDK or set RC to rc.exe")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        versions.sort();
        versions
            .into_iter()
            .rev()
            .map(|version| version.join("x64/rc.exe"))
            .find(|path| path.is_file())
            .expect("Install the Windows SDK or set RC to rc.exe")
    });
    let resource =
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output folder")).join("big-hack.res");
    let result = Command::new(compiler)
        .current_dir(env::var_os("CARGO_MANIFEST_DIR").expect("Project folder"))
        .arg("/nologo")
        .arg(format!("/fo{}", resource.display()))
        .arg("assets/icon.rc")
        .status()
        .expect("Run Windows resource compiler");
    assert!(result.success(), "Windows icon resource compilation failed");
    // GPUI loads icon resource 1 for the window and taskbar; Explorer uses it for the EXE.
    println!("cargo:rustc-link-arg-bin=big-hack={}", resource.display());
}

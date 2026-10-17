use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
};

pub struct Bridge {
    child: Option<Child>,
    input: Option<ChildStdin>,
    pub events: Receiver<Value>,
}
impl Bridge {
    pub fn start() -> Self {
        let (tx, events) = mpsc::sync_channel(64);
        let directory = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();
        let executable = directory.join("BigHackBridge.exe");
        let mut command = if executable.is_file() {
            Command::new(executable)
        } else {
            let mut c = Command::new(
                std::env::var_os("BIG_HACK_PYTHON").unwrap_or_else(|| "python".into()),
            );
            c.arg(concat!(env!("CARGO_MANIFEST_DIR"), "/bridge/bridge.py"));
            c
        };
        command
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match command.spawn() {
            Ok(mut child) => {
                let input = child.stdin.take();
                let output = child.stdout.take().expect("piped bridge stdout");
                thread::spawn(move || {
                    for line in BufReader::new(output).lines().map_while(Result::ok) {
                        if let Ok(event) = serde_json::from_str::<Value>(&line) {
                            if tx.send(event).is_err() {
                                return;
                            }
                        }
                    }
                    let _ = tx.send(json!({"type":"status", "state":"error", "message":"The local bridge stopped. Restart Big Hack to reconnect."}));
                });
                Self {
                    child: Some(child),
                    input,
                    events,
                }
            }
            Err(error) => {
                let _ = tx.send(json!({"type":"status", "state":"error", "message":format!("Could not start the local bridge: {error}")}));
                Self {
                    child: None,
                    input: None,
                    events,
                }
            }
        }
    }
    pub fn send(&mut self, value: &Value) -> bool {
        let Some(input) = &mut self.input else {
            return false;
        };
        writeln!(input, "{value}")
            .and_then(|_| input.flush())
            .is_ok()
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.send(&json!({"type":"shutdown"}));
        if let Some(mut child) = self.child.take() {
            thread::spawn(move || {
                for _ in 0..140 {
                    if child.try_wait().ok().flatten().is_some() {
                        return;
                    }
                    thread::sleep(std::time::Duration::from_millis(50));
                }
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}

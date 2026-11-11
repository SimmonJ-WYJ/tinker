use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
pub struct Fixture {
    root: PathBuf,
    pub config: PathBuf,
}
impl Fixture {
    pub fn new() -> Self {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "desktop-process-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let config = root.join("profiles.json");
        fs::write(&config,json!([{"profileId":"local","label":"Fixture","configRevision":"r1","models":[{"modelId":"model","label":"Model"}],"endpoint":"http://127.0.0.1:1/v1/chat/completions","key":"fake-secret"}]).to_string()).unwrap();
        Self { root, config }
    }
    pub fn spawn(&self) -> Child {
        Command::new(env!("CARGO_BIN_EXE_tinker-runtime"))
            .args([
                "--root",
                self.root.to_str().unwrap(),
                "--profiles-file",
                self.config.to_str().unwrap(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
pub fn rpc(
    input: &mut ChildStdin,
    output: &mut BufReader<ChildStdout>,
    id: &str,
    method: &str,
    params: Value,
) -> Value {
    writeln!(
        input,
        "{}",
        json!({"version":1,"id":id,"method":method,"params":params})
    )
    .unwrap();
    input.flush().unwrap();
    let mut line = String::new();
    assert!(output.read_line(&mut line).unwrap() > 0);
    let reply: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(reply["id"], id);
    assert!(reply.get("result").is_some() ^ reply.get("error").is_some());
    reply
}

pub fn set_endpoint(f: &Fixture, endpoint: &str) {
    let mut config: Value = serde_json::from_slice(&fs::read(&f.config).unwrap()).unwrap();
    config[0]["endpoint"] = json!(endpoint);
    fs::write(&f.config, config.to_string()).unwrap();
}
pub fn connect(f: &Fixture) -> (Child, ChildStdin, BufReader<ChildStdout>) {
    let mut child = f.spawn();
    let input = child.stdin.take().unwrap();
    let output = BufReader::new(child.stdout.take().unwrap());
    (child, input, output)
}
pub fn send(session: &str, request: &str, text: &str) -> Value {
    json!({"sessionId":session,"requestId":request,"profileId":"local","modelId":"model","userMessage":text,"startedAt":123,"effort":null})
}
pub fn terminal(
    input: &mut ChildStdin,
    output: &mut BufReader<ChildStdout>,
    session: &str,
    request: &str,
) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let reply = rpc(
            input,
            output,
            "poll",
            "chat.events",
            json!({"sessionId":session,"requestId":request,"afterSequence":0,"limit":256}),
        );
        let turn = &reply["result"]["turn"];
        if ["completed", "failed", "cancelled", "interrupted"]
            .contains(&turn["status"].as_str().unwrap())
        {
            return reply["result"].clone();
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

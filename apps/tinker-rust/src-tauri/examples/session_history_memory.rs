//! 合成历史测量入口：同一读取器分别使用全文件缓冲和流式输入，不连接桌面应用。
use std::{
    fs::File,
    hash::{Hash, Hasher},
    io::{BufReader, Cursor},
    time::Instant,
};
use tinker_rust_foundation::session_history::{read_history, HistoryOptions};
fn measure() -> Result<(), &'static str> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err("usage: session_history_memory <streaming|buffered> <synthetic-jsonl>");
    }
    let start = Instant::now();
    let buffered;
    let page = match args[0].as_str() {
        "streaming" => read_history(
            BufReader::new(File::open(&args[1]).map_err(|_| "fixture unavailable")?),
            HistoryOptions::default(),
        ),
        "buffered" => {
            buffered = std::fs::read(&args[1]).map_err(|_| "fixture unavailable")?;
            let result = read_history(Cursor::new(&buffered), HistoryOptions::default());
            std::hint::black_box(&buffered);
            result
        }
        _ => return Err("unknown mode"),
    }
    .map_err(|_| "invalid synthetic history")?;
    let mut digest = std::collections::hash_map::DefaultHasher::new();
    for entry in &page.entries {
        entry.line_number.hash(&mut digest);
        serde_json::to_vec(&entry.message)
            .map_err(|_| "encoding failed")?
            .hash(&mut digest);
    }
    println!(
        "{}",
        serde_json::json!({"mode":args[0],"messages":page.entries.len(),"firstLine":page.entries.first().map(|entry|entry.line_number),"nextBeforeLine":page.next_before_line,"incompleteTail":page.incomplete_tail,"digest":format!("{:016x}",digest.finish()),"elapsedMs":start.elapsed().as_secs_f64()*1000.0})
    );
    Ok(())
}
fn main() {
    if let Err(error) = measure() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

use tinker_core::Session;
#[test]
fn switching_preserves_independent_drafts() {
    let mut s = Session::default();
    s.edit("first");
    s.select("local").unwrap();
    s.edit("second");
    s.select("demo").unwrap();
    assert_eq!(s.draft(), "first");
    s.select("local").unwrap();
    assert_eq!(s.draft(), "second");
}
#[test]
fn failed_send_preserves_draft_and_history() {
    let mut s = Session::default();
    s.select("local").unwrap();
    s.edit("keep me");
    assert!(s.send().is_err());
    assert_eq!(s.draft(), "keep me");
    assert!(s.messages().is_empty());
}
#[test]
fn demo_sends_and_clears_only_active_draft() {
    let mut s = Session::default();
    s.edit("hello");
    s.send().unwrap();
    assert_eq!(s.messages().len(), 2);
    assert!(s.messages()[1].contains("演示"));
    assert_eq!(s.draft(), "");
    assert!(s.send().is_err());
    assert_eq!(s.messages().len(), 2);
}
#[test]
fn unknown_channel_does_not_change_selection() {
    let mut s = Session::default();
    s.edit("safe");
    assert!(s.select("unknown").is_err());
    assert_eq!(s.draft(), "safe");
}

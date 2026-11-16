# Coding Smart Approval
Status: implementation in progress; related issue/PR: not created.

<a id="行为"></a>

## Behavior
- Coding + acceptEdits uses the SDK's operating-system isolation, automatically running Bash within the project.
- Enable failIfUnavailable and prohibit unrestricted command fallback; commands cannot access external networks or bind locally.
- Ordinary project files are writable; protect .git/.agents/.codex/.aws and deny reading local channel credentials and SSH/AWS credentials.
- The HTML validation tool supports bounded fill / press / click sequences, retaining iframe isolation and network restrictions.
- Do not expand Full auto or unconditionally allow commands based on Python/Node strings.

<a id="验收"></a>

## Acceptance
- Real SDK + local model fixtures: project-file writes succeed, writes outside the project fail, and human approvals total zero.
- Real Chromium: input, Enter-to-add, checking, and deletion succeed; capture script exceptions and reject files outside the project.
- Typecheck, full test suite, and main-process build.
- Validate actual upstream model responses and desktop display separately; do not use a mock model as proof of upstream availability.

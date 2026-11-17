# Credentialed original-form implementation handoff

**Status:** Task 3 implementation and focused checks complete for handoff. Native window acceptance, final whole-branch regression and independent review are separate Root-owned gates. No installation, production entry change or paid request is authorized by this document.

## Original controls and authority

The original ChannelForm, ChannelModels, workbench and keyboard paths remain in use. Credential/probe state was extracted into `useChannelCredentials.ts`; no CSS or second settings screen was added. ChannelForm is smaller than its reviewed base. Production Electron keeps its API shape, encrypted-key edit behavior, automatic legacy probes and SDK defaults. Native managed edit intentionally changes saved-key reveal: the saved input stays blank, presence is metadata, and Show Key reveals only a newly typed replacement.

`getChannelCredentialMode` is optional and is installed only when the transport exposes a completed native bootstrap capability. It reads that cached capability and never issues another bootstrap or advances generation. Save and probe actions wait until mode is known. The Rust host remains the endpoint, credential, revision and runtime authority. `credentialedChannels: true`, `queueing: false` and `runtime:get-status: null` remain the host contract.

The shared optional fields are Channel.hasCredential and ChannelModel.supportedEfforts. Missing support becomes an empty support list in native writes. No provider support is inferred from model names. Managed bootstrap keeps an empty catalog unconfigured and seeds its effort from the native snapshot, defaulting to an empty setting. Both original AgentView send handlers fresh-read the same session/default state and omit an empty effort parameter. The managed-only Default / 模型默认 menu entry clears an explicit choice; it means provider-default behavior, not disabled reasoning. Unsupported nonempty choices still reach the host and fail. Electron's default remains high.

## Save, probes and reconciliation

- Original create/update/delete/list/test/fetch method names are retained. Managed create/update convert to a complete explicit openai-chat or anthropic-messages ChannelWrite; unknown providers fail rather than being remapped.
- Blank saved input means Keep only with unchanged full endpoint/protocol binding. A changed binding requires a newly typed key. All managed form persistence is explicit Save; replacement/origin edits and model/name edits do not autosave.
- Explicit Test/Refresh use the saved channel ID for blank input or the newly typed key as an ephemeral probe. They do not stage a key or infer a model POST. Queued probe options carry a document-local AbortSignal that is stripped by the preload factory. The lane checks it after waiting; changed/unmounted form intent aborts queued work. Already-started results are checked against the current identity before being applied.
- Private stage is an invoke with `channel:stage`, one `{request, secret}` argument and no outer mutation. The nested request has version 1, complete channel/write intent and mutation UUID/expectedRevision. Its acknowledged normalized request supplies the opaque replacement reference for final invoke. Stage, final mutation, settings writes and explicit probes share one serialized lane. Public cache changes only after durable reply.
- A single in-document pending mutation stores only a nonsecret normalized request and opaque intent identifier. A lost final ack can replay the exact same UUID, reference and expected revision on an unchanged explicit retry. Changed intent is rejected and is never acknowledged as saving a new key. A late successful earlier save does not clear a subsequently changed input or close that changed edit.
- A lost stage ack has no known reference. It is conservatively frozen and requires reopen/inspection; it is never described as exactly replayable and is not restaged automatically. Possibly written orphan items remain bounded and retained under the earlier host contract. No key-erasure claim is made.
- Quiesce includes pending mutation and probe promises. Stop, restore/history and close retain their existing host lanes. Reload creates no pending secret import or chat replay.

Host errors are rendered through synchronized static English/Chinese entries. No raw key is added to receipts, snapshots, history, error messages or persisted renderer state. The optional credentialIntentId and AbortSignal are local frontend coordination, not Rust authorization or additional wire privilege.

## Owned native QA support

Dedicated commands `channels:desktop:build` and `channels:qa:desktop:build` assemble independent ordinary and QA applications from the original formal renderer. They select their required Cargo features explicitly, stop new builds below 4 GiB free, create a fresh private temporary bundle, validate architecture/main symbol and ad-hoc signature, and never install or run an application. Ordinary identity is com.tinker.channels-preview; QA identity is com.tinker.channels-native-qa. Existing synthetic launchers/build scripts remain unchanged.

The QA service retains its exact owned numeric-loopback endpoint and finite fake slots. `[qa:hold]` emits a safe 210-character first text delta, then holds for 60 seconds with one-second SSE comment heartbeats under the unchanged 120-second total/15-second idle budgets. `[qa:partial]` emits that long first delta and disconnects after about two seconds without a terminal event. Existing short/slow/failure scenarios remain available. Four bounded handlers permit explicit catalog GET while A is held. Disconnect, Stop's client cancellation and service shutdown interrupt waiting and join owned handlers; no uninterruptible minute sleep was added.

`qa-observations.json` contains GET/POST totals, finite key-version counters, active/completed/cancelled/partial/unauthorized counts and at most 256 method/keyVersion/sequence/phase events. It contains no key, request header/body or prompt. Rejected GET/POST attempts are counted with keyVersion 0 so failed authentication cannot masquerade as zero HTTP. Counters persist across exact-port reopen; startup itself issues no GET or POST. A port collision fails closed. These are QA fixture facts, not a production telemetry feature or real-vault proof.

Native queueing stays false. Root must operate active A, explicitly Save a replacement during A, and send a fresh C. Accepted B on the old revision is separate automated runtime evidence from Tasks 1/2, not a fabricated native UI queue acceptance.

## Validation and remaining gates

Focused evidence is retained externally in migration-work/secure-channel-checks-20261117 under unique task3 stems. RED cases include missing managed capability/write mapping, premature decrypt, stale saved-key origin, late-ack replacement clearing, actual transport-timeout reconciliation, queued probe cancellation, stale provider busy state, original AgentView's previous high default, missing managed-default label, missing long QA delta/heartbeats, and rejected-HTTP undercounting. GREEN runs include original DOM, real preload/transport integration, actual AgentView sends, ABI, legacy/image behavior, locale parity, assembly contracts and owned-service concurrency/cancellation/reopen tests. The external Task 3 report records final exact counts, logs, source commit/tree and artifact hashes/identities.

Root still owns full Rust/Bun/workspace regression, final artifact audit, ordinary and QA native CUA (rotation, Stop, partial history, deletion, language/themes, Quit/reopen and zero automatic GET/POST), simplify/independent review and any later safe publication. Unit fixtures verify the first delta, heartbeat, concurrent GET and bounded cancellation; they do not claim that the full 60-second native-window rotation has already been observed. Real Keychain ACL/signing access, public DNS/TLS/provider behavior, actual credentials and paid inference remain unrun.

## Rollback

Close the isolated preview and keep its marked synthetic root for inspection. Continue using the existing installed Electron application and its unchanged entry/data directories. No migration, install replacement or production toggle needs reversal. Revert the Task 3 implementation commit if abandoning the experiment; retain the earlier synthetic proofs and the externally preserved QA evidence. Do not erase possibly referenced credentials or reinterpret earlier root markers.

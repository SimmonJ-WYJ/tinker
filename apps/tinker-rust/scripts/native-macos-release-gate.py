"""Qualify an isolated Apple Silicon Tinker preview; never deploy it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ROOT = Path("/private/tmp")
PACKAGES = {
    "preview": ("Tinker Channels Preview", "tinker-channels-preview", "com.tinker.channels-preview",
                "build-channels.ts"),
    "qa": ("Tinker Channels Native QA", "tinker-channels-native-qa", "com.tinker.channels-native-qa",
           "build-channels-native-qa.ts"),
}


def command(argv, cwd=REPO):
    return subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def check_bundle(bundle, kind):
    if bundle.is_symlink():
        raise ValueError("Use the original staged bundle, not a symlink")
    root = bundle.resolve(strict=True)
    name, executable, identifier, _ = PACKAGES[kind]
    if root.parent.parent != ROOT or not root.parent.name.startswith("tinker-tauri-channels-package-"):
        raise ValueError("Refusing to test a bundle outside dedicated temporary staging")
    if root.name != name + ".app":
        raise ValueError(f"Unexpected bundle name: {root.name}")
    contents = root / "Contents"
    binary = contents / "MacOS" / executable
    with (contents / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    if (info["CFBundleIdentifier"], info["CFBundleExecutable"]) != (identifier, executable):
        raise ValueError("Bundle identifier or executable name does not match the intended variant")
    if not binary.is_file() or binary.resolve() != binary or not os.access(binary, os.X_OK):
        raise ValueError("Missing executable or unexpected executable link")
    if command(["/usr/bin/lipo", "-archs", str(binary)]).stdout.strip() != "arm64":
        raise ValueError("Expected a single Apple Silicon executable")
    signature = command(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(root)])
    if signature.returncode:
        raise RuntimeError(signature.stdout.strip())
    return binary


def main():
    if not __debug__ or platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("Requires an Apple Silicon Mac with Python assertions enabled.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-app", type=Path)
    parser.add_argument("--qa-app", type=Path)
    args = parser.parse_args()
    if bool(args.preview_app) != bool(args.qa_app):
        parser.error("Provide both freshly built bundles, or neither to build both.")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-macos-release-gate-", dir=ROOT))
    print("Release gate evidence:", evidence, flush=True)
    summary_file = evidence / "summary.json"
    head = command(["git", "rev-parse", "HEAD"])
    if head.returncode:
        raise RuntimeError(head.stdout.strip())
    summary = {
        "sourceCommit": head.stdout.strip(),
        "bundleProvenance": "caller-supplied; commit not attested" if args.qa_app else "built from checkout",
        "stages": {},
        "notVerifiedByThisGate": [
            "real macOS Open/Save dialogs", "installed legacy Electron GUI",
            "real user profiles or provider credentials", "Developer ID distribution and notarization",
        ],
    }

    def write_summary():
        summary_file.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    def stage(name, argv, *, keep_output=True):
        print("Running:", name, flush=True)
        result = command(argv)
        log = evidence / (name + ".log")
        log.write_text(result.stdout if keep_output or result.returncode else "Command completed.\n", encoding="utf-8")
        summary["stages"][name] = {"exitCode": result.returncode, "log": log.name}
        write_summary()
        if result.returncode:
            raise RuntimeError(f"{name} failed; see {log}")
        return result.stdout

    try:
        paths = {"preview": args.preview_app, "qa": args.qa_app}
        for kind in ("preview", "qa"):
            if paths[kind] is None:
                output = stage("build-" + kind, ["bun", str(HERE / PACKAGES[kind][3])])
                found = re.findall(r"^渠道预览包：(.+\.app)$", output, re.MULTILINE)
                if len(found) != 1:
                    raise RuntimeError(f"No unique staged {kind} app in build output")
                paths[kind] = Path(found[0])
        binaries = {kind: check_bundle(path, kind) for kind, path in paths.items()}
        summary["binarySha256"] = {kind: hashlib.sha256(binary.read_bytes()).hexdigest()
                                   for kind, binary in binaries.items()}
        symbols = stage("preview-symbols", ["/usr/bin/nm", str(binaries["preview"])], keep_output=False)
        if re.search(r"formal_native_qa|NATIVE_QA_EARLY|QA_SECRET_ONE|vault_fake|channels_owned_qa", symbols):
            raise RuntimeError("Preview unexpectedly contains QA symbols")
        failures = []
        for key, script in (
            ("electron-native-rollback", "native-upgrade-rehearsal-qa.py"),
            ("portable-project-restart", "native-portable-project-qa.py"),
        ):
            try:
                output = stage(key, [sys.executable, str(HERE / script), str(binaries["qa"])])
            except RuntimeError as error:
                failures.append(str(error))
                continue
            found = re.findall(r"^Evidence:\s+(.+)$", output, re.MULTILINE)
            if len(found) != 1:
                failures.append(f"{key} did not identify its evidence")
                continue
            summary["stages"][key]["evidenceDirectory"] = found[0]
            write_summary()
        if failures:
            raise RuntimeError("; ".join(failures))
        summary["passed"] = True
    except (OSError, KeyError, RuntimeError, ValueError) as error:
        summary["passed"] = False
        summary["error"] = str(error)
        print(error, file=sys.stderr)
    finally:
        write_summary()
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

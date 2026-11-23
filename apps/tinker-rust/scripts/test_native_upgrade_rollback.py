"""The rehearsal must never mistake an untouched old copy for a valid native rollback."""
import tempfile
import unittest
from pathlib import Path

from native_upgrade_rollback import file_manifest, verify_roots


class RollbackTests(unittest.TestCase):
    def test_changed_original_added_file_and_modified_copy_are_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            original, copy = (Path(tmp) / name for name in ("source", "copy"))
            for root in (original, copy):
                root.mkdir()
                (root / "history").write_bytes(b"synthetic")
            expected = file_manifest(original)
            verify_roots(original, copy, expected)
            (original / "history").write_bytes(b"changed")
            with self.assertRaises(ValueError):
                verify_roots(original, copy, expected)
            (original / "history").write_bytes(b"synthetic")
            (copy / "history").write_bytes(b"different copy")
            with self.assertRaises(ValueError):
                verify_roots(original, copy, expected)
            (copy / "history").write_bytes(b"synthetic")
            (copy / "extra").touch()
            with self.assertRaises(ValueError):
                verify_roots(original, copy, expected)

    def test_links_never_enter_an_electron_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "target").write_bytes(b"synthetic")
            (root / "link").symlink_to(root / "target")
            with self.assertRaises(ValueError):
                file_manifest(root)

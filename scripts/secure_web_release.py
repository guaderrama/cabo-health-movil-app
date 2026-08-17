#!/usr/bin/env python3
"""Descriptor-relative CaboHealth web release materialization and promotion.

This helper intentionally has no network capability and accepts only the exact
Task 8 schema and path allowlists.  It never recursively removes or replaces a
filesystem object.
"""

from __future__ import annotations

import base64
import ctypes
import errno
import hashlib
import json
import os
import platform
import re
import stat
import sys
import unicodedata
from typing import Any


PAYLOAD_PATHS = (
    ".well-known/apple-app-site-association",
    "app/privacy/index.html",
    "app/report-content/index.html",
    "app/support/index.html",
    "app/terms/index.html",
    "apps/.htaccess",
    "apps/clinic-guide/app.js",
    "apps/clinic-guide/index.html",
    "apps/healthy-recipes/app.js",
    "apps/healthy-recipes/index.html",
    "apps/shared/logo.png",
    "apps/shared/motion.js",
    "apps/shared/shell.js",
    "apps/shared/styles.css",
)
INPUT_PATHS = (
    "miniapps/shared/security-headers.conf",
    "web-hosting/cabohealth.org/.well-known/apple-app-site-association",
    "web-hosting/cabohealth.org/app/privacy/index.html",
    "web-hosting/cabohealth.org/app/report-content/index.html",
    "web-hosting/cabohealth.org/app/support/index.html",
    "web-hosting/cabohealth.org/app/terms/index.html",
    "web-hosting/cabohealth.org/apps/.htaccess",
)
HOSTED_SOURCE_PATHS = tuple(
    path.removeprefix("web-hosting/cabohealth.org/")
    for path in INPUT_PATHS
    if path.startswith("web-hosting/cabohealth.org/")
)
PROMOTE_TARGETS = (
    "public_html/apps/.htaccess",
    "public_html/apps/shared",
    "public_html/app/privacy",
    "public_html/app/terms",
    "public_html/app/support",
    "public_html/app/report-content",
    "public_html/apps/healthy-recipes",
    "public_html/apps/clinic-guide",
    "public_html/.well-known/apple-app-site-association",
)
ENTRY_SLUGS = ("healthy-recipes", "clinic-guide")
LEGAL_SLUGS = ("privacy", "terms", "support", "report-content")
APP_ID = "DQ8PH2DZ3R.com.cabohealth.app"
RELEASE_ID = re.compile(r"^web-v1-[a-f0-9]{64}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ROOT_KEYS = (
    "schemaVersion",
    "artifactKind",
    "appId",
    "entrySlugs",
    "legalSlugs",
    "promoteTargets",
    "files",
    "releaseId",
    "inventorySha256",
)
FILE_KEYS = (
    "path",
    "size",
    "sha256",
    "mediaType",
    "deployMode",
    "kind",
    "bytesBase64",
)
META_KEYS = FILE_KEYS[:-1]
ALLOWED_MEDIA_TYPES = {
    "application/json",
    "image/png",
    "text/css; charset=utf-8",
    "text/html; charset=utf-8",
    "text/javascript; charset=utf-8",
    "text/plain; charset=utf-8",
}
ALLOWED_KINDS = {"task6b-miniapp", "task7-legal", "aasa", "apache-security"}
OPEN_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
UNITS = (
    ("apps/.htaccess", "00-apps-htaccess", ("apps/.htaccess",)),
    ("apps/shared", "01-apps-shared", (
        "apps/shared/logo.png",
        "apps/shared/motion.js",
        "apps/shared/shell.js",
        "apps/shared/styles.css",
    )),
    ("app/privacy", "02-app-privacy", ("app/privacy/index.html",)),
    ("app/terms", "03-app-terms", ("app/terms/index.html",)),
    ("app/support", "04-app-support", ("app/support/index.html",)),
    ("app/report-content", "05-app-report-content", ("app/report-content/index.html",)),
    ("apps/healthy-recipes", "06-apps-healthy-recipes", (
        "apps/healthy-recipes/app.js",
        "apps/healthy-recipes/index.html",
    )),
    ("apps/clinic-guide", "07-apps-clinic-guide", (
        "apps/clinic-guide/app.js",
        "apps/clinic-guide/index.html",
    )),
    (".well-known/apple-app-site-association", "08-aasa", (
        ".well-known/apple-app-site-association",
    )),
)
JOURNAL_KEYS = (
    "schemaVersion",
    "index",
    "target",
    "slot",
    "original",
    "oldInventorySha256",
    "state",
)
MANIFEST_KEYS = (
    "schemaVersion",
    "artifactKind",
    "releaseId",
    "inventorySha256",
    "appId",
    "entrySlugs",
    "legalSlugs",
    "promoteTargets",
    "inputs",
    "files",
)
INPUT_MANIFEST_PATHS = (
    "miniapps/dist",
    "web-hosting/cabohealth.org/app/privacy/index.html",
    "web-hosting/cabohealth.org/app/terms/index.html",
    "web-hosting/cabohealth.org/app/support/index.html",
    "web-hosting/cabohealth.org/app/report-content/index.html",
    "web-hosting/cabohealth.org/.well-known/apple-app-site-association",
    "miniapps/shared/security-headers.conf",
    "web-hosting/cabohealth.org/apps/.htaccess",
)
INPUT_MANIFEST_KINDS = (
    "task6b-miniapp",
    "task7-legal",
    "task7-legal",
    "task7-legal",
    "task7-legal",
    "aasa",
    "apache-security",
    "apache-security",
)


class ReleaseError(Exception):
    pass


def fail(message: str) -> None:
    raise ReleaseError(message)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("TRANSPORT_DUPLICATE_KEY")
        result[key] = value
    return result


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def exact_keys(value: Any, keys: tuple[str, ...], label: str) -> None:
    if not isinstance(value, dict) or tuple(value.keys()) != keys:
        fail(f"{label}_SCHEMA_INVALID")


def safe_relative_path(path: Any) -> bool:
    if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path:
        return False
    if not path.isascii() or unicodedata.normalize("NFC", path) != path:
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in path):
        return False
    return all(component not in ("", ".", "..") for component in path.split("/"))


def expected_media_type(path: str) -> str:
    if path.endswith("apple-app-site-association"):
        return "application/json"
    if path.endswith(".html"):
        return "text/html; charset=utf-8"
    if path.endswith(".js"):
        return "text/javascript; charset=utf-8"
    if path.endswith(".css"):
        return "text/css; charset=utf-8"
    if path.endswith(".png"):
        return "image/png"
    return "text/plain; charset=utf-8"


def expected_kind(path: str) -> str:
    if path == "apps/.htaccess":
        return "apache-security"
    if path.startswith("apps/"):
        return "task6b-miniapp"
    if path.startswith("app/"):
        return "task7-legal"
    return "aasa"


def parse_transport(raw: bytes) -> tuple[dict[str, Any], dict[str, bytes]]:
    if raw.startswith(b"\xef\xbb\xbf"):
        fail("TRANSPORT_BOM_FORBIDDEN")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("TRANSPORT_JSON_INVALID") from error
    if canonical_json(value) != raw:
        fail("TRANSPORT_BYTES_NONCANONICAL")
    exact_keys(value, ROOT_KEYS, "TRANSPORT")
    if value["schemaVersion"] != 1 or value["artifactKind"] != "cabohealth-web-transport-v1":
        fail("TRANSPORT_POLICY_INVALID")
    if value["appId"] != APP_ID:
        fail("TRANSPORT_APP_ID_INVALID")
    if tuple(value["entrySlugs"]) != ENTRY_SLUGS or tuple(value["legalSlugs"]) != LEGAL_SLUGS:
        fail("TRANSPORT_SLUGS_INVALID")
    if tuple(value["promoteTargets"]) != PROMOTE_TARGETS:
        fail("TRANSPORT_PROMOTION_POLICY_INVALID")
    if not isinstance(value["releaseId"], str) or not RELEASE_ID.fullmatch(value["releaseId"]):
        fail("TRANSPORT_RELEASE_ID_INVALID")
    if not isinstance(value["inventorySha256"], str) or not SHA256.fullmatch(value["inventorySha256"]):
        fail("TRANSPORT_INVENTORY_HASH_INVALID")
    if not isinstance(value["files"], list) or len(value["files"]) != len(PAYLOAD_PATHS):
        fail("TRANSPORT_FILE_SET_INVALID")

    buffers: dict[str, bytes] = {}
    metadata: list[dict[str, Any]] = []
    paths: list[str] = []
    for item in value["files"]:
        exact_keys(item, FILE_KEYS, "TRANSPORT_FILE")
        path = item["path"]
        if not safe_relative_path(path):
            fail("TRANSPORT_PATH_INVALID")
        paths.append(path)
        if (
            not isinstance(item["size"], int)
            or isinstance(item["size"], bool)
            or item["size"] < 0
            or not isinstance(item["sha256"], str)
            or not SHA256.fullmatch(item["sha256"])
            or item["mediaType"] not in ALLOWED_MEDIA_TYPES
            or item["mediaType"] != expected_media_type(path)
            or item["deployMode"] != "0644"
            or item["kind"] not in ALLOWED_KINDS
            or item["kind"] != expected_kind(path)
            or not isinstance(item["bytesBase64"], str)
        ):
            fail(f"TRANSPORT_FILE_METADATA_INVALID: {path}")
        try:
            contents = base64.b64decode(item["bytesBase64"], validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise ReleaseError(f"TRANSPORT_FILE_ENCODING_INVALID: {path}") from error
        if base64.b64encode(contents).decode("ascii") != item["bytesBase64"]:
            fail(f"TRANSPORT_FILE_ENCODING_NONCANONICAL: {path}")
        if len(contents) != item["size"] or hashlib.sha256(contents).hexdigest() != item["sha256"]:
            fail(f"TRANSPORT_FILE_BYTES_INVALID: {path}")
        buffers[path] = contents
        metadata.append({key: item[key] for key in META_KEYS})
    if tuple(paths) != PAYLOAD_PATHS or len(set(paths)) != len(paths):
        fail("TRANSPORT_FILE_SET_INVALID")

    policy = {
        "schemaVersion": 1,
        "artifactKind": "cabohealth-public-web-v1",
        "appId": APP_ID,
        "entrySlugs": list(ENTRY_SLUGS),
        "legalSlugs": list(LEGAL_SLUGS),
        "promoteTargets": list(PROMOTE_TARGETS),
        "files": metadata,
    }
    inventory_hash = hashlib.sha256(canonical_json(policy)).hexdigest()
    if value["inventorySha256"] != inventory_hash or value["releaseId"] != f"web-v1-{inventory_hash}":
        fail("TRANSPORT_INVENTORY_RECONCILIATION_FAILED")
    return value, buffers


def validate_owned_directory(fd: int, label: str, *, writable: bool = False) -> os.stat_result:
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        fail(f"UNOWNED_DIRECTORY: {label}")
    if info.st_mode & 0o022:
        fail(f"UNSAFE_DIRECTORY_MODE: {label}")
    return info


def open_directory(name: str, parent_fd: int, label: str, *, writable: bool = False) -> int:
    try:
        fd = os.open(name, OPEN_DIR, dir_fd=parent_fd)
    except OSError as error:
        raise ReleaseError(f"UNSAFE_DIRECTORY: {label}") from error
    validate_owned_directory(fd, label, writable=writable)
    return fd


def open_root(path: str) -> int:
    try:
        fd = os.open(path, OPEN_DIR)
    except OSError as error:
        raise ReleaseError("UNSAFE_ROOT_DIRECTORY") from error
    validate_owned_directory(fd, "root")
    return fd


def ensure_directory(name: str, parent_fd: int, label: str) -> int:
    try:
        os.mkdir(name, 0o700, dir_fd=parent_fd)
        os.fsync(parent_fd)
    except FileExistsError:
        pass
    return open_directory(name, parent_fd, label)


def rename_with_flag(src_fd: int, src: str, dst_fd: int, dst: str, operation: str) -> None:
    system = platform.system()
    library = ctypes.CDLL(None, use_errno=True)
    if system == "Darwin" and hasattr(library, "renameatx_np"):
        function = library.renameatx_np
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        flag = 0x00000004 if operation == "noreplace" else 0x00000002
    elif system == "Linux" and hasattr(library, "renameat2"):
        function = library.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        flag = 1 if operation == "noreplace" else 2
    else:
        fail("ATOMIC_RENAME_CAPABILITY_MISSING")
    result = function(src_fd, src.encode("ascii"), dst_fd, dst.encode("ascii"), flag)
    if result != 0:
        error_number = ctypes.get_errno()
        raise ReleaseError(f"ATOMIC_RENAME_{operation.upper()}_FAILED: errno={error_number}")
    os.fsync(src_fd)
    if dst_fd != src_fd:
        os.fsync(dst_fd)


def write_all(fd: int, contents: bytes) -> None:
    offset = 0
    while offset < len(contents):
        written = os.write(fd, contents[offset:])
        if written <= 0:
            fail("MATERIALIZATION_SHORT_WRITE")
        offset += written


def read_all(fd: int) -> bytes:
    os.lseek(fd, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    while True:
        chunk = os.read(fd, 131072)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def read_fixed_file(root_fd: int, path: str) -> bytes:
    directory_fd = os.dup(root_fd)
    try:
        for index, component in enumerate(path.split("/")):
            final = index == len(path.split("/")) - 1
            if not final:
                child_fd = open_directory(component, directory_fd, path)
                os.close(directory_fd)
                directory_fd = child_fd
                continue
            try:
                file_fd = os.open(component, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
            except OSError as error:
                raise ReleaseError(f"UNSAFE_INPUT_FILE: {path}") from error
            try:
                before = os.fstat(file_fd)
                if not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid() or before.st_nlink != 1:
                    fail(f"UNSAFE_INPUT_FILE: {path}")
                contents = read_all(file_fd)
                after = os.fstat(file_fd)
                if (before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size):
                    fail(f"INPUT_CHANGED_DURING_CAPTURE: {path}")
                return contents
            finally:
                os.close(file_fd)
    finally:
        os.close(directory_fd)


def open_parent_for_target(public_fd: int, target: str) -> tuple[int, str]:
    components = target.split("/")
    directory_fd = os.dup(public_fd)
    try:
        for component in components[:-1]:
            child_fd = open_directory(component, directory_fd, target, writable=True)
            os.close(directory_fd)
            directory_fd = child_fd
        return directory_fd, components[-1]
    except Exception:
        os.close(directory_fd)
        raise


def stat_if_present(parent_fd: int, name: str) -> os.stat_result | None:
    try:
        return os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


def inventory_leaf(parent_fd: int, name: str, expected_paths: tuple[str, ...], target: str) -> str | None:
    info = stat_if_present(parent_fd, name)
    if info is None:
        return None
    if info.st_uid != os.geteuid():
        fail(f"UNOWNED_LIVE_TARGET: {target}")
    entries: list[dict[str, Any]] = []
    expects_file = expected_paths == (target,)
    if stat.S_ISREG(info.st_mode):
        if not expects_file or info.st_nlink != 1 or info.st_mode & 0o111:
            fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            contents = read_all(fd)
        finally:
            os.close(fd)
        entries.append({
            "path": expected_paths[0],
            "size": len(contents),
            "sha256": hashlib.sha256(contents).hexdigest(),
            "mode": f"{info.st_mode & 0o777:04o}",
        })
    elif stat.S_ISDIR(info.st_mode):
        if expects_file:
            fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
        leaf_fd = open_directory(name, parent_fd, target, writable=True)
        try:
            prefix = f"{target}/"
            relative_expected = tuple(path.removeprefix(prefix) for path in expected_paths)
            found = list_regular_tree(leaf_fd)
            if found != relative_expected:
                fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
            for relative_path, full_path in zip(found, expected_paths, strict=True):
                contents = read_fixed_file(leaf_fd, relative_path)
                file_parent_fd, file_name = open_parent_for_target(leaf_fd, relative_path)
                try:
                    file_info = os.stat(file_name, dir_fd=file_parent_fd, follow_symlinks=False)
                finally:
                    os.close(file_parent_fd)
                if file_info.st_mode & 0o111:
                    fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
                entries.append({
                    "path": full_path,
                    "size": len(contents),
                    "sha256": hashlib.sha256(contents).hexdigest(),
                    "mode": f"{file_info.st_mode & 0o777:04o}",
                })
        finally:
            os.close(leaf_fd)
    else:
        fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
    return hashlib.sha256(canonical_json(entries)).hexdigest()


def verify_new_unit(public_fd: int, payload_paths: tuple[str, ...], buffers: dict[str, bytes]) -> None:
    for path in payload_paths:
        if read_fixed_file(public_fd, path) != buffers[path]:
            fail(f"PROMOTED_BYTES_MISMATCH: {path}")


def create_journal(rollback_fd: int) -> int:
    try:
        fd = os.open(
            "journal.jsonl",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=rollback_fd,
        )
    except OSError as error:
        raise ReleaseError("ROLLBACK_JOURNAL_COLLISION") from error
    os.fsync(rollback_fd)
    return fd


def open_journal(rollback_fd: int) -> int:
    try:
        fd = os.open("journal.jsonl", os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW, dir_fd=rollback_fd)
    except OSError as error:
        raise ReleaseError("ROLLBACK_JOURNAL_INVALID") from error
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1:
        os.close(fd)
        fail("ROLLBACK_JOURNAL_INVALID")
    return fd


def journal_entry(index: int, target: str, slot: str, original: str, old_hash: str | None, state: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "index": index,
        "target": f"public_html/{target}",
        "slot": slot,
        "original": original,
        "oldInventorySha256": old_hash,
        "state": state,
    }


def append_journal(fd: int, entry: dict[str, Any]) -> None:
    write_all(fd, canonical_json(entry))
    os.fsync(fd)


def read_journal(rollback_fd: int) -> list[dict[str, Any]]:
    try:
        fd = os.open("journal.jsonl", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=rollback_fd)
    except OSError as error:
        raise ReleaseError("ROLLBACK_JOURNAL_INVALID") from error
    try:
        raw = read_all(fd)
    finally:
        os.close(fd)
    entries = []
    for line in raw.splitlines(keepends=True):
        try:
            entry = json.loads(line, object_pairs_hook=reject_duplicate_keys)
        except json.JSONDecodeError as error:
            raise ReleaseError("ROLLBACK_JOURNAL_INVALID") from error
        if canonical_json(entry) != line:
            fail("ROLLBACK_JOURNAL_NONCANONICAL")
        exact_keys(entry, JOURNAL_KEYS, "ROLLBACK_JOURNAL_ENTRY")
        entries.append(entry)
    if not entries:
        fail("ROLLBACK_JOURNAL_INVALID")
    return entries


def list_regular_tree(root_fd: int) -> tuple[str, ...]:
    found: list[str] = []

    def walk(directory_fd: int, prefix: str) -> None:
        for name in sorted(os.listdir(directory_fd), key=lambda item: item.encode("utf-8")):
            path = f"{prefix}/{name}" if prefix else name
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child_fd = open_directory(name, directory_fd, path)
                try:
                    walk(child_fd, path)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                found.append(path)
            else:
                fail(f"UNSAFE_SOURCE_ENTRY: {path}")

    walk(root_fd, "")
    return tuple(found)


def capture_reviewed_inputs(root_path: str) -> bytes:
    root_fd = open_root(root_path)
    try:
        web_fd = open_directory("web-hosting", root_fd, "web-hosting")
        try:
            host_fd = open_directory("cabohealth.org", web_fd, "web-hosting/cabohealth.org")
            try:
                if list_regular_tree(host_fd) != HOSTED_SOURCE_PATHS:
                    fail("HOSTED_SOURCE_FILE_SET_INVALID")
            finally:
                os.close(host_fd)
        finally:
            os.close(web_fd)

        files = []
        for path in INPUT_PATHS:
            contents = read_fixed_file(root_fd, path)
            files.append({
                "path": path,
                "size": len(contents),
                "sha256": hashlib.sha256(contents).hexdigest(),
                "bytesBase64": base64.b64encode(contents).decode("ascii"),
            })
    finally:
        os.close(root_fd)
    return canonical_json({
        "schemaVersion": 1,
        "artifactKind": "cabohealth-reviewed-web-input-snapshot-v1",
        "files": files,
    })


def create_file(parent_fd: int, name: str, contents: bytes, path: str, final_mode: int = 0o444) -> None:
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    try:
        fd = os.open(name, flags, 0o600, dir_fd=parent_fd)
    except OSError as error:
        raise ReleaseError(f"MATERIALIZATION_EXCLUSIVE_CREATE_FAILED: {path}") from error
    try:
        write_all(fd, contents)
        os.fsync(fd)
        if read_all(fd) != contents:
            fail(f"MATERIALIZATION_READBACK_FAILED: {path}")
        os.fchmod(fd, final_mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(parent_fd)


def verify_tree(root_fd: int, buffers: dict[str, bytes], file_mode: int = 0o444) -> None:
    found: list[str] = []

    def walk(directory_fd: int, prefix: str) -> None:
        for name in sorted(os.listdir(directory_fd), key=lambda item: item.encode("ascii")):
            path = f"{prefix}/{name}" if prefix else name
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child_fd = open_directory(name, directory_fd, path, writable=True)
                try:
                    walk(child_fd, path)
                finally:
                    os.close(child_fd)
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o777 != file_mode:
                fail(f"MATERIALIZED_ENTRY_INVALID: {path}")
            found.append(path)
            if path not in buffers:
                fail(f"MATERIALIZED_UNKNOWN_PATH: {path}")
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                if read_all(fd) != buffers[path]:
                    fail(f"MATERIALIZED_BYTES_MISMATCH: {path}")
            finally:
                os.close(fd)

    walk(root_fd, "")
    if tuple(found) != PAYLOAD_PATHS:
        fail("MATERIALIZED_FILE_SET_INVALID")


def materialize_new(bundle_fd: int, buffers: dict[str, bytes]) -> None:
    directories: dict[tuple[str, ...], int] = {(): os.dup(bundle_fd)}
    try:
        for path in PAYLOAD_PATHS:
            components = path.split("/")
            parent: tuple[str, ...] = ()
            for component in components[:-1]:
                child = (*parent, component)
                if child not in directories:
                    directories[child] = ensure_directory(component, directories[parent], "/".join(child))
                parent = child
            create_file(directories[parent], components[-1], buffers[path], path)
        verify_tree(bundle_fd, buffers)
        for components, fd in sorted(directories.items(), key=lambda item: len(item[0]), reverse=True):
            os.fchmod(fd, 0o555)
            os.fsync(fd)
    finally:
        for fd in directories.values():
            os.close(fd)


def materialize_local(root_path: str, raw: bytes) -> str:
    transport, buffers = parse_transport(raw)
    root_fd = open_root(root_path)
    try:
        release_fd = open_directory("release", root_fd, "release")
        try:
            bundles_fd = ensure_directory("web-bundles", release_fd, "release/web-bundles")
            try:
                transport_name = f"{transport['releaseId']}.transport.json"
                transport_info = stat_if_present(bundles_fd, transport_name)
                if transport_info is not None:
                    if (
                        not stat.S_ISREG(transport_info.st_mode)
                        or transport_info.st_uid != os.geteuid()
                        or transport_info.st_nlink != 1
                        or transport_info.st_mode & 0o777 != 0o444
                    ):
                        fail("TRANSPORT_PUBLICATION_COLLISION")
                    transport_fd = os.open(transport_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=bundles_fd)
                    try:
                        if read_all(transport_fd) != raw:
                            fail("TRANSPORT_PUBLICATION_COLLISION")
                    finally:
                        os.close(transport_fd)
                try:
                    os.mkdir(transport["releaseId"], 0o700, dir_fd=bundles_fd)
                    os.fsync(bundles_fd)
                    created = True
                except FileExistsError:
                    created = False
                bundle_fd = open_directory(
                    transport["releaseId"], bundles_fd, transport["releaseId"], writable=created
                )
                try:
                    if created:
                        materialize_new(bundle_fd, buffers)
                    else:
                        verify_tree(bundle_fd, buffers)
                finally:
                    os.close(bundle_fd)
                if transport_info is None:
                    create_file(bundles_fd, transport_name, raw, f"release/web-bundles/{transport_name}")
            finally:
                os.close(bundles_fd)
        finally:
            os.close(release_fd)
    finally:
        os.close(root_fd)
    return "materialized" if created else "verified-existing"


def materialize_stage_new(public_fd: int, buffers: dict[str, bytes]) -> None:
    directories: dict[tuple[str, ...], int] = {(): os.dup(public_fd)}
    try:
        for path in PAYLOAD_PATHS:
            components = path.split("/")
            parent: tuple[str, ...] = ()
            for component in components[:-1]:
                child = (*parent, component)
                if child not in directories:
                    directories[child] = ensure_directory(component, directories[parent], "/".join(child))
                parent = child
            create_file(directories[parent], components[-1], buffers[path], path, 0o644)
        verify_tree(public_fd, buffers, 0o644)
        for components, fd in sorted(directories.items(), key=lambda item: len(item[0]), reverse=True):
            if len(components) >= 2:
                os.fchmod(fd, 0o755)
            os.fsync(fd)
    finally:
        for fd in directories.values():
            os.close(fd)


def materialize_stage(root_path: str, release_argument: str, raw: bytes) -> str:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    try:
        stage_fd = ensure_directory("stage", root_fd, "stage")
        try:
            try:
                os.mkdir(transport["releaseId"], 0o700, dir_fd=stage_fd)
                os.fsync(stage_fd)
                created = True
            except FileExistsError:
                created = False
            release_fd = open_directory(
                transport["releaseId"], stage_fd, f"stage/{transport['releaseId']}", writable=created
            )
            try:
                if created:
                    public_fd = ensure_directory("public_html", release_fd, "stage/public_html")
                else:
                    public_fd = open_directory("public_html", release_fd, "stage/public_html", writable=True)
                try:
                    if created:
                        materialize_stage_new(public_fd, buffers)
                    else:
                        verify_tree(public_fd, buffers, 0o644)
                finally:
                    os.close(public_fd)
            finally:
                os.close(release_fd)
        finally:
            os.close(stage_fd)
    finally:
        os.close(root_fd)
    return "materialized-stage" if created else "verified-existing-stage"


def open_optional_container(public_fd: int, name: str) -> int | None:
    info = stat_if_present(public_fd, name)
    if info is None:
        return None
    if not stat.S_ISDIR(info.st_mode):
        fail(f"UNSAFE_LIVE_PARENT: public_html/{name}")
    return open_directory(name, public_fd, f"public_html/{name}", writable=True)


def unit_is_new(public_fd: int, payload_paths: tuple[str, ...], buffers: dict[str, bytes]) -> bool:
    try:
        verify_new_unit(public_fd, payload_paths, buffers)
        return True
    except (FileNotFoundError, ReleaseError):
        return False


def validate_release_argument(argument: str, transport: dict[str, Any]) -> None:
    if not RELEASE_ID.fullmatch(argument) or argument != transport["releaseId"]:
        fail("RELEASE_ARGUMENT_INVALID")


def promote_local(root_path: str, release_argument: str, raw: bytes) -> str:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    try:
        stage_fd = open_directory("stage", root_fd, "stage")
        try:
            release_fd = open_directory(release_argument, stage_fd, f"stage/{release_argument}", writable=True)
            try:
                stage_public_fd = open_directory("public_html", release_fd, "stage/public_html", writable=True)
            finally:
                os.close(release_fd)
        finally:
            os.close(stage_fd)
        try:
            live_public_fd = open_directory("public_html", root_fd, "public_html", writable=True)
            try:
                if os.fstat(stage_public_fd).st_dev != os.fstat(live_public_fd).st_dev:
                    fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
                verify_tree(stage_public_fd, buffers, 0o644)

                preflight: list[tuple[str, str | None]] = []
                containers: dict[str, int | None] = {}
                try:
                    for name in ("apps", "app", ".well-known"):
                        containers[name] = open_optional_container(live_public_fd, name)
                    for target, _slot, payload_paths in UNITS:
                        parent_name, leaf_name = target.split("/", 1)
                        parent_fd = containers[parent_name]
                        if parent_fd is None:
                            old_hash = None
                        else:
                            if "/" in leaf_name:
                                os.close(parent_fd)
                                containers[parent_name] = open_optional_container(live_public_fd, parent_name)
                                parent_fd, leaf_name = open_parent_for_target(live_public_fd, target)
                                try:
                                    old_hash = inventory_leaf(parent_fd, leaf_name, payload_paths, target)
                                finally:
                                    os.close(parent_fd)
                            else:
                                old_hash = inventory_leaf(parent_fd, leaf_name, payload_paths, target)
                        preflight.append(("present" if old_hash is not None else "absent", old_hash))
                finally:
                    for fd in containers.values():
                        if fd is not None:
                            os.close(fd)

                for name in ("apps", "app", ".well-known"):
                    container_fd = ensure_directory(name, live_public_fd, f"public_html/{name}")
                    os.close(container_fd)
                rollback_root_fd = ensure_directory("rollback", root_fd, "rollback")
                try:
                    if os.fstat(rollback_root_fd).st_dev != os.fstat(live_public_fd).st_dev:
                        fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
                    try:
                        os.mkdir(release_argument, 0o700, dir_fd=rollback_root_fd)
                        os.fsync(rollback_root_fd)
                    except FileExistsError as error:
                        raise ReleaseError("ROLLBACK_RELEASE_COLLISION") from error
                    rollback_fd = open_directory(release_argument, rollback_root_fd, f"rollback/{release_argument}")
                    try:
                        journal_fd = create_journal(rollback_fd)
                        try:
                            for index, (target, slot, payload_paths) in enumerate(UNITS):
                                original, old_hash = preflight[index]
                                stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
                                live_parent_fd, live_leaf = open_parent_for_target(live_public_fd, target)
                                try:
                                    current_hash = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                    if ("present" if current_hash is not None else "absent", current_hash) != (original, old_hash):
                                        fail(f"LIVE_TARGET_RACE_DETECTED: {target}")
                                    prepared = journal_entry(index, target, slot, original, old_hash, "prepared")
                                    append_journal(journal_fd, prepared)
                                    if original == "present":
                                        rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                        swapped_old_hash = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                                        if swapped_old_hash != old_hash or not unit_is_new(live_public_fd, payload_paths, buffers):
                                            rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                            fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")
                                        rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
                                    else:
                                        rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "noreplace")
                                        if not unit_is_new(live_public_fd, payload_paths, buffers):
                                            rename_with_flag(live_parent_fd, live_leaf, stage_parent_fd, stage_leaf, "noreplace")
                                            fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")
                                    append_journal(
                                        journal_fd,
                                        journal_entry(index, target, slot, original, old_hash, "promoted"),
                                    )
                                finally:
                                    os.close(stage_parent_fd)
                                    os.close(live_parent_fd)
                        finally:
                            os.close(journal_fd)
                    finally:
                        os.close(rollback_fd)
                finally:
                    os.close(rollback_root_fd)
            finally:
                os.close(live_public_fd)
        finally:
            os.close(stage_public_fd)
    finally:
        os.close(root_fd)
    return "promoted"


def validate_journal(entries: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    latest: dict[int, dict[str, Any]] = {}
    allowed_transitions = {None: "prepared", "prepared": "promoted", "promoted": "rolled-back"}
    for entry in entries:
        index = entry.get("index")
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(UNITS):
            fail("ROLLBACK_JOURNAL_INVALID")
        target, slot, _payload_paths = UNITS[index]
        if (
            entry.get("schemaVersion") != 1
            or entry.get("target") != f"public_html/{target}"
            or entry.get("slot") != slot
            or entry.get("original") not in ("present", "absent")
            or (
                entry.get("oldInventorySha256") is not None
                and not SHA256.fullmatch(entry["oldInventorySha256"])
            )
            or (entry["original"] == "present") != (entry["oldInventorySha256"] is not None)
            or entry.get("state") not in ("prepared", "promoted", "rolled-back")
        ):
            fail("ROLLBACK_JOURNAL_INVALID")
        previous = latest.get(index)
        if previous and any(entry[key] != previous[key] for key in JOURNAL_KEYS if key != "state"):
            fail("ROLLBACK_JOURNAL_INVALID")
        previous_state = previous["state"] if previous else None
        if allowed_transitions.get(previous_state) != entry["state"]:
            fail("ROLLBACK_JOURNAL_INVALID")
        latest[index] = entry
    if sorted(latest) != list(range(len(latest))):
        fail("ROLLBACK_JOURNAL_INVALID")
    return latest


def rollback_local(root_path: str, release_argument: str, raw: bytes) -> str:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    try:
        stage_fd = open_directory("stage", root_fd, "stage")
        try:
            stage_release_fd = open_directory(release_argument, stage_fd, f"stage/{release_argument}", writable=True)
            try:
                stage_public_fd = open_directory("public_html", stage_release_fd, "stage/public_html", writable=True)
            finally:
                os.close(stage_release_fd)
        finally:
            os.close(stage_fd)
        live_public_fd = open_directory("public_html", root_fd, "public_html", writable=True)
        try:
            rollback_root_fd = open_directory("rollback", root_fd, "rollback")
            try:
                rollback_fd = open_directory(release_argument, rollback_root_fd, f"rollback/{release_argument}")
                try:
                    latest = validate_journal(read_journal(rollback_fd))
                    if latest and all(entry["state"] == "rolled-back" for entry in latest.values()):
                        fail("ROLLBACK_ALREADY_APPLIED")
                    journal_fd = open_journal(rollback_fd)
                    try:
                        for index in sorted(latest, reverse=True):
                            entry = latest[index]
                            if entry["state"] == "rolled-back":
                                continue
                            target, slot, payload_paths = UNITS[index]
                            live_parent_fd, live_leaf = open_parent_for_target(live_public_fd, target)
                            try:
                                is_new = unit_is_new(live_public_fd, payload_paths, buffers)
                                slot_info = stat_if_present(rollback_fd, slot)
                                if entry["original"] == "present":
                                    if is_new and slot_info is not None:
                                        rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                                    elif is_new:
                                        stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
                                        try:
                                            stage_hash = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                                            if stage_hash != entry["oldInventorySha256"]:
                                                fail(f"ROLLBACK_OLD_TARGET_MISSING: {target}")
                                            rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                        finally:
                                            os.close(stage_parent_fd)
                                    current_hash = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                    if current_hash != entry["oldInventorySha256"]:
                                        fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")
                                else:
                                    if is_new:
                                        if slot_info is not None:
                                            fail(f"ROLLBACK_COLLISION: {target}")
                                        rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                                    elif stat_if_present(live_parent_fd, live_leaf) is not None:
                                        fail(f"ROLLBACK_TARGET_RACE: {target}")
                                append_journal(
                                    journal_fd,
                                    journal_entry(
                                        index,
                                        target,
                                        slot,
                                        entry["original"],
                                        entry["oldInventorySha256"],
                                        "rolled-back",
                                    ),
                                )
                            finally:
                                os.close(live_parent_fd)
                    finally:
                        os.close(journal_fd)
                finally:
                    os.close(rollback_fd)
            finally:
                os.close(rollback_root_fd)
        finally:
            os.close(live_public_fd)
            os.close(stage_public_fd)
    finally:
        os.close(root_fd)
    return "rolled-back"


def validate_artifact_manifest(manifest: Any, transport: dict[str, Any]) -> bytes:
    exact_keys(manifest, MANIFEST_KEYS, "WEB_ARTIFACT_MANIFEST")
    for key in (
        "schemaVersion",
        "releaseId",
        "inventorySha256",
        "appId",
        "entrySlugs",
        "legalSlugs",
        "promoteTargets",
    ):
        if manifest[key] != transport[key]:
            fail("WEB_ARTIFACT_MANIFEST_RECONCILIATION_FAILED")
    if manifest["artifactKind"] != "cabohealth-public-web-v1":
        fail("WEB_ARTIFACT_MANIFEST_RECONCILIATION_FAILED")
    expected_files = [{key: item[key] for key in META_KEYS} for item in transport["files"]]
    if manifest["files"] != expected_files:
        fail("WEB_ARTIFACT_MANIFEST_FILE_SET_INVALID")
    if not isinstance(manifest["inputs"], list) or len(manifest["inputs"]) != len(INPUT_MANIFEST_PATHS):
        fail("WEB_ARTIFACT_MANIFEST_INPUTS_INVALID")
    for index, item in enumerate(manifest["inputs"]):
        exact_keys(item, ("path", "size", "sha256", "kind"), "WEB_ARTIFACT_INPUT")
        if (
            item["path"] != INPUT_MANIFEST_PATHS[index]
            or item["kind"] != INPUT_MANIFEST_KINDS[index]
            or not isinstance(item["size"], int)
            or isinstance(item["size"], bool)
            or item["size"] < 0
            or not isinstance(item["sha256"], str)
            or not SHA256.fullmatch(item["sha256"])
        ):
            fail("WEB_ARTIFACT_MANIFEST_INPUTS_INVALID")
    return canonical_json(manifest)


def publish_manifest_local(root_path: str, raw: bytes) -> str:
    try:
        envelope = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("WEB_ARTIFACT_ENVELOPE_INVALID") from error
    if canonical_json(envelope) != raw:
        fail("WEB_ARTIFACT_ENVELOPE_NONCANONICAL")
    exact_keys(envelope, ("transport", "manifest"), "WEB_ARTIFACT_ENVELOPE")
    transport, buffers = parse_transport(canonical_json(envelope["transport"]))
    manifest_bytes = validate_artifact_manifest(envelope["manifest"], transport)

    root_fd = open_root(root_path)
    try:
        release_fd = open_directory("release", root_fd, "release")
        try:
            bundles_fd = open_directory("web-bundles", release_fd, "release/web-bundles")
            try:
                bundle_fd = open_directory(transport["releaseId"], bundles_fd, transport["releaseId"], writable=True)
                try:
                    verify_tree(bundle_fd, buffers)
                finally:
                    os.close(bundle_fd)
            finally:
                os.close(bundles_fd)

            existing = stat_if_present(release_fd, "web-artifacts.json")
            if existing is None:
                create_file(
                    release_fd,
                    "web-artifacts.json",
                    manifest_bytes,
                    "release/web-artifacts.json",
                )
                return "published-manifest"
            if (
                not stat.S_ISREG(existing.st_mode)
                or existing.st_uid != os.geteuid()
                or existing.st_nlink != 1
                or existing.st_mode & 0o777 != 0o444
            ):
                fail("WEB_ARTIFACT_MANIFEST_COLLISION")
            fd = os.open("web-artifacts.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=release_fd)
            try:
                if read_all(fd) != manifest_bytes:
                    fail("WEB_ARTIFACT_MANIFEST_COLLISION")
            finally:
                os.close(fd)
            return "verified-existing-manifest"
        finally:
            os.close(release_fd)
    finally:
        os.close(root_fd)


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "materialize-local":
        result = materialize_local(argv[2], sys.stdin.buffer.read())
        print(result)
        return 0
    if len(argv) == 3 and argv[1] == "capture-reviewed-inputs":
        sys.stdout.buffer.write(capture_reviewed_inputs(argv[2]))
        return 0
    if len(argv) == 4 and argv[1] == "materialize-stage":
        result = materialize_stage(argv[2], argv[3], sys.stdin.buffer.read())
        print(result)
        return 0
    if len(argv) == 4 and argv[1] == "promote-local":
        raw = sys.stdin.buffer.read()
        try:
            print(promote_local(argv[2], argv[3], raw))
        except ReleaseError as promotion_error:
            try:
                rollback_local(argv[2], argv[3], raw)
            except ReleaseError:
                raise promotion_error
            raise ReleaseError(f"{promotion_error}; AUTO_ROLLBACK_APPLIED") from None
        return 0
    if len(argv) == 4 and argv[1] == "rollback-local":
        print(rollback_local(argv[2], argv[3], sys.stdin.buffer.read()))
        return 0
    if len(argv) == 3 and argv[1] == "publish-manifest-local":
        print(publish_manifest_local(argv[2], sys.stdin.buffer.read()))
        return 0
    fail("Usage: secure_web_release.py <materialize-local|materialize-stage|capture-reviewed-inputs|promote-local|rollback-local|publish-manifest-local> <owned-root> [release-id]")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

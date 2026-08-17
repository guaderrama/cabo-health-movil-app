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
from html.parser import HTMLParser
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
OPEN_FILE_READ = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
TREE_DIRECTORIES = (
    "",
    ".well-known",
    "app",
    "app/privacy",
    "app/report-content",
    "app/support",
    "app/terms",
    "apps",
    "apps/clinic-guide",
    "apps/healthy-recipes",
    "apps/shared",
)
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
URL_ATTRIBUTE_POLICY = {
    "img": ("src", "srcset"),
    "source": ("src", "srcset"),
    "video": ("src", "poster"),
    "audio": ("src",),
    "track": ("src",),
    "link": ("href",),
    "script": ("src",),
    "iframe": ("src",),
    "embed": ("src",),
    "object": ("data",),
    "form": ("action",),
    "input": ("src", "formaction"),
    "button": ("formaction",),
    "use": ("href", "xlink:href"),
    "image": ("href", "xlink:href"),
    "a": ("ping",),
    "area": ("ping",),
    "base": ("href",),
    "body": ("background",),
    "table": ("background",),
    "td": ("background",),
    "th": ("background",),
}


class ReleaseError(Exception):
    pass


def fail(message: str) -> None:
    raise ReleaseError(message)


def test_fault_enabled(root_path: str, name: str) -> bool:
    requested = os.environ.get("CABOHEALTH_TEST_FAULT")
    if requested != name:
        return False
    if "cabohealth-" not in os.path.basename(root_path) or "-fixture-" not in os.path.basename(root_path):
        fail("TEST_FAULT_FORBIDDEN")
    return True


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


def reviewed_local_url(value: str) -> bool:
    if not value or value.startswith("//") or "\\" in value:
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        return False
    if value.startswith("https://cabohealth.org/") or value.startswith("/"):
        return True
    return re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value) is None


class ActiveResourceParser(HTMLParser):
    def __init__(self, path: str) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag.lower() == "meta" and (values.get("http-equiv") or "").lower() == "refresh":
            fail(f"WEB_ACTIVE_RESOURCE_FORBIDDEN: {self.path}: meta[refresh]")
        for attribute in URL_ATTRIBUTE_POLICY.get(tag.lower(), ()):
            value = values.get(attribute)
            if value is None:
                continue
            candidates = [value]
            if attribute == "srcset":
                candidates = [item.strip().split()[0] if item.strip() else "" for item in value.split(",")]
            if any(not reviewed_local_url(candidate) for candidate in candidates):
                fail(f"WEB_ACTIVE_RESOURCE_FORBIDDEN: {self.path}: {tag}[{attribute}]")


def assert_static_web_policy(path: str, contents: bytes) -> None:
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ReleaseError(f"WEB_STATIC_POLICY_UTF8_INVALID: {path}") from error
    parser = ActiveResourceParser(path)
    try:
        parser.feed(text)
        parser.close()
    except ReleaseError:
        raise
    except Exception as error:
        raise ReleaseError(f"WEB_STATIC_POLICY_HTML_INVALID: {path}") from error
    if re.search(r"@import\s+(?:url\()?\s*[\"']?(?:https?:|//)|url\(\s*[\"']?(?:https?:|//)|http://", text, re.I):
        fail(f"WEB_ACTIVE_RESOURCE_FORBIDDEN: {path}: css-url")


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
        if path.endswith(".html"):
            assert_static_web_policy(path, contents)
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


def validate_owned_directory(fd: int, label: str, *, mode: int | None = None) -> os.stat_result:
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        fail(f"UNOWNED_DIRECTORY: {label}")
    if info.st_mode & 0o022:
        fail(f"UNSAFE_DIRECTORY_MODE: {label}")
    if mode is not None and info.st_mode & 0o777 != mode:
        fail(f"DIRECTORY_MODE_INVALID: {label}")
    return info


def open_directory(name: str, parent_fd: int, label: str, *, mode: int | None = None) -> int:
    try:
        fd = os.open(name, OPEN_DIR, dir_fd=parent_fd)
    except OSError as error:
        raise ReleaseError(f"UNSAFE_DIRECTORY: {label}") from error
    validate_owned_directory(fd, label, mode=mode)
    return fd


def open_root(path: str) -> int:
    if not os.path.isabs(path) or os.path.normpath(path) != path:
        fail("UNSAFE_ROOT_DIRECTORY")
    directory_fd = os.open("/", OPEN_DIR)
    try:
        components = path.split("/")[1:]
        if not components or any(component in ("", ".", "..") for component in components):
            fail("UNSAFE_ROOT_DIRECTORY")
        for index, component in enumerate(components):
            try:
                child_fd = os.open(component, OPEN_DIR, dir_fd=directory_fd)
            except OSError as error:
                raise ReleaseError("UNSAFE_ROOT_DIRECTORY") from error
            info = os.fstat(child_fd)
            if (
                not stat.S_ISDIR(info.st_mode)
                or info.st_uid not in (0, os.geteuid())
                or info.st_mode & 0o022
            ):
                os.close(child_fd)
                fail("UNSAFE_ROOT_DIRECTORY")
            os.close(directory_fd)
            directory_fd = child_fd
            if index == len(components) - 1:
                validate_owned_directory(directory_fd, "root")
                expected = os.environ.get("CABOHEALTH_EXPECTED_ROOT_ID")
                actual = f"{info.st_dev}:{info.st_ino}"
                if expected is not None and expected != actual:
                    fail("ROOT_IDENTITY_MISMATCH")
        return directory_fd
    except Exception:
        os.close(directory_fd)
        raise


def ensure_directory(name: str, parent_fd: int, label: str, mode: int = 0o700) -> int:
    try:
        os.mkdir(name, mode, dir_fd=parent_fd)
        os.fsync(parent_fd)
    except FileExistsError:
        pass
    fd = open_directory(name, parent_fd, label, mode=mode)
    os.fsync(fd)
    return fd


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
                file_fd = os.open(component, OPEN_FILE_READ, dir_fd=directory_fd)
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
            child_fd = open_directory(component, directory_fd, target, mode=0o755)
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
    try:
        fd = os.open(name, OPEN_FILE_READ, dir_fd=parent_fd)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ReleaseError(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}") from error
    entries: list[dict[str, Any]] = []
    expects_file = expected_paths == (target,)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid():
            fail(f"UNOWNED_LIVE_TARGET: {target}")
        if stat.S_ISREG(info.st_mode):
            if not expects_file or info.st_nlink != 1 or info.st_mode & 0o777 != 0o644:
                fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
            contents = read_all(fd)
            after = os.fstat(fd)
            if (info.st_dev, info.st_ino, info.st_size, info.st_mode, info.st_uid, info.st_nlink) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_uid, after.st_nlink
            ):
                fail(f"LIVE_TARGET_CHANGED_DURING_INVENTORY: {target}")
            entries.append({
                "path": expected_paths[0],
                "size": len(contents),
                "sha256": hashlib.sha256(contents).hexdigest(),
                "mode": "0644",
            })
        elif stat.S_ISDIR(info.st_mode):
            if expects_file or info.st_mode & 0o777 != 0o755:
                fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
            prefix = f"{target}/"
            relative_expected = tuple(path.removeprefix(prefix) for path in expected_paths)
            found = tuple(sorted(os.listdir(fd), key=lambda item: item.encode("ascii")))
            if found != relative_expected:
                fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
            for relative_path, full_path in zip(found, expected_paths, strict=True):
                try:
                    file_fd = os.open(relative_path, OPEN_FILE_READ, dir_fd=fd)
                except OSError as error:
                    raise ReleaseError(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}") from error
                try:
                    before = os.fstat(file_fd)
                    if (
                        not stat.S_ISREG(before.st_mode)
                        or before.st_uid != os.geteuid()
                        or before.st_nlink != 1
                        or before.st_mode & 0o777 != 0o644
                    ):
                        fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
                    contents = read_all(file_fd)
                    after = os.fstat(file_fd)
                    if (before.st_dev, before.st_ino, before.st_size, before.st_mode, before.st_uid, before.st_nlink) != (
                        after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_uid, after.st_nlink
                    ):
                        fail(f"LIVE_TARGET_CHANGED_DURING_INVENTORY: {target}")
                    entries.append({
                        "path": full_path,
                        "size": len(contents),
                        "sha256": hashlib.sha256(contents).hexdigest(),
                        "mode": "0644",
                    })
                finally:
                    os.close(file_fd)
            after_directory = os.fstat(fd)
            if (info.st_dev, info.st_ino, info.st_mode) != (
                after_directory.st_dev, after_directory.st_ino, after_directory.st_mode
            ):
                fail(f"LIVE_TARGET_CHANGED_DURING_INVENTORY: {target}")
        else:
            fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
    finally:
        os.close(fd)
    return hashlib.sha256(canonical_json(entries)).hexdigest()


def expected_unit_hash(payload_paths: tuple[str, ...], buffers: dict[str, bytes]) -> str:
    entries = [{
        "path": path,
        "size": len(buffers[path]),
        "sha256": hashlib.sha256(buffers[path]).hexdigest(),
        "mode": "0644",
    } for path in payload_paths]
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
    os.fchmod(fd, 0o600)
    os.fsync(fd)
    os.fsync(rollback_fd)
    return fd


def open_journal(rollback_fd: int) -> int:
    try:
        fd = os.open(
            "journal.jsonl",
            os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=rollback_fd,
        )
    except OSError as error:
        raise ReleaseError("ROLLBACK_JOURNAL_INVALID") from error
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_nlink != 1
        or info.st_mode & 0o777 != 0o600
    ):
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
        fd = os.open("journal.jsonl", OPEN_FILE_READ, dir_fd=rollback_fd)
    except OSError as error:
        raise ReleaseError("ROLLBACK_JOURNAL_INVALID") from error
    try:
        before = os.fstat(fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or before.st_mode & 0o777 != 0o600
        ):
            fail("ROLLBACK_JOURNAL_INVALID")
        raw = read_all(fd)
        after = os.fstat(fd)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mode,
            before.st_uid,
            before.st_nlink,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mode,
            after.st_uid,
            after.st_nlink,
        ):
            fail("ROLLBACK_JOURNAL_CHANGED_DURING_READ")
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


def verify_tree(
    root_fd: int,
    buffers: dict[str, bytes],
    file_mode: int = 0o444,
    root_mode: int = 0o555,
    directory_mode: int = 0o555,
) -> None:
    found_files: list[str] = []
    found_directories: list[str] = [""]
    root_before = validate_owned_directory(root_fd, "materialized-root", mode=root_mode)

    def walk(directory_fd: int, prefix: str) -> None:
        before_directory = os.fstat(directory_fd)
        for name in sorted(os.listdir(directory_fd), key=lambda item: item.encode("ascii")):
            path = f"{prefix}/{name}" if prefix else name
            try:
                entry_fd = os.open(name, OPEN_FILE_READ, dir_fd=directory_fd)
            except OSError as error:
                raise ReleaseError(f"MATERIALIZED_ENTRY_INVALID: {path}") from error
            try:
                before = os.fstat(entry_fd)
                if before.st_uid != os.geteuid():
                    fail(f"MATERIALIZED_ENTRY_INVALID: {path}")
                if stat.S_ISDIR(before.st_mode):
                    if before.st_mode & 0o777 != directory_mode or path not in TREE_DIRECTORIES:
                        fail(f"MATERIALIZED_DIRECTORY_INVALID: {path}")
                    found_directories.append(path)
                    walk(entry_fd, path)
                elif stat.S_ISREG(before.st_mode):
                    if before.st_nlink != 1 or before.st_mode & 0o777 != file_mode or path not in buffers:
                        fail(f"MATERIALIZED_ENTRY_INVALID: {path}")
                    contents = read_all(entry_fd)
                    after = os.fstat(entry_fd)
                    identity = lambda info: (
                        info.st_dev,
                        info.st_ino,
                        info.st_size,
                        info.st_mode,
                        info.st_uid,
                        info.st_nlink,
                    )
                    if identity(before) != identity(after):
                        fail(f"MATERIALIZED_ENTRY_CHANGED: {path}")
                    if contents != buffers[path]:
                        fail(f"MATERIALIZED_BYTES_MISMATCH: {path}")
                    found_files.append(path)
                else:
                    fail(f"MATERIALIZED_ENTRY_INVALID: {path}")
            finally:
                os.close(entry_fd)
        after_directory = os.fstat(directory_fd)
        if (before_directory.st_dev, before_directory.st_ino) != (
            after_directory.st_dev,
            after_directory.st_ino,
        ):
            fail(f"MATERIALIZED_DIRECTORY_CHANGED: {prefix or '.'}")

    walk(root_fd, "")
    root_after = os.fstat(root_fd)
    if (root_before.st_dev, root_before.st_ino) != (root_after.st_dev, root_after.st_ino):
        fail("MATERIALIZED_DIRECTORY_CHANGED: .")
    if tuple(found_files) != PAYLOAD_PATHS or tuple(sorted(found_directories)) != tuple(sorted(TREE_DIRECTORIES)):
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
        for components, fd in sorted(directories.items(), key=lambda item: len(item[0]), reverse=True):
            os.fchmod(fd, 0o555)
            os.fsync(fd)
        verify_tree(bundle_fd, buffers)
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
                    transport_fd = os.open(transport_name, OPEN_FILE_READ, dir_fd=bundles_fd)
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
                    transport["releaseId"], bundles_fd, transport["releaseId"], mode=None if created else 0o555
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
                    directories[child] = ensure_directory(component, directories[parent], "/".join(child), 0o755)
                parent = child
            create_file(directories[parent], components[-1], buffers[path], path, 0o644)
        verify_tree(public_fd, buffers, 0o644, 0o700, 0o755)
        for fd in directories.values():
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
                transport["releaseId"], stage_fd, f"stage/{transport['releaseId']}", mode=0o700
            )
            try:
                if created:
                    public_fd = ensure_directory("public_html", release_fd, "stage/public_html")
                else:
                    public_fd = open_directory("public_html", release_fd, "stage/public_html", mode=0o700)
                try:
                    if created:
                        materialize_stage_new(public_fd, buffers)
                    else:
                        verify_tree(public_fd, buffers, 0o644, 0o700, 0o755)
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
    return open_directory(name, public_fd, f"public_html/{name}", mode=0o755)


def unit_is_new(public_fd: int, payload_paths: tuple[str, ...], buffers: dict[str, bytes]) -> bool:
    try:
        verify_new_unit(public_fd, payload_paths, buffers)
        return True
    except (FileNotFoundError, ReleaseError):
        return False


def validate_release_argument(argument: str, transport: dict[str, Any]) -> None:
    if not RELEASE_ID.fullmatch(argument) or argument != transport["releaseId"]:
        fail("RELEASE_ARGUMENT_INVALID")


def inventory_live(root_path: str, release_argument: str, raw: bytes) -> dict[str, Any]:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    try:
        public_fd = open_directory("public_html", root_fd, "public_html", mode=0o755)
        try:
            hashes: list[str] = []
            file_count = 0
            for index in (1, 6, 7):
                target, _slot, payload_paths = UNITS[index]
                parent_fd, leaf = open_parent_for_target(public_fd, target)
                try:
                    actual = inventory_leaf(parent_fd, leaf, payload_paths, target)
                finally:
                    os.close(parent_fd)
                expected = expected_unit_hash(payload_paths, buffers)
                if actual != expected:
                    fail("SERVER_INVENTORY_INVALID")
                hashes.append(actual)
                file_count += len(payload_paths)
        finally:
            os.close(public_fd)
    finally:
        os.close(root_fd)
    return {
        "status": "verified",
        "rootCount": 3,
        "fileCount": file_count,
        "inventorySha256": hashlib.sha256(canonical_json(hashes)).hexdigest(),
    }


def promote_next(root_path: str, release_argument: str, raw: bytes) -> dict[str, Any]:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    try:
        stage_fd = open_directory("stage", root_fd, "stage")
        try:
            release_fd = open_directory(release_argument, stage_fd, f"stage/{release_argument}", mode=0o700)
            try:
                stage_public_fd = open_directory("public_html", release_fd, "stage/public_html", mode=0o700)
            finally:
                os.close(release_fd)
        finally:
            os.close(stage_fd)
        try:
            live_public_fd = open_directory("public_html", root_fd, "public_html", mode=0o755)
            try:
                if (
                    os.fstat(stage_public_fd).st_dev != os.fstat(live_public_fd).st_dev
                    or test_fault_enabled(root_path, "promotion-cross-device")
                ):
                    fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
                rollback_root_info = stat_if_present(root_fd, "rollback")
                existing_release = False
                if rollback_root_info is not None:
                    existing_rollback_root_fd = open_directory("rollback", root_fd, "rollback", mode=0o700)
                    try:
                        existing_release = stat_if_present(existing_rollback_root_fd, release_argument) is not None
                    finally:
                        os.close(existing_rollback_root_fd)
                preflight: list[tuple[str, str | None]] = []
                if not existing_release:
                    for target, _slot, payload_paths in UNITS:
                        parent_name, leaf_name = target.split("/", 1)
                        parent_fd = open_optional_container(live_public_fd, parent_name)
                        if parent_fd is None:
                            old_hash = None
                        else:
                            try:
                                old_hash = inventory_leaf(parent_fd, leaf_name, payload_paths, target)
                            finally:
                                os.close(parent_fd)
                        preflight.append(("present" if old_hash is not None else "absent", old_hash))
                    for name in ("apps", "app", ".well-known"):
                        container_fd = ensure_directory(name, live_public_fd, f"public_html/{name}", 0o755)
                        os.close(container_fd)

                rollback_root_fd = ensure_directory("rollback", root_fd, "rollback")
                try:
                    if (
                        os.fstat(rollback_root_fd).st_dev != os.fstat(live_public_fd).st_dev
                        or os.fstat(stage_public_fd).st_dev != os.fstat(live_public_fd).st_dev
                    ):
                        fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
                    if existing_release:
                        created_rollback = False
                    else:
                        try:
                            os.mkdir(release_argument, 0o700, dir_fd=rollback_root_fd)
                            os.fsync(rollback_root_fd)
                            created_rollback = True
                        except FileExistsError as error:
                            raise ReleaseError("ROLLBACK_RELEASE_COLLISION") from error
                    rollback_fd = open_directory(
                        release_argument,
                        rollback_root_fd,
                        f"rollback/{release_argument}",
                        mode=0o700,
                    )
                    try:
                        if created_rollback:
                            journal_fd = create_journal(rollback_fd)
                            try:
                                for index, (target, slot, _payload_paths) in enumerate(UNITS):
                                    original, old_hash = preflight[index]
                                    append_journal(
                                        journal_fd,
                                        journal_entry(index, target, slot, original, old_hash, "prepared"),
                                    )
                            finally:
                                os.close(journal_fd)

                        latest = validate_journal(read_journal(rollback_fd))
                        if len(latest) != len(UNITS):
                            fail("ROLLBACK_JOURNAL_INVALID")
                        if any(entry["state"] == "rolled-back" for entry in latest.values()):
                            fail("PROMOTION_AFTER_ROLLBACK_FORBIDDEN")
                        pending = [index for index, entry in latest.items() if entry["state"] == "prepared"]
                        if not pending:
                            fail("PROMOTION_ALREADY_COMPLETE")
                        index = min(pending)
                        entry = latest[index]
                        target, slot, payload_paths = UNITS[index]
                        new_hash = expected_unit_hash(payload_paths, buffers)
                        stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
                        live_parent_fd, live_leaf = open_parent_for_target(live_public_fd, target)
                        try:
                            stage_hash = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                            live_hash = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                            slot_hash = inventory_leaf(rollback_fd, slot, payload_paths, target)
                            old_hash = entry["oldInventorySha256"]
                            if entry["original"] == "present":
                                if live_hash == new_hash and stage_hash == old_hash and slot_hash is None:
                                    rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
                                    stage_hash = None
                                    slot_hash = inventory_leaf(rollback_fd, slot, payload_paths, target)
                                if live_hash == new_hash and stage_hash is None and slot_hash == old_hash:
                                    pass
                                elif live_hash == old_hash and stage_hash == new_hash and slot_hash is None:
                                    rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                    try:
                                        if test_fault_enabled(root_path, "promotion-post-exchange-inventory-error"):
                                            fail(f"PROMOTION_POST_EXCHANGE_INVENTORY_FAILED: {target}")
                                        after_live = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                        after_stage = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                                        if after_live != new_hash or after_stage != old_hash:
                                            fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")
                                    except ReleaseError:
                                        rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                        raise
                                    rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
                                    if inventory_leaf(rollback_fd, slot, payload_paths, target) != old_hash:
                                        fail(f"PROMOTION_ROLLBACK_SLOT_MISMATCH: {target}")
                                else:
                                    fail(f"PROMOTION_STATE_INVALID: {target}")
                            else:
                                if live_hash == new_hash and stage_hash is None and slot_hash is None:
                                    pass
                                elif live_hash is None and stage_hash == new_hash and slot_hash is None:
                                    rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "noreplace")
                                    try:
                                        if test_fault_enabled(root_path, "promotion-post-noreplace-inventory-error"):
                                            fail(f"PROMOTION_POST_NOREPLACE_INVENTORY_FAILED: {target}")
                                        if inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) != new_hash:
                                            fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")
                                    except ReleaseError:
                                        rename_with_flag(live_parent_fd, live_leaf, stage_parent_fd, stage_leaf, "noreplace")
                                        raise
                                else:
                                    fail(f"PROMOTION_STATE_INVALID: {target}")
                            journal_fd = open_journal(rollback_fd)
                            try:
                                append_journal(
                                    journal_fd,
                                    journal_entry(index, target, slot, entry["original"], old_hash, "promoted"),
                                )
                            finally:
                                os.close(journal_fd)
                        finally:
                            os.close(stage_parent_fd)
                            os.close(live_parent_fd)
                        return {
                            "schemaVersion": 1,
                            "index": index,
                            "target": f"public_html/{target}",
                            "status": "unit-promoted",
                            "complete": index == len(UNITS) - 1,
                        }
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
    fail("PROMOTION_STATE_INVALID")


def validate_journal(entries: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    latest: dict[int, dict[str, Any]] = {}
    allowed_transitions = {
        None: {"prepared"},
        "prepared": {"promoted", "rolled-back"},
        "promoted": {"rolled-back"},
    }
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
        if entry["state"] not in allowed_transitions.get(previous_state, set()):
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
            stage_release_fd = open_directory(release_argument, stage_fd, f"stage/{release_argument}", mode=0o700)
            try:
                stage_public_fd = open_directory("public_html", stage_release_fd, "stage/public_html", mode=0o700)
            finally:
                os.close(stage_release_fd)
        finally:
            os.close(stage_fd)
        live_public_fd = open_directory("public_html", root_fd, "public_html", mode=0o755)
        try:
            rollback_root_fd = open_directory("rollback", root_fd, "rollback", mode=0o700)
            try:
                rollback_fd = open_directory(
                    release_argument,
                    rollback_root_fd,
                    f"rollback/{release_argument}",
                    mode=0o700,
                )
                try:
                    latest = validate_journal(read_journal(rollback_fd))
                    if len(latest) != len(UNITS):
                        fail("ROLLBACK_JOURNAL_INVALID")
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
                                new_hash = expected_unit_hash(payload_paths, buffers)
                                old_hash = entry["oldInventorySha256"]
                                live_hash = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                slot_hash = inventory_leaf(rollback_fd, slot, payload_paths, target)
                                stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
                                try:
                                    stage_hash = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                                    if entry["state"] == "prepared":
                                        expected_live = old_hash if entry["original"] == "present" else None
                                        if live_hash != expected_live or stage_hash != new_hash or slot_hash is not None:
                                            fail(f"ROLLBACK_PREPARED_STATE_INVALID: {target}")
                                    elif entry["original"] == "present":
                                        if live_hash == old_hash and slot_hash == new_hash and stage_hash is None:
                                            pass
                                        elif live_hash == new_hash and slot_hash == old_hash and stage_hash is None:
                                            rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                                            try:
                                                if test_fault_enabled(root_path, "rollback-post-exchange-inventory-error"):
                                                    fail(f"ROLLBACK_POST_EXCHANGE_INVENTORY_FAILED: {target}")
                                                restored = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                                displaced = inventory_leaf(rollback_fd, slot, payload_paths, target)
                                                if (
                                                    restored != old_hash
                                                    or displaced != new_hash
                                                    or test_fault_enabled(root_path, "rollback-post-exchange-mismatch")
                                                ):
                                                    fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")
                                            except ReleaseError:
                                                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                                                raise
                                        elif live_hash == new_hash and slot_hash is None and stage_hash == old_hash:
                                            rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                            try:
                                                restored = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                                                displaced = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                                                if restored != old_hash or displaced != new_hash:
                                                    fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")
                                            except ReleaseError:
                                                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                                                raise
                                        else:
                                            fail(f"ROLLBACK_STATE_INVALID: {target}")
                                    else:
                                        if live_hash is None and slot_hash == new_hash and stage_hash is None:
                                            pass
                                        elif live_hash == new_hash and slot_hash is None and stage_hash is None:
                                            rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                                            if (
                                                inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) is not None
                                                or inventory_leaf(rollback_fd, slot, payload_paths, target) != new_hash
                                            ):
                                                fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")
                                        else:
                                            fail(f"ROLLBACK_STATE_INVALID: {target}")
                                finally:
                                    os.close(stage_parent_fd)
                                append_journal(
                                    journal_fd,
                                    journal_entry(
                                        index,
                                        target,
                                        slot,
                                        entry["original"],
                                        old_hash,
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


def publish_manifest_local(root_path: str, reviewed_manifest_sha256: str, raw: bytes) -> str:
    if not SHA256.fullmatch(reviewed_manifest_sha256):
        fail("REVIEWED_MANIFEST_SHA256_INVALID")
    try:
        envelope = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("WEB_ARTIFACT_ENVELOPE_INVALID") from error
    if canonical_json(envelope) != raw:
        fail("WEB_ARTIFACT_ENVELOPE_NONCANONICAL")
    exact_keys(envelope, ("transport", "manifest"), "WEB_ARTIFACT_ENVELOPE")
    transport, buffers = parse_transport(canonical_json(envelope["transport"]))
    manifest_bytes = validate_artifact_manifest(envelope["manifest"], transport)
    if hashlib.sha256(manifest_bytes).hexdigest() != reviewed_manifest_sha256:
        fail("REVIEWED_MANIFEST_SHA256_MISMATCH")

    root_fd = open_root(root_path)
    try:
        release_fd = open_directory("release", root_fd, "release")
        try:
            bundles_fd = open_directory("web-bundles", release_fd, "release/web-bundles")
            try:
                bundle_fd = open_directory(transport["releaseId"], bundles_fd, transport["releaseId"], mode=0o555)
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
            fd = os.open("web-artifacts.json", OPEN_FILE_READ, dir_fd=release_fd)
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
    if len(argv) == 3 and argv[1] == "root-identity":
        root_fd = open_root(argv[2])
        try:
            info = os.fstat(root_fd)
            sys.stdout.buffer.write(canonical_json({
                "schemaVersion": 1,
                "device": info.st_dev,
                "inode": info.st_ino,
            }))
        finally:
            os.close(root_fd)
        return 0
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
    if len(argv) == 4 and argv[1] == "promote-next":
        outcome = promote_next(argv[2], argv[3], sys.stdin.buffer.read())
        sys.stdout.buffer.write(canonical_json(outcome))
        return 0
    if len(argv) == 4 and argv[1] == "rollback-local":
        print(rollback_local(argv[2], argv[3], sys.stdin.buffer.read()))
        return 0
    if len(argv) == 4 and argv[1] == "inventory-live":
        sys.stdout.buffer.write(canonical_json(inventory_live(argv[2], argv[3], sys.stdin.buffer.read())))
        return 0
    if len(argv) == 4 and argv[1] == "publish-manifest-local":
        print(publish_manifest_local(argv[2], argv[3], sys.stdin.buffer.read()))
        return 0
    fail("Usage: secure_web_release.py <root-identity|materialize-local|materialize-stage|capture-reviewed-inputs|promote-next|rollback-local|inventory-live|publish-manifest-local> <owned-root> [release-id]")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

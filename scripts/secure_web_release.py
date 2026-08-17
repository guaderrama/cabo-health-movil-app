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
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
import platform
import re
import stat
import sys
import time
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
CAPSULE_SIZE = 161867
CAPSULE_SHA256 = "b5f4f2a39a46df12f12c017e6ef31fbff0aeb71045b3af5a7456be852fea9334"
APACHE_SECURITY_SHA256 = "0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da"
DRAFT_LEGAL_SHA256 = {
    "privacy": "48a9d5974d234434c200ff272c6dfeecc2d6b05baeae30dc25a37df06fb46b91",
    "report-content": "35d304f3ee82364616ab9b0f96013319857d4acc347b6764579a7604392bffb5",
    "support": "4580d6de3db45af3830428497715d903cad557c143a5312d95b6c73f7f575a1a",
    "terms": "0dfc0b40144db111e78e2a2e6a1de1c0e978c9a31bb9dceb819599d7b5e70d44",
}
# Deliberately unset until owner/legal sign-off and independent byte review.
# The mutation boundary below treats any unset or draft-equal value as fatal.
FINAL_LEGAL_SHA256: dict[str, str | None] = {
    "privacy": None,
    "report-content": None,
    "support": None,
    "terms": None,
}
MINIAPP_FILE_PINS = (
    ("apps/.htaccess", 568, "0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da"),
    ("apps/clinic-guide/app.js", 1436, "1565868ae2bc74769e5d036bc697a4e1d81f91740345ba67edf0628af5813243"),
    ("apps/clinic-guide/index.html", 20481, "a0246074ba7734df7e28354a6ecfff39ac08d7ddd1da4e295f66f11ec77a18ee"),
    ("apps/healthy-recipes/app.js", 4049, "70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090"),
    ("apps/healthy-recipes/index.html", 55957, "5f22027afcd1600fa36cd77974d48b6d2ddc4fe26e27fcf57f206a8520413829"),
    ("apps/shared/logo.png", 13598, "e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117"),
    ("apps/shared/motion.js", 8996, "9ac97593f7339f6b7f1b9f4da6dafed4084185440022604b75754377291e56b7"),
    ("apps/shared/shell.js", 3769, "d53f7caab7fbcaee1739b5aada9773b443289022f8e9c3b11578b84ab98a3103"),
    ("apps/shared/styles.css", 9887, "db0f0c531c453455d63aadba1dd4a99008337e555a746a7cbfee19e5a3d8f3ef"),
)
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
TRANSITION_KEYS = (
    "schemaVersion",
    "index",
    "target",
    "slot",
    "original",
    "oldInventorySha256",
    "sourceIdentity",
    "destinationIdentity",
    "transition",
    "attempt",
)
TRANSITION_NAME = re.compile(r"^(0[0-8])-(prepared|promoted|rolled-back)-([0-9]{3})\.json$")
CANDIDATE_NAME = re.compile(
    r"^(0[0-8])-(prepared|promoted|rolled-back)-([0-9]{3})(?:-[a-f0-9]{16})?\.candidate$"
)
IDENTITY_KEYS = ("device", "inode", "type")
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


def test_fault_requested(root_path: str, *names: str) -> str | None:
    for name in names:
        if test_fault_enabled(root_path, name):
            return name
    return None


def raise_injected_exception(root_path: str, prefix: str) -> None:
    requested = test_fault_requested(
        root_path,
        f"{prefix}-oserror",
        f"{prefix}-unicode",
        f"{prefix}-runtime",
        f"{prefix}-oserror-reversal-fsync-oserror",
    )
    if requested is None:
        return
    if requested.endswith("-unicode"):
        raise UnicodeError(f"INJECTED_{prefix.upper().replace('-', '_')}_UNICODE")
    if requested.endswith("-runtime"):
        raise RuntimeError(f"INJECTED_{prefix.upper().replace('-', '_')}_RUNTIME")
    raise OSError(errno.EIO, f"INJECTED_{prefix.upper().replace('-', '_')}_OSERROR")


def test_crash(root_path: str, name: str) -> None:
    if test_fault_enabled(root_path, name):
        os._exit(86)


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


def fsync_rename_directories(src_fd: int, dst_fd: int) -> None:
    os.fsync(src_fd)
    if dst_fd != src_fd:
        os.fsync(dst_fd)


def describe_exception(error: BaseException) -> str:
    return f"{type(error).__name__}:{error}"


def reverse_after_exception(
    primary: BaseException,
    src_fd: int,
    src: str,
    dst_fd: int,
    dst: str,
    operation: str,
    root_path: str,
    reversal_fault: str | None = None,
) -> None:
    try:
        rename_with_flag(dst_fd, dst, src_fd, src, operation)
        fsync_rename_directories(dst_fd, src_fd)
        if reversal_fault and test_fault_enabled(root_path, reversal_fault):
            raise OSError(errno.EIO, "INJECTED_REVERSAL_FSYNC_OSERROR")
    except BaseException as reversal:
        raise ReleaseError(
            f"POST_NAMESPACE_FAILURE PRIMARY={describe_exception(primary)} "
            f"REVERSAL={describe_exception(reversal)}"
        ) from reversal
    raise ReleaseError(f"POST_NAMESPACE_FAILURE PRIMARY={describe_exception(primary)} REVERSAL=ok") from primary


def reversible_rename(
    root_path: str,
    src_fd: int,
    src: str,
    dst_fd: int,
    dst: str,
    operation: str,
    validator: Any,
    fault_prefix: str,
    crash_prefix: str,
    tamper: Any | None = None,
) -> None:
    rename_with_flag(src_fd, src, dst_fd, dst, operation)
    try:
        test_crash(root_path, f"{crash_prefix}-crash-after-namespace")
        if test_fault_enabled(root_path, f"{fault_prefix}-fsync-oserror"):
            raise OSError(errno.EIO, "INJECTED_POST_NAMESPACE_FSYNC_OSERROR")
        fsync_rename_directories(src_fd, dst_fd)
        test_crash(root_path, f"{crash_prefix}-crash-after-directory-fsync")
        raise_injected_exception(root_path, fault_prefix)
        if tamper is not None and test_fault_enabled(root_path, f"{fault_prefix}-tamper"):
            tamper()
        validator()
    except BaseException as primary:
        reverse_after_exception(
            primary,
            src_fd,
            src,
            dst_fd,
            dst,
            operation,
            root_path,
            f"{fault_prefix}-oserror-reversal-fsync-oserror",
        )


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


def object_identity(info: os.stat_result) -> dict[str, Any]:
    if stat.S_ISREG(info.st_mode):
        kind = "file"
    elif stat.S_ISDIR(info.st_mode):
        kind = "directory"
    else:
        fail("ROLLBACK_TRANSITION_IDENTITY_INVALID")
    return {"device": info.st_dev, "inode": info.st_ino, "type": kind}


def inventory_leaf(
    parent_fd: int,
    name: str,
    expected_paths: tuple[str, ...],
    target: str,
    *,
    with_identity: bool = False,
) -> Any:
    try:
        fd = os.open(name, OPEN_FILE_READ, dir_fd=parent_fd)
    except FileNotFoundError:
        return (None, None) if with_identity else None
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
    inventory_hash = hashlib.sha256(canonical_json(entries)).hexdigest()
    if with_identity:
        return inventory_hash, object_identity(info)
    return inventory_hash


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


def transition_record(
    index: int,
    original: str,
    old_hash: str | None,
    source_identity: dict[str, Any],
    destination_identity: dict[str, Any] | None,
    transition: str,
    attempt: int,
) -> dict[str, Any]:
    target, slot, _payload_paths = UNITS[index]
    return {
        "schemaVersion": 1,
        "index": index,
        "target": f"public_html/{target}",
        "slot": slot,
        "original": original,
        "oldInventorySha256": old_hash,
        "sourceIdentity": source_identity,
        "destinationIdentity": destination_identity,
        "transition": transition,
        "attempt": attempt,
    }


def transition_name(index: int, transition: str, attempt: int) -> str:
    if transition not in ("prepared", "promoted", "rolled-back") or not 0 <= attempt <= 999:
        fail("ROLLBACK_TRANSITION_INVALID")
    return f"{index:02d}-{transition}-{attempt:03d}.json"


def open_transitions(rollback_fd: int, *, create: bool = False) -> int:
    if create:
        try:
            os.mkdir("transitions", 0o700, dir_fd=rollback_fd)
            os.fsync(rollback_fd)
        except FileExistsError:
            pass
    return open_directory("transitions", rollback_fd, "rollback/transitions", mode=0o700)


def validate_candidate_residue(parent_fd: int, name: str) -> None:
    if CANDIDATE_NAME.fullmatch(name) is None:
        fail("ROLLBACK_TRANSITION_UNKNOWN_PATH")
    try:
        info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as error:
        raise ReleaseError("ROLLBACK_TRANSITION_CANDIDATE_INVALID") from error
    # Candidates are never authority and are never opened or published during recovery.
    # A crash can occur after exclusive creation but before fchmod, so an inherited
    # restrictive umask may leave any safe subset of 0600, including 0000.
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) not in (0o000, 0o200, 0o400, 0o600)
    ):
        fail("ROLLBACK_TRANSITION_CANDIDATE_INVALID")


def validate_candidate_directory(transitions_fd: int) -> None:
    candidates_fd = open_directory("candidates", transitions_fd, "rollback/transitions/candidates", mode=0o700)
    try:
        for name in sorted(os.listdir(candidates_fd), key=lambda value: value.encode("ascii")):
            validate_candidate_residue(candidates_fd, name)
    except UnicodeEncodeError as error:
        raise ReleaseError("ROLLBACK_TRANSITION_UNKNOWN_PATH") from error
    finally:
        os.close(candidates_fd)


def validate_operation_lock(fd: int) -> None:
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_nlink != 1
        or info.st_mode & 0o777 != 0o600
    ):
        fail("PROMOTION_OPERATION_LOCK_INVALID")


def open_operation_lock(transitions_fd: int, root_path: str) -> int:
    try:
        fd = os.open(
            "operation.lock",
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=transitions_fd,
        )
        os.fchmod(fd, 0o600)
        os.fsync(fd)
        os.fsync(transitions_fd)
    except FileExistsError:
        try:
            fd = os.open("operation.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=transitions_fd)
        except OSError as error:
            raise ReleaseError("PROMOTION_OPERATION_LOCK_INVALID") from error
    validate_operation_lock(fd)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(fd)
        raise ReleaseError("PROMOTION_OPERATION_BUSY") from error
    if test_fault_enabled(root_path, "operation-lock-hold"):
        time.sleep(2)
    return fd


def read_transition_file(transitions_fd: int, name: str) -> bytes:
    try:
        fd = os.open(name, OPEN_FILE_READ, dir_fd=transitions_fd)
    except OSError as error:
        raise ReleaseError("ROLLBACK_TRANSITION_INVALID") from error
    try:
        before = os.fstat(fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or before.st_mode & 0o777 != 0o600
        ):
            fail("ROLLBACK_TRANSITION_INVALID")
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
            fail("ROLLBACK_TRANSITION_CHANGED_DURING_READ")
        return raw
    finally:
        os.close(fd)


def validate_identity(value: Any, expected_type: str) -> None:
    exact_keys(value, IDENTITY_KEYS, "ROLLBACK_TRANSITION_IDENTITY")
    if (
        not isinstance(value["device"], int)
        or isinstance(value["device"], bool)
        or value["device"] < 0
        or not isinstance(value["inode"], int)
        or isinstance(value["inode"], bool)
        or value["inode"] <= 0
        or value["type"] != expected_type
    ):
        fail("ROLLBACK_TRANSITION_IDENTITY_INVALID")


def validate_transition_semantics(value: dict[str, Any]) -> None:
    index = value.get("index")
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(UNITS):
        fail("ROLLBACK_TRANSITION_SEMANTICS_INVALID")
    target, _slot, payload_paths = UNITS[index]
    expected_type = "file" if payload_paths == (target,) else "directory"
    try:
        validate_identity(value.get("sourceIdentity"), expected_type)
        original = value.get("original")
        old_hash = value.get("oldInventorySha256")
        destination_identity = value.get("destinationIdentity")
        if original == "present":
            if not isinstance(old_hash, str) or SHA256.fullmatch(old_hash) is None:
                fail("ROLLBACK_TRANSITION_SEMANTICS_INVALID")
            validate_identity(destination_identity, expected_type)
            if value["sourceIdentity"] == destination_identity:
                fail("ROLLBACK_TRANSITION_SEMANTICS_INVALID")
        elif original == "absent":
            if old_hash is not None or destination_identity is not None:
                fail("ROLLBACK_TRANSITION_SEMANTICS_INVALID")
        else:
            fail("ROLLBACK_TRANSITION_SEMANTICS_INVALID")
    except (KeyError, TypeError) as error:
        raise ReleaseError("ROLLBACK_TRANSITION_SEMANTICS_INVALID") from error


def parse_transition_files(transitions_fd: int) -> tuple[dict[int, dict[str, Any]], dict[tuple[int, str], list[bytes]]]:
    complete: dict[int, dict[str, Any]] = {}
    attempts: dict[tuple[int, str], list[bytes]] = {}
    try:
        names = sorted(os.listdir(transitions_fd), key=lambda value: value.encode("ascii"))
    except UnicodeEncodeError as error:
        raise ReleaseError("ROLLBACK_TRANSITION_UNKNOWN_PATH") from error
    for name in names:
        if name == "operation.lock":
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=transitions_fd)
            try:
                validate_operation_lock(fd)
            finally:
                os.close(fd)
            continue
        if name == "candidates":
            validate_candidate_directory(transitions_fd)
            continue
        if CANDIDATE_NAME.fullmatch(name) is not None:
            validate_candidate_residue(transitions_fd, name)
            continue
        match = TRANSITION_NAME.fullmatch(name)
        if match is None:
            fail("ROLLBACK_TRANSITION_UNKNOWN_PATH")
        index = int(match.group(1))
        transition = match.group(2)
        attempt = int(match.group(3))
        key = (index, transition)
        prior = attempts.setdefault(key, [])
        if attempt != 0 or prior:
            fail("ROLLBACK_TRANSITION_ATTEMPT_ORDER_INVALID")
        raw = read_transition_file(transitions_fd, name)
        prior.append(raw)
        try:
            value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ReleaseError("ROLLBACK_TRANSITION_INVALID") from error
        if canonical_json(value) != raw:
            fail("ROLLBACK_TRANSITION_INVALID")
        exact_keys(value, TRANSITION_KEYS, "ROLLBACK_TRANSITION")
        validate_transition_semantics(value)
        expected = transition_record(
            index,
            value["original"],
            value["oldInventorySha256"],
            value["sourceIdentity"],
            value["destinationIdentity"],
            transition,
            attempt,
        )
        if value != expected:
            fail("ROLLBACK_TRANSITION_INVALID")
        if transition != "prepared" and index not in complete:
            fail("ROLLBACK_TRANSITION_WITHOUT_INTENT")
        existing = complete.get(index)
        if existing is not None:
            for authority_key in (
                "original",
                "oldInventorySha256",
                "sourceIdentity",
                "destinationIdentity",
            ):
                if value[authority_key] != existing[authority_key]:
                    fail("ROLLBACK_TRANSITION_AUTHORITY_CHANGED")
            allowed = {
                "prepared": {"promoted"},
                "promoted": {"rolled-back"},
                "rolled-back": set(),
            }
            if transition not in allowed[existing["transition"]]:
                fail("ROLLBACK_TRANSITION_STATE_INVALID")
        complete[index] = value
    return complete, attempts


def write_transition(
    transitions_fd: int,
    index: int,
    original: str,
    old_hash: str | None,
    source_identity: dict[str, Any],
    destination_identity: dict[str, Any] | None,
    transition: str,
    root_path: str,
    crash_prefix: str | None = None,
) -> dict[str, Any]:
    _complete, attempts = parse_transition_files(transitions_fd)
    if attempts.get((index, transition)):
        fail("ROLLBACK_TRANSITION_COLLISION")
    attempt = 0
    record = transition_record(
        index,
        original,
        old_hash,
        source_identity,
        destination_identity,
        transition,
        attempt,
    )
    validate_transition_semantics(record)
    raw = canonical_json(record)
    name = transition_name(index, transition, attempt)
    candidate_name = f"{index:02d}-{transition}-{attempt:03d}-{os.urandom(8).hex()}.candidate"
    try:
        fd = os.open(
            candidate_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=transitions_fd,
        )
    except OSError as error:
        raise ReleaseError("ROLLBACK_TRANSITION_COLLISION") from error
    try:
        if crash_prefix:
            test_crash(root_path, f"{crash_prefix}-crash-after-candidate-create")
        os.fchmod(fd, 0o600)
        if crash_prefix:
            requested = os.environ.get("CABOHEALTH_TEST_FAULT", "")
            byte_prefix = f"{crash_prefix}-crash-after-byte-"
            if requested.startswith(byte_prefix) and test_fault_enabled(root_path, requested):
                offset_text = requested.removeprefix(byte_prefix)
                if not offset_text.isascii() or not offset_text.isdigit():
                    fail("TEST_FRAME_CUT_INVALID")
                offset = int(offset_text)
                if not 0 <= offset <= len(raw):
                    fail("TEST_FRAME_CUT_INVALID")
                write_all(fd, raw[:offset])
                os._exit(86)
        if crash_prefix and test_fault_enabled(root_path, f"{crash_prefix.removesuffix('-frame')}-crash-transition-partial"):
            write_all(fd, raw[: max(1, len(raw) // 2)])
            os._exit(86)
        write_all(fd, raw)
        if crash_prefix:
            test_crash(root_path, f"{crash_prefix}-crash-after-candidate-write")
        os.fsync(fd)
        if crash_prefix:
            test_crash(root_path, f"{crash_prefix}-crash-after-candidate-fsync")
    finally:
        os.close(fd)
    rename_with_flag(transitions_fd, candidate_name, transitions_fd, name, "noreplace")
    if crash_prefix:
        test_crash(root_path, f"{crash_prefix}-crash-after-publish")
    os.fsync(transitions_fd)
    if crash_prefix:
        test_crash(root_path, f"{crash_prefix}-crash-after-directory-fsync")
        test_crash(root_path, f"{crash_prefix.removesuffix('-frame')}-crash-after-transition-fsync")
    return record


def validate_transition_state(latest: dict[int, dict[str, Any]]) -> tuple[int, int]:
    if sorted(latest) != list(range(len(UNITS))):
        fail("ROLLBACK_TRANSITION_SET_INVALID")
    states = [latest[index]["transition"] for index in range(len(UNITS))]
    promoted_end = 0
    while promoted_end < len(states) and states[promoted_end] == "promoted":
        promoted_end += 1
    rolled_back_end = promoted_end
    while rolled_back_end < len(states) and states[rolled_back_end] == "rolled-back":
        rolled_back_end += 1
    if any(state != "prepared" for state in states[rolled_back_end:]):
        fail("ROLLBACK_GLOBAL_ORDER_INVALID")
    if rolled_back_end > promoted_end:
        for index in range(promoted_end, rolled_back_end):
            attempts_transition = latest[index]["transition"]
            if attempts_transition != "rolled-back":
                fail("ROLLBACK_GLOBAL_ORDER_INVALID")
    return promoted_end, rolled_back_end


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


def captured_file(path: str, contents: bytes) -> dict[str, Any]:
    return {
        "path": path,
        "size": len(contents),
        "sha256": hashlib.sha256(contents).hexdigest(),
        "bytesBase64": base64.b64encode(contents).decode("ascii"),
    }


def capture_tree_files(
    root_fd: int,
    root_name: str,
    predicate: Any,
) -> list[dict[str, Any]]:
    info = stat_if_present(root_fd, root_name)
    if info is None:
        return []
    directory_fd = open_directory(root_name, root_fd, root_name)
    files: list[dict[str, Any]] = []

    def walk(directory: int, prefix: str) -> None:
        before_directory = os.fstat(directory)
        for name in sorted(os.listdir(directory), key=lambda item: item.encode("utf-8")):
            path = f"{prefix}/{name}"
            try:
                entry_fd = os.open(name, OPEN_FILE_READ, dir_fd=directory)
            except OSError as error:
                raise ReleaseError(f"ASSEMBLY_SNAPSHOT_ENTRY_INVALID: {path}") from error
            try:
                before = os.fstat(entry_fd)
                if before.st_uid != os.geteuid():
                    fail(f"ASSEMBLY_SNAPSHOT_ENTRY_INVALID: {path}")
                if stat.S_ISDIR(before.st_mode):
                    if before.st_mode & 0o022:
                        fail(f"ASSEMBLY_SNAPSHOT_ENTRY_INVALID: {path}")
                    walk(entry_fd, path)
                elif stat.S_ISREG(before.st_mode):
                    if predicate(path):
                        if before.st_nlink != 1:
                            fail(f"ASSEMBLY_SNAPSHOT_ENTRY_INVALID: {path}")
                        contents = read_all(entry_fd)
                        after = os.fstat(entry_fd)
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
                            fail(f"ASSEMBLY_SNAPSHOT_ENTRY_CHANGED: {path}")
                        files.append(captured_file(path, contents))
                else:
                    fail(f"ASSEMBLY_SNAPSHOT_ENTRY_INVALID: {path}")
            finally:
                os.close(entry_fd)
        after_directory = os.fstat(directory)
        if (before_directory.st_dev, before_directory.st_ino) != (
            after_directory.st_dev,
            after_directory.st_ino,
        ):
            fail(f"ASSEMBLY_SNAPSHOT_DIRECTORY_CHANGED: {prefix}")

    try:
        walk(directory_fd, root_name)
    finally:
        os.close(directory_fd)
    return files


def open_absolute_parent(path: str) -> tuple[int, str]:
    parent = os.path.dirname(path)
    leaf = os.path.basename(path)
    if not leaf or not os.path.isabs(parent):
        fail("UNSAFE_ROOT_DIRECTORY")
    return open_root(parent), leaf


def read_capsule_file(root_fd: int) -> tuple[bytes, os.stat_result]:
    miniapps_fd = open_directory("miniapps", root_fd, "miniapps")
    try:
        try:
            capsule_fd = os.open("dist", OPEN_FILE_READ, dir_fd=miniapps_fd)
        except OSError as error:
            raise ReleaseError("TASK6B_CAPSULE_ATTESTATION_FAILED") from error
        try:
            before = os.fstat(capsule_fd)
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_uid != os.geteuid()
                or before.st_nlink != 2
                or before.st_mode & 0o777 != 0o400
            ):
                fail("TASK6B_CAPSULE_ATTESTATION_FAILED")
            contents = read_all(capsule_fd)
            after = os.fstat(capsule_fd)
            identity = lambda info: (
                info.st_dev,
                info.st_ino,
                info.st_size,
                info.st_mode,
                info.st_uid,
                info.st_nlink,
            )
            if identity(before) != identity(after):
                fail("TASK6B_CAPSULE_CHANGED_DURING_CAPTURE")
            if len(contents) != CAPSULE_SIZE or hashlib.sha256(contents).hexdigest() != CAPSULE_SHA256:
                fail("TASK6B_CAPSULE_ATTESTATION_FAILED")
            return contents, before
        finally:
            os.close(capsule_fd)
    finally:
        os.close(miniapps_fd)


def capture_assembly_snapshot(root_path: str) -> bytes:
    root_fd = open_root(root_path)
    exchanged = False
    parent_fd: int | None = None
    root_leaf = ""
    alternate_leaf = ""
    try:
        if test_fault_enabled(root_path, "assembly-transient-root-exchange"):
            parent_fd, root_leaf = open_absolute_parent(root_path)
            alternate_leaf = f"{root_leaf}.alternate"
            rename_with_flag(parent_fd, root_leaf, parent_fd, alternate_leaf, "exchange")
            fsync_rename_directories(parent_fd, parent_fd)
            exchanged = True
        compliance_files: list[dict[str, Any]] = []
        for directory in ("app", "components", "constants", "context", "hooks", "features"):
            compliance_files.extend(capture_tree_files(root_fd, directory, lambda _path: True))
        compliance_files.extend(capture_tree_files(root_fd, "release", lambda path: path.endswith(".json")))
        compliance_files.extend(capture_tree_files(root_fd, "miniapps", lambda path: path.endswith(".json")))
        reviewed_inputs = [captured_file(path, read_fixed_file(root_fd, path)) for path in INPUT_PATHS]
        for entry in reviewed_inputs:
            if entry["path"].endswith("apple-app-site-association") or "/app/" in entry["path"]:
                compliance_files.append(entry)
        compliance_by_path = {entry["path"]: entry for entry in compliance_files}
        compliance_files = [compliance_by_path[path] for path in sorted(compliance_by_path, key=lambda item: item.encode("utf-8"))]
        capsule_contents, capsule_info = read_capsule_file(root_fd)
        root_info = os.fstat(root_fd)
        snapshot = {
            "schemaVersion": 1,
            "artifactKind": "cabohealth-bound-assembly-snapshot-v1",
            "rootIdentity": {"device": root_info.st_dev, "inode": root_info.st_ino},
            "complianceFiles": compliance_files,
            "reviewedInputs": reviewed_inputs,
            "capsule": {
                **captured_file("miniapps/dist", capsule_contents),
                "mode": f"{capsule_info.st_mode & 0o777:04o}",
                "nlink": capsule_info.st_nlink,
            },
        }
        snapshot["snapshotSha256"] = hashlib.sha256(canonical_json(snapshot)).hexdigest()
        return canonical_json(snapshot)
    finally:
        if exchanged and parent_fd is not None:
            rename_with_flag(parent_fd, root_leaf, parent_fd, alternate_leaf, "exchange")
            fsync_rename_directories(parent_fd, parent_fd)
        if parent_fd is not None:
            os.close(parent_fd)
        os.close(root_fd)


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


def materialize_local_bound(
    root_fd: int,
    raw: bytes,
    transport: dict[str, Any],
    buffers: dict[str, bytes],
) -> str:
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
            expected_children = {
                "apps": (".htaccess", "clinic-guide", "healthy-recipes", "shared"),
                "app": ("privacy", "report-content", "support", "terms"),
                ".well-known": ("apple-app-site-association",),
            }
            for parent, children in expected_children.items():
                parent_fd = open_directory(parent, public_fd, f"public_html/{parent}", mode=0o755)
                try:
                    found = tuple(sorted(os.listdir(parent_fd), key=lambda item: item.encode("ascii")))
                    if found != children:
                        fail(f"SERVER_INVENTORY_PARENT_SET_INVALID: {parent}")
                finally:
                    os.close(parent_fd)
            file_count = 0
            for index in range(len(UNITS)):
                target, _slot, payload_paths = UNITS[index]
                parent_fd, leaf = open_parent_for_target(public_fd, target)
                try:
                    actual = inventory_leaf(parent_fd, leaf, payload_paths, target)
                finally:
                    os.close(parent_fd)
                expected = expected_unit_hash(payload_paths, buffers)
                if actual != expected:
                    fail("SERVER_INVENTORY_INVALID")
                file_count += len(payload_paths)
        finally:
            os.close(public_fd)
    finally:
        os.close(root_fd)
    return {
        "schemaVersion": 1,
        "artifactKind": "cabohealth-server-inventory-v1",
        "status": "verified",
        "releaseId": transport["releaseId"],
        "rootCount": 3,
        "fileCount": file_count,
        "paths": list(PAYLOAD_PATHS),
        "inventorySha256": transport["inventorySha256"],
    }


def live_preflight(stage_public_fd: int, live_public_fd: int) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for target, _slot, payload_paths in UNITS:
        stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
        try:
            source_hash, source_identity = inventory_leaf(
                stage_parent_fd, stage_leaf, payload_paths, target, with_identity=True
            )
        finally:
            os.close(stage_parent_fd)
        if source_hash is None or source_identity is None:
            fail(f"PROMOTION_STAGE_SOURCE_MISSING: {target}")
        parent_name, leaf_name = target.split("/", 1)
        parent_fd = open_optional_container(live_public_fd, parent_name)
        if parent_fd is None:
            old_hash = None
            destination_identity = None
        else:
            try:
                old_hash, destination_identity = inventory_leaf(
                    parent_fd, leaf_name, payload_paths, target, with_identity=True
                )
            finally:
                os.close(parent_fd)
        result.append({
            "original": "present" if old_hash is not None else "absent",
            "oldInventorySha256": old_hash,
            "sourceIdentity": source_identity,
            "destinationIdentity": destination_identity,
        })
    return result


def ensure_prepared_transitions(
    transitions_fd: int,
    preflight: list[dict[str, Any]],
    root_path: str,
) -> dict[int, dict[str, Any]]:
    latest, _attempts = parse_transition_files(transitions_fd)
    if any(entry["transition"] != "prepared" for entry in latest.values()) and len(latest) != len(UNITS):
        fail("ROLLBACK_TRANSITION_INITIALIZATION_INVALID")
    if len(latest) < len(UNITS):
        for index, authority in enumerate(preflight):
            existing = latest.get(index)
            if existing is not None:
                for key in (
                    "original",
                    "oldInventorySha256",
                    "sourceIdentity",
                    "destinationIdentity",
                ):
                    if existing[key] != authority[key]:
                        fail("ROLLBACK_TRANSITION_PREFLIGHT_CHANGED")
                continue
            write_transition(
                transitions_fd,
                index,
                authority["original"],
                authority["oldInventorySha256"],
                authority["sourceIdentity"],
                authority["destinationIdentity"],
                "prepared",
                root_path,
                "prepare-frame",
            )
        latest, _attempts = parse_transition_files(transitions_fd)
    validate_transition_state(latest)
    return latest


def unit_inventories(
    stage_public_fd: int,
    live_public_fd: int,
    rollback_fd: int,
    index: int,
) -> tuple[
    int, str, int, str,
    str | None, dict[str, Any] | None,
    str | None, dict[str, Any] | None,
    str | None, dict[str, Any] | None,
]:
    target, slot, payload_paths = UNITS[index]
    stage_parent_fd, stage_leaf = open_parent_for_target(stage_public_fd, target)
    live_parent_fd, live_leaf = open_parent_for_target(live_public_fd, target)
    try:
        stage_hash, stage_identity = inventory_leaf(
            stage_parent_fd, stage_leaf, payload_paths, target, with_identity=True
        )
        live_hash, live_identity = inventory_leaf(
            live_parent_fd, live_leaf, payload_paths, target, with_identity=True
        )
        slot_hash, slot_identity = inventory_leaf(
            rollback_fd, slot, payload_paths, target, with_identity=True
        )
        return (
            stage_parent_fd, stage_leaf, live_parent_fd, live_leaf,
            stage_hash, stage_identity, live_hash, live_identity, slot_hash, slot_identity,
        )
    except BaseException:
        os.close(stage_parent_fd)
        os.close(live_parent_fd)
        raise


def physical_state(
    entry: dict[str, Any],
    new_hash: str,
    stage_hash: str | None,
    stage_identity: dict[str, Any] | None,
    live_hash: str | None,
    live_identity: dict[str, Any] | None,
    slot_hash: str | None,
    slot_identity: dict[str, Any] | None,
) -> str:
    old_hash = entry["oldInventorySha256"]
    source_identity = entry["sourceIdentity"]
    destination_identity = entry["destinationIdentity"]
    if entry["original"] == "present":
        states = (
            (new_hash, source_identity, old_hash, destination_identity, None, None, "prepared"),
            (old_hash, destination_identity, new_hash, source_identity, None, None, "exchanged"),
            (None, None, new_hash, source_identity, old_hash, destination_identity, "promoted"),
            (None, None, old_hash, destination_identity, new_hash, source_identity, "rolled-back"),
        )
    else:
        states = (
            (new_hash, source_identity, None, None, None, None, "prepared"),
            (None, None, new_hash, source_identity, None, None, "promoted"),
            (None, None, None, None, new_hash, source_identity, "rolled-back"),
        )
    actual = (stage_hash, stage_identity, live_hash, live_identity, slot_hash, slot_identity)
    for *expected, label in states:
        if actual == tuple(expected):
            return label
    if entry["original"] == "present":
        if (
            stage_hash == old_hash
            and stage_identity == destination_identity
            and live_identity not in (None, source_identity, destination_identity)
            and slot_identity is None
        ):
            return "promotion-exchange-unvalidated"
        if (
            stage_identity is None
            and live_identity not in (None, source_identity, destination_identity)
            and slot_identity == source_identity
        ):
            return "rollback-exchange-unvalidated"
    elif (
        stage_identity is None
        and live_identity not in (None, source_identity)
        and slot_identity is None
    ):
        return "promotion-noreplace-unvalidated"
    elif (
        stage_identity is None
        and live_identity is None
        and slot_identity not in (None, source_identity)
    ):
        return "rollback-noreplace-unvalidated"
    fail(f"PROMOTION_PHYSICAL_STATE_INVALID: {entry['target']}")


def validate_all_physical_states(
    latest: dict[int, dict[str, Any]],
    buffers: dict[str, bytes],
    stage_public_fd: int,
    live_public_fd: int,
    rollback_fd: int,
    *,
    allow_prepared_candidate: bool,
    allow_rolled_back_candidate: bool = False,
) -> dict[int, str]:
    promoted_end, rolled_back_end = validate_transition_state(latest)
    candidate = promoted_end if rolled_back_end == promoted_end and promoted_end < len(UNITS) else None
    states: dict[int, str] = {}
    for index, entry in latest.items():
        target, _slot, payload_paths = UNITS[index]
        (
            stage_parent_fd, _stage_leaf, live_parent_fd, _live_leaf,
            stage_hash, stage_identity, live_hash, live_identity, slot_hash, slot_identity,
        ) = unit_inventories(stage_public_fd, live_public_fd, rollback_fd, index)
        try:
            actual = physical_state(
                entry,
                expected_unit_hash(payload_paths, buffers),
                stage_hash,
                stage_identity,
                live_hash,
                live_identity,
                slot_hash,
                slot_identity,
            )
        finally:
            os.close(stage_parent_fd)
            os.close(live_parent_fd)
        expected = entry["transition"]
        if expected == "prepared" and allow_prepared_candidate and index == candidate:
            if actual not in (
                "prepared",
                "exchanged",
                "promoted",
                "promotion-exchange-unvalidated",
                "promotion-noreplace-unvalidated",
            ):
                fail(f"PROMOTION_PHYSICAL_STATE_INVALID: {target}")
        elif (
            expected == "promoted"
            and allow_rolled_back_candidate
            and index == promoted_end - 1
            and actual in (
                "rolled-back",
                "rollback-exchange-unvalidated",
                "rollback-noreplace-unvalidated",
            )
        ):
            pass
        elif actual != expected:
            fail(f"PROMOTION_RECORD_PHYSICAL_MISMATCH: {target}")
        states[index] = actual
    return states


def finish_promoted_physical_state(
    root_path: str,
    entry: dict[str, Any],
    buffers: dict[str, bytes],
    stage_public_fd: int,
    live_public_fd: int,
    rollback_fd: int,
    index: int,
    current: str,
) -> None:
    target, slot, payload_paths = UNITS[index]
    new_hash = expected_unit_hash(payload_paths, buffers)
    old_hash = entry["oldInventorySha256"]
    (
        stage_parent_fd, stage_leaf, live_parent_fd, live_leaf,
        _stage_hash, _stage_identity, _live_hash, _live_identity, _slot_hash, _slot_identity,
    ) = unit_inventories(stage_public_fd, live_public_fd, rollback_fd, index)
    try:
        if current == "promotion-exchange-unvalidated":
            try:
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                fsync_rename_directories(stage_parent_fd, live_parent_fd)
                _restored_hash, restored_identity = inventory_leaf(
                    live_parent_fd, live_leaf, payload_paths, target, with_identity=True
                )
                if restored_identity != entry["destinationIdentity"]:
                    fail(f"OPERAND_SUBSTITUTION_REVERSAL_INVALID: {target}")
            except BaseException as recovery_error:
                raise ReleaseError(
                    f"OPERAND_SUBSTITUTION_RECOVERY_FAILED: {target}: {describe_exception(recovery_error)}"
                ) from recovery_error
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
        if current == "promotion-noreplace-unvalidated":
            try:
                rename_with_flag(live_parent_fd, live_leaf, stage_parent_fd, stage_leaf, "noreplace")
                fsync_rename_directories(live_parent_fd, stage_parent_fd)
                if inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) is not None:
                    fail(f"OPERAND_SUBSTITUTION_REVERSAL_INVALID: {target}")
            except BaseException as recovery_error:
                raise ReleaseError(
                    f"OPERAND_SUBSTITUTION_RECOVERY_FAILED: {target}: {describe_exception(recovery_error)}"
                ) from recovery_error
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
        if entry["original"] == "present" and current == "prepared":
            if test_fault_enabled(root_path, "promote-exchange-substitute-source-crash"):
                rename_with_flag(
                    stage_parent_fd, stage_leaf, stage_parent_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                os._exit(86)

            def validate_exchange() -> None:
                if test_fault_enabled(root_path, "promotion-post-exchange-inventory-error"):
                    fail(f"PROMOTION_POST_EXCHANGE_INVENTORY_FAILED: {target}")
                after_live = inventory_leaf(live_parent_fd, live_leaf, payload_paths, target)
                after_stage = inventory_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
                if (
                    after_live != new_hash
                    or after_stage != old_hash
                    or test_fault_enabled(root_path, "promotion-post-exchange-mismatch")
                ):
                    fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")

            reversible_rename(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                "exchange",
                validate_exchange,
                "promotion-post-exchange",
                "promote",
            )
            current = "exchanged"
        if entry["original"] == "present" and current == "exchanged":
            rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
            fsync_rename_directories(stage_parent_fd, rollback_fd)
            if inventory_leaf(rollback_fd, slot, payload_paths, target) != old_hash:
                fail(f"PROMOTION_ROLLBACK_SLOT_MISMATCH: {target}")
            current = "promoted"
        if entry["original"] == "absent" and current == "prepared":
            if test_fault_enabled(root_path, "promote-noreplace-substitute-source-crash"):
                rename_with_flag(
                    stage_parent_fd, stage_leaf, stage_parent_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "noreplace")
                os._exit(86)

            def validate_noreplace() -> None:
                if test_fault_enabled(root_path, "promotion-post-noreplace-inventory-error"):
                    fail(f"PROMOTION_POST_NOREPLACE_INVENTORY_FAILED: {target}")
                if inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) != new_hash:
                    fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")

            reversible_rename(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                "noreplace",
                validate_noreplace,
                "promotion-post-noreplace",
                "promote",
            )
            current = "promoted"
        if current != "promoted":
            fail(f"PROMOTION_STATE_INVALID: {target}")
    finally:
        os.close(stage_parent_fd)
        os.close(live_parent_fd)


def open_release_state(root_path: str, release_argument: str, raw: bytes, *, create_rollback: bool) -> tuple[Any, ...]:
    transport, buffers = parse_transport(raw)
    validate_release_argument(release_argument, transport)
    root_fd = open_root(root_path)
    stage_fd = open_directory("stage", root_fd, "stage")
    release_fd = open_directory(release_argument, stage_fd, f"stage/{release_argument}", mode=0o700)
    stage_public_fd = open_directory("public_html", release_fd, "stage/public_html", mode=0o700)
    os.close(release_fd)
    os.close(stage_fd)
    live_public_fd = open_directory("public_html", root_fd, "public_html", mode=0o755)
    if (
        os.fstat(stage_public_fd).st_dev != os.fstat(live_public_fd).st_dev
        or (create_rollback and test_fault_enabled(root_path, "promotion-cross-device"))
    ):
        fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
    existing_release = False
    rollback_info = stat_if_present(root_fd, "rollback")
    if rollback_info is not None:
        existing_root_fd = open_directory("rollback", root_fd, "rollback", mode=0o700)
        try:
            existing_release = stat_if_present(existing_root_fd, release_argument) is not None
        finally:
            os.close(existing_root_fd)
    if not existing_release:
        for name in ("apps", "app", ".well-known"):
            container_fd = ensure_directory(name, live_public_fd, f"public_html/{name}", 0o755)
            os.close(container_fd)
    rollback_root_fd = ensure_directory("rollback", root_fd, "rollback") if create_rollback else open_directory(
        "rollback", root_fd, "rollback", mode=0o700
    )
    if (
        os.fstat(rollback_root_fd).st_dev != os.fstat(live_public_fd).st_dev
        or os.fstat(stage_public_fd).st_dev != os.fstat(live_public_fd).st_dev
    ):
        fail("PROMOTION_CROSS_DEVICE_FORBIDDEN")
    if not existing_release:
        if not create_rollback:
            fail("ROLLBACK_RELEASE_MISSING")
        try:
            os.mkdir(release_argument, 0o700, dir_fd=rollback_root_fd)
            os.fsync(rollback_root_fd)
        except FileExistsError as error:
            raise ReleaseError("ROLLBACK_RELEASE_COLLISION") from error
    rollback_fd = open_directory(release_argument, rollback_root_fd, f"rollback/{release_argument}", mode=0o700)
    rollback_names = set(os.listdir(rollback_fd))
    allowed_rollback_names = {"transitions", *(slot for _target, slot, _paths in UNITS)}
    if "cabohealth-" in os.path.basename(root_path) and "-fixture-" in os.path.basename(root_path):
        allowed_rollback_names.add("fault-substitute")
    if not rollback_names.issubset(allowed_rollback_names):
        fail("ROLLBACK_UNKNOWN_PATH")
    transitions_fd = open_transitions(rollback_fd, create=create_rollback)
    operation_lock_fd = open_operation_lock(transitions_fd, root_path)
    latest, _attempts = parse_transition_files(transitions_fd)
    if len(latest) < len(UNITS):
        if any(entry["transition"] != "prepared" for entry in latest.values()):
            fail("ROLLBACK_TRANSITION_INITIALIZATION_INVALID")
        latest = ensure_prepared_transitions(
            transitions_fd,
            live_preflight(stage_public_fd, live_public_fd),
            root_path,
        )
    else:
        validate_transition_state(latest)
    return (
        transport, buffers, root_fd, stage_public_fd, live_public_fd,
        rollback_root_fd, rollback_fd, transitions_fd, operation_lock_fd, latest,
    )


def close_release_state(state: tuple[Any, ...]) -> None:
    for fd in reversed(state[2:9]):
        os.close(fd)


def promote_next(root_path: str, release_argument: str, raw: bytes) -> dict[str, Any]:
    state = open_release_state(root_path, release_argument, raw, create_rollback=True)
    (
        transport, buffers, _root_fd, stage_public_fd, live_public_fd, _rollback_root_fd,
        rollback_fd, transitions_fd, _operation_lock_fd, latest,
    ) = state
    try:
        promoted_end, rolled_back_end = validate_transition_state(latest)
        if rolled_back_end > promoted_end:
            fail("PROMOTION_AFTER_ROLLBACK_FORBIDDEN")
        if promoted_end == len(UNITS):
            fail("PROMOTION_ALREADY_COMPLETE")
        physical = validate_all_physical_states(
            latest,
            buffers,
            stage_public_fd,
            live_public_fd,
            rollback_fd,
            allow_prepared_candidate=True,
        )
        index = promoted_end
        entry = latest[index]
        finish_promoted_physical_state(
            root_path, entry, buffers, stage_public_fd, live_public_fd, rollback_fd, index, physical[index]
        )
        write_transition(
            transitions_fd,
            index,
            entry["original"],
            entry["oldInventorySha256"],
            entry["sourceIdentity"],
            entry["destinationIdentity"],
            "promoted",
            root_path,
            "promote-frame",
        )
        test_crash(root_path, "promote-crash-before-return")
        return {
            "schemaVersion": 1,
            "index": index,
            "target": f"public_html/{UNITS[index][0]}",
            "status": "unit-promoted",
            "complete": index == len(UNITS) - 1,
        }
    finally:
        close_release_state(state)


def tamper_live_leaf_mode(parent_fd: int, leaf: str) -> None:
    fd = os.open(leaf, OPEN_FILE_READ, dir_fd=parent_fd)
    try:
        os.fchmod(fd, 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)


def rollback_promoted_unit(
    root_path: str,
    entry: dict[str, Any],
    buffers: dict[str, bytes],
    stage_public_fd: int,
    live_public_fd: int,
    rollback_fd: int,
    index: int,
    current: str,
) -> None:
    target, slot, payload_paths = UNITS[index]
    new_hash = expected_unit_hash(payload_paths, buffers)
    old_hash = entry["oldInventorySha256"]
    (
        stage_parent_fd, _stage_leaf, live_parent_fd, live_leaf,
        _stage_hash, _stage_identity, _live_hash, _live_identity, _slot_hash, _slot_identity,
    ) = unit_inventories(stage_public_fd, live_public_fd, rollback_fd, index)
    try:
        if current == "rolled-back":
            return
        if current == "rollback-exchange-unvalidated":
            try:
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                fsync_rename_directories(rollback_fd, live_parent_fd)
                _restored_hash, restored_identity = inventory_leaf(
                    live_parent_fd, live_leaf, payload_paths, target, with_identity=True
                )
                if restored_identity != entry["sourceIdentity"]:
                    fail(f"OPERAND_SUBSTITUTION_REVERSAL_INVALID: {target}")
            except BaseException as recovery_error:
                raise ReleaseError(
                    f"OPERAND_SUBSTITUTION_RECOVERY_FAILED: {target}: {describe_exception(recovery_error)}"
                ) from recovery_error
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
        if current == "rollback-noreplace-unvalidated":
            # The reviewed original state is absence. Reintroducing the unknown slot
            # inode into the live namespace would be less safe than retaining that
            # absence, so stop with the unverified inode quarantined in rollback.
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
        if current != "promoted":
            fail(f"ROLLBACK_STATE_INVALID: {target}")
        if entry["original"] == "present":
            if test_fault_enabled(root_path, "rollback-exchange-substitute-source-crash"):
                rename_with_flag(rollback_fd, slot, rollback_fd, "fault-substitute", "exchange")
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                os._exit(86)

            def validate_exchange() -> None:
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

            reversible_rename(
                root_path,
                rollback_fd,
                slot,
                live_parent_fd,
                live_leaf,
                "exchange",
                validate_exchange,
                "rollback-post-exchange",
                "rollback",
                lambda: tamper_live_leaf_mode(live_parent_fd, live_leaf),
            )
        else:
            if test_fault_enabled(root_path, "rollback-noreplace-substitute-source-crash"):
                rename_with_flag(
                    live_parent_fd, live_leaf, rollback_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                os._exit(86)

            def validate_noreplace() -> None:
                if (
                    inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) is not None
                    or inventory_leaf(rollback_fd, slot, payload_paths, target) != new_hash
                ):
                    fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")

            reversible_rename(
                root_path,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                "noreplace",
                validate_noreplace,
                "rollback-post-noreplace",
                "rollback",
            )
    finally:
        os.close(stage_parent_fd)
        os.close(live_parent_fd)


def rollback_next(
    root_path: str,
    release_argument: str,
    expected_index_argument: str,
    raw: bytes,
) -> dict[str, Any]:
    if not expected_index_argument.isascii() or not expected_index_argument.isdigit():
        fail("ROLLBACK_EXPECTED_INDEX_INVALID")
    expected_index = int(expected_index_argument)
    if not 0 <= expected_index < len(UNITS) or str(expected_index) != expected_index_argument:
        fail("ROLLBACK_EXPECTED_INDEX_INVALID")
    state = open_release_state(root_path, release_argument, raw, create_rollback=False)
    (
        _transport, buffers, _root_fd, stage_public_fd, live_public_fd, _rollback_root_fd,
        rollback_fd, transitions_fd, _operation_lock_fd, latest,
    ) = state
    try:
        promoted_end, rolled_back_end = validate_transition_state(latest)
        physical = validate_all_physical_states(
            latest,
            buffers,
            stage_public_fd,
            live_public_fd,
            rollback_fd,
            allow_prepared_candidate=True,
            allow_rolled_back_candidate=True,
        )
        candidate = promoted_end if promoted_end == rolled_back_end and promoted_end < len(UNITS) else None
        if candidate is not None and physical[candidate] in (
            "exchanged",
            "promoted",
            "promotion-exchange-unvalidated",
            "promotion-noreplace-unvalidated",
        ):
            entry = latest[candidate]
            finish_promoted_physical_state(
                root_path,
                entry,
                buffers,
                stage_public_fd,
                live_public_fd,
                rollback_fd,
                candidate,
                physical[candidate],
            )
            write_transition(
                transitions_fd,
                candidate,
                entry["original"],
                entry["oldInventorySha256"],
                entry["sourceIdentity"],
                entry["destinationIdentity"],
                "promoted",
                root_path,
            )
            latest, _attempts = parse_transition_files(transitions_fd)
            promoted_end, rolled_back_end = validate_transition_state(latest)
        if latest[expected_index]["transition"] == "rolled-back":
            return {
                "schemaVersion": 1,
                "index": expected_index,
                "target": f"public_html/{UNITS[expected_index][0]}",
                "status": "unit-rolled-back",
                "complete": expected_index == 0,
            }
        if promoted_end == 0:
            fail("ROLLBACK_NOTHING_PROMOTED")
        index = promoted_end - 1
        if index != expected_index:
            fail("ROLLBACK_EXPECTED_INDEX_MISMATCH")
        entry = latest[index]
        target, _slot, payload_paths = UNITS[index]
        (
            stage_parent_fd, _stage_leaf, live_parent_fd, _live_leaf,
            stage_hash, stage_identity, live_hash, live_identity, slot_hash, slot_identity,
        ) = unit_inventories(stage_public_fd, live_public_fd, rollback_fd, index)
        try:
            current = physical_state(
                entry,
                expected_unit_hash(payload_paths, buffers),
                stage_hash,
                stage_identity,
                live_hash,
                live_identity,
                slot_hash,
                slot_identity,
            )
        finally:
            os.close(stage_parent_fd)
            os.close(live_parent_fd)
        rollback_promoted_unit(
            root_path, entry, buffers, stage_public_fd, live_public_fd, rollback_fd, index, current
        )
        write_transition(
            transitions_fd,
            index,
            entry["original"],
            entry["oldInventorySha256"],
            entry["sourceIdentity"],
            entry["destinationIdentity"],
            "rolled-back",
            root_path,
            "rollback-frame",
        )
        latest, _attempts = parse_transition_files(transitions_fd)
        validate_transition_state(latest)
        test_crash(root_path, "rollback-crash-before-return")
        return {
            "schemaVersion": 1,
            "index": index,
            "target": f"public_html/{UNITS[index][0]}",
            "status": "unit-rolled-back",
            "complete": index == 0,
        }
    finally:
        close_release_state(state)


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


def parse_artifact_envelope(raw: bytes) -> tuple[dict[str, Any], dict[str, bytes], bytes, bytes]:
    try:
        envelope = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("WEB_ARTIFACT_ENVELOPE_INVALID") from error
    if canonical_json(envelope) != raw:
        fail("WEB_ARTIFACT_ENVELOPE_NONCANONICAL")
    exact_keys(envelope, ("transport", "manifest"), "WEB_ARTIFACT_ENVELOPE")
    transport_bytes = canonical_json(envelope["transport"])
    transport, buffers = parse_transport(transport_bytes)
    manifest_bytes = validate_artifact_manifest(envelope["manifest"], transport)
    return transport, buffers, transport_bytes, manifest_bytes


def exact_key_set(value: Any, keys: tuple[str, ...], label: str) -> None:
    if not isinstance(value, dict) or set(value) != set(keys) or len(value) != len(keys):
        fail(f"{label}_SCHEMA_INVALID")


def verified_gate(value: Any, label: str) -> Any:
    exact_key_set(value, ("value", "status"), label)
    if value["status"] != "verified" or value["value"] is None:
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    return value["value"]


def validate_compliance_facts_bound(root_fd: int) -> None:
    try:
        raw = read_fixed_file(root_fd, "release/compliance-facts.json")
        facts = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, ReleaseError) as error:
        raise ReleaseError("COMPLIANCE_FACTS_INCOMPLETE") from error
    exact_key_set(facts, (
        "schemaVersion", "brand", "releaseReady", "slice", "legalEntity", "appStore",
        "hosting", "support", "contentRights", "exportCompliance", "medicalDevice",
        "ageRating", "phiRemediation",
    ), "COMPLIANCE_FACTS")
    if (
        facts["schemaVersion"] != 1
        or facts["brand"] != "Cabo Health"
        or facts["releaseReady"] is not True
        or not isinstance(facts["slice"], str)
        or not facts["slice"]
    ):
        fail("COMPLIANCE_FACTS_INCOMPLETE")

    legal = facts["legalEntity"]
    exact_key_set(legal, (
        "name", "nameStatus", "sellerType", "registeredOrganization", "dunsApplicable",
        "dunsNumber", "legalSignOffStatus",
    ), "COMPLIANCE_LEGAL_ENTITY")
    if legal != {
        "name": "Ivan Guaderrama",
        "nameStatus": "owner-confirmed",
        "sellerType": "individual",
        "registeredOrganization": False,
        "dunsApplicable": False,
        "dunsNumber": None,
        "legalSignOffStatus": "approved",
    }:
        fail("COMPLIANCE_FACTS_INCOMPLETE")

    app_store = facts["appStore"]
    exact_key_set(app_store, ("seller", "sellerRelationship"), "COMPLIANCE_APP_STORE")
    seller = verified_gate(app_store["seller"], "COMPLIANCE_APP_STORE_SELLER")
    relationship = verified_gate(app_store["sellerRelationship"], "COMPLIANCE_APP_STORE_RELATIONSHIP")
    if seller != {"sellerType": "individual", "legalSeller": "Ivan Guaderrama"}:
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    if relationship != {
        "publicBrand": "Cabo Health",
        "brandIsSeparateLegalEntity": False,
        "relationship": "trade brand owned and operated by Ivan Guaderrama",
    }:
        fail("COMPLIANCE_FACTS_INCOMPLETE")

    hosting = facts["hosting"]
    exact_key_set(hosting, ("provider", "logTypes", "retention", "deletionProcess"), "COMPLIANCE_HOSTING")
    if hosting["provider"] != "Hostinger":
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    log_types = verified_gate(hosting["logTypes"], "COMPLIANCE_HOSTING_LOG_TYPES")
    if (
        not isinstance(log_types, list)
        or not log_types
        or any(not isinstance(item, str) or not item.strip() for item in log_types)
        or len(log_types) != len(set(log_types))
    ):
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    for key in ("retention", "deletionProcess"):
        described = verified_gate(hosting[key], f"COMPLIANCE_HOSTING_{key.upper()}")
        if (
            not isinstance(described, dict)
            or set(described) != {"description"}
            or not isinstance(described["description"], str)
            or not described["description"].strip()
        ):
            fail("COMPLIANCE_FACTS_INCOMPLETE")

    support = facts["support"]
    exact_key_set(support, ("contactFactsRef", "responseSla"), "COMPLIANCE_SUPPORT")
    if support["contactFactsRef"] != "release/public-contact-facts.json":
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    response_sla = verified_gate(support["responseSla"], "COMPLIANCE_SUPPORT_SLA")
    if (
        not isinstance(response_sla, dict)
        or set(response_sla) != {"description"}
        or not isinstance(response_sla["description"], str)
        or not response_sla["description"].strip()
    ):
        fail("COMPLIANCE_FACTS_INCOMPLETE")

    for key, required_keys in (
        ("contentRights", {"approved", "scope"}),
        ("exportCompliance", {"approved", "determination"}),
    ):
        determination = verified_gate(facts[key], f"COMPLIANCE_{key.upper()}")
        if (
            not isinstance(determination, dict)
            or set(determination) != required_keys
            or determination.get("approved") is not True
        ):
            fail("COMPLIANCE_FACTS_INCOMPLETE")
        description_key = next(item for item in required_keys if item != "approved")
        if not isinstance(determination[description_key], str) or not determination[description_key].strip():
            fail("COMPLIANCE_FACTS_INCOMPLETE")
    medical = verified_gate(facts["medicalDevice"], "COMPLIANCE_MEDICAL_DEVICE")
    if (
        not isinstance(medical, dict)
        or set(medical) != {"basis", "isMedicalDevice"}
        or not isinstance(medical["isMedicalDevice"], bool)
        or not isinstance(medical["basis"], str)
        or not medical["basis"].strip()
    ):
        fail("COMPLIANCE_FACTS_INCOMPLETE")

    age = facts["ageRating"]
    exact_key_set(age, ("host", "miniapps"), "COMPLIANCE_AGE_RATING")
    exact_key_set(age["miniapps"], ENTRY_SLUGS, "COMPLIANCE_MINIAPP_AGE_RATING")
    host_rating = verified_gate(age["host"], "COMPLIANCE_HOST_AGE_RATING")
    ratings = [
        verified_gate(age["miniapps"][slug], f"COMPLIANCE_{slug.upper()}_AGE_RATING")
        for slug in ENTRY_SLUGS
    ]
    if host_rating not in (4, 9, 13, 16, 18) or any(rating not in (4, 9, 13, 16, 18) or rating > host_rating for rating in ratings):
        fail("COMPLIANCE_FACTS_INCOMPLETE")
    phi = verified_gate(facts["phiRemediation"], "COMPLIANCE_PHI_REMEDIATION")
    if (
        not isinstance(phi, dict)
        or set(phi) != {"completed", "evidenceRef"}
        or phi["completed"] is not True
        or not isinstance(phi["evidenceRef"], str)
        or not phi["evidenceRef"].strip()
    ):
        fail("COMPLIANCE_FACTS_INCOMPLETE")


def assert_final_legal_pins() -> None:
    if set(FINAL_LEGAL_SHA256) != set(LEGAL_SLUGS):
        fail("FINAL_LEGAL_PINS_INCOMPLETE")
    for slug in LEGAL_SLUGS:
        value = FINAL_LEGAL_SHA256[slug]
        if not isinstance(value, str) or SHA256.fullmatch(value) is None or value == DRAFT_LEGAL_SHA256[slug]:
            fail("FINAL_LEGAL_PINS_INCOMPLETE")


def canonical_aasa_bytes() -> bytes:
    return (json.dumps({
        "applinks": {
            "details": [{
                "appIDs": [APP_ID],
                "components": [
                    {"/": "/apps/healthy-recipes/"},
                    {"/": "/apps/clinic-guide/"},
                ],
            }],
        },
    }, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def independently_captured_assembly(root_fd: int) -> tuple[dict[str, bytes], list[dict[str, Any]]]:
    capsule_bytes, _capsule_info = read_capsule_file(root_fd)
    try:
        capsule = json.loads(capsule_bytes.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("TASK6B_CAPSULE_PAYLOAD_INVALID") from error
    exact_keys(capsule, ("schemaVersion", "kind", "manifest", "files"), "TASK6B_CAPSULE")
    manifest = capsule.get("manifest")
    if (
        capsule["schemaVersion"] != 1
        or capsule["kind"] != "cabohealth-miniapps-task-6b-release-capsule-v1"
        or not isinstance(manifest, dict)
        or manifest.get("releaseReady") is not True
        or manifest.get("mode") != "release"
        or manifest.get("entrySlugs") != list(ENTRY_SLUGS)
        or not isinstance(capsule["files"], list)
        or len(capsule["files"]) != len(MINIAPP_FILE_PINS)
    ):
        fail("TASK6B_CAPSULE_PAYLOAD_INVALID")
    expected_buffers: dict[str, bytes] = {}
    for index, item in enumerate(capsule["files"]):
        exact_keys(item, ("path", "size", "sha256", "bytesBase64"), "TASK6B_CAPSULE_FILE")
        pin_path, pin_size, pin_sha256 = MINIAPP_FILE_PINS[index]
        try:
            contents = base64.b64decode(item["bytesBase64"], validate=True)
        except (TypeError, ValueError, base64.binascii.Error) as error:
            raise ReleaseError("TASK6B_CAPSULE_PAYLOAD_INVALID") from error
        if (
            item["path"] != pin_path
            or item["size"] != pin_size
            or item["sha256"] != pin_sha256
            or len(contents) != pin_size
            or hashlib.sha256(contents).hexdigest() != pin_sha256
            or base64.b64encode(contents).decode("ascii") != item["bytesBase64"]
        ):
            fail("TASK6B_CAPSULE_PAYLOAD_INVALID")
        expected_buffers[pin_path] = contents

    captured_inputs = {path: read_fixed_file(root_fd, path) for path in INPUT_PATHS}
    aasa_path = "web-hosting/cabohealth.org/.well-known/apple-app-site-association"
    if captured_inputs[aasa_path] != canonical_aasa_bytes():
        fail("WEB_RELEASE_AASA_INVALID")
    for slug in LEGAL_SLUGS:
        legal_path = f"web-hosting/cabohealth.org/app/{slug}/index.html"
        legal_bytes = captured_inputs[legal_path]
        if hashlib.sha256(legal_bytes).hexdigest() != FINAL_LEGAL_SHA256[slug]:
            fail(f"FINAL_LEGAL_PIN_MISMATCH: {slug}")
        assert_static_web_policy(f"app/{slug}/index.html", legal_bytes)
    for apache_path in (
        "miniapps/shared/security-headers.conf",
        "web-hosting/cabohealth.org/apps/.htaccess",
    ):
        if hashlib.sha256(captured_inputs[apache_path]).hexdigest() != APACHE_SECURITY_SHA256:
            fail("WEB_RELEASE_APACHE_SECURITY_MISMATCH")
    expected_buffers[".well-known/apple-app-site-association"] = captured_inputs[
        aasa_path
    ]
    for slug in LEGAL_SLUGS:
        expected_buffers[f"app/{slug}/index.html"] = captured_inputs[
            f"web-hosting/cabohealth.org/app/{slug}/index.html"
        ]
    apache = expected_buffers["apps/.htaccess"]
    if (
        captured_inputs["miniapps/shared/security-headers.conf"] != apache
        or captured_inputs["web-hosting/cabohealth.org/apps/.htaccess"] != apache
    ):
        fail("WEB_RELEASE_APACHE_SECURITY_MISMATCH")
    input_bytes = {"miniapps/dist": capsule_bytes, **captured_inputs}
    input_entries = [{
        "path": path,
        "size": len(input_bytes[path]),
        "sha256": hashlib.sha256(input_bytes[path]).hexdigest(),
        "kind": INPUT_MANIFEST_KINDS[index],
    } for index, path in enumerate(INPUT_MANIFEST_PATHS)]
    return expected_buffers, input_entries


def publish_manifest_bound(
    root_fd: int,
    transport: dict[str, Any],
    buffers: dict[str, bytes],
    manifest_bytes: bytes,
) -> str:
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
            create_file(release_fd, "web-artifacts.json", manifest_bytes, "release/web-artifacts.json")
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
            before = os.fstat(fd)
            contents = read_all(fd)
            after = os.fstat(fd)
            if (
                contents != manifest_bytes
                or (before.st_dev, before.st_ino, before.st_size, before.st_mode, before.st_uid, before.st_nlink)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_uid, after.st_nlink)
            ):
                fail("WEB_ARTIFACT_MANIFEST_COLLISION")
        finally:
            os.close(fd)
        return "verified-existing-manifest"
    finally:
        os.close(release_fd)


def materialize_release(root_path: str, raw: bytes) -> str:
    transport, buffers, transport_bytes, manifest_bytes = parse_artifact_envelope(raw)

    root_fd = open_root(root_path)
    try:
        validate_compliance_facts_bound(root_fd)
        assert_final_legal_pins()
        expected_buffers, input_entries = independently_captured_assembly(root_fd)
        if buffers != expected_buffers:
            fail("WEB_ARTIFACT_INDEPENDENT_ASSEMBLY_MISMATCH")
        manifest = json.loads(manifest_bytes.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
        if manifest["inputs"] != input_entries:
            fail("WEB_ARTIFACT_MANIFEST_PROVENANCE_MISMATCH")
        materialized = materialize_local_bound(root_fd, transport_bytes, transport, buffers)
        published = publish_manifest_bound(root_fd, transport, buffers, manifest_bytes)
        return f"{materialized};{published}"
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
    if len(argv) == 3 and argv[1] == "materialize-release":
        print(materialize_release(argv[2], sys.stdin.buffer.read()))
        return 0
    if len(argv) == 3 and argv[1] == "capture-reviewed-inputs":
        sys.stdout.buffer.write(capture_reviewed_inputs(argv[2]))
        return 0
    if len(argv) == 3 and argv[1] == "capture-assembly-snapshot":
        sys.stdout.buffer.write(capture_assembly_snapshot(argv[2]))
        return 0
    if len(argv) == 4 and argv[1] == "materialize-stage":
        result = materialize_stage(argv[2], argv[3], sys.stdin.buffer.read())
        print(result)
        return 0
    if len(argv) == 4 and argv[1] == "promote-next":
        outcome = promote_next(argv[2], argv[3], sys.stdin.buffer.read())
        sys.stdout.buffer.write(canonical_json(outcome))
        return 0
    if len(argv) == 5 and argv[1] == "rollback-next":
        outcome = rollback_next(argv[2], argv[3], argv[4], sys.stdin.buffer.read())
        sys.stdout.buffer.write(canonical_json(outcome))
        return 0
    if len(argv) == 4 and argv[1] == "inventory-live":
        sys.stdout.buffer.write(canonical_json(inventory_live(argv[2], argv[3], sys.stdin.buffer.read())))
        return 0
    fail("Usage: secure_web_release.py <root-identity|capture-assembly-snapshot|materialize-release|materialize-stage|capture-reviewed-inputs|promote-next|inventory-live> <owned-root> [release-id]; secure_web_release.py rollback-next <owned-root> <release-id> <expected-index>")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

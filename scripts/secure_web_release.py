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
    "app/index.html",
    "app/privacy/index.html",
    "app/report-content/index.html",
    "app/support/index.html",
    "app/terms/index.html",
    "apps/.htaccess",
    "apps/clinic-guide/app.js",
    "apps/clinic-guide/index.html",
    "apps/healthy-recipes/app.js",
    "apps/healthy-recipes/index.html",
    "apps/shared/clinic-map-texture.png",
    "apps/shared/logo-wordmark.png",
    "apps/shared/logo.png",
    "apps/shared/motion.js",
    "apps/shared/shell.js",
    "apps/shared/styles.css",
)
INPUT_PATHS = (
    "miniapps/shared/security-headers.conf",
    "web-hosting/cabohealth.org/.well-known/apple-app-site-association",
    "web-hosting/cabohealth.org/app/index.html",
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
    "public_html/app/index.html",
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
CAPSULE_SIZE = 721307
CAPSULE_SHA256 = "b569107971f2db55f900e595e08e4d9a8daa54ef4588850424d60a9a8c089929"
APACHE_SECURITY_SHA256 = "0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da"
MARKETING_LANDING_SIZE = 15798
MARKETING_LANDING_SHA256 = "8ca9c36be228bbcc96234e1ee228debfa423de11924b7f1adc8384bfad15d147"
MINIAPP_MIME_OVERLAY = (
    b"Options -Indexes\n"
    b"<FilesMatch \"\\.html$\">\n"
    b"  <IfModule mod_headers.c>\n"
    b"    Header always set Content-Type \"text/html; charset=utf-8\"\n"
    b"  </IfModule>\n"
    b"</FilesMatch>\n"
    b"<FilesMatch \"\\.js$\">\n"
    b"  <IfModule mod_headers.c>\n"
    b"    Header always set Content-Type \"text/javascript; charset=utf-8\"\n"
    b"  </IfModule>\n"
    b"</FilesMatch>\n"
    b"<FilesMatch \"\\.css$\">\n"
    b"  <IfModule mod_headers.c>\n"
    b"    Header always set Content-Type \"text/css; charset=utf-8\"\n"
    b"  </IfModule>\n"
    b"</FilesMatch>\n"
    b"<FilesMatch \"\\.png$\">\n"
    b"  <IfModule mod_headers.c>\n"
    b"    Header always set Content-Type \"image/png\"\n"
    b"  </IfModule>\n"
    b"</FilesMatch>\n"
)
HOSTING_OVERLAYS = (
    (
        "app/.htaccess",
        "app-htaccess",
        b"Options -Indexes\n"
        b"<IfModule mod_headers.c>\n"
        b"  Header always set Content-Type \"text/html; charset=utf-8\"\n"
        b"  Header always set Content-Security-Policy \"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\"\n"
        b"  Header always set X-Content-Type-Options \"nosniff\"\n"
        b"  Header always set X-Frame-Options \"DENY\"\n"
        b"  Header always set Referrer-Policy \"no-referrer\"\n"
        b"  Header always set Permissions-Policy \"camera=(), microphone=(), geolocation=(), payment=(), usb=()\"\n"
        b"  Header always unset Set-Cookie\n"
        b"</IfModule>\n"
        b"<IfModule mod_mime.c>\n"
        b"  AddDefaultCharset UTF-8\n"
        b"</IfModule>\n",
    ),
    (
        ".well-known/.htaccess",
        "well-known-htaccess",
        b"Options -Indexes\n"
        b"<Files \"apple-app-site-association\">\n"
        b"  ForceType application/json\n"
        b"  <IfModule mod_headers.c>\n"
        b"    Header always set Content-Type \"application/json\"\n"
        b"    Header always set X-Content-Type-Options \"nosniff\"\n"
        b"    Header always unset Set-Cookie\n"
        b"  </IfModule>\n"
        b"</Files>\n",
    ),
    ("apps/clinic-guide/.htaccess", "clinic-guide-htaccess", MINIAPP_MIME_OVERLAY),
    ("apps/healthy-recipes/.htaccess", "healthy-recipes-htaccess", MINIAPP_MIME_OVERLAY),
    ("apps/shared/.htaccess", "shared-htaccess", MINIAPP_MIME_OVERLAY),
)
DRAFT_LEGAL_SHA256 = {
    "privacy": "48a9d5974d234434c200ff272c6dfeecc2d6b05baeae30dc25a37df06fb46b91",
    "report-content": "35d304f3ee82364616ab9b0f96013319857d4acc347b6764579a7604392bffb5",
    "support": "4580d6de3db45af3830428497715d903cad557c143a5312d95b6c73f7f575a1a",
    "terms": "0dfc0b40144db111e78e2a2e6a1de1c0e978c9a31bb9dceb819599d7b5e70d44",
}
# Pinned after owner-authorized fact reconciliation and independent byte review.
# Any later legal-copy edit must fail closed until both authorities are repinned.
FINAL_LEGAL_SHA256: dict[str, str | None] = {
    "privacy": "560f781d4e1d2b6bd65797aaa27dc499b1f74954f548507da78053887ac6c125",
    "report-content": "f38f162f51aa4f882da4fa8f35e03bf0efa37308b3a1e4c7e2a6bc1d31886f7c",
    "support": "06fa373c7c59a705348e7bd236f02dec221223577018db161c249428db6883fa",
    "terms": "b1c2a7f2ab3bc1907d8d64b9eda2f712b2810270345f91b8e96033561e5adb22",
}
# This remains unset until an independently reviewed legal/AASA/Firebase/
# Hostinger readiness record is pinned in both release authorities.
WEB_DEPLOYMENT_READINESS_SHA256: str | None = "bf2e2326d057a60131db535b57000f69f2b96a812929f1e6e27286e9a4f9522c"
MINIAPP_FILE_PINS = (
    ("apps/.htaccess", 568, "0057e73870fe6fc6e71887020c4ffad3db76b3ddc12a0c922ae0eaf6ac5b08da"),
    ("apps/clinic-guide/app.js", 3868, "f9b6b5284574ff3dfd3856a30b59b9d6ffe546550bce6f7595cd82eaa6e8ddd7"),
    ("apps/clinic-guide/index.html", 28764, "8a42f8e12ce5b0a7a425cb4c25d291f4c2b749388780630403ada28c834a2abd"),
    ("apps/healthy-recipes/app.js", 4049, "70a2537bcf2b858eef98535cc48e691fbd081bd3e180347207aecfc04550e090"),
    ("apps/healthy-recipes/index.html", 58398, "e7c42084fcfb55e01cbd01ac77bfc8ebc6f8d441a700bf8ae0d2fee45569a7b4"),
    ("apps/shared/clinic-map-texture.png", 382740, "4b569f0da0cffb9a54dedd93ce672cf7592ae4516dd12663e3b34d731df237c4"),
    ("apps/shared/logo-wordmark.png", 12584, "42012a5550f332e531c8d6ea7a99bb06b9c0bd9f0c0c6a45249106dc940f592d"),
    ("apps/shared/logo.png", 13598, "e835403f38f3420e219396e82455818a3e636600f7b9a865530e365faa168117"),
    ("apps/shared/motion.js", 9370, "f6a613929e08e49ee4dea7513f00fdc9fd5e7b1c791ffa512cca1f26a4863d24"),
    ("apps/shared/shell.js", 5506, "edbb90593477cb68de24df0115854d9aeb243c94ff219b211944b2fa3cf93ea9"),
    ("apps/shared/styles.css", 18319, "e98ad07424d4210208542468b25e1841aa3ade7dc505aee2aebd37064c466523"),
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
ALLOWED_KINDS = {"task6b-miniapp", "task7-legal", "marketing-landing", "aasa", "apache-security"}
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
        "apps/shared/clinic-map-texture.png",
        "apps/shared/logo-wordmark.png",
        "apps/shared/logo.png",
        "apps/shared/motion.js",
        "apps/shared/shell.js",
        "apps/shared/styles.css",
    )),
    ("app/index.html", "02-app-index", ("app/index.html",)),
    ("app/privacy", "03-app-privacy", ("app/privacy/index.html",)),
    ("app/terms", "04-app-terms", ("app/terms/index.html",)),
    ("app/support", "05-app-support", ("app/support/index.html",)),
    ("app/report-content", "06-app-report-content", ("app/report-content/index.html",)),
    ("apps/healthy-recipes", "07-apps-healthy-recipes", (
        "apps/healthy-recipes/app.js",
        "apps/healthy-recipes/index.html",
    )),
    ("apps/clinic-guide", "08-apps-clinic-guide", (
        "apps/clinic-guide/app.js",
        "apps/clinic-guide/index.html",
    )),
    (".well-known/apple-app-site-association", "09-aasa", (
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
TRANSITION_NAME = re.compile(r"^(0[0-9])-(prepared|promoted|rolled-back)-([0-9]{3})\.json$")
CANDIDATE_NAME = re.compile(
    r"^(0[0-9])-(prepared|promoted|rolled-back)-([0-9]{3})(?:-[a-f0-9]{16})?\.candidate$"
)
OPERATION_LOCK_CANDIDATE_NAME = re.compile(r"^operation-lock-[a-f0-9]{32}\.candidate$")
OPERATION_LOCK_BYTES = b"CABOHEALTH_OPERATION_LOCK_V1\n"
QUARANTINE_SUFFIX = re.compile(r"^[a-f0-9]{32}$")
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
    "web-hosting/cabohealth.org/app/index.html",
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
    "marketing-landing",
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
    if path == "app/index.html":
        return "marketing-landing"
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
    reversal_precheck: Any | None = None,
    reversal_mutation: Any | None = None,
    reversal_validator: Any | None = None,
    reversal_safety: Any | None = None,
) -> None:
    try:
        if reversal_precheck is not None:
            reversal_precheck()
        if reversal_mutation is not None:
            reversal_mutation()
        rename_with_flag(dst_fd, dst, src_fd, src, operation)
        fsync_rename_directories(dst_fd, src_fd)
        if reversal_fault and test_fault_enabled(root_path, reversal_fault):
            raise OSError(errno.EIO, "INJECTED_REVERSAL_FSYNC_OSERROR")
        if reversal_validator is not None:
            reversal_validator()
    except BaseException as reversal:
        if reversal_safety is not None:
            try:
                reversal_safety()
            except BaseException as safety_error:
                raise ReleaseError(
                    f"POST_NAMESPACE_FAILURE PRIMARY={describe_exception(primary)} "
                    f"REVERSAL={describe_exception(reversal)} "
                    f"SAFETY={describe_exception(safety_error)}"
                ) from safety_error
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
    reversal_precheck: Any | None = None,
    reversal_mutation: Any | None = None,
    reversal_validator: Any | None = None,
    reversal_safety: Any | None = None,
) -> None:
    rename_with_flag(src_fd, src, dst_fd, dst, operation)
    reversal_mutation_requested = (
        reversal_mutation is not None
        and test_fault_enabled(root_path, f"{fault_prefix}-reversal-operand-tamper")
    )
    try:
        test_crash(root_path, f"{crash_prefix}-crash-after-namespace")
        if test_fault_enabled(root_path, f"{fault_prefix}-fsync-oserror"):
            raise OSError(errno.EIO, "INJECTED_POST_NAMESPACE_FSYNC_OSERROR")
        fsync_rename_directories(src_fd, dst_fd)
        test_crash(root_path, f"{crash_prefix}-crash-after-directory-fsync")
        raise_injected_exception(root_path, fault_prefix)
        if tamper is not None and test_fault_enabled(root_path, f"{fault_prefix}-tamper"):
            tamper()
        if reversal_mutation_requested:
            raise OSError(errno.EIO, "INJECTED_REVERSAL_OPERAND_TAMPER")
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
            reversal_precheck,
            reversal_mutation if reversal_mutation_requested else None,
            reversal_validator,
            reversal_safety,
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


def raw_object_identity(info: os.stat_result) -> dict[str, Any]:
    if stat.S_ISREG(info.st_mode):
        kind = "file"
    elif stat.S_ISDIR(info.st_mode):
        kind = "directory"
    elif stat.S_ISLNK(info.st_mode):
        kind = "symlink"
    elif stat.S_ISFIFO(info.st_mode):
        kind = "fifo"
    elif stat.S_ISSOCK(info.st_mode):
        kind = "socket"
    elif stat.S_ISCHR(info.st_mode):
        kind = "character-device"
    elif stat.S_ISBLK(info.st_mode):
        kind = "block-device"
    else:
        kind = "special"
    return {"device": info.st_dev, "inode": info.st_ino, "type": kind}


def inventory_leaf(
    parent_fd: int,
    name: str,
    expected_paths: tuple[str, ...],
    target: str,
    *,
    with_identity: bool = False,
    allowed_extra_names: tuple[str, ...] = (),
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
            found_all = tuple(sorted(os.listdir(fd), key=lambda item: item.encode("ascii")))
            if tuple(item for item in found_all if item in allowed_extra_names) != tuple(
                sorted(allowed_extra_names, key=lambda item: item.encode("ascii"))
            ):
                fail(f"UNEXPECTED_LIVE_TARGET_INVENTORY: {target}")
            found = tuple(item for item in found_all if item not in allowed_extra_names)
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


def probe_leaf(
    parent_fd: int,
    name: str,
    expected_paths: tuple[str, ...],
    target: str,
) -> tuple[str | None, dict[str, Any] | None]:
    """Return stable raw topology even when strict inventory is invalid.

    The no-follow lstat identity is authority only for crash reconciliation.  A
    hash is returned solely when the ordinary strict inventory succeeds for the
    same inode.  Special files are never followed, and FIFO reads remain
    nonblocking through inventory_leaf's descriptor flags.
    """
    for _attempt in range(3):
        before = stat_if_present(parent_fd, name)
        if before is None:
            return None, None
        raw_identity = raw_object_identity(before)
        try:
            inventory_hash, strict_identity = inventory_leaf(
                parent_fd, name, expected_paths, target, with_identity=True
            )
        except (ReleaseError, OSError, UnicodeError):
            after = stat_if_present(parent_fd, name)
            if after is not None and raw_object_identity(after) == raw_identity:
                return None, raw_identity
            continue
        if strict_identity == raw_identity:
            return inventory_hash, raw_identity
    fail(f"LIVE_TARGET_CHANGED_DURING_PROBE: {target}")


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
    before = os.fstat(fd)
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_uid != os.geteuid()
        or before.st_nlink != 1
        or stat.S_IMODE(before.st_mode) != 0o600
    ):
        fail("PROMOTION_OPERATION_LOCK_INVALID")
    os.lseek(fd, 0, os.SEEK_SET)
    contents = read_all(fd)
    after = os.fstat(fd)
    if (
        contents != OPERATION_LOCK_BYTES
        or (before.st_dev, before.st_ino, before.st_size, before.st_mode, before.st_uid, before.st_nlink)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_uid, after.st_nlink)
    ):
        fail("PROMOTION_OPERATION_LOCK_INVALID")
    os.lseek(fd, 0, os.SEEK_SET)


def validate_operation_lock_candidate(transitions_fd: int, name: str) -> None:
    if OPERATION_LOCK_CANDIDATE_NAME.fullmatch(name) is None:
        fail("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID")
    try:
        info = os.stat(name, dir_fd=transitions_fd, follow_symlinks=False)
    except OSError as error:
        raise ReleaseError("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID") from error
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_nlink != 1
        or info.st_size > len(OPERATION_LOCK_BYTES)
        or stat.S_IMODE(info.st_mode) not in (0o000, 0o200, 0o400, 0o600)
    ):
        fail("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID")


def acquire_operation_lock(fd: int, root_path: str) -> int:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        os.close(fd)
        raise ReleaseError("PROMOTION_OPERATION_BUSY") from error
    if test_fault_enabled(root_path, "operation-lock-hold"):
        time.sleep(2)
    return fd


def open_published_operation_lock(transitions_fd: int, root_path: str) -> int:
    try:
        fd = os.open("operation.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=transitions_fd)
    except OSError as error:
        raise ReleaseError("PROMOTION_OPERATION_LOCK_INVALID") from error
    try:
        validate_operation_lock(fd)
    except BaseException:
        os.close(fd)
        raise
    return acquire_operation_lock(fd, root_path)


def open_operation_lock(transitions_fd: int, root_path: str) -> int:
    try:
        existing_fd = os.open(
            "operation.lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=transitions_fd
        )
    except FileNotFoundError:
        existing_fd = None
    except OSError as error:
        raise ReleaseError("PROMOTION_OPERATION_LOCK_INVALID") from error
    if existing_fd is not None:
        try:
            validate_operation_lock(existing_fd)
        except BaseException:
            os.close(existing_fd)
            raise
        return acquire_operation_lock(existing_fd, root_path)

    candidate_name = f"operation-lock-{os.urandom(16).hex()}.candidate"
    try:
        candidate_fd = os.open(
            candidate_name,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=transitions_fd,
        )
    except OSError as error:
        raise ReleaseError("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID") from error
    try:
        test_crash(root_path, "operation-lock-crash-after-candidate-create")
        os.fchmod(candidate_fd, 0o600)
        candidate_info = os.fstat(candidate_fd)
        if (
            not stat.S_ISREG(candidate_info.st_mode)
            or candidate_info.st_uid != os.geteuid()
            or candidate_info.st_nlink != 1
            or stat.S_IMODE(candidate_info.st_mode) != 0o600
        ):
            fail("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID")
        test_crash(root_path, "operation-lock-crash-after-candidate-fchmod")
        requested = os.environ.get("CABOHEALTH_TEST_FAULT", "")
        byte_prefix = "operation-lock-crash-after-byte-"
        if requested.startswith(byte_prefix) and test_fault_enabled(root_path, requested):
            offset_text = requested.removeprefix(byte_prefix)
            if not offset_text.isascii() or not offset_text.isdigit():
                fail("TEST_FRAME_CUT_INVALID")
            offset = int(offset_text)
            if not 0 <= offset <= len(OPERATION_LOCK_BYTES):
                fail("TEST_FRAME_CUT_INVALID")
            write_all(candidate_fd, OPERATION_LOCK_BYTES[:offset])
            os._exit(86)
        write_all(candidate_fd, OPERATION_LOCK_BYTES)
        test_crash(root_path, "operation-lock-crash-after-candidate-write")
        os.fsync(candidate_fd)
        test_crash(root_path, "operation-lock-crash-after-candidate-fsync")
        validate_operation_lock(candidate_fd)
        try:
            fcntl.flock(candidate_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError("PROMOTION_OPERATION_LOCK_CANDIDATE_INVALID") from error
        if test_fault_enabled(root_path, "operation-lock-hold-before-publish"):
            time.sleep(2)
        try:
            rename_with_flag(transitions_fd, candidate_name, transitions_fd, "operation.lock", "noreplace")
        except ReleaseError:
            os.close(candidate_fd)
            return open_published_operation_lock(transitions_fd, root_path)
        test_crash(root_path, "operation-lock-crash-after-publish")
        os.fsync(transitions_fd)
        test_crash(root_path, "operation-lock-crash-after-directory-fsync")
        if test_fault_enabled(root_path, "operation-lock-hold"):
            time.sleep(2)
        return candidate_fd
    except BaseException:
        try:
            os.close(candidate_fd)
        except OSError:
            pass
        raise


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
        if OPERATION_LOCK_CANDIDATE_NAME.fullmatch(name) is not None:
            validate_operation_lock_candidate(transitions_fd, name)
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
        compliance_files.append(captured_file("app.json", read_fixed_file(root_fd, "app.json")))
        compliance_files.append(captured_file("eas.json", read_fixed_file(root_fd, "eas.json")))
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


def verify_overlay_file(
    parent_fd: int,
    name: str,
    contents: bytes,
    label: str,
    expected_links: int,
) -> os.stat_result:
    try:
        fd = os.open(name, OPEN_FILE_READ, dir_fd=parent_fd)
    except OSError as error:
        raise ReleaseError(f"HOSTING_OVERLAY_INVALID: {label}") from error
    try:
        before = os.fstat(fd)
        captured = read_all(fd)
        after = os.fstat(fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or stat.S_IMODE(before.st_mode) != 0o644
            or before.st_nlink != expected_links
            or captured != contents
            or (
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
            )
        ):
            fail(f"HOSTING_OVERLAY_INVALID: {label}")
        return before
    finally:
        os.close(fd)


def open_hosting_overlay_state(root_path: str) -> tuple[int, int, int]:
    root_fd = open_root(root_path)
    overlays_fd: int | None = None
    try:
        private_fd = ensure_directory(".cabohealth-private", root_fd, ".cabohealth-private", 0o700)
        try:
            overlays_fd = ensure_directory(
                "hosting-overlays-v1",
                private_fd,
                ".cabohealth-private/hosting-overlays-v1",
                0o700,
            )
        finally:
            os.close(private_fd)
        public_fd = open_directory("public_html", root_fd, "public_html", mode=0o755)
        return root_fd, public_fd, overlays_fd
    except Exception:
        if overlays_fd is not None:
            os.close(overlays_fd)
        os.close(root_fd)
        raise


def publish_hosting_overlays(root_path: str) -> dict[str, Any]:
    root_fd, public_fd, overlays_fd = open_hosting_overlay_state(root_path)
    plans: list[tuple[str, str, bytes, int, str, bool]] = []
    try:
        for target, candidate, contents in HOSTING_OVERLAYS:
            candidate_info = stat_if_present(overlays_fd, candidate)
            if candidate_info is None:
                create_file(
                    overlays_fd,
                    candidate,
                    contents,
                    f".cabohealth-private/hosting-overlays-v1/{candidate}",
                    final_mode=0o644,
                )
                candidate_info = verify_overlay_file(
                    overlays_fd, candidate, contents, candidate, 1
                )
            elif candidate_info.st_nlink not in (1, 2):
                fail(f"HOSTING_OVERLAY_INVALID: {candidate}")
            else:
                candidate_info = verify_overlay_file(
                    overlays_fd,
                    candidate,
                    contents,
                    candidate,
                    candidate_info.st_nlink,
                )

            parent_fd, leaf = open_parent_for_target(public_fd, target)
            plans.append((target, candidate, contents, parent_fd, leaf, False))
            live_info = stat_if_present(parent_fd, leaf)
            if live_info is None:
                if candidate_info.st_nlink != 1:
                    fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")
                plans[-1] = (target, candidate, contents, parent_fd, leaf, True)
            else:
                if candidate_info.st_nlink != 2:
                    fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")
                live_info = verify_overlay_file(parent_fd, leaf, contents, target, 2)
                candidate_info = verify_overlay_file(
                    overlays_fd, candidate, contents, candidate, 2
                )
                if (live_info.st_dev, live_info.st_ino) != (
                    candidate_info.st_dev,
                    candidate_info.st_ino,
                ):
                    fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")

        linked: list[tuple[str, str, bytes, int, str]] = []
        try:
            for target, candidate, contents, parent_fd, leaf, needs_publish in plans:
                if not needs_publish:
                    continue
                try:
                    os.link(
                        candidate,
                        leaf,
                        src_dir_fd=overlays_fd,
                        dst_dir_fd=parent_fd,
                        follow_symlinks=False,
                    )
                    os.fsync(parent_fd)
                    linked.append((target, candidate, contents, parent_fd, leaf))
                    live_info = verify_overlay_file(parent_fd, leaf, contents, target, 2)
                    candidate_info = verify_overlay_file(
                        overlays_fd, candidate, contents, candidate, 2
                    )
                    if (live_info.st_dev, live_info.st_ino) != (
                        candidate_info.st_dev,
                        candidate_info.st_ino,
                    ):
                        fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")
                except Exception as error:
                    cleanup_failed = False
                    for (
                        linked_target,
                        linked_candidate,
                        linked_contents,
                        linked_parent_fd,
                        linked_leaf,
                    ) in reversed(linked):
                        try:
                            linked_live = verify_overlay_file(
                                linked_parent_fd,
                                linked_leaf,
                                linked_contents,
                                linked_target,
                                2,
                            )
                            linked_private = verify_overlay_file(
                                overlays_fd,
                                linked_candidate,
                                linked_contents,
                                linked_candidate,
                                2,
                            )
                            if (linked_live.st_dev, linked_live.st_ino) != (
                                linked_private.st_dev,
                                linked_private.st_ino,
                            ):
                                fail(
                                    f"HOSTING_OVERLAY_IDENTITY_INVALID: {linked_target}"
                                )
                            os.unlink(linked_leaf, dir_fd=linked_parent_fd)
                            os.fsync(linked_parent_fd)
                            verify_overlay_file(
                                overlays_fd,
                                linked_candidate,
                                linked_contents,
                                linked_candidate,
                                1,
                            )
                        except Exception:
                            cleanup_failed = True
                    if cleanup_failed:
                        raise ReleaseError(
                            "HOSTING_OVERLAY_PUBLISH_ROLLBACK_FAILED"
                        ) from error
                    raise ReleaseError(
                        f"HOSTING_OVERLAY_PUBLISH_FAILED: {target}"
                    ) from error

            return {
                "schemaVersion": 1,
                "status": "published" if linked else "verified-existing",
                "overlayCount": len(HOSTING_OVERLAYS),
            }
        finally:
            linked.clear()
    finally:
        for _target, _candidate, _contents, parent_fd, _leaf, _needs_publish in plans:
            os.close(parent_fd)
        os.close(overlays_fd)
        os.close(public_fd)
        os.close(root_fd)


def rollback_hosting_overlays(root_path: str) -> dict[str, Any]:
    root_fd, public_fd, overlays_fd = open_hosting_overlay_state(root_path)
    try:
        for target, candidate, contents in reversed(HOSTING_OVERLAYS):
            parent_fd, leaf = open_parent_for_target(public_fd, target)
            try:
                live_info = stat_if_present(parent_fd, leaf)
                candidate_info = stat_if_present(overlays_fd, candidate)
                if live_info is None:
                    if candidate_info is None:
                        fail(f"HOSTING_OVERLAY_ROLLBACK_INVALID: {target}")
                    verify_overlay_file(overlays_fd, candidate, contents, candidate, 1)
                    continue
                live_info = verify_overlay_file(parent_fd, leaf, contents, target, 2)
                candidate_info = verify_overlay_file(
                    overlays_fd, candidate, contents, candidate, 2
                )
                if (live_info.st_dev, live_info.st_ino) != (
                    candidate_info.st_dev,
                    candidate_info.st_ino,
                ):
                    fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")
                os.unlink(leaf, dir_fd=parent_fd)
                os.fsync(parent_fd)
                verify_overlay_file(overlays_fd, candidate, contents, candidate, 1)
            finally:
                os.close(parent_fd)
        return {
            "schemaVersion": 1,
            "status": "rolled-back",
            "overlayCount": len(HOSTING_OVERLAYS),
        }
    finally:
        os.close(overlays_fd)
        os.close(public_fd)
        os.close(root_fd)


def verify_hosting_overlays(root_fd: int, public_fd: int) -> None:
    try:
        private_fd = open_directory(
            ".cabohealth-private",
            root_fd,
            ".cabohealth-private",
            mode=0o700,
        )
    except (OSError, ReleaseError) as error:
        raise ReleaseError("HOSTING_OVERLAY_INVALID: private authority") from error
    try:
        try:
            overlays_fd = open_directory(
                "hosting-overlays-v1",
                private_fd,
                ".cabohealth-private/hosting-overlays-v1",
                mode=0o700,
            )
        except (OSError, ReleaseError) as error:
            raise ReleaseError("HOSTING_OVERLAY_INVALID: private authority") from error
    finally:
        os.close(private_fd)
    try:
        for target, candidate, contents in HOSTING_OVERLAYS:
            parent_fd, leaf = open_parent_for_target(public_fd, target)
            try:
                live_info = verify_overlay_file(parent_fd, leaf, contents, target, 2)
                candidate_info = verify_overlay_file(
                    overlays_fd,
                    candidate,
                    contents,
                    candidate,
                    2,
                )
                if (live_info.st_dev, live_info.st_ino) != (
                    candidate_info.st_dev,
                    candidate_info.st_ino,
                ):
                    fail(f"HOSTING_OVERLAY_IDENTITY_INVALID: {target}")
            finally:
                os.close(parent_fd)
    finally:
        os.close(overlays_fd)


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
            verify_hosting_overlays(root_fd, public_fd)
            expected_children = {
                "apps": (".htaccess", "clinic-guide", "healthy-recipes", "shared"),
                "app": (".htaccess", "index.html", "privacy", "report-content", "support", "terms"),
                ".well-known": (".htaccess", "apple-app-site-association"),
            }
            for parent, children in expected_children.items():
                parent_fd = open_directory(parent, public_fd, f"public_html/{parent}", mode=0o755)
                try:
                    found = tuple(sorted(os.listdir(parent_fd), key=lambda item: item.encode("ascii")))
                    protected_pair = ("app-review", "client-resources")
                    allowed = (
                        children,
                        tuple(sorted((*children, *protected_pair), key=lambda item: item.encode("ascii"))),
                    ) if parent == "apps" else (children,)
                    if found not in allowed:
                        fail(f"SERVER_INVENTORY_PARENT_SET_INVALID: {parent}")
                    if parent == "apps" and found == allowed[1]:
                        for protected_name in protected_pair:
                            protected_fd = open_directory(
                                protected_name,
                                parent_fd,
                                f"public_html/apps/{protected_name}",
                                mode=0o755,
                            )
                            os.close(protected_fd)
                finally:
                    os.close(parent_fd)
            file_count = 0
            for index in range(len(UNITS)):
                target, _slot, payload_paths = UNITS[index]
                parent_fd, leaf = open_parent_for_target(public_fd, target)
                try:
                    allowed_extra_names = (
                        (".htaccess",)
                        if target in (
                            "apps/clinic-guide",
                            "apps/healthy-recipes",
                            "apps/shared",
                        )
                        else ()
                    )
                    actual = inventory_leaf(
                        parent_fd,
                        leaf,
                        payload_paths,
                        target,
                        allowed_extra_names=allowed_extra_names,
                    )
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
        stage_hash, stage_identity = probe_leaf(stage_parent_fd, stage_leaf, payload_paths, target)
        live_hash, live_identity = probe_leaf(live_parent_fd, live_leaf, payload_paths, target)
        slot_hash, slot_identity = probe_leaf(rollback_fd, slot, payload_paths, target)
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
    has_quarantine: bool = False,
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
            (stage_identity == destination_identity or live_identity == source_identity)
            and stage_identity is not None
            and live_identity is not None
            and slot_identity is None
        ):
            return "promotion-exchange-unvalidated"
        if (
            stage_identity is None
            and live_identity is not None
            and slot_identity is not None
            and (slot_identity == destination_identity or live_identity == source_identity)
        ):
            return "promotion-complete-unvalidated"
        if (
            stage_identity is None
            and live_identity is not None
            and slot_identity is not None
            and (slot_identity == source_identity or live_identity == destination_identity)
        ):
            return "rollback-exchange-unvalidated"
    elif (
        stage_identity is None
        and live_identity is not None
        and slot_identity is None
    ):
        return "promotion-noreplace-unvalidated"
    elif (
        stage_identity is None
        and live_identity is None
        and slot_identity is not None
    ):
        return "rollback-noreplace-unvalidated"
    if has_quarantine:
        return "recovery-in-progress"
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
        target, slot, payload_paths = UNITS[index]
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
                bool(quarantine_names(rollback_fd, slot)),
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
                "promotion-complete-unvalidated",
                "promotion-noreplace-unvalidated",
                "recovery-in-progress",
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
                "recovery-in-progress",
            )
        ):
            pass
        elif actual != expected:
            fail(f"PROMOTION_RECORD_PHYSICAL_MISMATCH: {target}")
        states[index] = actual
    return states


def mutate_leaf_bytes(parent_fd: int, leaf: str) -> None:
    fd = os.open(leaf, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
    try:
        os.ftruncate(fd, 0)
        write_all(fd, b"unreviewed same-inode bytes\n")
        os.fsync(fd)
    finally:
        os.close(fd)


def mutate_leaf_mode(parent_fd: int, leaf: str) -> None:
    fd = os.open(leaf, OPEN_FILE_READ, dir_fd=parent_fd)
    try:
        info = os.fstat(fd)
        os.fchmod(fd, 0o700 if stat.S_ISDIR(info.st_mode) else 0o600)
        os.fsync(fd)
    finally:
        os.close(fd)


def mutate_directory_tree(parent_fd: int, leaf: str, child_name: str = "round4-unreviewed") -> None:
    directory_fd = os.open(leaf, OPEN_DIR, dir_fd=parent_fd)
    try:
        child_fd = os.open(
            child_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        try:
            os.fchmod(child_fd, 0o644)
            write_all(child_fd, b"unreviewed tree entry\n")
            os.fsync(child_fd)
        finally:
            os.close(child_fd)
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def create_fault_leaf(parent_fd: int, kind: str, name: str) -> None:
    if kind == "symlink":
        os.symlink("round4-never-follow", name, dir_fd=parent_fd)
    elif kind == "fifo":
        os.mkfifo(name, 0o600, dir_fd=parent_fd)
    elif kind == "special":
        os.mkdir(name, 0o700, dir_fd=parent_fd)
    else:
        fail("TEST_OPERAND_SUBSTITUTION_INVALID")


def create_fault_regular_leaf(parent_fd: int, name: str) -> None:
    fd = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=parent_fd,
    )
    try:
        os.fchmod(fd, 0o644)
        write_all(fd, b"unreviewed recovery operand\n")
        os.fsync(fd)
    finally:
        os.close(fd)


def substitute_leaf_for_fault(parent_fd: int, leaf: str, kind: str, name: str) -> None:
    create_fault_leaf(parent_fd, kind, name)
    rename_with_flag(parent_fd, leaf, parent_fd, name, "exchange")


def quarantine_name(slot: str) -> str:
    return f"{slot}.quarantine-{os.urandom(16).hex()}"


def quarantine_slot(name: str) -> str | None:
    marker = ".quarantine-"
    if marker not in name:
        return None
    slot, suffix = name.rsplit(marker, 1)
    if slot not in {unit_slot for _target, unit_slot, _paths in UNITS}:
        return None
    if QUARANTINE_SUFFIX.fullmatch(suffix) is None:
        return None
    return slot


def quarantine_names(rollback_fd: int, slot: str) -> tuple[str, ...]:
    try:
        names = tuple(sorted(
            (
                name for name in os.listdir(rollback_fd)
                if quarantine_slot(name) == slot
            ),
            key=lambda value: value.encode("ascii"),
        ))
    except UnicodeEncodeError as error:
        raise ReleaseError("ROLLBACK_UNKNOWN_PATH") from error
    return names


def validate_quarantine_residue(rollback_fd: int, name: str) -> None:
    if quarantine_slot(name) is None:
        fail("ROLLBACK_QUARANTINE_NAME_INVALID")
    try:
        info = os.stat(name, dir_fd=rollback_fd, follow_symlinks=False)
    except OSError as error:
        raise ReleaseError("ROLLBACK_QUARANTINE_INVALID") from error
    if info.st_uid != os.geteuid():
        fail("ROLLBACK_QUARANTINE_INVALID")


def recovery_snapshot(
    stage_parent_fd: int,
    stage_leaf: str,
    live_parent_fd: int,
    live_leaf: str,
    rollback_fd: int,
    slot: str,
    payload_paths: tuple[str, ...],
    target: str,
) -> dict[str, tuple[int, str, str | None, dict[str, Any] | None]]:
    locations = {
        "stage": (stage_parent_fd, stage_leaf),
        "live": (live_parent_fd, live_leaf),
        "slot": (rollback_fd, slot),
    }
    for name in quarantine_names(rollback_fd, slot):
        locations[f"quarantine:{name}"] = (rollback_fd, name)
    result: dict[str, tuple[int, str, str | None, dict[str, Any] | None]] = {}
    for label, (parent_fd, leaf) in locations.items():
        inventory_hash, identity = probe_leaf(parent_fd, leaf, payload_paths, target)
        result[label] = (parent_fd, leaf, inventory_hash, identity)
    return result


def recovery_match(
    location: tuple[int, str, str | None, dict[str, Any] | None],
    expected: tuple[str, dict[str, Any]],
) -> bool:
    return location[2] == expected[0] and location[3] == expected[1]


def record_recovery_error(
    errors: list[tuple[str, BaseException]],
    label: str,
    error: BaseException,
) -> None:
    detail = describe_exception(error)
    if not any(existing_label == label and describe_exception(existing) == detail for existing_label, existing in errors):
        errors.append((label, error))


def recovery_error_details(errors: list[tuple[str, BaseException]]) -> str:
    return " ".join(f"{label}={describe_exception(error)}" for label, error in errors)


def reconcile_recovery_topology(
    root_path: str,
    stage_parent_fd: int,
    stage_leaf: str,
    live_parent_fd: int,
    live_leaf: str,
    rollback_fd: int,
    slot: str,
    payload_paths: tuple[str, ...],
    target: str,
    desired_stage: tuple[str, dict[str, Any]] | None,
    desired_live: tuple[str, dict[str, Any]] | None,
    desired_slot: tuple[str, dict[str, Any]] | None,
    initial_errors: tuple[tuple[str, BaseException], ...] = (),
    canonical_required: bool = False,
) -> None:
    """Boundedly rebuild a reviewed-or-absent public topology.

    Every namespace or durability failure is followed by a new descriptor-relative
    probe.  Objects are never overwritten or deleted: a mismatched named operand is
    moved to a fresh no-replace private quarantine name, where an exact recorded
    inode/hash can still be found and restored on the next iteration.
    """
    desired = {
        "stage": desired_stage,
        "live": desired_live,
        "slot": desired_slot,
    }
    errors = list(initial_errors)
    injected_quarantine_fsync = False
    force_final_probe_failure = test_fault_enabled(
        root_path, "promotion-recovery-final-probe-oserror"
    )
    for _attempt in range(24):
        try:
            snapshot = recovery_snapshot(
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
            )
        except BaseException as error:
            record_recovery_error(errors, "RECOVERY", error)
            continue

        moved = False
        for label in ("live", "stage", "slot"):
            location = snapshot[label]
            expected = desired[label]
            desired_live_available = desired_live is not None and any(
                recovery_match(candidate, desired_live) for candidate in snapshot.values()
            )
            live_is_only_reviewed_fallback = (
                label == "live"
                and desired_live is not None
                and not desired_live_available
                and any(
                    reviewed is not None and recovery_match(location, reviewed)
                    for reviewed in desired.values()
                )
            )
            if (
                location[3] is None
                or (expected is not None and recovery_match(location, expected))
                or live_is_only_reviewed_fallback
            ):
                continue
            destination = quarantine_name(slot)
            try:
                rename_with_flag(location[0], location[1], rollback_fd, destination, "noreplace")
                test_crash(root_path, "promotion-recovery-relocate-restore-quarantine-crash")
                test_crash(root_path, "promotion-recovery-destination-mutation-safe-crash")
                if (
                    not injected_quarantine_fsync
                    and test_fault_enabled(root_path, "promotion-recovery-relocate-restore-compound-fsync")
                ):
                    injected_quarantine_fsync = True
                    raise OSError(errno.EIO, "INJECTED_RECOVERY_QUARANTINE_FSYNC_OSERROR")
                fsync_rename_directories(location[0], rollback_fd)
            except BaseException as error:
                record_recovery_error(errors, "RECOVERY", error)
            moved = True
            break
        if moved:
            continue

        for label in ("live", "stage", "slot"):
            expected = desired[label]
            if expected is None or recovery_match(snapshot[label], expected):
                continue
            source = next(
                (
                    location for source_label, location in snapshot.items()
                    if source_label.startswith("quarantine:") and recovery_match(location, expected)
                ),
                None,
            )
            if source is None:
                continue
            try:
                rename_with_flag(source[0], source[1], snapshot[label][0], snapshot[label][1], "noreplace")
                fsync_rename_directories(source[0], snapshot[label][0])
            except BaseException as error:
                record_recovery_error(errors, "RESTORE", error)
            moved = True
            break
        if moved:
            continue

        canonical = all(
            (location[3] is None if desired[label] is None else recovery_match(location, desired[label]))
            for label, location in ((name, snapshot[name]) for name in ("stage", "live", "slot"))
        )
        live_location = snapshot["live"]
        live_safe = live_location[3] is None or any(
            expected is not None and recovery_match(live_location, expected)
            for expected in desired.values()
        )
        details = recovery_error_details(errors)
        if canonical or (live_safe and not canonical_required):
            if force_final_probe_failure:
                record_recovery_error(
                    errors,
                    "RECOVERY",
                    ReleaseError("INJECTED_RECOVERY_FINAL_PROBE_RETRY"),
                )
                continue
            suffix = f" {details}" if details else ""
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}{suffix}")
        break

    final_snapshot: dict[str, tuple[int, str, str | None, dict[str, Any] | None]] | None = None
    try:
        if force_final_probe_failure:
            raise OSError(errno.EIO, "INJECTED_RECOVERY_FINAL_PROBE_OSERROR")
        final_snapshot = recovery_snapshot(
            stage_parent_fd,
            stage_leaf,
            live_parent_fd,
            live_leaf,
            rollback_fd,
            slot,
            payload_paths,
            target,
        )
    except BaseException as error:
        record_recovery_error(errors, "RECOVERY", error)
    if final_snapshot is not None:
        canonical = all(
            (final_snapshot[label][3] is None
                if desired[label] is None else recovery_match(final_snapshot[label], desired[label]))
            for label in ("stage", "live", "slot")
        )
        if canonical:
            details = recovery_error_details(errors)
            suffix = f" {details}" if details else ""
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}{suffix}")
        live_location = final_snapshot["live"]
        if live_location[3] is None or any(
            expected is not None and recovery_match(live_location, expected)
            for expected in desired.values()
        ):
            errors.append(("RECOVERY", ReleaseError("BOUNDED_RECONCILIATION_INCOMPLETE_PUBLIC_STATE_SAFE")))
    details = recovery_error_details(errors)
    suffix = f" {details}" if details else ""
    fail(f"OPERAND_SUBSTITUTION_RECOVERY_FAILED: {target}{suffix}")


def quarantine_live_leaf(
    live_parent_fd: int,
    live_leaf: str,
    private_parent_fd: int,
    private_leaf: str,
    target: str,
) -> None:
    if stat_if_present(live_parent_fd, live_leaf) is None:
        return
    rename_with_flag(live_parent_fd, live_leaf, private_parent_fd, private_leaf, "noreplace")
    fsync_rename_directories(live_parent_fd, private_parent_fd)
    if stat_if_present(live_parent_fd, live_leaf) is not None:
        fail(f"OPERAND_SUBSTITUTION_QUARANTINE_INVALID: {target}")


def leaf_matches(
    parent_fd: int,
    leaf: str,
    payload_paths: tuple[str, ...],
    target: str,
    expected_hash: str | None,
    expected_identity: dict[str, Any] | None,
) -> bool:
    actual_hash, actual_identity = probe_leaf(parent_fd, leaf, payload_paths, target)
    return actual_hash == expected_hash and actual_identity == expected_identity


def quarantine_unreviewed_live(
    live_parent_fd: int,
    live_leaf: str,
    private_parent_fd: int,
    private_leaf: str,
    payload_paths: tuple[str, ...],
    target: str,
    reviewed: tuple[tuple[str, dict[str, Any]], ...],
) -> None:
    live_hash, live_identity = probe_leaf(live_parent_fd, live_leaf, payload_paths, target)
    if live_identity is None or any(
        live_hash == reviewed_hash and live_identity == reviewed_identity
        for reviewed_hash, reviewed_identity in reviewed
    ):
        return
    quarantine_live_leaf(live_parent_fd, live_leaf, private_parent_fd, private_leaf, target)


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
        reviewed_live_states = (
            (new_hash, entry["sourceIdentity"]),
            (old_hash, entry["destinationIdentity"]),
        )
        if current == "recovery-in-progress":
            reconcile_recovery_topology(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
                (new_hash, entry["sourceIdentity"]),
                (old_hash, entry["destinationIdentity"])
                    if entry["original"] == "present" else None,
                None,
            )
        completion_error: BaseException | None = None
        if current == "promotion-complete-unvalidated":
            if not leaf_matches(
                rollback_fd,
                slot,
                payload_paths,
                target,
                old_hash,
                entry["destinationIdentity"],
            ):
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    None,
                    (("PRIMARY", ReleaseError("RESTORE_OPERAND_INVALID")),),
                    True,
                )
            try:
                rename_with_flag(rollback_fd, slot, stage_parent_fd, stage_leaf, "noreplace")
                if test_fault_enabled(root_path, "promotion-complete-recovery-fsync-oserror"):
                    raise OSError(errno.EIO, "INJECTED_PROMOTION_COMPLETE_RECOVERY_FSYNC_OSERROR")
                fsync_rename_directories(rollback_fd, stage_parent_fd)
            except BaseException as recovery_error:
                completion_error = recovery_error
            if not (
                leaf_matches(
                    stage_parent_fd,
                    stage_leaf,
                    payload_paths,
                    target,
                    old_hash,
                    entry["destinationIdentity"],
                )
                and leaf_matches(rollback_fd, slot, payload_paths, target, None, None)
            ):
                topology_error = completion_error or ReleaseError("TOPOLOGY_INVALID")
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    None,
                    (("PRIMARY", topology_error),),
                    True,
                )
            current = "promotion-exchange-unvalidated"
        if current == "promotion-exchange-unvalidated":
            if test_fault_enabled(
                root_path, "promotion-recovery-relocate-restore-before-precheck"
            ):
                rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
                fsync_rename_directories(stage_parent_fd, rollback_fd)
            if not leaf_matches(
                stage_parent_fd,
                stage_leaf,
                payload_paths,
                target,
                old_hash,
                entry["destinationIdentity"],
            ):
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    None,
                    (("PRIMARY", ReleaseError("RESTORE_OPERAND_INVALID")),),
                    True,
                )
            relocation_fault = test_fault_requested(
                root_path,
                "promotion-recovery-relocate-restore-to-slot",
                "promotion-recovery-relocate-restore-compound-fsync",
                "promotion-recovery-relocate-restore-quarantine-crash",
                "promotion-recovery-final-probe-oserror",
            )
            if relocation_fault is not None:
                rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
                fsync_rename_directories(stage_parent_fd, rollback_fd)
            recovery_mutation = test_fault_requested(
                root_path,
                "promotion-recovery-destination-same-inode-mutation",
                "promotion-recovery-destination-mutation-safe-crash",
            )
            if recovery_mutation is not None:
                mutate_leaf_bytes(stage_parent_fd, stage_leaf)
            try:
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                fsync_rename_directories(stage_parent_fd, live_parent_fd)
            except BaseException as recovery_error:
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    None,
                    (("PRIMARY", recovery_error),),
                )
            restored_hash, restored_identity = probe_leaf(
                live_parent_fd, live_leaf, payload_paths, target
            )
            if restored_hash == old_hash and restored_identity == entry["destinationIdentity"]:
                initial_errors: tuple[tuple[str, BaseException], ...] = ()
                if completion_error is not None:
                    initial_errors = ((
                        "PRIMARY",
                        ReleaseError(
                            f"{describe_exception(completion_error)} RESTORED_STATE_SAFE"
                        ),
                    ),)
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    None,
                    initial_errors,
                )
            reconcile_recovery_topology(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
                (new_hash, entry["sourceIdentity"]),
                (old_hash, entry["destinationIdentity"]),
                None,
                (("PRIMARY", ReleaseError("RESTORED_STATE_INVALID")),),
                True,
            )
        if current == "promotion-noreplace-unvalidated":
            if test_fault_enabled(root_path, "promotion-noreplace-recovery-relocate-live-to-slot"):
                rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                fsync_rename_directories(live_parent_fd, rollback_fd)
            try:
                rename_with_flag(live_parent_fd, live_leaf, stage_parent_fd, stage_leaf, "noreplace")
                fsync_rename_directories(live_parent_fd, stage_parent_fd)
                if not leaf_matches(live_parent_fd, live_leaf, payload_paths, target, None, None):
                    fail(f"OPERAND_SUBSTITUTION_REVERSAL_INVALID: {target}")
                if not leaf_matches(
                    stage_parent_fd,
                    stage_leaf,
                    payload_paths,
                    target,
                    new_hash,
                    entry["sourceIdentity"],
                ):
                    fail(f"OPERAND_SUBSTITUTION_REVERSAL_INVALID: {target}")
            except BaseException as recovery_error:
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    (new_hash, entry["sourceIdentity"]),
                    None,
                    None,
                    (("PRIMARY", recovery_error),),
                )
            fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
        if entry["original"] == "present" and current == "prepared":
            if test_fault_enabled(root_path, "promote-exchange-quarantined-source-crash"):
                candidate = quarantine_name(slot)
                rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, candidate, "noreplace")
                fsync_rename_directories(stage_parent_fd, rollback_fd)
                create_fault_regular_leaf(stage_parent_fd, stage_leaf)
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            if test_fault_enabled(root_path, "promote-exchange-live-symlink-crash"):
                create_fault_leaf(rollback_fd, "symlink", "fault-substitute")
                rename_with_flag(
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    "fault-substitute",
                    "exchange",
                )
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            round4_fault = test_fault_requested(
                root_path,
                "promote-exchange-same-inode-bytes-crash",
                "promote-exchange-symlink-crash",
                "promote-exchange-fifo-crash",
                "promote-exchange-special-crash",
                "promote-exchange-wrong-mode-crash",
                "promote-exchange-wrong-tree-crash",
                "promote-exchange-nonascii-wrong-tree-crash",
                "promote-exchange-directory-wrong-mode-crash",
            )
            if round4_fault is not None:
                if "same-inode-bytes" in round4_fault:
                    mutate_leaf_bytes(stage_parent_fd, stage_leaf)
                elif "wrong-tree" in round4_fault:
                    mutate_directory_tree(
                        stage_parent_fd,
                        stage_leaf,
                        "round4-ñ" if "nonascii" in round4_fault else "round4-unreviewed",
                    )
                elif "wrong-mode" in round4_fault:
                    mutate_leaf_mode(stage_parent_fd, stage_leaf)
                else:
                    kind = "symlink" if "symlink" in round4_fault else (
                        "fifo" if "fifo" in round4_fault else "special"
                    )
                    substitute_leaf_for_fault(stage_parent_fd, stage_leaf, kind, "fault-round4")
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            if test_fault_enabled(root_path, "promote-exchange-substitute-source-crash"):
                rename_with_flag(
                    stage_parent_fd, stage_leaf, stage_parent_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "exchange")
                os._exit(86)

            def validate_exchange() -> None:
                if test_fault_enabled(root_path, "promotion-post-exchange-inventory-error"):
                    fail(f"PROMOTION_POST_EXCHANGE_INVENTORY_FAILED: {target}")
                after_live, after_live_identity = inventory_leaf(
                    live_parent_fd, live_leaf, payload_paths, target, with_identity=True
                )
                after_stage, after_stage_identity = inventory_leaf(
                    stage_parent_fd, stage_leaf, payload_paths, target, with_identity=True
                )
                if (
                    after_live != new_hash
                    or after_live_identity != entry["sourceIdentity"]
                    or after_stage != old_hash
                    or after_stage_identity != entry["destinationIdentity"]
                    or test_fault_enabled(root_path, "promotion-post-exchange-mismatch")
                ):
                    fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")

            def precheck_exchange_reversal() -> None:
                if not leaf_matches(
                    stage_parent_fd,
                    stage_leaf,
                    payload_paths,
                    target,
                    old_hash,
                    entry["destinationIdentity"],
                ):
                    fail(f"PROMOTION_REVERSAL_OPERAND_INVALID: {target}")

            def validate_exchange_reversal() -> None:
                if not (
                    leaf_matches(
                        live_parent_fd,
                        live_leaf,
                        payload_paths,
                        target,
                        old_hash,
                        entry["destinationIdentity"],
                    )
                    and leaf_matches(
                        stage_parent_fd,
                        stage_leaf,
                        payload_paths,
                        target,
                        new_hash,
                        entry["sourceIdentity"],
                    )
                    and leaf_matches(rollback_fd, slot, payload_paths, target, None, None)
                ):
                    fail(f"PROMOTION_REVERSAL_STATE_INVALID: {target}")

            def secure_exchange_reversal() -> None:
                quarantine_unreviewed_live(
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    reviewed_live_states,
                )

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
                reversal_precheck=precheck_exchange_reversal,
                reversal_mutation=lambda: mutate_leaf_bytes(stage_parent_fd, stage_leaf),
                reversal_validator=validate_exchange_reversal,
                reversal_safety=secure_exchange_reversal,
            )
            current = "exchanged"
        if entry["original"] == "present" and current == "exchanged":
            rename_with_flag(stage_parent_fd, stage_leaf, rollback_fd, slot, "noreplace")
            test_crash(root_path, "promote-slot-crash-after-namespace")
            if test_fault_enabled(root_path, "promote-slot-same-inode-live-mutation-crash"):
                mutate_leaf_bytes(live_parent_fd, live_leaf)
                os._exit(86)
            fsync_rename_directories(stage_parent_fd, rollback_fd)
            slot_hash, slot_identity = inventory_leaf(
                rollback_fd, slot, payload_paths, target, with_identity=True
            )
            if slot_hash != old_hash or slot_identity != entry["destinationIdentity"]:
                fail(f"PROMOTION_ROLLBACK_SLOT_MISMATCH: {target}")
            current = "promoted"
        if entry["original"] == "absent" and current == "prepared":
            round4_fault = test_fault_requested(
                root_path,
                "promote-noreplace-same-inode-bytes-crash",
                "promote-noreplace-symlink-crash",
                "promote-noreplace-wrong-tree-crash",
            )
            if round4_fault is not None:
                if "same-inode-bytes" in round4_fault:
                    mutate_leaf_bytes(stage_parent_fd, stage_leaf)
                elif "wrong-tree" in round4_fault:
                    mutate_directory_tree(stage_parent_fd, stage_leaf)
                else:
                    substitute_leaf_for_fault(stage_parent_fd, stage_leaf, "symlink", "fault-round4")
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "noreplace")
                os._exit(86)
            if test_fault_enabled(root_path, "promote-noreplace-substitute-source-crash"):
                rename_with_flag(
                    stage_parent_fd, stage_leaf, stage_parent_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(stage_parent_fd, stage_leaf, live_parent_fd, live_leaf, "noreplace")
                os._exit(86)

            def validate_noreplace() -> None:
                if test_fault_enabled(root_path, "promotion-post-noreplace-inventory-error"):
                    fail(f"PROMOTION_POST_NOREPLACE_INVENTORY_FAILED: {target}")
                after_live, after_live_identity = inventory_leaf(
                    live_parent_fd, live_leaf, payload_paths, target, with_identity=True
                )
                if after_live != new_hash or after_live_identity != entry["sourceIdentity"]:
                    fail(f"PROMOTION_RACE_OR_TAMPER_DETECTED: {target}")

            def validate_noreplace_reversal() -> None:
                if not (
                    leaf_matches(live_parent_fd, live_leaf, payload_paths, target, None, None)
                    and leaf_matches(
                        stage_parent_fd,
                        stage_leaf,
                        payload_paths,
                        target,
                        new_hash,
                        entry["sourceIdentity"],
                    )
                    and leaf_matches(rollback_fd, slot, payload_paths, target, None, None)
                ):
                    fail(f"PROMOTION_REVERSAL_STATE_INVALID: {target}")

            def secure_noreplace_reversal() -> None:
                quarantine_unreviewed_live(
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    reviewed_live_states,
                )

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
                reversal_validator=validate_noreplace_reversal,
                reversal_safety=secure_noreplace_reversal,
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
    for name in rollback_names - allowed_rollback_names:
        if quarantine_slot(name) is None:
            fail("ROLLBACK_UNKNOWN_PATH")
        validate_quarantine_residue(rollback_fd, name)
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
        stage_parent_fd, stage_leaf, live_parent_fd, live_leaf,
        _stage_hash, _stage_identity, _live_hash, _live_identity, _slot_hash, _slot_identity,
    ) = unit_inventories(stage_public_fd, live_public_fd, rollback_fd, index)
    try:
        reviewed_live_states = (
            (new_hash, entry["sourceIdentity"]),
            (old_hash, entry["destinationIdentity"]),
        )
        if current == "rolled-back":
            return
        if current == "recovery-in-progress":
            reconcile_recovery_topology(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
                None,
                (new_hash, entry["sourceIdentity"]),
                (old_hash, entry["destinationIdentity"])
                    if entry["original"] == "present" else None,
            )
        if current == "rollback-exchange-unvalidated":
            if test_fault_enabled(
                root_path, "rollback-recovery-relocate-restore-before-precheck"
            ):
                rename_with_flag(rollback_fd, slot, stage_parent_fd, stage_leaf, "noreplace")
                fsync_rename_directories(rollback_fd, stage_parent_fd)
            if not leaf_matches(
                rollback_fd,
                slot,
                payload_paths,
                target,
                new_hash,
                entry["sourceIdentity"],
            ):
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    (("PRIMARY", ReleaseError("RESTORE_OPERAND_INVALID")),),
                    True,
                )
            if test_fault_enabled(root_path, "rollback-recovery-relocate-restore-to-stage"):
                rename_with_flag(rollback_fd, slot, stage_parent_fd, stage_leaf, "noreplace")
                fsync_rename_directories(rollback_fd, stage_parent_fd)
            try:
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                fsync_rename_directories(rollback_fd, live_parent_fd)
            except BaseException as recovery_error:
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                    (("PRIMARY", recovery_error),),
                )
            restored_hash, restored_identity = probe_leaf(
                live_parent_fd, live_leaf, payload_paths, target
            )
            if restored_hash == new_hash and restored_identity == entry["sourceIdentity"]:
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    (old_hash, entry["destinationIdentity"]),
                )
            reconcile_recovery_topology(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
                None,
                (new_hash, entry["sourceIdentity"]),
                (old_hash, entry["destinationIdentity"]),
                (("PRIMARY", ReleaseError("RESTORED_STATE_INVALID")),),
                True,
            )
        if current == "rollback-noreplace-unvalidated":
            if test_fault_enabled(
                root_path,
                "rollback-noreplace-recovery-relocate-slot-before-absence-precheck",
            ):
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "noreplace")
                fsync_rename_directories(rollback_fd, live_parent_fd)
            if not leaf_matches(live_parent_fd, live_leaf, payload_paths, target, None, None):
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    None,
                    (("PRIMARY", ReleaseError("LIVE_ABSENCE_INVALID")),),
                )
            if test_fault_enabled(root_path, "rollback-noreplace-recovery-relocate-slot-to-live"):
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "noreplace")
                fsync_rename_directories(rollback_fd, live_parent_fd)
            if not leaf_matches(
                rollback_fd,
                slot,
                payload_paths,
                target,
                new_hash,
                entry["sourceIdentity"],
            ):
                test_crash(root_path, "rollback-noreplace-recovery-safe-crash")
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    None,
                )
            try:
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "noreplace")
                fsync_rename_directories(rollback_fd, live_parent_fd)
            except BaseException as recovery_error:
                reconcile_recovery_topology(
                    root_path,
                    stage_parent_fd,
                    stage_leaf,
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    None,
                    (new_hash, entry["sourceIdentity"]),
                    None,
                    (("PRIMARY", recovery_error),),
                )
            restored_hash, restored_identity = probe_leaf(
                live_parent_fd, live_leaf, payload_paths, target
            )
            if restored_hash == new_hash and restored_identity == entry["sourceIdentity"]:
                fail(f"OPERAND_SUBSTITUTION_RECOVERED: {target}")
            reconcile_recovery_topology(
                root_path,
                stage_parent_fd,
                stage_leaf,
                live_parent_fd,
                live_leaf,
                rollback_fd,
                slot,
                payload_paths,
                target,
                None,
                (new_hash, entry["sourceIdentity"]),
                None,
                (("PRIMARY", ReleaseError("RESTORED_STATE_INVALID")),),
                True,
            )
        if current != "promoted":
            fail(f"ROLLBACK_STATE_INVALID: {target}")
        if entry["original"] == "present":
            if test_fault_enabled(root_path, "rollback-exchange-quarantined-destination-crash"):
                candidate = quarantine_name(slot)
                rename_with_flag(rollback_fd, slot, rollback_fd, candidate, "noreplace")
                fsync_rename_directories(rollback_fd, rollback_fd)
                create_fault_regular_leaf(rollback_fd, slot)
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            if test_fault_enabled(root_path, "rollback-exchange-live-symlink-crash"):
                create_fault_leaf(rollback_fd, "symlink", "fault-substitute")
                rename_with_flag(
                    live_parent_fd,
                    live_leaf,
                    rollback_fd,
                    "fault-substitute",
                    "exchange",
                )
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            round4_fault = test_fault_requested(
                root_path,
                "rollback-exchange-same-inode-bytes-crash",
                "rollback-exchange-symlink-crash",
                "rollback-exchange-fifo-crash",
                "rollback-exchange-special-crash",
                "rollback-exchange-wrong-mode-crash",
                "rollback-exchange-wrong-tree-crash",
                "rollback-exchange-directory-wrong-mode-crash",
            )
            if round4_fault is not None:
                if "same-inode-bytes" in round4_fault:
                    mutate_leaf_bytes(rollback_fd, slot)
                elif "wrong-tree" in round4_fault:
                    mutate_directory_tree(rollback_fd, slot)
                elif "wrong-mode" in round4_fault:
                    mutate_leaf_mode(rollback_fd, slot)
                else:
                    substitute_leaf_for_fault(
                        rollback_fd,
                        slot,
                        "symlink" if "symlink" in round4_fault else (
                            "fifo" if "fifo" in round4_fault else "special"
                        ),
                        "fault-substitute",
                    )
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                os._exit(86)
            if test_fault_enabled(root_path, "rollback-exchange-substitute-source-crash"):
                rename_with_flag(rollback_fd, slot, rollback_fd, "fault-substitute", "exchange")
                rename_with_flag(rollback_fd, slot, live_parent_fd, live_leaf, "exchange")
                os._exit(86)

            def validate_exchange() -> None:
                if test_fault_enabled(root_path, "rollback-post-exchange-inventory-error"):
                    fail(f"ROLLBACK_POST_EXCHANGE_INVENTORY_FAILED: {target}")
                restored, restored_identity = inventory_leaf(
                    live_parent_fd, live_leaf, payload_paths, target, with_identity=True
                )
                displaced, displaced_identity = inventory_leaf(
                    rollback_fd, slot, payload_paths, target, with_identity=True
                )
                if (
                    restored != old_hash
                    or restored_identity != entry["destinationIdentity"]
                    or displaced != new_hash
                    or displaced_identity != entry["sourceIdentity"]
                    or test_fault_enabled(root_path, "rollback-post-exchange-mismatch")
                ):
                    fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")

            def precheck_exchange_reversal() -> None:
                if not leaf_matches(
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    new_hash,
                    entry["sourceIdentity"],
                ):
                    fail(f"ROLLBACK_REVERSAL_OPERAND_INVALID: {target}")

            def validate_exchange_reversal() -> None:
                if not (
                    leaf_matches(stage_parent_fd, stage_leaf, payload_paths, target, None, None)
                    and leaf_matches(
                        live_parent_fd,
                        live_leaf,
                        payload_paths,
                        target,
                        new_hash,
                        entry["sourceIdentity"],
                    )
                    and leaf_matches(
                        rollback_fd,
                        slot,
                        payload_paths,
                        target,
                        old_hash,
                        entry["destinationIdentity"],
                    )
                ):
                    fail(f"ROLLBACK_REVERSAL_STATE_INVALID: {target}")

            def secure_exchange_reversal() -> None:
                quarantine_unreviewed_live(
                    live_parent_fd,
                    live_leaf,
                    stage_parent_fd,
                    stage_leaf,
                    payload_paths,
                    target,
                    reviewed_live_states,
                )

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
                reversal_precheck=precheck_exchange_reversal,
                reversal_mutation=lambda: mutate_leaf_bytes(rollback_fd, slot),
                reversal_validator=validate_exchange_reversal,
                reversal_safety=secure_exchange_reversal,
            )
        else:
            round4_fault = test_fault_requested(
                root_path,
                "rollback-noreplace-same-inode-bytes-crash",
                "rollback-noreplace-symlink-crash",
                "rollback-noreplace-fifo-crash",
                "rollback-noreplace-special-crash",
                "rollback-noreplace-wrong-mode-crash",
                "rollback-noreplace-wrong-tree-crash",
                "rollback-noreplace-directory-wrong-mode-crash",
            )
            if round4_fault is not None:
                if "same-inode-bytes" in round4_fault:
                    mutate_leaf_bytes(live_parent_fd, live_leaf)
                elif "wrong-tree" in round4_fault:
                    mutate_directory_tree(live_parent_fd, live_leaf)
                elif "wrong-mode" in round4_fault:
                    mutate_leaf_mode(live_parent_fd, live_leaf)
                else:
                    kind = "symlink" if "symlink" in round4_fault else (
                        "fifo" if "fifo" in round4_fault else "special"
                    )
                    create_fault_leaf(rollback_fd, kind, "fault-substitute")
                    rename_with_flag(
                        live_parent_fd,
                        live_leaf,
                        rollback_fd,
                        "fault-substitute",
                        "exchange",
                    )
                rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                os._exit(86)
            if test_fault_enabled(root_path, "rollback-noreplace-substitute-source-crash"):
                rename_with_flag(
                    live_parent_fd, live_leaf, rollback_fd, "fault-substitute", "exchange"
                )
                rename_with_flag(live_parent_fd, live_leaf, rollback_fd, slot, "noreplace")
                os._exit(86)

            def validate_noreplace() -> None:
                slot_hash, slot_identity = inventory_leaf(
                    rollback_fd, slot, payload_paths, target, with_identity=True
                )
                if (
                    inventory_leaf(live_parent_fd, live_leaf, payload_paths, target) is not None
                    or slot_hash != new_hash
                    or slot_identity != entry["sourceIdentity"]
                ):
                    fail(f"ROLLBACK_RESTORE_MISMATCH: {target}")

            def precheck_noreplace_reversal() -> None:
                if not leaf_matches(
                    rollback_fd,
                    slot,
                    payload_paths,
                    target,
                    new_hash,
                    entry["sourceIdentity"],
                ):
                    fail(f"ROLLBACK_REVERSAL_OPERAND_INVALID: {target}")

            def validate_noreplace_reversal() -> None:
                if not (
                    leaf_matches(stage_parent_fd, stage_leaf, payload_paths, target, None, None)
                    and leaf_matches(
                        live_parent_fd,
                        live_leaf,
                        payload_paths,
                        target,
                        new_hash,
                        entry["sourceIdentity"],
                    )
                    and leaf_matches(rollback_fd, slot, payload_paths, target, None, None)
                ):
                    fail(f"ROLLBACK_REVERSAL_STATE_INVALID: {target}")

            def secure_noreplace_reversal() -> None:
                quarantine_unreviewed_live(
                    live_parent_fd,
                    live_leaf,
                    stage_parent_fd,
                    stage_leaf,
                    payload_paths,
                    target,
                    reviewed_live_states,
                )

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
                reversal_precheck=precheck_noreplace_reversal,
                reversal_validator=validate_noreplace_reversal,
                reversal_safety=secure_noreplace_reversal,
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
            "promotion-complete-unvalidated",
            "promotion-noreplace-unvalidated",
            "recovery-in-progress",
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
        target, slot, payload_paths = UNITS[index]
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
                bool(quarantine_names(rollback_fd, slot)),
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


def validate_web_deployment_readiness_bound(root_fd: int) -> None:
    if (
        not isinstance(WEB_DEPLOYMENT_READINESS_SHA256, str)
        or SHA256.fullmatch(WEB_DEPLOYMENT_READINESS_SHA256) is None
    ):
        fail("WEB_DEPLOYMENT_GATES_INCOMPLETE")
    try:
        raw = read_fixed_file(root_fd, "release/web-deployment-readiness.json")
        readiness = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, ReleaseError) as error:
        raise ReleaseError("WEB_DEPLOYMENT_GATES_INCOMPLETE") from error
    if hashlib.sha256(raw).hexdigest() != WEB_DEPLOYMENT_READINESS_SHA256:
        fail("WEB_DEPLOYMENT_GATES_INCOMPLETE")
    exact_key_set(
        readiness,
        ("schemaVersion", "artifactKind", "status", "reviewedAt", "reviewedInputs", "scope"),
        "WEB_DEPLOYMENT_READINESS",
    )
    if readiness != {
        "schemaVersion": 2,
        "artifactKind": "cabohealth-web-deployment-readiness-v2",
        "status": "ready",
        "reviewedAt": "2026-08-25",
        "reviewedInputs": {
            "miniappCapsuleSha256": CAPSULE_SHA256,
            "privacySha256": FINAL_LEGAL_SHA256["privacy"],
            "marketingSha256": MARKETING_LANDING_SHA256,
            "aasaSha256": hashlib.sha256(canonical_aasa_bytes()).hexdigest(),
        },
        "scope": {
            "localAssemblyAuthorized": True,
            "publicPromotionAuthorized": False,
            "deployed": False,
            "appleReady": False,
        },
    }:
        fail("WEB_DEPLOYMENT_GATES_INCOMPLETE")


def canonical_aasa_bytes() -> bytes:
    return (json.dumps({
        "applinks": {
            "details": [{
                "appIDs": [APP_ID],
                "components": [
                    {"/": "/apps/client-resources/launch/", "exclude": True},
                    {"/": "/apps/client-resources/launch/*", "exclude": True},
                    {"/": "/apps/client-resources/api/", "exclude": True},
                    {"/": "/apps/client-resources/api/*", "exclude": True},
                    {"/": "/apps/app-review/", "exclude": True},
                    {"/": "/apps/app-review/*", "exclude": True},
                    {"/": "/apps/client-resources/"},
                    {"/": "/apps/client-resources/*", "exclude": True},
                    {"/": "/apps/*/"},
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
    marketing_path = "web-hosting/cabohealth.org/app/index.html"
    marketing_bytes = captured_inputs[marketing_path]
    if (
        len(marketing_bytes) != MARKETING_LANDING_SIZE
        or hashlib.sha256(marketing_bytes).hexdigest() != MARKETING_LANDING_SHA256
    ):
        fail("MARKETING_LANDING_PIN_MISMATCH")
    assert_static_web_policy("app/index.html", marketing_bytes)
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
    expected_buffers["app/index.html"] = marketing_bytes
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

        immutable_name = f"web-artifacts.{transport['releaseId']}.json"
        immutable = stat_if_present(release_fd, immutable_name)
        if immutable is None:
            create_file(
                release_fd,
                immutable_name,
                manifest_bytes,
                f"release/{immutable_name}",
                0o444,
            )
        else:
            if (
                not stat.S_ISREG(immutable.st_mode)
                or immutable.st_uid != os.geteuid()
                or immutable.st_nlink != 1
                or immutable.st_mode & 0o777 != 0o444
            ):
                fail("WEB_IMMUTABLE_ARTIFACT_MANIFEST_COLLISION")
            immutable_fd = os.open(immutable_name, OPEN_FILE_READ, dir_fd=release_fd)
            try:
                before = os.fstat(immutable_fd)
                contents = read_all(immutable_fd)
                after = os.fstat(immutable_fd)
                if (
                    contents != manifest_bytes
                    or (before.st_dev, before.st_ino, before.st_size, before.st_mode, before.st_uid, before.st_nlink)
                    != (after.st_dev, after.st_ino, after.st_size, after.st_mode, after.st_uid, after.st_nlink)
                ):
                    fail("WEB_IMMUTABLE_ARTIFACT_MANIFEST_COLLISION")
            finally:
                os.close(immutable_fd)

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
        validate_web_deployment_readiness_bound(root_fd)
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
    if len(argv) == 3 and argv[1] == "publish-hosting-overlays":
        sys.stdout.buffer.write(canonical_json(publish_hosting_overlays(argv[2])))
        return 0
    if len(argv) == 3 and argv[1] == "rollback-hosting-overlays":
        sys.stdout.buffer.write(canonical_json(rollback_hosting_overlays(argv[2])))
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
    fail("Usage: secure_web_release.py <root-identity|capture-assembly-snapshot|publish-hosting-overlays|rollback-hosting-overlays|materialize-release|materialize-stage|capture-reviewed-inputs|promote-next|inventory-live> <owned-root> [release-id]; secure_web_release.py rollback-next <owned-root> <release-id> <expected-index>")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except ReleaseError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

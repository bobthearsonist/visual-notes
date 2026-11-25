#!/usr/bin/env python3
"""Conform + pin agent-authored visual-notes sidecars (Engine A).

Triggered by a PostToolUse hook on Write|Edit of `{basename}-overview.json`
sidecars inside an Obsidian vault. In the dual-engine model:

- Engine A (agent): the agent authors a graph in the friendly/loose shape; this
  script coerces it to the visual-notes plugin's STRICT sidecar schema
  (mirrors plugins/obsidian-plugin/src/schema.ts) and stamps `_pinned: true`.
  The plugin's LLM extractor sees the pin and stands down, so the agent's
  curated graph is what the ```visual-notes``` fence renders.
- Engine B (plugin): driven separately via the plugin command
  `visual-daily-notes:regenerate-current-note-force` (overrides the pin).

The write-back is a plain filesystem write (NOT a tool call), so it does not
re-trigger the PostToolUse hook. The fence renders the JSON sidecar directly, so
no HTML/iframe generation is needed here anymore.

Manual run: python regenerate.py /path/to/{basename}-overview.json
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# --- schema constants (mirror plugins/obsidian-plugin/src/schema.ts) ---
NODE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NODE_CLASS_RE = re.compile(r"^(system|task|decision) (completed|active|context|blocked)$")
EDGE_CLASSES = {"strong-edge", "weak-edge"}
NODE_TYPES = ("system", "task", "decision")
NODE_STATUSES = ("completed", "active", "context", "blocked")
KIND_VALUES = {"daily-overview", "session-whiteboard", "rollup"}
ALLOWED_TOP = ("kind", "title", "header", "subtitle", "nodes", "edges")
X_MIN, X_MAX = -200, 5000
Y_MIN, Y_MAX = -200, 3000
MAX_NODES, MAX_EDGES = 50, 100

# Provenance stamps (schema-legal fields: `_extractedBy` = producer@semver,
# `_schemaVersion` = semver). AGENT_PRODUCER is the Engine-A (agent) producer
# and version, independent of Engine B (the plugin stamps `obsidian-plugin@x`).
# So a sidecar's `_extractedBy` records WHICH engine wrote it and that engine's
# own version. SCHEMA_VERSION mirrors the plugin's SETTINGS_VERSION — the shared
# sidecar-format version (single-sourcing tracked in visual-notes#31).
AGENT_PRODUCER = "visual-notes-agent@1.0.0"
SCHEMA_VERSION = "0.1.0"

OVERVIEW_SUFFIX = "-overview.json"


def emit(message: str) -> None:
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": message}
    }))


def kebab(value: object) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return slug or "node"


def clamp_int(value: object, lo: int, hi: int) -> int | None:
    try:
        num = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return int(max(lo, min(hi, num)))


def vault_root_for(path: Path) -> Path | None:
    for parent in (path, *path.parents):
        if (parent / ".obsidian").exists():
            return parent
    return None


# The Obsidian plugin's id; its settings live in <vault>/.obsidian/plugins/<id>/data.json.
PLUGIN_ID = "visual-daily-notes"


def _run(args: list[str]) -> str | None:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def _read_mapping(path: Path) -> dict | None:
    """Parse a JSON or YAML file into a dict. YAML needs PyYAML or yq; returns
    None when the file is missing, unparsable or not a mapping."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    data: object = None
    if path.suffix.lower() == ".json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
    else:
        try:
            import yaml  # type: ignore[import-not-found]
        except ImportError:
            yaml = None
        if yaml is not None:
            try:
                data = yaml.safe_load(text)
            except yaml.YAMLError:
                return None
        elif shutil.which("yq"):
            out = _run(["yq", "-o=json", ".", str(path)])
            try:
                data = json.loads(out) if out else None
            except json.JSONDecodeError:
                return None
    return data if isinstance(data, dict) else None


def load_configured_folders(vault_root: Path) -> list[Path]:
    """Note folders from the per-machine config file named by the plugin's
    `agentConfigPath` setting. That file's `obsidian:` block holds `vault_path`
    and `contexts.<name>.daily_folder` / `ai_session_folders`, so folder names
    live only in machine config, never in this repo. Only that one setting is
    read from data.json, which also holds secrets. Returns [] when nothing is
    configured or readable."""
    settings = _read_mapping(vault_root / ".obsidian" / "plugins" / PLUGIN_ID / "data.json") or {}
    config_path = str(settings.get("agentConfigPath") or "").strip()
    if not config_path:
        return []
    obsidian = (_read_mapping(Path(config_path).expanduser()) or {}).get("obsidian")
    if not isinstance(obsidian, dict):
        return []
    vault_path = Path(str(obsidian.get("vault_path") or vault_root)).expanduser()
    folders: list[Path] = []
    for context in (obsidian.get("contexts") or {}).values():
        if not isinstance(context, dict):
            continue
        names = [context.get("daily_folder"), *(context.get("ai_session_folders") or [])]
        folders.extend((vault_path / str(name)).resolve() for name in names if name)
    return folders


def within_configured_folder(path: Path, folders: list[Path]) -> bool:
    rp = path.resolve()
    return any(folder == rp or folder in rp.parents for folder in folders)


def conform(sidecar: dict) -> tuple[dict, list[str]]:
    """Coerce a loose agent-authored sidecar into the plugin's strict schema."""
    warnings: list[str] = []
    out: dict = {}

    # Top-level: whitelist allowed keys; validate the few that are constrained.
    for key in ALLOWED_TOP:
        if key not in sidecar or key in ("nodes", "edges"):
            continue
        val = sidecar[key]
        if key == "kind":
            if val in KIND_VALUES:
                out[key] = val
            else:
                warnings.append(f"dropped invalid kind={val!r}")
        elif isinstance(val, str):
            out[key] = val
        else:
            warnings.append(f"dropped non-string {key}")

    raw_nodes = sidecar.get("nodes") or []
    raw_edges = sidecar.get("edges") or []
    if not isinstance(raw_nodes, list):
        raw_nodes = []
    if not isinstance(raw_edges, list):
        raw_edges = []

    # Nodes -----------------------------------------------------------------
    nodes: list[dict] = []
    id_map: dict[str, str] = {}
    used_ids: set[str] = set()

    for index, node in enumerate(raw_nodes[:MAX_NODES]):
        data = node.get("data") if isinstance(node, dict) else None
        data = dict(data) if isinstance(data, dict) else {}
        original_id = data.get("id") or data.get("label") or f"node-{index + 1}"

        nid = kebab(original_id)
        base, n = nid, 2
        while nid in used_ids:
            nid = f"{base}-{n}"
            n += 1
        used_ids.add(nid)
        # Map every spelling the edges might reference back to the final id.
        id_map[str(original_id)] = nid
        if data.get("id") is not None:
            id_map[str(data["id"])] = nid

        label = str(data.get("label") or original_id).strip() or nid
        data["id"] = nid
        data["label"] = label

        cls = str(node.get("classes", "")).strip() if isinstance(node, dict) else ""
        if not NODE_CLASS_RE.match(cls):
            parts = cls.split()
            node_type = next((p for p in parts if p in NODE_TYPES), "task")
            status = next((p for p in parts if p in NODE_STATUSES), "context")
            new_cls = f"{node_type} {status}"
            if cls:
                warnings.append(f"node {nid!r} class {cls!r} -> {new_cls!r}")
            cls = new_cls

        pos = node.get("position") if isinstance(node, dict) else None
        pos = pos if isinstance(pos, dict) else {}
        x = clamp_int(pos.get("x"), X_MIN, X_MAX)
        y = clamp_int(pos.get("y"), Y_MIN, Y_MAX)
        if x is None or y is None:
            col, row = len(nodes) % 5, len(nodes) // 5
            x, y = 120 + col * 180, 120 + row * 160
            warnings.append(f"node {nid!r} position assigned ({x},{y})")

        nodes.append({"data": data, "classes": cls, "position": {"x": x, "y": y}})

    if len(raw_nodes) > MAX_NODES:
        warnings.append(f"truncated nodes {len(raw_nodes)} -> {MAX_NODES}")

    # Edges -----------------------------------------------------------------
    edges: list[dict] = []
    node_ids = {node["data"]["id"] for node in nodes}
    dropped = 0

    for edge in raw_edges[:MAX_EDGES]:
        data = edge.get("data") if isinstance(edge, dict) else None
        data = dict(data) if isinstance(data, dict) else {}
        source = id_map.get(str(data.get("source")), kebab(data.get("source", "")))
        target = id_map.get(str(data.get("target")), kebab(data.get("target", "")))
        if source not in node_ids or target not in node_ids:
            dropped += 1
            continue
        data["source"] = source
        data["target"] = target
        data["label"] = str(data.get("label") or "").strip() or "→"
        edge_out: dict = {"data": data}
        cls = edge.get("classes") if isinstance(edge, dict) else None
        if cls in EDGE_CLASSES:
            edge_out["classes"] = cls  # else omit (schema allows no class)
        edges.append(edge_out)

    if dropped:
        warnings.append(f"dropped {dropped} edge(s) with unknown endpoints")
    if len(raw_edges) > MAX_EDGES:
        warnings.append(f"truncated edges {len(raw_edges)} -> {MAX_EDGES}")

    out["nodes"] = nodes
    out["edges"] = edges
    out["_pinned"] = True
    out["_extractedBy"] = AGENT_PRODUCER
    out["_schemaVersion"] = SCHEMA_VERSION
    return out, warnings


def resolve_sidecar_path() -> Path | None:
    """argv[1] wins for manual runs; otherwise read the hook event from stdin."""
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    if sys.stdin.isatty():
        return None
    raw = sys.stdin.read().strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        emit(f"visual-notes conform: malformed hook input JSON: {exc}")
        return None
    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    return Path(file_path) if file_path else None


def main() -> int:
    sidecar_path = resolve_sidecar_path()
    if sidecar_path is None:
        return 0

    # Only act on overview sidecars inside an Obsidian vault and, when the
    # vault's plugin settings name a config file, inside a folder it lists.
    if not sidecar_path.name.endswith(OVERVIEW_SUFFIX):
        return 0
    vault_root = vault_root_for(sidecar_path)
    if vault_root is None:
        return 0
    folders = load_configured_folders(vault_root)
    if folders and not within_configured_folder(sidecar_path, folders):
        return 0
    if not sidecar_path.exists():
        emit(f"visual-notes conform: sidecar not found at {sidecar_path}")
        return 0

    try:
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        emit(f"visual-notes conform: {sidecar_path.name} is not valid JSON: {exc}")
        return 0
    if not isinstance(sidecar, dict):
        emit(f"visual-notes conform: {sidecar_path.name} is not a JSON object")
        return 0

    # The conformed sidecar is always written back, including on re-runs.
    conformed, warnings = conform(sidecar)
    if not conformed["nodes"]:
        emit(f"visual-notes conform: {sidecar_path.name} has no usable nodes; left as-is")
        return 0

    sidecar_path.write_text(
        json.dumps(conformed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    summary = (
        f"visual-notes conform: {sidecar_path.name} pinned "
        f"({len(conformed['nodes'])} nodes, {len(conformed['edges'])} edges)"
    )
    if warnings:
        summary += " — " + "; ".join(warnings[:6])
        if len(warnings) > 6:
            summary += f"; (+{len(warnings) - 6} more)"
    emit(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())

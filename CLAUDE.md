# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A collection of **Claude Code agent skills**. This is a content + scripts repository, not a buildable application: there is no build step, test suite, or linter. Each skill is a self-contained package under `skills/<skill-name>/` that Claude Code loads on demand when its `description` matches a user request.

## Skill package structure

```
skills/<skill-name>/
├── SKILL.md            # required — the skill itself, what Claude reads
├── scripts/            # optional — executable helpers invoked from the skill
└── docs/              # optional — large docs loaded on demand, not by default
```

`SKILL.md` must begin with YAML frontmatter:

```yaml
---
name: <skill-name>
description: <one-line, in the user's language — this string is what triggers the skill>
---
```

The body is the skill's instructions. Keep it the single source of truth for that skill; push large reference material into `docs/` and load it lazily from there rather than bloating `SKILL.md`.

## Install path convention (important)

Skills are authored to be **location-agnostic**: scripts locate their own assets via `__dirname` (e.g. `path.join(__dirname, '..', 'config.json')`) rather than hardcoded `~/...` paths, so a skill works no matter where the user installs it. `SKILL.md` documents script paths relative to the skill package (written as `<skill>/scripts/...`) and the agent resolves them against the actual install location at invoke time. When testing a skill, install it wherever the user keeps skills — copy or symlink `skills/<skill-name>` into the target directory — then invoke. Skills that need credentials read them from a `config.json` in the skill package root (agent-managed); make sure that file exists before invoking.

## Cross-cutting conventions

The `apipost-open-api` skill establishes patterns to follow for any new skill that calls an authenticated external API:

- **Secrets and project IDs live in an agent-managed `config.json`** in the skill package root (e.g. `api_key`, `project_id`). The agent writes this file on first use (prompting the user); it is never committed. Template lives at `config.example.json` in the skill package.
- **Scripts locate config via `__dirname`**, not via the user's home directory or a hardcoded install path — so the skill is portable to any install location.
- **Check readiness with a script, not by reading the config**: `scripts/docs-check.js` validates required fields are set and non-empty without printing their values.
- **Scripts read `config.json` themselves**: helper scripts (e.g. `docs-export.js`, `docs-list.js`) load `config.json` internally, so the agent invokes them directly — the token never enters the conversation context.
- **Load before curl**: for ad-hoc `curl`, load values into shell vars from `config.json` via a `node -e` one-liner consumed by `eval`, so the token doesn't appear in command-line args or captured stdout.
- **Prefer helper scripts over raw API calls** when browsing/listing/exporting: scripts reshape flat JSON into compact, readable output (or render full Markdown docs), saving tokens versus dumping raw responses.

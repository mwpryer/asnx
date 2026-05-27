<p align="center">
  <img src="docs/asx.png" alt="asx" width="220">
</p>

<h1 align="center">asx</h1>

<p align="center">A schema-driven Asana CLI with first-class AI agent support.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mwp13/asx"><img src="https://img.shields.io/npm/v/@mwp13/asx" alt="npm version"></a>
  <a href="skills/asx/SKILL.md"><img src="https://img.shields.io/badge/agent-ready-brightgreen" alt="agent-ready"></a>
  <a href="https://github.com/mwpryer/asx/stargazers"><img src="https://img.shields.io/github/stars/mwpryer/asx" alt="GitHub stars"></a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="asx demo" width="800">
</p>

> [!IMPORTANT]
> This project is under active development. Expect breaking changes before v1.0.

## Why asx

asx is generated from the Asana OpenAPI spec, not hand-written. Commands come straight from the schema, so when Asana ships a new endpoint you can pull it in yourself with `asx schema update` instead of waiting on a release. The same schema makes the whole surface introspectable, with every command, flag, and response shape described in JSON.

asx was built for agents from the start. `--json` takes the raw API payload one-to-one. `--opt-fields` keeps responses from swamping an agent's context. `--dry-run` shows the exact request before it is sent, and flags are checked against the OpenAPI types, so bad calls fail locally instead of at the API.

## Installation

Requires **Node.js 24+** and an [Asana Personal Access Token](https://developers.asana.com/docs/personal-access-token).

```bash
npm install -g @mwp13/asx
```

## Quick start

```bash
# Store a named account (token is read from stdin)
asx auth add work
# Or set a token via environment variable
export ASANA_TOKEN=<pat>

# Build the command index
asx schema update

# Interact with Asana
asx tasks search <workspace-gid> --text "bugfix"
asx tasks create --name "migration" --workspace <workspace-gid> --projects <project-gid>
```

Stored accounts live in `~/.config/asx/accounts.json` (respects `XDG_CONFIG_HOME`).

## Agent skill

asx ships with an [agent skill](https://skills.sh) that gives coding agents the small bit of context they need to drive asx and introspect commands themselves.

```bash
npx skills add mwpryer/asx
```

## How it works

Every command follows the same shape:

```
asx <entity> <action> [<gid>] [--flags...]
```

The CLI stays flat. Sub-resources and verbs are spelled out as their own actions, for example `asx tasks subtasks`, `asx tasks create-subtasks`, and `asx tasks add-followers`.

Use `--help` at every level to discover what is available:

```bash
asx --help
asx tasks --help
asx tasks create --help
asx tasks create-subtasks --help
```

### Designed for agents

What makes it usable for agents:

- **Introspectable.** `asx describe [entity] [action]` emits the command surface as JSON, so an agent can build a call without scraping `--help`.
- **Stable JSON envelope.** Every response is JSON on stdout. Errors go to stderr in the same shape.
- **Safe planning.** `--dry-run` returns the exact HTTP request that would be sent, so the agent can preview before sending.
- **Schema-validated input.** Flags are generated and validated against the OpenAPI types, so bad input is rejected before the request goes out.

## Auth resolution

`--account <name>` > `ASANA_TOKEN` env var > single stored account.

`asx auth add <name>` reads the token from stdin (input hidden on TTY, pipe-friendly).

## Key flags

| Flag               | Description                                      |
| ------------------ | ------------------------------------------------ |
| `--account <name>` | Account to use for this request                  |
| `--opt-fields a,b` | Comma-separated fields to return                 |
| `--dry-run`        | Return the built HTTP request without sending it |
| `--json '{...}'`   | Raw JSON body (replaces individual value flags)  |
| `--limit N`        | Page size for list commands                      |
| `--offset <token>` | Pagination cursor from a previous response       |

## Output

Commands emit a JSON envelope to stdout on success:

```bash
asx tasks search <workspace-gid> --text "migration" --opt-fields name,due_on
```

```json
{
  "meta": {
    "command": "tasks.search",
    "status": 200,
    "nextPage": null
  },
  "data": [ ... ]
}
```

`data` is the unwrapped Asana payload, either an object for single resources or an array for lists. `nextPage` is a pagination offset or `null`; pass it back as `--offset`.

Errors go to stderr:

```json
{
  "error": {
    "status": 400,
    "message": "...",
    "help": "..."
  }
}
```

## Licence

[MIT](LICENSE)

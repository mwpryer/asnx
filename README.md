# asx

A schema-driven Asana CLI with first-class AI agent support.

[![npm version](https://img.shields.io/npm/v/@mwp13/asx)](https://www.npmjs.com/package/@mwp13/asx)

> [!IMPORTANT]
> This project is under active development. Expect breaking changes before v1.0.

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
asx tasks search "bugfix" --workspace <workspace-gid>
asx tasks create --name "migration" --project <project-gid>
```

Stored accounts live in `~/.config/asx/accounts.json` (respects `XDG_CONFIG_HOME`).

## Agent skill

asx ships with an [agent skill](https://skills.sh) that gives AI coding agents full context on every command, flag, and workflow.

```bash
npx skills add mwpryer/asx
```

## How it works

asx compiles the Asana OpenAPI spec and generates every command from it. Entities, actions, and flags always match the REST API, so there is no hand-written command surface to drift out of sync.

```
asx <entity> <action> [<gid>] [--flags...]
```

The CLI is always flat: `asx <entity> <action>`. Sub-resource and verb actions stay explicit, for example `asx tasks subtasks`, `asx tasks create-subtasks`, and `asx tasks add-followers`.

### Designed for agents

Every surface is structured and predictable, which makes asx a great fit for LLM-driven workflows:

- **Introspectable.** `asx describe [entity] [action]` emits the full command surface as JSON, so agents can plan without scraping `--help`.
- **Stable JSON envelope.** Every response (success or error) is a parseable JSON envelope on stdout/stderr.
- **Safe planning.** `--dry-run` returns the exact HTTP request that would be sent, so agents can reason about an action before committing to it.
- **Schema-validated input.** Flags are generated and validated against the OpenAPI types, so malformed calls fail fast with a structured error.

Use `--help` at every level to discover what is available:

```bash
asx --help
asx tasks --help
asx tasks create --help
asx tasks create-subtasks --help
```

### Auth resolution

`--account <name>` > `ASANA_TOKEN` env var > single stored account.

`asx auth add <name>` reads the token from stdin (input hidden on TTY, pipe-friendly).

### Key flags

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

```json
{
  "meta": {
    "command": "tasks.list",
    "status": 200,
    "nextPage": null
  },
  "data": { ... }
}
```

`data` is the unwrapped Asana payload: an object for single resources, an array for lists. `nextPage` is a pagination offset or `null`; pass it back as `--offset`.

Errors are written to stderr:

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

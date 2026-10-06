# Service guide

> Status: **draft**. Reviewed by the platform team.

## Overview

The gateway accepts requests on port `8080` and forwards them to the
upstream pool. Health checks run every 30 seconds.

## Options

| Flag        | Default | Description                 |
| ----------- | ------- | --------------------------- |
| `--port`    | `8080`  | Listening port              |
| `--workers` | `4`     | Worker processes            |
| `--verbose` | `false` | Emit per-request log lines  |

## Rollout

- [x] Staging deploy
- [ ] Load test
- [ ] Production deploy

```bash
gateway --port 8080 --workers 4
```

See the [runbook](./runbook.md) for the escalation path.[^1]

[^1]: Escalation is owned by the on-call rotation.

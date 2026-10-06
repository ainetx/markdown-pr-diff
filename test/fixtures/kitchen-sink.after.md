# Service guide

> Status: **reviewed**. Reviewed by the platform team and SRE.

## Overview

The gateway accepts requests on port `8443` and forwards them to the
upstream pool. Health checks run every 10 seconds.

## Options

| Flag        | Default | Description                 |
| ----------- | ------- | --------------------------- |
| `--port`    | `8443`  | Listening port              |
| `--workers` | `8`     | Worker processes            |
| `--verbose` | `false` | Emit per-request log lines  |
| `--tls`     | `true`  | Terminate TLS at the edge   |

## Rollout

- [x] Staging deploy
- [x] Load test
- [ ] Production deploy

```bash
gateway --port 8443 --workers 8 --tls
```

See the [runbook](./runbook.md) for the escalation path.[^1]

[^1]: Escalation is owned by the on-call rotation.

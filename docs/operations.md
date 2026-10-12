# Keeping the service running

Keep the relay key and service secrets in the host's secret manager. Never store them in deployment records or source control. The web host and worker must use the same Neon database, contract addresses and encryption key.

A persistent worker is the recommended scheduler. It submits one serialized network action at a time and checks receipts every ten seconds. Native Studio RPC quotas apply across the account and IP. Reduce polling if other applications share that quota.

A systemd user service can run the worker on a Linux host:

```ini
[Unit]
Description=Sortition transaction worker
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/sortition
ExecStart=/path/to/node --import tsx scripts/worker.ts
Restart=on-failure
RestartSec=15
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

The worker reads the private environment file through Next's environment loader. Restrict it to the service user. An external scheduler can instead send `POST /api/worker` with `Authorization: Bearer WORKER_SECRET`. This endpoint performs one tick and requires the same secret as the persistent worker.

## Recover an interrupted submission

Find the operation marked `needs_review`. Inspect its creation time, the relay nonce and transaction history on Studio. If a matching transaction exists, record its hash and move the operation to `submitted`. If it provably never reached the network, move it back to `queued`. Never guess for a payable operation. The worker deliberately stops here to prevent duplicate bonds or fees.

The deployed user service has lingering enabled so it survives logout. GitHub Actions runs a backup scheduler every five minutes, making four ticks per run. Scheduled actions can be delayed by GitHub; the continuous worker provides prompt processing. Both use the same database lease.

Lease expiry lets another worker resume after a crash. A stale `submitting` operation becomes `needs_review` after ten minutes. A receipt with FINALIZED status can still contain a failed execution. Always inspect the actual leader execution and then verify contract state.

Factory children finish asynchronously. A parent registration receipt can finalize before its docket and vault binding are readable. Leave that operation submitted; the worker retries the read and records the child receipts.

When changing a contract, run lint and direct tests first, deploy a new registry with the updated docket code, and preserve old addresses. Existing criteria and dockets remain immutable. Each question retains its own registry and vault addresses, so the worker continues to follow older dockets after a new deployment.

Studio may report a timestamp different from the operating system clock. Sortition reads the network timestamp for registration and appeal controls. Do not replace it with server wall time.

Webhook signing uses the timestamp returned by Neon with the outbox row. A worker host clock may differ from the receiver clock; using a trusted shared timestamp avoids signing every event outside its replay window. Receivers still reject stale events.

import { randomUUID } from "node:crypto";
import { db } from "./db";
import {
  protocolAppealable,
  questionState,
  nativeAppealsEnabled,
  nativeAppealUnavailable,
  timeoutClaimable,
  maxBondedRounds,
} from "./lifecycle";
import { reserveSponsorship } from "./sponsorship";
import {
  chain,
  panelSize,
  panelVerification,
  networkClock,
  readFinal,
  object,
  statusName,
  executionSucceeded,
  readTransaction,
  childExecutionState,
  publicReceipt,
  type Address,
} from "./chain";
import { decrypt, deliverWebhook } from "./security";
import type { Specification } from "./types";
import type { TransactionHash } from "genlayer-js/types";

type Job = {
  id: string;
  owner_id: string;
  kind: string;
  question_id: string;
  tx_hash: string | null;
  status: string;
  payload: { expected?: string; claimant?: string; payment_id?: string };
  specification: Specification;
  beneficiary: string;
  fee: string;
  base_bond: string;
  docket_address: string | null;
  registry_address: Address;
  vault_address: Address;
};
/** One durable settlement event per question and final round. */
function settlementEvent(
  id: string,
  escrow: Record<string, unknown>,
  criteriaHash: unknown,
  docketAddress: string,
) {
  return {
    key: `${id}:settled:${String(escrow.final_round)}`,
    payload: {
      type: "question.settled",
      question_id: id,
      outcome: escrow.outcome,
      refunded: escrow.refunded === true,
      criteria_hash: criteriaHash,
      docket_address: docketAddress,
      round: escrow.final_round,
      network: "studionet",
    },
  };
}
async function updateQuestion(id: string) {
  const sql = db();
  const configured =
    await sql`SELECT registry_address,vault_address,owner_id FROM questions WHERE id=${id}`;
  const a = {
    registry: configured[0].registry_address as Address,
    vault: configured[0].vault_address as Address,
  };
  const registered = object(await readFinal(a.registry, "get_question", [id]));
  const docketAddress = registered.docket_address as Address;
  if (!docketAddress) return;
  const docket = object(await readFinal(docketAddress, "get_docket"));
  const escrow = object(await readFinal(a.vault, "get_account", [id]));
  const spec = registered.specification as Specification;
  const rounds = Array.isArray(docket.rounds) ? docket.rounds : [];
  const now = (await networkClock()).unix;
  const state = questionState(escrow, rounds.length, spec.close_timestamp, now);
  const statements = [
    sql`UPDATE questions SET criteria_hash=${registered.criteria_hash as string},docket_address=${docketAddress},docket=${JSON.stringify(docket)}::jsonb,escrow=${JSON.stringify(escrow)}::jsonb,status=${state},updated_at=now(),indexed_at=now(),next_index_at=now()+interval '60 seconds' WHERE id=${id}`,
  ];
  if (escrow.settled) {
    // The settled status and its outbox event are written together. A crash
    // between them used to lose the event permanently, because later idle
    // scans skip settled questions.
    const event = settlementEvent(id, escrow, registered.criteria_hash, docketAddress);
    statements.push(
      sql`INSERT INTO deliveries(id,question_id,event_key,payload) SELECT ${randomUUID()},${id},${event.key},${JSON.stringify(event.payload)}::jsonb WHERE EXISTS(SELECT 1 FROM webhooks WHERE question_id=${id}) ON CONFLICT(event_key) DO NOTHING`,
    );
    for (const beneficiary of participants(escrow, registered))
      statements.push(
        sql`INSERT INTO payment_watch(vault_address,beneficiary,question_id) VALUES(${a.vault},${beneficiary},${id}) ON CONFLICT(vault_address,beneficiary) DO NOTHING`,
      );
  }
  if (timeoutClaimable(escrow, now))
    // The bounded exit is part of the service, not only of the contract.
    statements.push(
      sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key) VALUES(${randomUUID()},${id},${configured[0].owner_id},'claim_timeout','{}'::jsonb,${"timeout:" + id + ":" + String(escrow.hearing_deadline)}) ON CONFLICT(owner_id,idempotency_key) DO NOTHING`,
    );
  await sql.transaction(statements);
}
/** Everyone who can hold credit in a settled escrow. */
function participants(
  escrow: Record<string, unknown>,
  registered: Record<string, unknown>,
) {
  const addresses = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value))
      addresses.add(value);
  };
  add(registered.beneficiary);
  add(escrow.beneficiary);
  add(escrow.fee_payer);
  for (const challenge of Array.isArray(escrow.challenges)
    ? escrow.challenges
    : []) {
    add(object(challenge).payer);
    add(object(challenge).claimant);
  }
  return [...addresses];
}
/**
 * Replace any settlement event lost before this repair existed, and any event
 * whose question settled while its insert failed.
 */
async function repairDeliveries() {
  const sql = db();
  const rows =
    await sql`SELECT q.id,q.criteria_hash,q.docket_address,q.escrow FROM questions q JOIN webhooks w ON w.question_id=q.id
      WHERE q.escrow->>'settled'='true' AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.question_id=q.id) LIMIT 1`;
  if (!rows[0]) return false;
  const event = settlementEvent(
    rows[0].id,
    object(rows[0].escrow),
    rows[0].criteria_hash,
    rows[0].docket_address,
  );
  await sql`INSERT INTO deliveries(id,question_id,event_key,payload) VALUES(${randomUUID()},${rows[0].id},${event.key},${JSON.stringify(event.payload)}::jsonb) ON CONFLICT(event_key) DO NOTHING`;
  return true;
}
/**
 * Read contract payment state for a watched beneficiary and queue its
 * reconciliation. This finds a pending payment from a direct contract
 * withdrawal that this service never submitted.
 */
async function scanPayments() {
  const sql = db();
  const rows =
    await sql`SELECT w.*,q.owner_id FROM payment_watch w JOIN questions q ON q.id=w.question_id WHERE w.next_scan_at<=now() ORDER BY w.next_scan_at LIMIT 1`;
  if (!rows[0]) return false;
  const watch = rows[0];
  let payment: Record<string, unknown>;
  try {
    payment = object(
      await readFinal(watch.vault_address as Address, "get_payment", [
        watch.beneficiary,
      ]),
    );
  } catch {
    await sql`UPDATE payment_watch SET next_scan_at=now()+interval '10 minutes' WHERE vault_address=${watch.vault_address} AND beneficiary=${watch.beneficiary}`;
    return true;
  }
  const status = typeof payment.status === "string" ? payment.status : "";
  const id = typeof payment.id === "string" ? payment.id : null;
  const retry = status === "pending" ? 120 : 21600;
  const statements = [
    sql`UPDATE payment_watch SET payment_id=${id},status=${status},updated_at=now(),next_scan_at=now()+(${retry}*interval '1 second') WHERE vault_address=${watch.vault_address} AND beneficiary=${watch.beneficiary}`,
  ];
  if (status === "pending" && id)
    statements.push(
      sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key)
        VALUES(${randomUUID()},${watch.question_id},${watch.owner_id},'confirm_payment',${JSON.stringify({ claimant: watch.beneficiary, payment_id: id })}::jsonb,${"scanned-payment:" + watch.beneficiary + ":" + id})
        ON CONFLICT(owner_id,idempotency_key) DO NOTHING`,
    );
  await sql.transaction(statements);
  return true;
}
async function renewLease(token: string) {
  const renewed =
    await db()`UPDATE worker_lock SET lease_until=now()+interval '90 seconds' WHERE id=1 AND token=${token} AND lease_until>now() RETURNING token`;
  if (!renewed.length)
    throw Error(
      "Preparation failed before submission because the worker lease expired.",
    );
}
async function submit(job: Job, token: string) {
  const client = chain(),
    a = { registry: job.registry_address, vault: job.vault_address };
  let hash: string;
  if (job.kind === "register") {
    await renewLease(token);
    hash = await client.writeContract({
      address: a.registry,
      functionName: "register",
      args: [
        job.question_id,
        JSON.stringify(job.specification),
        job.beneficiary,
        BigInt(job.fee),
        BigInt(job.base_bond),
      ],
      value: 0n,
    });
  } else if (job.kind === "protocol_appeal") {
    if (!nativeAppealsEnabled)
      throw Error("Preparation failed: " + nativeAppealUnavailable);
    const rows =
      await db()`SELECT tx_hash FROM operations WHERE question_id=${job.question_id} AND kind='resolve' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
    if (!rows[0])
      throw Error("No resolution transaction is available to appeal.");
    const txId = rows[0].tx_hash as Address;
    const prior = await client.getTransaction({
      hash: txId as TransactionHash,
    });
    if (!protocolAppealable(statusName(prior)))
      throw Error(
        "The protocol appeal window has closed. Use a bonded docket challenge while its window is open.",
      );
    const bond = client.chain.feeManagerContract?.address
      ? await client.getMinAppealBond({ txId })
      : 0n;
    if ((await client.getBalance({ address: client.account!.address })) < bond)
      throw Error(
        "The relay needs more test GEN to sponsor this protocol appeal.",
      );
    await reserveSponsorship(job.id, job.owner_id, bond);
    await renewLease(token);
    await client.appealTransaction({ txId, value: bond });
    hash = txId;
  } else {
    if (!job.docket_address)
      throw Error(
        "The docket is still being created. Please try again shortly.",
      );
    let escrow: Record<string, unknown>;
    try {
      escrow = object(
        await readFinal(a.vault, "get_account", [job.question_id]),
      );
    } catch {
      throw Error(
        "Preparation failed before any transaction was sent. Please try again.",
      );
    }
    let address = a.vault;
    let fn = job.kind;
    let args: (string | number | bigint)[] = [job.question_id];
    let value = 0n;
    if (job.kind === "open_round" && Number(escrow.version) >= 3) {
      address = job.docket_address as Address;
      fn = "publish_ruling";
      args = [];
    }
    if (job.kind === "prepare_hearing") fn = "prepare_hearing";
    if (job.kind === "claim_timeout") {
      if (!timeoutClaimable(escrow, (await networkClock()).unix))
        throw Error(
          "Preparation failed because this funded hearing is not past its deadline without a ruling.",
        );
    }
    if (job.kind === "resolve" && Number(escrow.version) >= 3) {
      const docket = object(
        await readFinal(job.docket_address as Address, "get_docket"),
      );
      if (
        !docket.funded ||
        Number(docket.expected_challenge_count) !==
          Number(escrow.challenge_count)
      ) {
        await queueInternal(
          job,
          "prepare_hearing",
          {},
          "prepare-hearing:" + job.id,
        );
        await db()`UPDATE operations SET status='queued',next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE id=${job.id}`;
        return;
      }
      // Request exactly the panel the contract committed to for this round.
      const committed = Number(docket.required_validators || 0);
      client.chain.defaultNumberOfInitialValidators =
        committed > 0
          ? Math.min(committed, 101)
          : panelSize(
              Math.min(Number(escrow.challenge_count), maxBondedRounds),
            );
    }
    if (job.kind === "resolve") {
      address = job.docket_address as Address;
      args = [];
      if (Number(escrow.version) < 3)
        client.chain.defaultNumberOfInitialValidators = panelSize(
          Math.min(Number(escrow.challenge_count), maxBondedRounds),
        );
    }
    if (job.kind === "fund") {
      if (escrow.funded || escrow.settled)
        throw Error("Preparation failed because this fee is already funded.");
      value = BigInt(job.fee);
    }
    if (job.kind === "challenge") {
      if (escrow.settled || !escrow.funded)
        throw Error("Preparation failed because no funded hearing is open.");
      if (
        Number(escrow.version) >= 3 &&
        (job.payload.expected === escrow.ruling_outcome ||
          Number(escrow.ruling_round) !== Number(escrow.challenge_count) + 1 ||
          (await networkClock()).unix >= Number(escrow.round_deadline))
      )
        throw Error(
          "Preparation failed because this challenge does not target an open, different ruling.",
        );
      value =
        BigInt(escrow.base_bond as string) *
        2n ** BigInt(escrow.challenge_count as number);
      args = [job.question_id, job.payload.claimant!, job.payload.expected!];
    }
    if (["confirm_payment", "restore_payment"].includes(job.kind)) {
      const payment = object(
        await readFinal(a.vault, "get_payment", [job.payload.claimant!]),
      );
      if (payment.id !== job.payload.payment_id || payment.status !== "pending")
        throw Error(
          "Preparation failed because this payment no longer needs reconciliation.",
        );
      fn =
        job.kind === "confirm_payment"
          ? "confirm_withdrawal"
          : "restore_withdrawal";
      args = [job.payload.claimant!, job.payload.payment_id!];
      if (job.kind === "restore_payment")
        value = BigInt(payment.amount as string);
    }
    if (job.kind === "withdraw") {
      fn = "withdraw";
      args = [job.payload.claimant!];
    }
    if (
      value > 0n &&
      (await client.getBalance({ address: client.account!.address })) < value
    )
      throw Error("The relay needs more test GEN to sponsor this fee or bond.");
    if (job.kind !== "restore_payment")
      await reserveSponsorship(job.id, job.owner_id, value);
    await renewLease(token);
    hash = await client.writeContract({
      address,
      functionName: fn,
      args,
      value,
    });
  }
  await db()`UPDATE operations SET tx_hash=${hash},status='submitted',updated_at=now() WHERE id=${job.id}`;
  return hash;
}
async function queueInternal(
  job: Job,
  kind: string,
  payload: Record<string, unknown>,
  key: string,
) {
  await db()`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key)
    VALUES(${randomUUID()},${job.question_id},${job.owner_id},${kind},${JSON.stringify(payload)}::jsonb,${key})
    ON CONFLICT(owner_id,idempotency_key) DO NOTHING`;
}
async function reconcilePayment(job: Job, failed: boolean) {
  const escrow = object(
    await readFinal(job.vault_address, "get_account", [job.question_id]),
  );
  if (Number(escrow.version) < 2 || !escrow.version) return;
  const payment = object(
    await readFinal(job.vault_address, "get_payment", [job.payload.claimant!]),
  );
  if (payment.status !== "pending") return;
  const kind = failed ? "restore_payment" : "confirm_payment";
  await queueInternal(
    job,
    kind,
    { claimant: job.payload.claimant, payment_id: payment.id },
    kind + ":" + job.id,
  );
}
/**
 * Record the panel a completed hearing actually seated against the panel its
 * round was funded for. The contract cannot seat validators, so this public
 * check is what makes the committed requirement meaningful.
 */
async function recordPanelCheck(job: Job, receipt: ReturnType<typeof publicReceipt>) {
  const sql = db();
  const docket = object(
    await readFinal(job.docket_address as Address, "get_docket"),
  );
  const rounds = Array.isArray(docket.rounds) ? docket.rounds : [];
  const latest = object(rounds[rounds.length - 1]);
  if (!rounds.length) return;
  const check = {
    round: Number(latest.round),
    tx_hash: job.tx_hash,
    ...panelVerification(receipt, Number(latest.required_validators || 0)),
  };
  const rows =
    await sql`SELECT panel_checks FROM questions WHERE id=${job.question_id}`;
  const existing = Array.isArray(rows[0]?.panel_checks)
    ? (rows[0].panel_checks as { round: number }[])
    : [];
  const merged = [
    ...existing.filter((entry) => Number(entry.round) !== check.round),
    check,
  ].sort((x, y) => Number(x.round) - Number(y.round));
  await sql`UPDATE questions SET panel_checks=${JSON.stringify(merged)}::jsonb WHERE id=${job.question_id}`;
}
async function poll(job: Job) {
  const r = await readTransaction(job.tx_hash as TransactionHash);
  const status = statusName(r);
  if (
    [
      "FINALIZED",
      "UNDETERMINED",
      "CANCELED",
      "LEADER_TIMEOUT",
      "VALIDATORS_TIMEOUT",
    ].includes(status)
  ) {
    await db()`INSERT INTO receipts(tx_hash,question_id,kind,receipt) VALUES(${job.tx_hash},${job.question_id},${job.kind},${JSON.stringify(publicReceipt(r))}::jsonb) ON CONFLICT(tx_hash) DO UPDATE SET receipt=EXCLUDED.receipt`;
  }
  if (["ACCEPTED", "FINALIZED"].includes(status)) {
    const publicData = publicReceipt(r);
    await db()`INSERT INTO receipts(tx_hash,question_id,kind,receipt) VALUES(${job.tx_hash},${job.question_id},${job.kind},${JSON.stringify(publicData)}::jsonb) ON CONFLICT(tx_hash) DO UPDATE SET receipt=EXCLUDED.receipt`;
    const children = await chain().getTriggeredTransactionIds({
      hash: job.tx_hash as TransactionHash,
    });
    const childReceipts = [];
    for (const hash of children) {
      const child = await readTransaction(hash);
      childReceipts.push(child);
      await db()`INSERT INTO receipts(tx_hash,question_id,kind,receipt) VALUES(${hash},${job.question_id},'internal',${JSON.stringify(publicReceipt(child))}::jsonb) ON CONFLICT(tx_hash) DO UPDATE SET receipt=EXCLUDED.receipt`;
    }
    if (!executionSucceeded(r)) {
      await db()`UPDATE operations SET status='failed',error='Contract execution did not succeed. See the public transaction receipt.',updated_at=now() WHERE id=${job.id}`;
      return;
    }
    if (status === "FINALIZED") {
      const childState = childExecutionState(childReceipts);
      if (childState === "failed") {
        if (job.kind === "withdraw") await reconcilePayment(job, true);
        await db()`UPDATE operations SET status='failed',error='An emitted transaction failed. Retry the funded hearing or window without paying again. Pending native payments receive backed recovery.',updated_at=now() WHERE id=${job.id}`;
        if (job.kind === "challenge") {
          await queueInternal(
            job,
            "resolve",
            {},
            "bonded-resolution:" + job.id,
          );
        }
        return;
      }
      if (
        childState === "pending" ||
        (job.kind === "withdraw" && !childReceipts.length)
      )
        return;

      try {
        await updateQuestion(job.question_id);
      } catch {
        return; /* Factory children may still be pending. Retry the same transaction next tick. */
      }
      if (job.kind === "resolve" && job.docket_address) {
        try {
          await recordPanelCheck(job, publicData);
        } catch {
          /* The hearing stands on its receipt; the check retries next hearing. */
        }
      }
      if (["resolve", "protocol_appeal"].includes(job.kind)) {
        const finalizedEscrow = object(
          await readFinal(job.vault_address, "get_account", [job.question_id]),
        );
        const ruling = object(
          await readFinal(job.docket_address as Address, "get_settlement"),
        );
        if (
          Number(finalizedEscrow.version) >= 2 &&
          !finalizedEscrow.settled &&
          Number(finalizedEscrow.opened_round) < Number(ruling.round)
        ) {
          await queueInternal(
            job,
            "open_round",
            {},
            "open-window:" + job.question_id + ":" + String(ruling.round),
          );
          return;
        }
      }
      if (job.kind === "withdraw") await reconcilePayment(job, false);
      const sql = db();
      await sql.transaction([
        sql`UPDATE operations SET status='complete',updated_at=now() WHERE id=${job.id}`,
        ...(job.kind === "challenge"
          ? [
              sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key) SELECT ${randomUUID()},question_id,owner_id,'resolve','{}'::jsonb,${"bonded-resolution:" + job.id} FROM operations WHERE id=${job.id} ON CONFLICT(owner_id,idempotency_key) DO NOTHING`,
            ]
          : []),
      ]);
    }
  } else if (
    [
      "CANCELED",
      "UNDETERMINED",
      "LEADER_TIMEOUT",
      "VALIDATORS_TIMEOUT",
    ].includes(status)
  )
    await db()`UPDATE operations SET status='failed',error='The network could not reach a verdict. Review the transaction receipt before trying again.',updated_at=now() WHERE id=${job.id}`;
}
async function delivery() {
  const sql = db();
  const rows =
    await sql`SELECT d.*,w.url,w.secret_ciphertext,floor(extract(epoch from now()))::bigint AS signing_timestamp FROM deliveries d JOIN webhooks w ON w.question_id=d.question_id WHERE d.status='pending' AND d.next_attempt_at<=now() ORDER BY d.next_attempt_at LIMIT 1`;
  if (!rows[0]) return;
  const d = rows[0];
  try {
    await deliverWebhook(
      d.url,
      JSON.stringify(d.payload),
      decrypt(d.secret_ciphertext),
      d.id,
      Number(d.signing_timestamp),
    );
    await sql`UPDATE deliveries SET status='delivered',attempts=attempts+1,delivered_at=now() WHERE id=${d.id}`;
  } catch {
    await sql`UPDATE deliveries SET attempts=attempts+1,status=CASE WHEN attempts>=9 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+(${Math.min(3600, 2 ** d.attempts * 30)}*interval '1 second') WHERE id=${d.id}`;
  }
}
/**
 * Index one question whose refresh is due. `overdueSeconds` keeps indexing
 * alive when job traffic is continuous, so sustained submissions can no longer
 * starve unrelated updates such as a newly expired challenge window.
 */
async function indexDue(overdueSeconds = 0) {
  const sql = db();
  const q =
    await sql`SELECT id FROM questions WHERE docket_address IS NOT NULL AND status NOT IN ('settled','refunded','archived')
      AND next_index_at<=now()-(${overdueSeconds}*interval '1 second') ORDER BY next_index_at,updated_at LIMIT 1`;
  if (!q[0]) return false;
  try {
    await updateQuestion(q[0].id);
  } catch {
    await sql`UPDATE questions SET next_index_at=now()+interval '120 seconds' WHERE id=${q[0].id}`;
  }
  return true;
}
export async function workerTick() {
  const sql = db(),
    token = randomUUID();
  const lease =
    await sql`INSERT INTO worker_lock(id,lease_until,token) VALUES(1,now()+interval '90 seconds',${token}) ON CONFLICT(id) DO UPDATE SET lease_until=EXCLUDED.lease_until,token=EXCLUDED.token WHERE worker_lock.lease_until<now() RETURNING token`;
  if (!lease.length) return { busy: true };
  const heartbeat = setInterval(() => {
    sql`UPDATE worker_lock SET lease_until=now()+interval '90 seconds' WHERE id=1 AND token=${token}`.catch(
      () => {},
    );
  }, 30000);
  heartbeat.unref();
  try {
    // A crash after submit but before persisting the hash requires manual reconciliation. Never blindly resend money.
    await sql`UPDATE operations SET status='needs_review',error='Submission was interrupted. The operator must reconcile the relay nonce and network history before resubmitting.',updated_at=now() WHERE status='submitting' AND updated_at<now()-interval '10 minutes'`;
    const rows =
      await sql`SELECT o.*,q.specification,q.beneficiary,q.fee::text,q.base_bond::text,q.docket_address,q.registry_address,q.vault_address FROM operations o JOIN questions q ON q.id=o.question_id WHERE o.status IN ('queued','submitted') AND o.next_attempt_at<=now() ORDER BY CASE WHEN o.kind='protocol_appeal' AND o.status='queued' THEN 0 ELSE 1 END,o.next_attempt_at,o.created_at LIMIT 1`;
    if (rows[0]) {
      const job = rows[0] as Job;
      if (job.status === "queued") {
        await sql`UPDATE operations SET status='submitting',updated_at=now() WHERE id=${job.id}`;
        try {
          await submit(job, token);
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          if (
            message ===
            "Preparation failed before any transaction was sent. Please try again."
          ) {
            await sql`UPDATE operations SET status='queued',error=NULL,poll_failures=poll_failures+1,next_attempt_at=now()+(LEAST(300,20*power(2,LEAST(poll_failures,4)))*interval '1 second'),updated_at=now() WHERE id=${job.id} AND tx_hash IS NULL`;
            return { processed: job.id };
          }
          const safe =
            message.startsWith("The relay") ||
            message.startsWith("The protocol") ||
            message.startsWith("No resolution") ||
            message.startsWith("The docket") ||
            message.startsWith("Preparation failed")
              ? message
              : "Submission could not be confirmed. Check the network history before retrying.";
          await sql`UPDATE operations SET status=${safe === message ? "failed" : "needs_review"},error=${safe},updated_at=now() WHERE id=${job.id}`;
        }
      } else {
        try {
          await poll(job);
          await sql`UPDATE operations SET next_attempt_at=now()+interval '20 seconds',poll_failures=0,updated_at=now() WHERE id=${job.id} AND status='submitted'`;
        } catch {
          await sql`UPDATE operations SET poll_failures=poll_failures+1,next_attempt_at=now()+(LEAST(300,20*power(2,LEAST(poll_failures,4)))*interval '1 second'),updated_at=now() WHERE id=${job.id} AND status='submitted'`;
        }
      }
      // Continuous job traffic must not starve indexing or payment recovery.
      try {
        if (!(await indexDue(300))) await scanPayments();
      } catch {
        /* Both retry on their own schedule. */
      }
    } else {
      if (!(await indexDue()))
        if (!(await scanPayments())) await repairDeliveries();
    }
    return { processed: rows[0]?.id || null };
  } finally {
    try {
      await delivery();
    } catch {
      /* Durable outbox retries independently next tick. */
    }
    clearInterval(heartbeat);
    await sql`DELETE FROM worker_lock WHERE id=1 AND token=${token}`;
  }
}

"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Queue visualization / admin page (#29, ADR 0001 + 0002).
//
// Live queue depth/consumers/rates + DLQ inspection/requeue/purge come from the
// gateway's RabbitMQ management proxy; per-image task history comes from the
// catalog tasks ledger. Deep-links to RabbitMQ's own management UI for power use.
//
// Built wide for ops use: a KPI summary strip up top, a dense depth table with
// total/backlog bars + net throughput, detailed dead-letter cards, and a full
// task ledger table with timestamps.
// ---------------------------------------------------------------------------

const RABBITMQ_MGMT_URL =
  process.env.NEXT_PUBLIC_RABBITMQ_MGMT_URL ?? "http://localhost:15672";

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input:
    "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  btnSm: "rounded-md border border-ui-border/70 bg-ui-bg-soft px-2 py-1 text-ui-2xs font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
  danger:
    "rounded-md border border-rose-500/40 px-2 py-1 text-ui-2xs text-rose-500 transition hover:bg-rose-500/10",
};

interface QueueStat {
  name: string;
  reachable: boolean;
  messages: number;
  messages_ready: number;
  messages_unacknowledged: number;
  consumers: number;
  publish_rate: number;
  deliver_rate: number;
}

interface QueueMessage {
  payload: string | null;
  headers: Record<string, unknown>;
  payload_bytes?: number;
  payload_encoding?: string;
  redelivered?: boolean;
  routing_key?: string;
  exchange?: string;
  properties?: Record<string, unknown>;
}

// A non-destructive peek result for one queue: the sampled messages + how many
// are still queued after the peek (the sample is requeued, not consumed).
interface QueuePeek {
  messages: QueueMessage[];
  remaining: number;
}

interface Task {
  id: string;
  sha256: string;
  type: string;
  status: string;
  attempts: number;
  error: string | null;
  parent_op_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// Per-stage DAG queues (ADR 0002): the opt-in `ingest` producer queue, the
// embed/index/label stages, plus the legacy `index` queue kept for in-flight
// migration drain. Each has a `<base>.dlq` with peek/requeue/purge controls.
const DLQ_BASES = [
  "ingest",
  "embed.dense",
  "embed.sparse",
  "index.search",
  "index.graph",
  "label",
  "index",
] as const;

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-sky-500/15 text-sky-500";
    case "queued":
      return "bg-ui-bg text-ui-ink-muted";
    case "done":
      return "bg-emerald-500/15 text-emerald-500";
    case "failed":
      return "bg-amber-500/15 text-amber-500";
    case "dlq":
      return "bg-rose-500/15 text-rose-500";
    default:
      return "bg-ui-bg text-ui-ink-muted";
  }
}

// Short relative timestamp for the ledger ("12s ago" / "3m ago" / "2h ago").
function ago(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Collapse a long hash to head…tail so the table stays scannable.
function shortSha(sha: string): string {
  return sha.length > 16 ? `${sha.slice(0, 8)}…${sha.slice(-6)}` : sha;
}

// DLQ payloads are JSON task envelopes; pull out the sha for a readable label.
function payloadSha(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const o = JSON.parse(payload) as Record<string, unknown>;
    return typeof o.sha256 === "string" ? o.sha256 : null;
  } catch {
    return null;
  }
}

// Parse a task envelope into its known fields. Most stages carry
// {sha256, type, parent_op_id}; the ingest stage carries {path, source_folder_id}.
function taskEnvelope(payload: string | null): {
  sha256?: string;
  type?: string;
  path?: string;
  parent_op_id?: string;
  source_folder_id?: string;
} | null {
  if (!payload) return null;
  try {
    const o = JSON.parse(payload) as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
    return {
      sha256: str("sha256"),
      type: str("type"),
      path: str("path"),
      parent_op_id: str("parent_op_id"),
      source_folder_id: str("source_folder_id"),
    };
  } catch {
    return null;
  }
}

// Pretty-print a JSON payload for the raw view; leave non-JSON untouched.
function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

const pillCls = "rounded px-1 py-0.5 text-ui-2xs";

// One message in a queue, rendered with its decoded task fields up top (stage,
// sha/path, op, attempt, redelivered, size) and the raw payload + headers behind
// disclosure toggles. Shared by the live-queue inspector and the DLQ cards.
function MessageCard({ m, index }: { m: QueueMessage; index: number }) {
  const env = taskEnvelope(m.payload);
  const sha = env?.sha256 ?? payloadSha(m.payload);
  const attempt = m.headers?.["x-attempt"];
  const err = m.headers?.["x-error"];
  const hasHeaders = m.headers && Object.keys(m.headers).length > 0;
  return (
    <li className="min-w-0 rounded border border-ui-border/40 bg-ui-bg-soft/40 p-2 text-ui-2xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ui-ink-muted">#{index + 1}</span>
        {env?.type && (
          <span className={`${pillCls} bg-accent-cyan/10 font-medium text-accent-cyan`}>{env.type}</span>
        )}
        {sha ? (
          <span className="font-mono text-ui-ink" title={sha}>
            {shortSha(sha)}
          </span>
        ) : env?.path ? (
          <span className="min-w-0 truncate font-mono text-ui-ink" title={env.path}>
            {env.path}
          </span>
        ) : null}
        {m.redelivered && <span className={`${pillCls} bg-amber-500/10 text-amber-500`}>redelivered</span>}
        {attempt != null && (
          <span className={`${pillCls} bg-rose-500/10 text-rose-500`}>attempt {String(attempt)}</span>
        )}
        {typeof m.payload_bytes === "number" && (
          <span className="text-ui-ink-muted" title="payload size">
            {m.payload_bytes} B
          </span>
        )}
        {m.routing_key && (
          <span className="text-ui-ink-muted" title="routing key">
            rk:{m.routing_key}
          </span>
        )}
      </div>
      {env?.parent_op_id && (
        <div className="mt-1 font-mono text-ui-ink-muted" title={env.parent_op_id}>
          op {env.parent_op_id.slice(0, 8)}
        </div>
      )}
      {err != null && <div className="mt-1 break-words text-rose-500">{String(err)}</div>}
      {m.payload && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ui-ink-muted hover:text-ui-ink">payload</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-ui-bg p-1.5 font-mono text-ui-ink-muted">
            {prettyJson(m.payload)}
          </pre>
        </details>
      )}
      {hasHeaders && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ui-ink-muted hover:text-ui-ink">headers</summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-ui-bg p-1.5 font-mono text-ui-ink-muted">
            {JSON.stringify(m.headers, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-rose-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "good"
          ? "text-emerald-500"
          : "text-ui-ink-title";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-ui-border/50 bg-ui-bg px-3 py-2">
      <span className="truncate text-ui-2xs uppercase tracking-wide text-ui-ink-muted">{label}</span>
      <span className={`text-ui-xl font-semibold tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

export default function QueuesPage() {
  const [queues, setQueues] = useState<QueueStat[]>([]);
  // Peeked contents keyed by queue name — shared by the live-queue inspector and
  // the DLQ cards. `expanded` is the live queue row whose inspector is open.
  const [peeked, setPeeked] = useState<Record<string, QueuePeek>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [taskSha, setTaskSha] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/library/queues")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.queues)) {
          setQueues(j.queues as QueueStat[]);
          setLastUpdated(Date.now());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Non-destructively peek a queue's contents (works for any queue — live stage,
  // .retry, or .dlq). The sample is requeued, so the depth is unchanged.
  const peek = useCallback(async (name: string, limit = 25) => {
    setError(null);
    try {
      const j = (await fetch(
        `/api/library/queues/${encodeURIComponent(name)}/messages?limit=${limit}`,
      ).then((r) => r.json())) as { messages?: QueueMessage[]; remaining?: number };
      setPeeked((prev) => ({
        ...prev,
        [name]: { messages: j.messages ?? [], remaining: j.remaining ?? 0 },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Peek failed");
    }
  }, []);

  // Toggle the inline inspector on a live-queue row, fetching its contents the
  // first time it opens.
  const toggleInspect = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (!peeked[name]) void peek(name);
  };

  const requeueDlq = async (base: string) => {
    if (!window.confirm(`Requeue all ${base}.dlq messages back to "${base}"?`)) return;
    setError(null);
    try {
      const j = await fetch(`/api/library/dlq/${encodeURIComponent(base)}/requeue`, {
        method: "POST",
      }).then((r) => r.json());
      setNotice(`Requeued ${j.count ?? 0} message(s) to ${base}.`);
      setPeeked((prev) => ({ ...prev, [`${base}.dlq`]: { messages: [], remaining: 0 } }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Requeue failed");
    }
  };

  const purge = async (name: string) => {
    // Typed-confirm: the operator must type the queue name to purge it.
    const typed = window.prompt(`Type "${name}" to PURGE all its messages (irreversible):`);
    if (typed !== name) return;
    setError(null);
    try {
      await fetch(`/api/library/queues/${encodeURIComponent(name)}/purge`, { method: "POST" });
      setNotice(`Purged ${name}.`);
      setPeeked((prev) => ({ ...prev, [name]: { messages: [], remaining: 0 } }));
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purge failed");
    }
  };

  const lookupTasks = async () => {
    const sha = taskSha.trim();
    setError(null);
    try {
      const qs = sha ? `?sha256=${encodeURIComponent(sha)}` : "";
      const j = await fetch(`/api/library/tasks${qs}`).then((r) => r.json());
      setTasks((j.tasks ?? []) as Task[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    }
  };

  // Aggregate KPIs across the live queue set. DLQ depth is summed separately so
  // a stuck dead-letter is impossible to miss at the top of the page.
  const kpis = useMemo(() => {
    let ready = 0;
    let unacked = 0;
    let consumers = 0;
    let inRate = 0;
    let outRate = 0;
    let dlqTotal = 0;
    let unreachable = 0;
    for (const q of queues) {
      if (!q.reachable) unreachable += 1;
      if (q.name.endsWith(".dlq")) {
        dlqTotal += q.messages;
        continue;
      }
      ready += q.messages_ready;
      unacked += q.messages_unacknowledged;
      consumers += q.consumers;
      inRate += q.publish_rate;
      outRate += q.deliver_rate;
    }
    return { ready, unacked, consumers, inRate, outRate, dlqTotal, unreachable };
  }, [queues]);

  // Scale the in-row depth bars against the busiest queue.
  const maxMessages = useMemo(
    () => Math.max(1, ...queues.map((q) => q.messages)),
    [queues],
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-6" data-testid="queues-page">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Queues</h1>
          <p className="max-w-3xl text-ui-sm text-ui-ink-muted">
            Per-stage ingest DAG queues (embed.dense/embed.sparse → index.search,
            index.graph, label) — live depth, peek any queue&apos;s contents,
            dead-letters, and per-image history.
          </p>
        </div>
        <a
          href={RABBITMQ_MGMT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cls.btn}
          data-testid="rabbitmq-link"
        >
          Open RabbitMQ console ↗
        </a>
      </header>

      {error && <p className="text-ui-sm text-rose-500" data-testid="queues-error">{error}</p>}
      {notice && <p className="text-ui-sm text-emerald-500" data-testid="queues-notice">{notice}</p>}

      {/* At-a-glance KPIs */}
      <section
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        data-testid="queue-kpis"
      >
        <Kpi label="Ready backlog" value={kpis.ready.toLocaleString()} tone={kpis.ready > 0 ? "warn" : "good"} />
        <Kpi label="In-flight" value={kpis.unacked.toLocaleString()} />
        <Kpi label="Dead-letters" value={kpis.dlqTotal.toLocaleString()} tone={kpis.dlqTotal > 0 ? "bad" : "good"} />
        <Kpi label="Consumers" value={kpis.consumers.toLocaleString()} tone={kpis.consumers > 0 ? "default" : "warn"} />
        <Kpi label="Publish /s" value={kpis.inRate.toFixed(1)} />
        <Kpi label="Deliver /s" value={kpis.outRate.toFixed(1)} />
      </section>

      {/* Live queue stats */}
      <section className={cls.card} data-testid="queue-stats">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-ui-sm font-semibold text-ui-ink-title">
            Queue depth{" "}
            <span className="ml-2 text-ui-2xs text-ui-ink-muted">
              live · 3s{lastUpdated ? ` · updated ${ago(new Date(lastUpdated).toISOString())}` : ""}
              {kpis.unreachable > 0 ? ` · ${kpis.unreachable} unreachable` : ""}
            </span>
          </h2>
          <button className={cls.btn} onClick={refresh} data-testid="queues-refresh">
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-ui-xs">
            <thead className="text-ui-ink-muted">
              <tr className="text-left">
                <th className="px-2 py-1">queue</th>
                <th className="px-2 py-1 text-right">ready</th>
                <th className="px-2 py-1 text-right">unacked</th>
                <th className="px-2 py-1 text-right">total</th>
                <th className="w-[28%] px-2 py-1">depth</th>
                <th className="px-2 py-1 text-right">consumers</th>
                <th className="px-2 py-1 text-right">in/s</th>
                <th className="px-2 py-1 text-right">out/s</th>
                <th className="px-2 py-1 text-right">net/s</th>
                <th className="px-2 py-1 text-right">inspect</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => {
                const net = q.publish_rate - q.deliver_rate;
                const isDlq = q.name.endsWith(".dlq");
                const barPct = Math.round((q.messages / maxMessages) * 100);
                const barColor = isDlq
                  ? "bg-rose-500/70"
                  : q.messages_unacknowledged > 0
                    ? "bg-sky-500/70"
                    : "bg-accent-cyan/70";
                const isOpen = expanded === q.name;
                const peek_ = peeked[q.name];
                return (
                  <Fragment key={q.name}>
                  <tr
                    className={`border-t border-ui-border/40 align-middle hover:bg-ui-bg-soft/40 ${q.reachable ? "" : "opacity-40"}`}
                    data-testid={`queue-row-${q.name}`}
                  >
                    <td className="px-2 py-1.5 font-medium text-ui-ink">
                      <span className={isDlq ? "text-rose-500" : ""}>{q.name}</span>
                      {!q.reachable && <span className="ml-1 text-ui-2xs text-ui-ink-muted">(down)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{q.messages_ready}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {q.messages_unacknowledged > 0 ? (
                        <span className="text-sky-500">{q.messages_unacknowledged}</span>
                      ) : (
                        q.messages_unacknowledged
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{q.messages}</td>
                    <td className="px-2 py-1.5">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ui-bg">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${q.messages > 0 ? Math.max(barPct, 4) : 0}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {q.consumers === 0 && q.messages_ready > 0 ? (
                        <span className="text-amber-500" title="messages ready but no consumers">
                          {q.consumers}
                        </span>
                      ) : (
                        q.consumers
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{q.publish_rate.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{q.deliver_rate.toFixed(1)}</td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        net > 0.05 ? "text-amber-500" : net < -0.05 ? "text-emerald-500" : "text-ui-ink-muted"
                      }`}
                    >
                      {net > 0 ? "+" : ""}
                      {net.toFixed(1)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {/* DLQs are inspected in the dead-letter panel below. */}
                      {!isDlq && (
                        <button
                          className={cls.btnSm}
                          onClick={() => toggleInspect(q.name)}
                          disabled={!q.reachable}
                          data-testid={`queue-peek-${q.name}`}
                        >
                          {isOpen ? "Hide" : "Peek"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr
                      className="border-t border-ui-border/40 bg-ui-bg-soft/20"
                      data-testid={`queue-inspect-${q.name}`}
                    >
                      <td colSpan={10} className="px-2 py-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-ui-2xs text-ui-ink-muted">
                            {peek_
                              ? `${peek_.messages.length} ready message(s) sampled · ${peek_.remaining} remaining · non-destructive (requeued)`
                              : "loading…"}
                          </span>
                          <button className={cls.btnSm} onClick={() => peek(q.name)} data-testid={`queue-repeek-${q.name}`}>
                            Re-peek
                          </button>
                        </div>
                        {peek_ && (
                          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {peek_.messages.length === 0 && (
                              <li className="text-ui-2xs text-ui-ink-muted">
                                no ready messages (queue empty, or all in-flight on a consumer)
                              </li>
                            )}
                            {peek_.messages.map((m, i) => (
                              <MessageCard key={i} m={m} index={i} />
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {queues.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-2 py-3 text-ui-ink-muted">
                    No queue data (broker unreachable?).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dead-letter queues */}
      <section className={cls.card} data-testid="dlq-panel">
        <h2 className="mb-3 text-ui-sm font-semibold text-ui-ink-title">
          Dead-letter queues
          {kpis.dlqTotal > 0 && (
            <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-ui-2xs text-rose-500">
              {kpis.dlqTotal} stuck
            </span>
          )}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {DLQ_BASES.map((base) => {
            const name = `${base}.dlq`;
            const stat = queues.find((q) => q.name === name);
            const count = stat ? stat.messages : 0;
            const msgs = peeked[name]?.messages;
            return (
              <div
                key={name}
                className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-ui-bg p-3 ${
                  count > 0 ? "border-rose-500/40" : "border-ui-border/50"
                }`}
                data-testid={`dlq-${base}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-ui-sm font-medium text-ui-ink-title">
                    {name}
                    <span
                      className={`ml-2 text-ui-2xs ${count > 0 ? "font-semibold text-rose-500" : "text-ui-ink-muted"}`}
                    >
                      {count} msg
                    </span>
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <button className={cls.btnSm} onClick={() => peek(name)} data-testid={`dlq-peek-${base}`}>
                      Peek
                    </button>
                    <button
                      className={cls.btnSm}
                      onClick={() => requeueDlq(base)}
                      disabled={count === 0}
                      data-testid={`dlq-requeue-${base}`}
                    >
                      Requeue
                    </button>
                    <button className={cls.danger} onClick={() => purge(name)} data-testid={`dlq-purge-${base}`}>
                      Purge
                    </button>
                  </div>
                </div>
                {msgs && (
                  <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                    {msgs.length === 0 && <li className="text-ui-2xs text-ui-ink-muted">empty</li>}
                    {msgs.map((m, i) => (
                      <MessageCard key={i} m={m} index={i} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-image task history (catalog ledger) */}
      <section className={cls.card} data-testid="task-lookup">
        <h2 className="mb-3 text-ui-sm font-semibold text-ui-ink-title">Per-image task history</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${cls.input} flex-1`}
            value={taskSha}
            onChange={(e) => setTaskSha(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookupTasks()}
            placeholder="sha256 (blank = recent tasks across the library)"
            data-testid="task-sha-input"
          />
          <button className={cls.btn} onClick={lookupTasks} data-testid="task-lookup-btn">
            Look up
          </button>
        </div>
        {tasks.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] text-ui-xs" data-testid="task-table">
              <thead className="text-ui-ink-muted">
                <tr className="text-left">
                  <th className="px-2 py-1">status</th>
                  <th className="px-2 py-1">type</th>
                  <th className="px-2 py-1">sha256</th>
                  <th className="px-2 py-1 text-right">attempts</th>
                  <th className="px-2 py-1">created</th>
                  <th className="px-2 py-1">updated</th>
                  <th className="px-2 py-1">op</th>
                  <th className="px-2 py-1">error</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-ui-border/40 align-middle hover:bg-ui-bg-soft/40">
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-ui-2xs font-medium ${statusColor(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-ui-ink-muted">{t.type}</td>
                    <td className="px-2 py-1.5 font-mono text-ui-ink" title={t.sha256}>
                      {shortSha(t.sha256)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.attempts}</td>
                    <td className="px-2 py-1.5 text-ui-ink-muted" title={t.created_at ?? ""}>
                      {ago(t.created_at)}
                    </td>
                    <td className="px-2 py-1.5 text-ui-ink-muted" title={t.updated_at ?? ""}>
                      {ago(t.updated_at)}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-ui-2xs text-ui-ink-muted" title={t.parent_op_id ?? ""}>
                      {t.parent_op_id ? t.parent_op_id.slice(0, 8) : "—"}
                    </td>
                    <td className="max-w-[24rem] truncate px-2 py-1.5 text-rose-500" title={t.error ?? ""}>
                      {t.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-ui-2xs text-ui-ink-muted">No tasks loaded — look up a sha256 or list recent.</p>
        )}
      </section>
    </div>
  );
}

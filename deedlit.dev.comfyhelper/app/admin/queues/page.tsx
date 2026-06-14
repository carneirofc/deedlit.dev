"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Queue visualization / debug page (#29, ADR 0001).
//
// Live queue depth/consumers/rates + DLQ inspection/requeue/purge come from the
// gateway's RabbitMQ management proxy; per-image task history comes from the
// catalog tasks ledger. Deep-links to RabbitMQ's own management UI for power use.
// ---------------------------------------------------------------------------

const RABBITMQ_MGMT_URL =
  process.env.NEXT_PUBLIC_RABBITMQ_MGMT_URL ?? "http://localhost:15672";

const cls = {
  card: "rounded-xl border border-ui-border/60 bg-ui-bg-soft/40 p-4",
  input:
    "w-full rounded-lg border border-ui-border/70 bg-ui-bg px-3 py-2 text-ui-sm outline-none focus:border-accent-cyan",
  btn: "rounded-lg border border-ui-border/70 bg-ui-bg-soft px-3 py-2 text-ui-sm font-medium transition hover:bg-accent-cyan/10 disabled:opacity-50",
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
}

interface Task {
  id: string;
  sha256: string;
  type: string;
  status: string;
  attempts: number;
  error: string | null;
  updated_at?: string | null;
}

const DLQ_BASES = ["index", "label"] as const;

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-sky-500/15 text-sky-500";
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

export default function QueuesPage() {
  const [queues, setQueues] = useState<QueueStat[]>([]);
  const [dlqMessages, setDlqMessages] = useState<Record<string, QueueMessage[]>>({});
  const [taskSha, setTaskSha] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/library/queues")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.queues)) setQueues(j.queues as QueueStat[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const peekDlq = async (name: string) => {
    setError(null);
    try {
      const j = await fetch(`/api/library/queues/${encodeURIComponent(name)}/messages?limit=20`).then(
        (r) => r.json(),
      );
      setDlqMessages((prev) => ({ ...prev, [name]: (j.messages ?? []) as QueueMessage[] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Peek failed");
    }
  };

  const requeueDlq = async (base: string) => {
    if (!window.confirm(`Requeue all ${base}.dlq messages back to "${base}"?`)) return;
    setError(null);
    try {
      const j = await fetch(`/api/library/dlq/${encodeURIComponent(base)}/requeue`, {
        method: "POST",
      }).then((r) => r.json());
      setNotice(`Requeued ${j.count ?? 0} message(s) to ${base}.`);
      setDlqMessages((prev) => ({ ...prev, [`${base}.dlq`]: [] }));
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
      setDlqMessages((prev) => ({ ...prev, [name]: [] }));
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

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6" data-testid="queues-page">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-ui-2xl font-semibold text-ui-ink-title">Queues</h1>
          <p className="text-ui-sm text-ui-ink-muted">
            Async index/label task queues — live depth, dead-letters, and per-image history.
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

      {/* Live queue stats */}
      <section className={cls.card} data-testid="queue-stats">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ui-sm font-semibold text-ui-ink-title">
            Queue depth <span className="ml-2 text-ui-2xs text-ui-ink-muted">live · 3s</span>
          </h2>
          <button className={cls.btn} onClick={refresh} data-testid="queues-refresh">
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-ui-xs">
            <thead className="text-ui-ink-muted">
              <tr className="text-left">
                <th className="px-2 py-1">queue</th>
                <th className="px-2 py-1 text-right">ready</th>
                <th className="px-2 py-1 text-right">unacked</th>
                <th className="px-2 py-1 text-right">consumers</th>
                <th className="px-2 py-1 text-right">in/s</th>
                <th className="px-2 py-1 text-right">out/s</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr
                  key={q.name}
                  className={`border-t border-ui-border/40 ${q.reachable ? "" : "opacity-40"}`}
                  data-testid={`queue-row-${q.name}`}
                >
                  <td className="px-2 py-1 font-medium text-ui-ink">
                    {q.name}
                    {!q.reachable && <span className="ml-1 text-ui-2xs text-ui-ink-muted">(down)</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{q.messages_ready}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{q.messages_unacknowledged}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{q.consumers}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{q.publish_rate.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{q.deliver_rate.toFixed(1)}</td>
                </tr>
              ))}
              {queues.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-ui-ink-muted">
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
        <h2 className="mb-3 text-ui-sm font-semibold text-ui-ink-title">Dead-letter queues</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {DLQ_BASES.map((base) => {
            const name = `${base}.dlq`;
            const stat = queues.find((q) => q.name === name);
            const msgs = dlqMessages[name];
            return (
              <div
                key={name}
                className="flex flex-col gap-2 rounded-lg border border-ui-border/50 bg-ui-bg p-3"
                data-testid={`dlq-${base}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-ui-sm font-medium text-ui-ink-title">
                    {name}
                    <span className="ml-2 text-ui-2xs text-ui-ink-muted">
                      {stat ? stat.messages : 0} msg
                    </span>
                  </p>
                  <div className="flex gap-1">
                    <button className={cls.btn} onClick={() => peekDlq(name)} data-testid={`dlq-peek-${base}`}>
                      Peek
                    </button>
                    <button
                      className={cls.btn}
                      onClick={() => requeueDlq(base)}
                      data-testid={`dlq-requeue-${base}`}
                    >
                      Requeue all
                    </button>
                    <button className={cls.danger} onClick={() => purge(name)} data-testid={`dlq-purge-${base}`}>
                      Purge
                    </button>
                  </div>
                </div>
                {msgs && (
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-ui-2xs">
                    {msgs.length === 0 && <li className="text-ui-ink-muted">empty</li>}
                    {msgs.map((m, i) => (
                      <li key={i} className="rounded border border-ui-border/40 bg-ui-bg-soft/40 p-1.5">
                        <div className="truncate text-ui-ink">{m.payload}</div>
                        {m.headers && (m.headers["x-error"] as string) && (
                          <div className="mt-0.5 text-rose-500">
                            attempt {String(m.headers["x-attempt"] ?? "?")}: {String(m.headers["x-error"])}
                          </div>
                        )}
                      </li>
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
        {tasks.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-ui-border/50 bg-ui-bg px-3 py-1.5 text-ui-xs"
              >
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-ui-2xs font-medium ${statusColor(t.status)}`}>
                  {t.status}
                </span>
                <span className="w-14 shrink-0 text-ui-ink-muted">{t.type}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-ui-ink">{t.sha256}</span>
                <span className="shrink-0 text-ui-2xs text-ui-ink-muted">attempts {t.attempts}</span>
                {t.error && <span className="shrink-0 truncate text-rose-500" title={t.error}>err</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

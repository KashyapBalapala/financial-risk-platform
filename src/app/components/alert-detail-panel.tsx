"use client";

import { useEffect, useRef, useState } from "react";

export type AlertStatus = "OPEN" | "INVESTIGATING" | "CLOSED";

export type AlertDetailView = {
  id: string;
  transactionId: string;
  ruleCode: string;
  severity: string;
  status: string;
  reason: string;
  createdAt: string;
  evidence: Record<string, unknown>;
  accountReference: string;
  amount: string;
  currency: string;
  transactionType: string;
  transactionStatus: string;
};

type AlertDetailPanelProps = {
  alert: AlertDetailView;
  pending: boolean;
  error: string | null;
  success: string | null;
  auditRefreshKey: number;
  onClose: () => void;
  onStatusChange: (status: AlertStatus) => void;
};

const transitions: Record<AlertStatus, AlertStatus[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["OPEN", "CLOSED"],
  CLOSED: [],
};

const transitionLabel: Record<AlertStatus, string> = {
  OPEN: "Reopen",
  INVESTIGATING: "Start investigation",
  CLOSED: "Resolve and close",
};

function isAlertStatus(value: string): value is AlertStatus {
  return (
    value === "OPEN" ||
    value === "INVESTIGATING" ||
    value === "CLOSED"
  );
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || currency.length !== 3) {
    return amount && currency ? `${amount} ${currency}` : "Unknown amount";
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatEvidenceValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function evidenceEntries(
  evidence: Record<string, unknown>,
): Array<[string, string]> {
  return Object.entries(evidence).map(([key, value]) => [
    key,
    formatEvidenceValue(value),
  ]);
}

export function AlertDetailPanel({
  alert,
  pending,
  error,
  success,
  auditRefreshKey,
  onClose,
  onStatusChange,
}: AlertDetailPanelProps) {
  const currentStatus = isAlertStatus(alert.status) ? alert.status : null;
  const nextStatuses = currentStatus ? transitions[currentStatus] : [];
  const evidence = evidenceEntries(alert.evidence);

  return (
    <aside
      aria-labelledby="alert-detail-heading"
      className="border-t border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-t-0 lg:border-l"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Selected alert
          </p>
          <h2
            id="alert-detail-heading"
            className="mt-1 text-lg font-semibold text-slate-900"
          >
            {alert.ruleCode}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close alert details"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
        >
          Close
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        <section aria-labelledby="alert-fields-heading">
          <h3 id="alert-fields-heading" className="text-sm font-semibold">
            Alert
          </h3>
          <dl className="mt-3 space-y-3 text-sm">
            <DetailItem label="Alert ID" value={alert.id} mono />
            <DetailItem label="Rule code" value={alert.ruleCode} />
            <DetailItem label="Severity" value={alert.severity} />
            <DetailItem label="Status" value={alert.status} />
            <DetailItem label="Reason" value={alert.reason} />
            <DetailItem
              label="Created"
              value={formatTimestamp(alert.createdAt)}
            />
          </dl>
        </section>

        <section aria-labelledby="transaction-fields-heading">
          <h3
            id="transaction-fields-heading"
            className="text-sm font-semibold"
          >
            Transaction
          </h3>
          <dl className="mt-3 space-y-3 text-sm">
            <DetailItem
              label="Transaction ID"
              value={alert.transactionId}
              mono
            />
            <DetailItem
              label="Account reference"
              value={alert.accountReference}
            />
            <DetailItem
              label="Amount"
              value={formatAmount(alert.amount, alert.currency)}
            />
            <DetailItem
              label="Transaction type"
              value={alert.transactionType}
            />
            <DetailItem
              label="Transaction status"
              value={alert.transactionStatus}
            />
          </dl>
        </section>

        <section aria-labelledby="evidence-heading">
          <h3 id="evidence-heading" className="text-sm font-semibold">
            Risk evidence
          </h3>
          {evidence.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No additional evidence available
            </p>
          ) : (
            <dl className="mt-3 space-y-3 text-sm">
              {evidence.map(([key, value]) => (
                <DetailItem key={key} label={key} value={value} />
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="status-actions-heading">
          <h3 id="status-actions-heading" className="text-sm font-semibold">
            Investigation status
          </h3>
          {nextStatuses.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              {currentStatus === "CLOSED"
                ? "Closed alerts cannot change status."
                : "No status changes are available for this alert."}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {nextStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending}
                  onClick={() => onStatusChange(status)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "Updating…" : transitionLabel[status]}
                </button>
              ))}
            </div>
          )}
          <div aria-live="polite" className="mt-3 text-sm">
            {pending ? (
              <p className="text-slate-600">Saving status change…</p>
            ) : null}
            {error ? <p className="text-red-700">{error}</p> : null}
            {success ? <p className="text-emerald-800">{success}</p> : null}
          </div>
        </section>

        <InvestigationHistory
          alertId={alert.id}
          refreshKey={auditRefreshKey}
        />
      </div>
    </aside>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? "mt-0.5 font-mono text-xs break-all text-slate-900"
            : "mt-0.5 break-words text-slate-900"
        }
      >
        {value || "Unknown"}
      </dd>
    </div>
  );
}

const AUDIT_PAGE_SIZE = 20;

type AuditRecord = {
  id: string;
  alertId: string;
  transactionId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditPagination = {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
};

type HistoryState = {
  alertId: string;
  refreshKey: number;
  records: AuditRecord[];
  hasMore: boolean;
  nextOffset: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  moreError: string | null;
};

function InvestigationHistory({
  alertId,
  refreshKey,
}: {
  alertId: string;
  refreshKey: number;
}) {
  const [history, setHistory] = useState<HistoryState>(() => ({
    alertId,
    refreshKey,
    records: [],
    hasMore: false,
    nextOffset: 0,
    loading: true,
    loadingMore: false,
    error: null,
    moreError: null,
  }));
  const [retryCount, setRetryCount] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  if (history.alertId !== alertId || history.refreshKey !== refreshKey) {
    setHistory({
      alertId,
      refreshKey,
      records: [],
      hasMore: false,
      nextOffset: 0,
      loading: true,
      loadingMore: false,
      error: null,
      moreError: null,
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => {
      void loadAuditPage({
        alertId,
        offset: 0,
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted || result.aborted) {
          return;
        }
        setHistory((current) => {
          if (current.alertId !== alertId || current.refreshKey !== refreshKey) {
            return current;
          }
          if (!result.ok) {
            return {
              ...current,
              records: [],
              hasMore: false,
              nextOffset: 0,
              loading: false,
              loadingMore: false,
              error: result.error,
            };
          }
          return {
            ...current,
            records: result.records,
            hasMore: result.pagination.hasMore,
            nextOffset: result.pagination.offset + result.pagination.returned,
            loading: false,
            loadingMore: false,
            error: null,
            moreError: null,
          };
        });
      });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      activeRequest.current?.abort();
    };
  }, [alertId, refreshKey, retryCount]);

  async function loadMore() {
    const requestedAlertId = alertId;
    const requestedRefreshKey = refreshKey;
    const offset = history.nextOffset;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setHistory((current) =>
      current.alertId === requestedAlertId &&
      current.refreshKey === requestedRefreshKey
        ? { ...current, loadingMore: true, moreError: null }
        : current,
    );
    const result = await loadAuditPage({
      alertId,
      offset,
      signal: controller.signal,
    });
    if (controller.signal.aborted || result.aborted) {
      return;
    }
    setHistory((current) => {
      if (
        current.alertId !== requestedAlertId ||
        current.refreshKey !== requestedRefreshKey
      ) {
        return current;
      }
      if (!result.ok) {
        return {
          ...current,
          loadingMore: false,
          moreError: result.error,
        };
      }
      return {
        ...current,
        loadingMore: false,
        moreError: null,
        records: appendAuditRecords(current.records, result.records),
        hasMore: result.pagination.hasMore,
        nextOffset: result.pagination.offset + result.pagination.returned,
      };
    });
  }

  const { records, hasMore, loading, loadingMore, error, moreError } = history;

  return (
    <section aria-labelledby="investigation-history-heading">
      <h3 id="investigation-history-heading" className="text-sm font-semibold">
        Investigation History
      </h3>
      {loading ? (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Loading investigation history…
        </p>
      ) : error ? (
        <div className="mt-3" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => {
              setHistory((current) => ({
                ...current,
                loading: true,
                loadingMore: false,
                error: null,
                moreError: null,
              }));
              setRetryCount((count) => count + 1);
            }}
            className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Retry
          </button>
        </div>
      ) : records.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No audit events recorded.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {records.map((record, index) => (
            <li key={record.id} className="relative pb-5 pl-6">
              {index < records.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-2 bottom-0 left-[7px] w-px bg-slate-200"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="absolute top-1.5 left-0 h-4 w-4 rounded-full border-2 border-white bg-slate-400 ring-1 ring-slate-300"
              />
              <p className="text-sm font-medium text-slate-900">
                {record.action || "Unknown action"}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-800">
                <StatusChip status={record.previousStatus} />
                <span aria-hidden="true">→</span>
                <span className="sr-only"> to </span>
                <StatusChip status={record.newStatus} />
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Recorded by {record.actorLabel} ({record.actorType})
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatTimestamp(record.createdAt)}
              </p>
              <AuditMetadata metadata={record.metadata} />
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
                  Audit record ID
                </summary>
                <p className="mt-1 font-mono text-xs break-all text-slate-700">
                  {record.id}
                </p>
              </details>
            </li>
          ))}
        </ol>
      )}
      {moreError ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {moreError}
        </p>
      ) : null}
      {hasMore && !loading && !error ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore ? "Loading more…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

function StatusChip({ status }: { status: string }) {
  const className =
    status === "OPEN"
      ? "bg-red-50 text-red-800 ring-red-200"
      : status === "INVESTIGATING"
        ? "bg-amber-50 text-amber-900 ring-amber-200"
        : status === "CLOSED"
          ? "bg-slate-100 text-slate-700 ring-slate-200"
          : "bg-sky-50 text-sky-900 ring-sky-200";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${className}`}
    >
      {status || "Unknown"}
    </span>
  );
}

function AuditMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return null;
  }

  return (
    <dl className="mt-2 space-y-1 text-xs text-slate-600">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="inline font-medium">{key}: </dt>
          <dd className="inline break-all">{formatEvidenceValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

async function loadAuditPage({
  alertId,
  offset,
  signal,
}: {
  alertId: string;
  offset: number;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; aborted: false; records: AuditRecord[]; pagination: AuditPagination }
  | { ok: false; aborted: boolean; error: string }
> {
  try {
    const response = await fetch(
      `/api/alerts/${alertId}/audit?limit=${AUDIT_PAGE_SIZE}&offset=${offset}`,
      { signal },
    );
    if (!response.ok) {
      return { ok: false, aborted: false, error: await readAuditError(response) };
    }
    const parsed = parseAuditPage(await response.json());
    if (!parsed) {
      return {
        ok: false,
        aborted: false,
        error: "The audit history response was not in the expected format.",
      };
    }
    return {
      ok: true,
      aborted: false,
      records: parsed.data,
      pagination: parsed.pagination,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, aborted: true, error: "" };
    }
    return {
      ok: false,
      aborted: false,
      error: "Unable to reach the audit history API.",
    };
  }
}

function appendAuditRecords(
  current: AuditRecord[],
  incoming: AuditRecord[],
): AuditRecord[] {
  const seen = new Set(current.map((record) => record.id));
  return [
    ...current,
    ...incoming.filter((record) => !seen.has(record.id)),
  ];
}

function parseAuditPage(
  value: unknown,
): { data: AuditRecord[]; pagination: AuditPagination } | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const pagination = parseAuditPagination(value.pagination);
  if (!pagination) {
    return null;
  }
  return {
    data: value.data.flatMap((item) => {
      const record = parseAuditRecord(item);
      return record ? [record] : [];
    }),
    pagination,
  };
}

function parseAuditPagination(value: unknown): AuditPagination | null {
  if (!isRecord(value)) {
    return null;
  }
  const { limit, offset, returned, hasMore } = value;
  if (
    typeof limit !== "number" ||
    typeof offset !== "number" ||
    typeof returned !== "number" ||
    typeof hasMore !== "boolean"
  ) {
    return null;
  }
  return { limit, offset, returned, hasMore };
}

function parseAuditRecord(value: unknown): AuditRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    alertId: readString(value.alertId),
    transactionId: readString(value.transactionId),
    action: readString(value.action, "Unknown action"),
    previousStatus: readString(value.previousStatus, "Unknown"),
    newStatus: readString(value.newStatus, "Unknown"),
    actorType: readString(value.actorType, "Unknown type"),
    actorId: typeof value.actorId === "string" ? value.actorId : null,
    actorLabel: readString(value.actorLabel, "Unknown actor"),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    createdAt: readString(value.createdAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function readAuditError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    return `Request failed (${response.status}).`;
  }
  return `Request failed (${response.status}).`;
}

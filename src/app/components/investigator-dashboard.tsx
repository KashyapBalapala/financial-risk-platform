"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  AlertDetailPanel,
  formatAmount,
  formatTimestamp,
  type AlertDetailView,
  type AlertStatus,
} from "./alert-detail-panel";

const PAGE_SIZE = 20;

type StatusFilter = "ALL" | AlertStatus;
type SeverityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

type AlertListItem = {
  id: string;
  transactionId: string;
  ruleCode: string;
  severity: string;
  reason: string;
  evidence: Record<string, unknown>;
  status: string;
  createdAt: string;
  transaction: {
    accountReference: string;
    amount: string;
    currency: string;
    transactionType: string;
    transactionStatus: string;
  };
};

type Pagination = {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
};

export function InvestigatorDashboard({
  investigatorName,
}: {
  investigatorName: string;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [alerts, setAlerts] = useState<AlertListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlertDetailView | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    const result = await authClient.signOut();
    if (result.error) {
      setSigningOut(false);
      setSignOutError("Unable to sign out. Try again.");
      return;
    }
    router.push("/login");
    router.refresh();
  }

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (statusFilter !== "ALL") {
      params.set("status", statusFilter);
    }

    try {
      const response = await fetch(`/api/alerts?${params.toString()}`);
      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const parsed = parseAlertList(await response.json());
      if (!parsed) {
        setError("The alerts response was not in the expected format.");
        return;
      }

      setAlerts(parsed.data);
      setPagination(parsed.pagination);
    } catch {
      setError("Unable to reach the alerts API.");
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAlerts();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadAlerts]);

  const visibleAlerts = alerts.filter((alert) => {
    if (severityFilter !== "ALL" && alert.severity !== severityFilter) {
      return false;
    }
    const query = search.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [
      alert.ruleCode,
      alert.reason,
      alert.transaction.accountReference,
      alert.id,
    ].some((value) => value.toLowerCase().includes(query));
  });

  function selectAlert(alert: AlertListItem) {
    setSelectedId(alert.id);
    setDetail(detailFromListItem(alert));
    setStatusError(null);
    setStatusSuccess(null);
  }

  function clearFilters() {
    setStatusFilter("ALL");
    setSeverityFilter("ALL");
    setSearch("");
    setOffset(0);
  }

  async function changeStatus(nextStatus: AlertStatus) {
    if (!detail) {
      return;
    }

    const alertId = detail.id;
    setStatusPending(true);
    setStatusError(null);
    setStatusSuccess(null);

    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        setStatusError(await readError(response));
        return;
      }

      await loadAlerts();

      const detailResponse = await fetch(`/api/alerts/${alertId}`);
      if (!detailResponse.ok) {
        setStatusError(await readError(detailResponse));
        return;
      }

      const updated = parseAlertDetail(await detailResponse.json());
      if (!updated) {
        setStatusError("The updated alert could not be read.");
        return;
      }

      setSelectedId(updated.id);
      setDetail(updated);
      setStatusSuccess(`Status updated to ${updated.status}.`);
      setAuditRefreshKey((key) => key + 1);
    } catch {
      setStatusError("Unable to reach the alerts API.");
    } finally {
      setStatusPending(false);
    }
  }

  const openCount = alerts.filter((alert) => alert.status === "OPEN").length;
  const investigatingCount = alerts.filter(
    (alert) => alert.status === "INVESTIGATING",
  ).length;
  const highCount = alerts.filter((alert) => alert.severity === "HIGH").length;
  const loadedCount = pagination?.returned ?? alerts.length;
  const rangeStart = loadedCount === 0 ? 0 : offset + 1;
  const rangeEnd = offset + loadedCount;

  return (
    <div className="min-h-screen min-w-0 max-w-full bg-slate-100 text-slate-900">
      <header className="border-b border-slate-800 bg-slate-900 text-white lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">RiskLens</p>
            <p className="text-xs text-slate-300">Transaction Surveillance</p>
          </div>
          <button
            type="button"
            aria-expanded={navOpen}
            aria-controls="mobile-nav"
            onClick={() => setNavOpen((open) => !open)}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            {navOpen ? "Hide menu" : "Menu"}
          </button>
        </div>
        {navOpen ? (
          <nav id="mobile-nav" aria-label="Primary" className="px-4 pb-4">
            <Navigation />
            <p className="mt-4 text-xs text-slate-400">Risk Operations</p>
          </nav>
        ) : null}
      </header>

      <div className="min-w-0 max-w-full lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between lg:bg-slate-900 lg:px-4 lg:py-6 lg:text-white">
          <div>
            <p className="text-lg font-semibold">RiskLens</p>
            <p className="mt-1 text-sm text-slate-300">
              Transaction Surveillance
            </p>
            <nav aria-label="Primary" className="mt-8">
              <Navigation />
            </nav>
          </div>
          <p className="text-xs text-slate-400">Risk Operations</p>
        </aside>

        <div
          className={
            detail
              ? "min-w-0 max-w-full lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]"
              : "min-w-0 max-w-full"
          }
        >
          <main className="min-w-0 max-w-full px-4 py-6 sm:px-6 lg:px-8">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-slate-500">
                  Risk Operations / Alerts
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                  Alert Management
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Review flagged transactions and manage investigations
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Signed in as {investigatorName}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadAlerts()}
                  disabled={loading}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </header>
            {signOutError ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {signOutError}
              </p>
            ) : null}

            <section
              id="overview"
              aria-labelledby="summary-heading"
              className="mt-6"
            >
              <h2 id="summary-heading" className="sr-only">
                Loaded alert summary
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Open Alerts"
                  value={openCount}
                  note="On this page"
                  tone="red"
                />
                <SummaryCard
                  label="Investigating"
                  value={investigatingCount}
                  note="On this page"
                  tone="amber"
                />
                <SummaryCard
                  label="High Severity"
                  value={highCount}
                  note="On this page"
                  tone="slate"
                />
                <SummaryCard
                  label="Loaded Alerts"
                  value={loadedCount}
                  note="This page"
                  tone="blue"
                />
              </div>
            </section>

            <section id="alerts" aria-labelledby="alerts-heading" className="mt-6 min-w-0 max-w-full">
              <div className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-4">
                  <h2 id="alerts-heading" className="text-base font-semibold">
                    Alerts
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Severity and search apply only to the alerts loaded on
                    this page. Status and page controls are sent to the API.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <label className="text-sm font-medium text-slate-700">
                      Status
                      <select
                        value={statusFilter}
                        onChange={(event) => {
                          setStatusFilter(event.target.value as StatusFilter);
                          setOffset(0);
                        }}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                      >
                        <option value="ALL">All statuses</option>
                        <option value="OPEN">OPEN</option>
                        <option value="INVESTIGATING">INVESTIGATING</option>
                        <option value="CLOSED">CLOSED</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      Severity
                      <select
                        value={severityFilter}
                        onChange={(event) =>
                          setSeverityFilter(
                            event.target.value as SeverityFilter,
                          )
                        }
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                      >
                        <option value="ALL">All severities</option>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700 md:col-span-2">
                      Search loaded alerts
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Rule, reason, account, or alert ID"
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                      />
                    </label>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-sm font-medium text-sky-800 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                    <p>{error}</p>
                    <button
                      type="button"
                      onClick={() => void loadAlerts()}
                      className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}

                {loading && alerts.length === 0 ? (
                  <p className="px-4 py-10 text-sm text-slate-600" role="status">
                    Loading alerts…
                  </p>
                ) : visibleAlerts.length === 0 ? (
                  <p className="px-4 py-10 text-sm text-slate-600">
                    No alerts match the selected filters.
                  </p>
                ) : (
                  <div className="relative w-full min-w-0 max-w-full overflow-x-auto">
                    <table className="min-w-[760px] w-full text-left text-sm">
                      <caption className="sr-only">
                        Flagged transactions on the current page
                      </caption>
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                        <tr>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Severity
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Alert / Rule
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Account
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Transaction
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Status
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Created
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            <span className="sr-only">Row action</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAlerts.map((alert) => {
                          const selected = alert.id === selectedId;
                          return (
                            <tr
                              key={alert.id}
                              aria-selected={selected}
                              onClick={() => selectAlert(alert)}
                              className={
                                selected
                                  ? "cursor-pointer border-b border-slate-200 bg-sky-50"
                                  : "cursor-pointer border-b border-slate-200 hover:bg-slate-50"
                              }
                            >
                              <td className="px-4 py-3">
                                <SeverityBadge severity={alert.severity} />
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium">{alert.ruleCode}</p>
                                <p className="mt-1 max-w-xs truncate text-slate-600">
                                  {alert.reason}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                {alert.transaction.accountReference}
                              </td>
                              <td className="px-4 py-3">
                                <p>
                                  {formatAmount(
                                    alert.transaction.amount,
                                    alert.transaction.currency,
                                  )}
                                </p>
                                <p className="text-slate-600">
                                  {alert.transaction.transactionType}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={alert.status} />
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {formatTimestamp(alert.createdAt)}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    selectAlert(alert);
                                  }}
                                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                                >
                                  View details
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-col gap-3 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Showing {rangeStart}–{rangeEnd}
                    {pagination?.hasMore ? "" : " of the loaded results"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOffset((current) =>
                          Math.max(0, current - PAGE_SIZE),
                        )
                      }
                      disabled={loading || offset === 0}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOffset((current) => current + PAGE_SIZE)
                      }
                      disabled={loading || !pagination?.hasMore}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </main>

          {detail ? (
            <AlertDetailPanel
              alert={detail}
              pending={statusPending}
              error={statusError}
              success={statusSuccess}
              auditRefreshKey={auditRefreshKey}
              onClose={() => {
                setSelectedId(null);
                setDetail(null);
                setStatusError(null);
                setStatusSuccess(null);
              }}
              onStatusChange={(status) => void changeStatus(status)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Navigation() {
  return (
    <ul className="space-y-1">
      <li>
        <a
          href="#overview"
          className="block rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
        >
          Overview
        </a>
      </li>
      <li>
        <a
          href="#alerts"
          aria-current="page"
          className="block rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
        >
          Alerts
        </a>
      </li>
      <li>
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-slate-400 disabled:cursor-not-allowed"
        >
          Transactions
          <span className="text-xs">Coming soon</span>
        </button>
      </li>
      <li>
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-slate-400 disabled:cursor-not-allowed"
        >
          Rules
          <span className="text-xs">Coming soon</span>
        </button>
      </li>
    </ul>
  );
}

function SummaryCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  tone: "red" | "amber" | "slate" | "blue";
}) {
  const toneClass = {
    red: "bg-red-600",
    amber: "bg-amber-500",
    slate: "bg-slate-500",
    blue: "bg-sky-700",
  }[tone];

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-600">{label}</h3>
        <span
          aria-hidden="true"
          className={`inline-block h-2.5 w-2.5 rounded-full ${toneClass}`}
        />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </article>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === "HIGH"
      ? "bg-red-50 text-red-800 ring-red-200"
      : severity === "MEDIUM"
        ? "bg-amber-50 text-amber-900 ring-amber-200"
        : "bg-slate-100 text-slate-700 ring-slate-200";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${className}`}
    >
      {severity || "UNKNOWN"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
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
      {status || "UNKNOWN"}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseAlertList(
  value: unknown,
): { data: AlertListItem[]; pagination: Pagination } | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }

  const pagination = parsePagination(value.pagination);
  if (!pagination) {
    return null;
  }

  const data = value.data.flatMap((item) => {
    const parsed = parseListItem(item);
    return parsed ? [parsed] : [];
  });

  return { data, pagination };
}

function parsePagination(value: unknown): Pagination | null {
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

function parseListItem(value: unknown): AlertListItem | null {
  if (!isRecord(value) || !isRecord(value.transaction)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  const transaction = value.transaction;
  return {
    id,
    transactionId: readString(value.transactionId),
    ruleCode: readString(value.ruleCode, "Unknown rule"),
    severity: readString(value.severity, "UNKNOWN"),
    reason: readString(value.reason, "No reason recorded"),
    evidence: isRecord(value.evidence) ? value.evidence : {},
    status: readString(value.status, "UNKNOWN"),
    createdAt: readString(value.createdAt),
    transaction: {
      accountReference: readString(
        transaction.accountReference,
        "Unknown account",
      ),
      amount: readString(transaction.amount),
      currency: readString(transaction.currency),
      transactionType: readString(transaction.transactionType, "Unknown"),
      transactionStatus: readString(transaction.transactionStatus, "Unknown"),
    },
  };
}

function detailFromListItem(alert: AlertListItem): AlertDetailView {
  return {
    id: alert.id,
    transactionId: alert.transactionId,
    ruleCode: alert.ruleCode,
    severity: alert.severity,
    status: alert.status,
    reason: alert.reason,
    createdAt: alert.createdAt,
    evidence: alert.evidence,
    accountReference: alert.transaction.accountReference,
    amount: alert.transaction.amount,
    currency: alert.transaction.currency,
    transactionType: alert.transaction.transactionType,
    transactionStatus: alert.transaction.transactionStatus,
  };
}

function parseAlertDetail(value: unknown): AlertDetailView | null {
  if (!isRecord(value) || !isRecord(value.alert) || !isRecord(value.transaction)) {
    return null;
  }

  const alert = value.alert;
  const transaction = value.transaction;
  const id = readString(alert.id);
  if (!id) {
    return null;
  }

  return {
    id,
    transactionId: readString(alert.transactionId, readString(transaction.id)),
    ruleCode: readString(alert.ruleCode, "Unknown rule"),
    severity: readString(alert.severity, "UNKNOWN"),
    status: readString(alert.status, "UNKNOWN"),
    reason: readString(alert.reason, "No reason recorded"),
    createdAt: readString(alert.createdAt),
    evidence: isRecord(alert.evidence) ? alert.evidence : {},
    accountReference: readString(transaction.accountReference, "Unknown account"),
    amount: readString(transaction.amount),
    currency: readString(transaction.currency),
    transactionType: readString(transaction.transactionType, "Unknown"),
    transactionStatus: readString(transaction.status, "Unknown"),
  };
}

async function readError(response: Response): Promise<string> {
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

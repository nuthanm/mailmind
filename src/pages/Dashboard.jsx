// src/pages/Dashboard.jsx
import { useState } from "react";
import { useApp } from "../lib/AppContext";
import Sidebar from "../components/Sidebar";
import EmailList from "../components/EmailList";
import RightPanel from "../components/RightPanel";
import AlertBar from "../components/AlertBar";
import ResizableLayout from "../components/ResizableLayout";
import { SAMPLE_EMAILS } from "../lib/samples";
import { gmailApi } from "../lib/gmailApi";

export default function Dashboard() {
  return (
    <ResizableLayout
      left={<Sidebar />}
      center={
        <div className="main-panel">
          <MainToolbar />
          <AlertBar />
          <EmailList />
        </div>
      }
      right={<RightPanel />}
    />
  );
}

function MainToolbar() {
  const {
    filter,
    setFilter,
    runAgent,
    running,
    addEmails,
    refreshMe,
    showToast,
    showAlert,
    gmailAccounts,
    activeAccountId,
    setActiveAccountId,
    fetchEmailsSSE,
    fetchProgress,
    setFetchProgress,
    stats,
  } = useApp();
  const [syncing, setSyncing] = useState(false);
  const filters = [
    { id: "all", label: "All" },
    { id: "extracted", label: "Extracted" },
    { id: "action", label: "Action" },
    { id: "draft", label: "Drafts" },
  ];
  const loadSamples = () => addEmails(SAMPLE_EMAILS);
  const connectAnotherGmail = async () => {
    try {
      const result = await gmailApi.startConnectPopup();
      await refreshMe();
      if (result?.connected) {
        showToast(`Connected: ${result.connected}`);
      } else if (result?.error) {
        showAlert("error", result.error);
      }
    } catch (e) {
      showAlert("error", e.message);
    }
  };

  const syncGmail = async () => {
    if (gmailAccounts.length === 0) {
      showAlert(
        "error",
        'No Gmail account connected. Use "+ Connect Gmail Account" first.',
      );
      return;
    }
    setSyncing(true);
    try {
      const accountsToSync =
        activeAccountId === "all"
          ? gmailAccounts
          : gmailAccounts.filter((a) => a.id === activeAccountId);

      for (const acc of accountsToSync) {
        showAlert("processing", `Syncing ${acc.email}…`);
        await fetchEmailsSSE(acc.id, { query: "in:inbox", maxEmails: 50 });
      }
      showAlert(
        "success",
        `✓ Gmail synced — ${stats.total} email${stats.total !== 1 ? "s" : ""} in app`,
      );
    } catch (e) {
      showAlert("error", e.message);
    } finally {
      setSyncing(false);
      setFetchProgress(null);
    }
  };

  return (
    <div className="main-toolbar">
      <div className="toolbar-left">
        <span className="view-label">Inbox</span>
        <div className="filter-bar">
          {filters.map((f) => (
            <button
              key={f.id}
              className={`filter-btn${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="account-select"
          value={activeAccountId}
          onChange={(e) => setActiveAccountId(e.target.value)}
        >
          <option value="all">All Gmail accounts</option>
          {gmailAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.email}
            </option>
          ))}
        </select>
        {stats.total > 0 && (
          <span className="toolbar-email-count">
            {stats.total} email{stats.total !== 1 ? "s" : ""} loaded
          </span>
        )}
      </div>
      <div className="toolbar-right">
        <button className="btn-ghost" onClick={connectAnotherGmail}>
          + Connect Gmail
        </button>
        <button
          className="btn-ghost sync-btn"
          onClick={syncGmail}
          disabled={syncing || running}
        >
          {syncing ? (
            <>
              <div
                className="spin-sm"
                style={{
                  borderTopColor: "var(--ink)",
                  borderColor: "var(--border)",
                }}
              ></div>
              {fetchProgress
                ? ` ${fetchProgress.inserted || 0} fetched…`
                : " Syncing…"}
            </>
          ) : (
            "⟳ Sync Gmail"
          )}
        </button>
        <button className="btn-ghost" onClick={loadSamples}>
          ↺ Load Samples
        </button>
        <button className="run-btn" onClick={runAgent} disabled={running}>
          {running ? (
            <>
              <div
                className="spin-sm"
                style={{
                  borderTopColor: "#fff",
                  borderColor: "rgba(255,255,255,.3)",
                }}
              ></div>{" "}
              Running…
            </>
          ) : (
            <>▶ Run Agent</>
          )}
        </button>
      </div>
    </div>
  );
}

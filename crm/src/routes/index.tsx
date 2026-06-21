import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  connectSSE, createJob as apiCreateJob, patchJob, deleteJob as apiDeleteJob,
  serverJobToRow, colorForCompany, statusToStage,
  type SSESnapshot, type SSEUpdatePayload,
} from "../lib/crm-server";
import {
  Search,
  Plus,
  Briefcase,
  Users,
  CheckSquare,
  StickyNote,
  LayoutDashboard,
  Settings,
  MoreHorizontal,
  X,
  SlidersHorizontal,
  Bell,
  Send,
  Sparkles,
  ChevronRight,
  Pencil,
  Check,
  Trash2,
  User,
  Mail,
  MessageCircle,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Opportunities · Pathway" },
      { name: "description", content: "A calm, focused tracker for student internships and applications." },
    ],
  }),
  component: Index,
});

type Status = "Saved" | "Applied" | "Interview" | "Rejected" | "Awarded";

type Row = {
  id: string;
  name: string;
  org: string;
  type: string;
  notes: string;
  deadline: string;
  status: Status;
  added: string;
  color: string;
};

const ACCENT = "#534AB7";
const SURFACE = "#f9f9fb";

const initialRows: Row[] = [];

const palette = ["#534AB7", "#635BFF", "#F24E1E", "#1DB954", "#D97757", "#5E6AD2", "#7D6CFF", "#0EA5E9"];

const statusDot: Record<Status, string> = {
  Saved: "#94A3B8",
  Applied: "#3B82F6",
  Interview: "#F59E0B",
  Rejected: "#EF4444",
  Awarded: "#16A34A",
};

const navItems = [
  { label: "Opportunities", icon: Briefcase },
  { label: "Contacts", icon: Users },
  { label: "Tasks", icon: CheckSquare },
  { label: "Notes", icon: StickyNote },
  { label: "Dashboard", icon: LayoutDashboard },
] as const;
type View = (typeof navItems)[number]["label"];

const pillFilters = ["All", "Applied", "Interview", "Saved", "Rejected"] as const;
type Pill = (typeof pillFilters)[number];

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function daysUntil(dateStr: string): number | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function Index() {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState({
    name: "Sujan Nandikol",
    school: "University",
    grade: "Student",
    interests: "AI, full-stack, agentic systems",
  });
  const [pill, setPill] = useState<Pill>("All");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("Opportunities");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState({ name: "", org: "", type: "Internship", notes: "", deadline: "", status: "Saved" as Status });
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>(() => {
    const up = initialRows
      .map((r) => ({ r, d: daysUntil(r.deadline) }))
      .filter((x): x is { r: Row; d: number } => x.d != null && x.d >= 0)
      .sort((a, b) => a.d - b.d);
    const next = up[0];
    const greeting = next
      ? `Morning, Alex 👋 Your most urgent deadline is ${next.r.name} at ${next.r.org} — ${next.d === 0 ? "due today" : `${next.d} day${next.d === 1 ? "" : "s"} left`}. Want help prepping?`
      : "Morning, Alex 👋 No urgent deadlines on the board — good time to add new opportunities.";
    return [{ role: "ai", text: greeting }];
  });
  const [input, setInput] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Row | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Live sync from CRM server ──────────────────────────────────────────
  const rowsFromServer = useCallback((jobs: Record<string, unknown>) => {
    const mapped = Object.values(jobs).map((j) => serverJobToRow(j as Parameters<typeof serverJobToRow>[0])) as Row[];
    setRows(mapped);
  }, []);

  useEffect(() => {
    const disconnect = connectSSE({
      onSnapshot: (snap: SSESnapshot) => {
        setConnected(true);
        rowsFromServer(snap.jobs as Record<string, unknown>);
      },
      onUpdate: (payload: SSEUpdatePayload) => {
        if (payload.deleted_id) {
          setRows((prev) => prev.filter((r) => r.id !== payload.deleted_id));
          setSelected((s) => (s?.id === payload.deleted_id ? null : s));
          return;
        }
        if (payload.updated?.length) {
          const updates = payload.updated.map((j) => serverJobToRow(j) as Row);
          setRows((prev) => {
            const map = new Map(prev.map((r) => [r.id, r]));
            for (const u of updates) map.set(u.id, u);
            return Array.from(map.values());
          });
        }
      },
    });
    return disconnect;
  }, [rowsFromServer]);

  const openRow = (r: Row) => {
    setSelected(r);
    setEditing(false);
    setEditForm(r);
  };

  const saveEdit = async () => {
    if (!editForm) return;
    setRows((rs) => rs.map((r) => (r.id === editForm.id ? editForm : r)));
    setSelected(editForm);
    setEditing(false);
    try {
      await patchJob(editForm.id, {
        stage: statusToStage(editForm.status),
        notes: editForm.notes,
        deadline: editForm.deadline !== "—" ? editForm.deadline : "",
        type: editForm.type,
      });
    } catch { /* server down — local state already updated */ }
  };

  const deleteRow = async (id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setSelected(null);
    setEditing(false);
    try { await apiDeleteJob(id); } catch {}
  };

  const replyFor = (q: string): string => {
    const t = q.toLowerCase();
    const withDays = rows
      .map((r) => ({ r, d: daysUntil(r.deadline) }))
      .filter((x): x is { r: Row; d: number } => x.d != null);
    const upcoming = withDays.filter((x) => x.d >= 0).sort((a, b) => a.d - b.d);
    const next = upcoming[0];
    const counts: Record<Status, number> = { Saved: 0, Applied: 0, Interview: 0, Rejected: 0, Awarded: 0 };
    rows.forEach((r) => counts[r.status]++);
    const who = profile.name.split(" ")[0] || "there";
    const ctx = `${profile.grade} at ${profile.school} focused on ${profile.interests}`;

    if (/deadline|due|soon|upcoming|next|summari/.test(t)) {
      if (!next) return "You don't have any upcoming deadlines on the board right now.";
      const list = upcoming.slice(0, 5).map((x) => `• ${x.r.name} (${x.r.org}) — ${x.d === 0 ? "today" : `${x.d}d`}`).join("\n");
      return `${who}, your next deadline is ${next.r.name} at ${next.r.org} in ${next.d} day${next.d === 1 ? "" : "s"}.\n\n${list}`;
    }
    if (/what should i (work|do)|priorit|focus/.test(t)) {
      if (!next) return `Nothing urgent right now, ${who}. Good time to add 2–3 opportunities aligned with ${profile.interests}.`;
      const iv = rows.filter((r) => r.status === "Interview").map((r) => r.org);
      const ivLine = iv.length ? ` Also prep for interviews at ${iv.join(", ")}.` : "";
      return `Focus on ${next.r.name} at ${next.r.org} — ${next.d}d left. You're a ${ctx}, so lead with the most relevant projects.${ivLine}`;
    }
    if (/status|summary|overview|how many|progress/.test(t)) {
      return `Here's your board, ${who}: ${counts.Applied} applied, ${counts.Interview} in interview, ${counts.Saved} saved, ${counts.Awarded} awarded, ${counts.Rejected} rejected.`;
    }
    if (/interview/.test(t)) {
      const ivs = rows.filter((r) => r.status === "Interview");
      if (!ivs.length) return "No active interviews — want me to prep questions for any saved roles?";
      return `You have ${ivs.length} interview${ivs.length === 1 ? "" : "s"}: ${ivs.map((r) => `${r.name} (${r.org})`).join(", ")}.`;
    }
    if (/cover letter|cover-letter/.test(t)) {
      const target = next ? `${next.r.name} at ${next.r.org}` : "your top role";
      return `Cover letter draft — ${target}\n\nDear Hiring Team,\n\nI'm ${profile.name}, a ${profile.grade} at ${profile.school} focused on ${profile.interests}. ${next ? `${next.r.org}'s work is exactly where I want to spend my next term — ` : ""}I'd bring hands-on experience and a bias for shipping.\n\nMy notes on ${target} point to a strong fit with the team's roadmap, and I'd love the chance to contribute.\n\nBest,\n${profile.name}`;
    }
    if (/mock|practice|prep/.test(t)) {
      return `Let's run a mock round. I'll start with a behavioral question tailored to ${next?.r.org ?? "your top opportunity"} — ready when you are.`;
    }
    if (/hi|hello|hey|morning/.test(t)) {
      return `Hey ${who} — you're tracking ${rows.length} opportunities. ${next ? `Closest deadline: ${next.r.name} in ${next.d} day${next.d === 1 ? "" : "s"}.` : ""}`;
    }
    return `Noted, ${who}. Across your ${rows.length} opportunities, ${counts.Applied} are applied and ${counts.Interview} are in interview. ${next ? `Next up: ${next.r.name} in ${next.d}d.` : ""}`;
  };

  const draftEmail = (r: Row) => {
    const subject = `Interest in ${r.name} at ${r.org}`;
    const body = `Hi ${r.org} team,\n\nMy name is ${profile.name} — I'm a ${profile.grade} at ${profile.school} focused on ${profile.interests}. I came across the ${r.name} role and it lines up closely with the work I want to be doing next.\n\nA few quick notes on the fit:\n• Background aligned with ${profile.interests}\n• Currently tracking ${r.type.toLowerCase()} roles like this${r.notes ? `\n• Relevant context: ${r.notes}` : ""}\n\nWould you be open to a short intro chat${r.deadline && r.deadline !== "—" ? ` before the ${r.deadline} deadline` : ""}?\n\nThank you for the time,\n${profile.name}`;
    setMessages((m) => [
      ...m,
      { role: "user", text: `Draft a cold outreach email for ${r.name} at ${r.org}.` },
      { role: "ai", text: `Subject: ${subject}\n\n${body}` },
    ]);
    setSelected(null);
  };

  const upcoming = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, days: daysUntil(r.deadline) }))
        .filter((x): x is { row: Row; days: number } => x.days != null && x.days >= 0)
        .sort((a, b) => a.days - b.days)
        .slice(0, 6),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (pill !== "All" && r.status !== pill) return false;
        if (typeFilter !== "All" && r.type !== typeFilter) return false;
        if (query && !`${r.name} ${r.org} ${r.type} ${r.notes}`.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [rows, pill, query, typeFilter]
  );

  const allTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.type))), [rows]);

  const navCounts: Record<View, number | undefined> = {
    Opportunities: rows.length,
    Contacts: new Set(rows.map((r) => r.org)).size,
    Tasks: rows.filter((r) => {
      const d = daysUntil(r.deadline);
      return d != null && d >= 0 && r.status !== "Rejected" && r.status !== "Awarded";
    }).length,
    Notes: rows.filter((r) => r.notes && r.notes.trim()).length,
    Dashboard: undefined,
  };

  const createOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.org.trim()) return;
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    const tempId = `ui-${Date.now()}`;
    const optimistic: Row = {
      id: tempId,
      name: form.name,
      org: form.org,
      type: form.type,
      notes: form.notes,
      deadline: form.deadline || "—",
      status: form.status,
      added: today,
      color: colorForCompany(form.org),
    };
    setRows((rs) => [optimistic, ...rs]);
    setForm({ name: "", org: "", type: "Internship", notes: "", deadline: "", status: "Saved" });
    setShowNew(false);
    try {
      const saved = await apiCreateJob(form);
      // swap temp id with real server id
      setRows((rs) => rs.map((r) => r.id === tempId ? { ...r, id: saved.id } : r));
    } catch { /* server down — optimistic update stays */ }
  };

  const send = () => {
    if (!input.trim()) return;
    const userText = input;
    setMessages((m) => [
      ...m,
      { role: "user", text: userText },
      { role: "ai", text: replyFor(userText) },
    ]);
    setInput("");
  };

  const runQuickAction = (text: string) => {
    setMessages((m) => [
      ...m,
      { role: "user", text },
      { role: "ai", text: replyFor(text) },
    ]);
  };

  return (
    <div className="flex h-screen w-full flex-col bg-white text-foreground">
      {/* Thin accent top border */}
      <div className="h-[3px] w-full shrink-0" style={{ backgroundColor: ACCENT }} />

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border" style={{ backgroundColor: SURFACE }}>
          <div className="flex items-center gap-2 px-4 py-4">
            <div className="grid h-7 w-7 place-items-center rounded-md text-xs font-semibold text-white" style={{ backgroundColor: ACCENT }}>P</div>
            <div className="flex-1">
              <div className="text-sm font-semibold">Pathway</div>
              <div className="text-[11px] text-muted-foreground">{profile.name.split(" ")[0] || "Your"}'s workspace</div>
            </div>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </div>

          <nav className="mt-2 flex flex-col gap-0.5 px-2">
            <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</div>
            {navItems.map((it) => {
              const active = view === it.label;
              const count = navCounts[it.label];
              return (
                <button
                  key={it.label}
                  onClick={() => setView(it.label)}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    active ? "bg-white font-medium text-foreground shadow-sm" : "text-foreground/75 hover:bg-white/70"
                  }`}
                >
                  <it.icon className="h-4 w-4" style={active ? { color: ACCENT } : undefined} />
                  <span className="flex-1 text-left">{it.label}</span>
                  {count != null && <span className="text-[11px] text-muted-foreground">{count}</span>}
                </button>
              );
            })}
            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground/75 transition-colors hover:bg-white/70"
            >
              <User className="h-4 w-4" />
              <span className="flex-1 text-left">Profile</span>
            </button>
          </nav>

          <div className="mt-auto p-3">
            <button onClick={() => setShowProfile(true)} className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-white p-2.5 text-left hover:shadow-sm">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[oklch(0.6_0.18_30)] text-[11px] font-semibold text-white">{initials(profile.name)}</div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium">{profile.name}</div>
                <div className="truncate text-muted-foreground">{profile.grade} · {profile.school}</div>
              </div>
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col bg-white">
          {/* Full-width search bar */}
          <div className="flex items-center gap-3 border-b border-border px-6 py-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2 focus-within:border-[color:var(--accent)] focus-within:ring-2 focus-within:ring-[color:var(--accent)]/10" style={{ backgroundColor: SURFACE, ["--accent" as never]: ACCENT } as React.CSSProperties}>
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search opportunities, organizations, notes…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border border-border bg-white px-1.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </div>
            <div className="flex items-center gap-1.5 px-1" title={connected ? "Live — synced with Claude Code" : "Connecting to CRM server…"}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{connected ? "Live" : "…"}</span>
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-[color:var(--surface)]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
              <Bell className="h-4 w-4 text-foreground/70" />
            </button>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium text-white shadow-sm hover:opacity-90" style={{ backgroundColor: ACCENT }}>
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            {view === "Opportunities" && (
              <>
            {/* Upcoming */}
            <section className="px-6 pt-6">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold">Upcoming</h2>
                  <p className="text-xs text-muted-foreground">Deadlines closest to today</p>
                </div>
                <button className="flex items-center gap-0.5 text-xs font-medium hover:underline" style={{ color: ACCENT }}>
                  See all <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              <div className="-mx-6 overflow-x-auto px-6 pb-1">
                <div className="flex min-w-max gap-3">
                  {upcoming.map(({ row, days }) => {
                    const dot = statusDot[row.status];
                    const urgent = days <= 3;
                    return (
                      <button
                        key={row.name}
                        onClick={() => openRow(row)}
                        className="group w-[280px] shrink-0 rounded-xl border border-border text-left transition-shadow hover:shadow-sm"
                        style={{ backgroundColor: SURFACE, borderLeft: `3px solid ${dot}` }}
                      >
                        <div className="px-4 py-3.5">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-muted-foreground">{row.org}</span>
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/75">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />
                              {row.status}
                            </span>
                          </div>
                          <div className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{row.name}</div>
                          <div className="mt-3 flex items-center justify-between">
                            <span className={`text-xs ${urgent ? "font-medium text-[oklch(0.55_0.22_25)]" : "text-muted-foreground"}`}>
                              {days === 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} left`}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{row.deadline}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* All opportunities */}
            <section className="px-6 pb-8 pt-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">All opportunities</h2>
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    showFilters || typeFilter !== "All" ? "border-transparent text-white" : "border-border text-foreground/80 hover:bg-[color:var(--surface)]"
                  }`}
                  style={{ backgroundColor: showFilters || typeFilter !== "All" ? ACCENT : undefined, ["--surface" as never]: SURFACE } as React.CSSProperties}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filters{typeFilter !== "All" ? ` · ${typeFilter}` : ""}
                </button>
              </div>

              {showFilters && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white p-2.5">
                  <span className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Type</span>
                  {["All", ...allTypes].map((t) => {
                    const active = typeFilter === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${active ? "border-transparent text-white" : "border-border text-foreground/70 hover:bg-[color:var(--surface)]"}`}
                        style={{ backgroundColor: active ? ACCENT : undefined, ["--surface" as never]: SURFACE } as React.CSSProperties}
                      >
                        {t}
                      </button>
                    );
                  })}
                  {typeFilter !== "All" && (
                    <button onClick={() => setTypeFilter("All")} className="ml-auto text-[11px] text-muted-foreground hover:underline">Clear</button>
                  )}
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {pillFilters.map((p) => {
                  const active = pill === p;
                  const count = p === "All" ? rows.length : rows.filter((r) => r.status === p).length;
                  return (
                    <button
                      key={p}
                      onClick={() => setPill(p)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? "border-transparent text-white"
                          : "border-border bg-white text-foreground/70 hover:bg-[color:var(--surface)]"
                      }`}
                      style={{
                        backgroundColor: active ? ACCENT : undefined,
                        ["--surface" as never]: SURFACE,
                      } as React.CSSProperties}
                    >
                      {p}
                      <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/20" : "bg-[color:var(--surface)]"}`} style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground" style={{ backgroundColor: SURFACE }}>
                      <th className="px-5 py-3 text-left font-medium">Opportunity</th>
                      <th className="px-4 py-3 text-left font-medium">Type</th>
                      <th className="px-4 py-3 text-left font-medium">Notes</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Date added</th>
                      <th className="w-8 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} onClick={() => openRow(r)} className="group cursor-pointer border-b border-border last:border-0 hover:bg-[color:var(--surface)]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-semibold text-white" style={{ backgroundColor: r.color }}>
                              {initials(r.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{r.name}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{r.org}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground/80" style={{ backgroundColor: SURFACE }}>{r.type}</span>
                        </td>
                        <td className="max-w-[260px] px-4 py-3">
                          <span className="line-clamp-1 text-xs text-foreground/70">{r.notes || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusDot[r.status] }} />
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.added}</td>
                        <td className="px-2 py-3">
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">
                          No opportunities match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <button onClick={() => setShowNew(true)} className="flex w-full items-center gap-1.5 border-t border-border px-5 py-3 text-xs text-muted-foreground hover:bg-[color:var(--surface)] hover:text-foreground" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
                  <Plus className="h-3.5 w-3.5" /> Add opportunity
                </button>
              </div>
            </section>
              </>
            )}

            {view === "Contacts" && <ContactsView rows={rows} accent={ACCENT} surface={SURFACE} onOpen={openRow} />}
            {view === "Tasks" && <TasksView rows={rows} accent={ACCENT} surface={SURFACE} onOpen={openRow} />}
            {view === "Notes" && (
              <NotesView
                rows={rows}
                surface={SURFACE}
                accent={ACCENT}
                onUpdateNotes={(id, notes) =>
                  setRows((rs) => rs.map((r) => (r.id === id ? { ...r, notes } : r)))
                }
              />
            )}
            {view === "Dashboard" && <DashboardView rows={rows} accent={ACCENT} surface={SURFACE} />}
          </div>
        </main>

        {/* AI Chat */}
        {chatOpen ? (
          <aside className="flex w-[320px] shrink-0 flex-col border-l border-border" style={{ backgroundColor: SURFACE }}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-md text-white" style={{ backgroundColor: ACCENT }}>
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">Pathway AI</div>
                  <div className="text-[11px] text-muted-foreground">Your application copilot</div>
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-white hover:text-foreground"
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-auto p-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user" ? "rounded-br-sm text-white" : "rounded-bl-sm border border-border bg-white text-foreground"
                    }`}
                    style={m.role === "user" ? { backgroundColor: ACCENT } : undefined}
                  >
                    <span className="whitespace-pre-wrap">{m.text}</span>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-xl border border-border bg-white p-2 focus-within:border-[color:var(--accent)] focus-within:ring-2 focus-within:ring-[color:var(--accent)]/15" style={{ ["--accent" as never]: ACCENT } as React.CSSProperties}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask Pathway anything…"
                  className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button onClick={send} className="grid h-7 w-7 place-items-center rounded-md text-white hover:opacity-90" style={{ backgroundColor: ACCENT }}>
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["Draft cover letter", "Summarize deadlines", "What should I work on?"].map((s) => (
                  <button
                    key={s}
                    onClick={() => runQuickAction(s)}
                    className="rounded-full border border-border bg-white px-2 py-0.5 text-[11px] text-foreground/70 hover:bg-[color:var(--surface)]"
                    style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
            aria-label="Open assistant"
          >
            <MessageCircle className="h-4 w-4" /> Pathway AI
          </button>
        )}
      </div>

      {/* New Opportunity Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setShowNew(false)}>
          <form onSubmit={createOpportunity} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">New opportunity</h2>
              <button type="button" onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <Field label="Opportunity name">
                <input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]" style={{ ["--accent" as never]: ACCENT } as React.CSSProperties} placeholder="Software Engineering Intern" />
              </Field>
              <Field label="Organization">
                <input required value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" placeholder="Stripe" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none">
                    <option>Internship</option><option>Co-op</option><option>Research</option><option>Scholarship</option><option>Full-time</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none">
                    {(["Saved", "Applied", "Interview", "Rejected", "Awarded"] as Status[]).map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Deadline">
                <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" placeholder="Jul 15, 2026" />
              </Field>
              <Field label="Notes">
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" placeholder="Referral, reminders, etc." />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--surface)]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>Cancel</button>
              <button type="submit" className="rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: ACCENT }}>Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Row detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-md border-l border-border bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: selected.color }}>
                  {initials(selected.name)}
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">{selected.name}</div>
                  <div className="text-xs text-muted-foreground">{selected.org}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!editing ? (
                  <button onClick={() => setEditing(true)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-[color:var(--surface)]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                ) : (
                  <button onClick={saveEdit} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white" style={{ backgroundColor: ACCENT }}>
                    <Check className="h-3 w-3" /> Save
                  </button>
                )}
                <button onClick={() => deleteRow(selected.id)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-[color:var(--surface)] hover:text-[oklch(0.55_0.22_25)]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setSelected(null)} className="grid h-7 w-7 place-items-center text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {!editing || !editForm ? (
              <div className="space-y-4 px-5 py-4 text-sm">
                <DetailRow label="Type" value={selected.type} />
                <DetailRow label="Status" value={
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusDot[selected.status] }} />
                    {selected.status}
                  </span>
                } />
                <DetailRow label="Deadline" value={selected.deadline || "—"} />
                <DetailRow label="Date added" value={selected.added} />
                <div>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Notes</div>
                  <div className="rounded-md border border-border bg-[color:var(--surface)] px-2.5 py-2 text-sm text-foreground/80 min-h-[80px]" style={{ ["--surface" as never]: SURFACE } as React.CSSProperties}>
                    {selected.notes || <span className="text-muted-foreground">No notes yet — click Edit to add some.</span>}
                  </div>
                </div>
                <button
                  onClick={() => draftEmail(selected)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: ACCENT }}
                >
                  <Mail className="h-3.5 w-3.5" /> Draft email
                </button>
              </div>
            ) : (
              <div className="space-y-3 px-5 py-4 text-sm">
                <Field label="Opportunity name">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" />
                </Field>
                <Field label="Organization">
                  <input value={editForm.org} onChange={(e) => setEditForm({ ...editForm, org: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Type">
                    <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none">
                      <option>Internship</option><option>Co-op</option><option>Research</option><option>Scholarship</option><option>Full-time</option>
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Status })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none">
                      {(["Saved", "Applied", "Interview", "Rejected", "Awarded"] as Status[]).map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Deadline">
                  <input value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" placeholder="Jul 15, 2026" />
                </Field>
                <Field label="Notes">
                  <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={5} className="w-full resize-none rounded-md border border-border bg-white px-2.5 py-2 text-sm outline-none" />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {showProfile && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setShowProfile(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">Your profile</h2>
              <button onClick={() => setShowProfile(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-[11px] text-muted-foreground">Pathway AI references this when drafting emails, cover letters, and suggestions.</p>
              <Field label="Full name">
                <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" />
              </Field>
              <Field label="School">
                <input value={profile.school} onChange={(e) => setProfile({ ...profile, school: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" />
              </Field>
              <Field label="Grade / year">
                <input value={profile.grade} onChange={(e) => setProfile({ ...profile, grade: e.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm outline-none" placeholder="Junior (CS '27)" />
              </Field>
              <Field label="Research interests">
                <textarea value={profile.interests} onChange={(e) => setProfile({ ...profile, interests: e.target.value })} rows={3} className="w-full resize-none rounded-md border border-border bg-white px-2.5 py-2 text-sm outline-none" placeholder="ML infra, dev tools, distributed systems…" />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setShowProfile(false)} className="rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: ACCENT }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function ContactsView({ rows, accent, surface, onOpen }: { rows: Row[]; accent: string; surface: string; onOpen: (r: Row) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    rows.forEach((r) => {
      const arr = m.get(r.org) ?? [];
      arr.push(r);
      m.set(r.org, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Contacts</h2>
        <p className="text-xs text-muted-foreground">Organizations from your tracker — click to see related opportunities.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([org, items]) => (
          <div key={org} className="rounded-xl border border-border bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: items[0].color }}>
                {initials(org)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{org}</div>
                <div className="text-[11px] text-muted-foreground">{items.length} opportunit{items.length === 1 ? "y" : "ies"}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {items.map((r) => (
                <button key={r.id} onClick={() => onOpen(r)} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-[color:var(--s)]" style={{ ["--s" as never]: surface } as React.CSSProperties}>
                  <span className="truncate">{r.name}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusDot[r.status] }} />
                    {r.status}
                  </span>
                </button>
              ))}
            </div>
            <button className="mt-3 w-full rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-foreground/70 hover:text-foreground" style={{ borderColor: accent, color: accent }}>
              Draft outreach
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function TasksView({ rows, accent, surface, onOpen }: { rows: Row[]; accent: string; surface: string; onOpen: (r: Row) => void }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const tasks = useMemo(() => {
    return rows
      .map((r) => ({ r, d: daysUntil(r.deadline) }))
      .filter((x): x is { r: Row; d: number } => x.d != null && x.r.status !== "Rejected" && x.r.status !== "Awarded")
      .sort((a, b) => a.d - b.d);
  }, [rows]);
  const open = tasks.filter((t) => !done[t.r.id]);
  const closed = tasks.filter((t) => done[t.r.id]);

  const Task = ({ t }: { t: { r: Row; d: number } }) => {
    const isDone = !!done[t.r.id];
    const overdue = t.d < 0;
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-white px-3 py-2.5">
        <button
          onClick={() => setDone((s) => ({ ...s, [t.r.id]: !s[t.r.id] }))}
          className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${isDone ? "text-white" : "border-border"}`}
          style={{ backgroundColor: isDone ? accent : "white", borderColor: isDone ? accent : undefined }}
        >
          {isDone && <Check className="h-3 w-3" />}
        </button>
        <button onClick={() => onOpen(t.r)} className={`min-w-0 flex-1 text-left ${isDone ? "line-through opacity-60" : ""}`}>
          <div className="truncate text-sm font-medium">{t.r.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{t.r.org} · {t.r.status}</div>
        </button>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${overdue ? "text-white" : "text-foreground/70"}`} style={{ backgroundColor: overdue ? "#EF4444" : surface }}>
          {overdue ? `${Math.abs(t.d)}d overdue` : t.d === 0 ? "Today" : `${t.d}d left`}
        </span>
      </div>
    );
  };

  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Tasks</h2>
        <p className="text-xs text-muted-foreground">Deadlines from your active opportunities. Check them off as you go.</p>
      </div>
      <div className="space-y-2">
        {open.length === 0 && <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">All caught up. 🎉</div>}
        {open.map((t) => <Task key={t.r.id} t={t} />)}
      </div>
      {closed.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Done</div>
          <div className="space-y-2">
            {closed.map((t) => <Task key={t.r.id} t={t} />)}
          </div>
        </>
      )}
    </section>
  );
}

function NotesView({ rows, surface, accent, onUpdateNotes }: { rows: Row[]; surface: string; accent: string; onUpdateNotes: (id: string, notes: string) => void }) {
  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Notes</h2>
        <p className="text-xs text-muted-foreground">Type directly into any card — changes save as you go.</p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Add an opportunity to start taking notes.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-white p-4" style={{ borderLeft: `3px solid ${statusDot[r.status]}` }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{r.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{r.org}</div>
                </div>
                <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-foreground/70" style={{ backgroundColor: surface }}>{r.status}</span>
              </div>
              <textarea
                value={r.notes}
                onChange={(e) => onUpdateNotes(r.id, e.target.value)}
                rows={4}
                placeholder="Add a note…"
                className="w-full resize-none rounded-md border border-border bg-white px-2.5 py-2 text-xs leading-relaxed text-foreground/80 outline-none focus:border-[color:var(--a)] focus:ring-2 focus:ring-[color:var(--a)]/10"
                style={{ ["--a" as never]: accent } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DashboardView({ rows, accent, surface }: { rows: Row[]; accent: string; surface: string }) {
  const counts: Record<Status, number> = { Saved: 0, Applied: 0, Interview: 0, Rejected: 0, Awarded: 0 };
  rows.forEach((r) => counts[r.status]++);
  const total = rows.length || 1;
  const upcoming = rows
    .map((r) => ({ r, d: daysUntil(r.deadline) }))
    .filter((x): x is { r: Row; d: number } => x.d != null && x.d >= 0)
    .sort((a, b) => a.d - b.d);
  const next = upcoming[0];
  const stats: { label: string; value: string | number; sub?: string }[] = [
    { label: "Total tracked", value: rows.length },
    { label: "Applied", value: counts.Applied, sub: `${Math.round((counts.Applied / total) * 100)}%` },
    { label: "In interview", value: counts.Interview },
    { label: "Next deadline", value: next ? `${next.d}d` : "—", sub: next?.r.org },
  ];

  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Dashboard</h2>
        <p className="text-xs text-muted-foreground">A bird's-eye view of your search.</p>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold" style={{ color: accent }}>{s.value}</div>
            {s.sub && <div className="mt-1 text-[11px] text-muted-foreground">{s.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-white p-4">
          <div className="mb-3 text-sm font-semibold">Pipeline</div>
          <div className="space-y-2.5">
            {(Object.keys(counts) as Status[]).map((s) => {
              const pct = Math.round((counts[s] / total) * 100);
              return (
                <div key={s}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1.5 text-foreground/80">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusDot[s] }} />
                      {s}
                    </span>
                    <span className="text-muted-foreground">{counts[s]} · {pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: surface }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: statusDot[s] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white p-4">
          <div className="mb-3 text-sm font-semibold">Next 5 deadlines</div>
          {upcoming.length === 0 ? (
            <div className="text-xs text-muted-foreground">Nothing scheduled.</div>
          ) : (
            <ul className="space-y-2">
              {upcoming.slice(0, 5).map(({ r, d }) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.org}</span></span>
                  <span className="shrink-0 text-xs font-medium" style={{ color: d <= 3 ? "#EF4444" : accent }}>{d === 0 ? "Today" : `${d}d`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

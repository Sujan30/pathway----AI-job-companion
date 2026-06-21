export const CRM_URL = "http://localhost:8000";

// ── Stage ↔ Status mapping ────────────────────────────────────────────────

export type ServerStage =
  | "shortlisted" | "researched" | "packet_built" | "resume_compiled"
  | "ready_to_submit" | "applied" | "interview" | "offer" | "rejected";

export type UIStatus = "Saved" | "Applied" | "Interview" | "Rejected" | "Awarded";

export function stageToStatus(stage: ServerStage | string): UIStatus {
  switch (stage) {
    case "applied": return "Applied";
    case "interview": return "Interview";
    case "offer": return "Awarded";
    case "rejected": return "Rejected";
    default: return "Saved"; // shortlisted, researched, packet_built, resume_compiled, ready_to_submit
  }
}

export function statusToStage(status: UIStatus): ServerStage {
  switch (status) {
    case "Applied": return "applied";
    case "Interview": return "interview";
    case "Awarded": return "offer";
    case "Rejected": return "rejected";
    default: return "shortlisted";
  }
}

// ── Color determinism ─────────────────────────────────────────────────────

const PALETTE = [
  "#534AB7", "#635BFF", "#F24E1E", "#1DB954",
  "#D97757", "#5E6AD2", "#7D6CFF", "#0EA5E9",
];

export function colorForCompany(company: string): string {
  let h = 0;
  for (let i = 0; i < company.length; i++) h = (Math.imul(31, h) + company.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ── Server job → UI Row ───────────────────────────────────────────────────

export interface ServerJob {
  id: string;
  company: string;
  title: string;
  stage: string;
  notes?: string;
  deadline?: string;
  type?: string;
  url?: string;
  color?: string;
  updated_at: string;
  location?: string;
}

export function serverJobToRow(job: ServerJob) {
  const added = (() => {
    try {
      return new Date(job.updated_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    } catch {
      return "—";
    }
  })();

  return {
    id: job.id,
    name: job.title || "Untitled",
    org: job.company || "Unknown",
    type: job.type || "Internship",
    notes: job.notes || "",
    deadline: job.deadline || "—",
    status: stageToStatus(job.stage),
    added,
    color: job.color || colorForCompany(job.company || ""),
    url: job.url || "",
    _stage: job.stage, // keep original for PATCH
  } as const;
}

// ── REST helpers ──────────────────────────────────────────────────────────

export async function fetchJobs(): Promise<ServerJob[]> {
  const r = await fetch(`${CRM_URL}/api/jobs`);
  if (!r.ok) throw new Error("CRM server unreachable");
  return r.json();
}

export async function createJob(data: {
  company: string; title: string; type: string;
  notes: string; deadline: string; status: UIStatus;
}): Promise<ServerJob> {
  const r = await fetch(`${CRM_URL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company: data.company,
      title: data.title,
      type: data.type,
      notes: data.notes,
      deadline: data.deadline,
      stage: statusToStage(data.status),
    }),
  });
  return r.json();
}

export async function patchJob(
  id: string,
  patch: { stage?: string; notes?: string; deadline?: string; type?: string }
): Promise<ServerJob> {
  const r = await fetch(`${CRM_URL}/api/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return r.json();
}

export async function deleteJob(id: string): Promise<void> {
  await fetch(`${CRM_URL}/api/jobs/${id}`, { method: "DELETE" });
}

// ── SSE subscription ──────────────────────────────────────────────────────

export interface SSESnapshot {
  jobs: Record<string, ServerJob>;
  applications: Record<string, unknown>;
  events: unknown[];
}

export interface SSEUpdatePayload {
  tool: string;
  updated: ServerJob[];
  deleted_id?: string;
}

export type SSEHandler = {
  onSnapshot: (snap: SSESnapshot) => void;
  onUpdate: (payload: SSEUpdatePayload) => void;
};

export function connectSSE(handlers: SSEHandler): () => void {
  let es: EventSource;
  let reconnectTimer: ReturnType<typeof setTimeout>;

  function connect() {
    es = new EventSource(`${CRM_URL}/api/stream`);

    es.addEventListener("snapshot", (e) => {
      try { handlers.onSnapshot(JSON.parse(e.data)); } catch {}
    });

    es.addEventListener("update", (e) => {
      try { handlers.onUpdate(JSON.parse(e.data)); } catch {}
    });

    es.addEventListener("ping", () => {});

    es.onerror = () => {
      es.close();
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  connect();

  return () => {
    clearTimeout(reconnectTimer);
    es?.close();
  };
}

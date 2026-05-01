import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ╔══════════════════════════════════════════════════════════════╗
// ║                        SUPABASE                              ║
// ╚══════════════════════════════════════════════════════════════╝
const SB_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const HAS_SB = !!(SB_URL && SB_KEY && SB_URL.includes("supabase.co"));
let sb: SupabaseClient | null = null;
function getSB(): SupabaseClient | null {
  if (!HAS_SB) return null;
  if (!sb) sb = createClient(SB_URL, SB_KEY);
  return sb;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                         TYPES                                ║
// ╚══════════════════════════════════════════════════════════════╝
interface Lnk { id: string; label: string; url: string }
interface Rev { date: string; ok: boolean; lvl: number }
interface Topic {
  id: string; title: string; subject: string; cat: string; desc: string;
  date: string; studied: boolean | null; links: Lnk[]; revs: Rev[];
  next: string; lvl: number; sched: boolean; created: string;
}
interface Exam {
  id: string; name: string; subject: string; cat: string; date: string;
  desc: string; links: Lnk[]; max: number; got: number; pct: number;
  grade: string; answer: string; ai: string; created: string;
}
interface MemItem {
  id: string; title: string; cat: string; content: string; tags: string[];
  created: string; updated: string;
}
interface AppUser { id: string; email: string; name: string; mode: "supabase" | "local" }

type Tab = "topics" | "exams" | "memory";

// ╔══════════════════════════════════════════════════════════════╗
// ║                       HELPERS                                ║
// ╚══════════════════════════════════════════════════════════════╝
const IV = [1, 3, 7, 14, 30, 60, 120];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = () => new Date().toISOString().split("T")[0];
const addD = (s: string, n: number) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
const nxt = (f: string, i: number) => addD(f, IV[Math.min(i, 6)]);
const fmt = (s: string) => { try { return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return s; } };
const isFut = (s: string) => s > iso();
const daysDiff = (s: string) => { const a = new Date(iso()); const b = new Date(s); return Math.round((b.getTime() - a.getTime()) / 864e5); };
const getSt = (t: Topic) => { if (t.sched && t.studied === null) return "sched"; const d = daysDiff(t.next); return d < 0 ? "over" : d === 0 ? "due" : "soon"; };
const calcGr = (p: number) => p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B+" : p >= 60 ? "B" : p >= 50 ? "C" : p >= 40 ? "D" : "F";
const CATS_T = ["GS", "Optional", "Prelims", "Mains", "Essay"];
const CATS_M = ["GS1", "GS2", "GS3", "GS4", "Ethics", "Optional", "Essay", "Current Affairs"];

// Local password helpers
async function hashPw(pw: string, salt: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw + salt));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function genSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join(""); }

// ╔══════════════════════════════════════════════════════════════╗
// ║                   SYNCED STORE HOOK                          ║
// ╚══════════════════════════════════════════════════════════════╝
function useSync<T>(key: string, init: T, userId: string | null): [T, (fn: T | ((p: T) => T)) => void] {
  const lsKey = userId ? `sr_${userId}_${key}` : `sr_${key}`;
  const [val, setVal] = useState<T>(() => {
    try { const s = localStorage.getItem(lsKey); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(val)); } catch {}
    if (HAS_SB && userId) {
      const c = getSB();
      if (c) c.from("user_store").upsert({ user_id: userId, key, value: val, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {});
    }
  }, [lsKey, val, key, userId]);
  return [val, setVal];
}

async function loadFromSB(userId: string): Promise<Record<string, any>> {
  const c = getSB(); if (!c) return {};
  try { const { data } = await c.from("user_store").select("key, value").eq("user_id", userId); if (!data) return {}; const out: Record<string, any> = {}; data.forEach((r: any) => { out[r.key] = r.value; }); return out; } catch { return {}; }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                      SVG ICONS                               ║
// ╚══════════════════════════════════════════════════════════════╝
const Ic = ({ d, sz = 18, cls = "" }: { d: string; sz?: number; cls?: string }) => (<svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls}><path d={d} /></svg>);
const IPlus = (p: any) => <Ic {...p} d="M12 5v14M5 12h14" />;
const ISearch = (p: any) => <Ic {...p} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />;
const ICheck = (p: any) => <Ic {...p} d="M20 6L9 17l-5-5" />;
const IX = (p: any) => <Ic {...p} d="M18 6L6 18M6 6l12 12" />;
const IEdit = (p: any) => <Ic {...p} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />;
const ITrash = (p: any) => <Ic {...p} d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />;
const IChevD = (p: any) => <Ic {...p} d="M6 9l6 6 6-6" />;
const IChevU = (p: any) => <Ic {...p} d="M18 15l-6-6-6 6" />;
const IChevL = (p: any) => <Ic {...p} d="M15 18l-6-6 6-6" />;
const IChevR = (p: any) => <Ic {...p} d="M9 18l6-6-6-6" />;
const ILink = (p: any) => <Ic {...p} d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />;
const IUndo = (p: any) => <Ic {...p} d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" />;
const IRefresh = (p: any) => <Ic {...p} d="M23 4v6h-6M1 20v-6h6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />;
const IStar = (p: any) => <Ic {...p} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;
const ICal = (p: any) => <Ic {...p} d="M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18" />;
const IDL = (p: any) => <Ic {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />;
const IUL = (p: any) => <Ic {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />;
const ILogOut = (p: any) => <Ic {...p} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />;
const IUser = (p: any) => <Ic {...p} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z" />;

// ╔══════════════════════════════════════════════════════════════╗
// ║                   AUTH PAGE                                  ║
// ╚══════════════════════════════════════════════════════════════╝
function AuthPage({ onLogin }: { onLogin: (u: AppUser) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setOk(""); setLoading(true);
    try {
      if (HAS_SB) {
        const c = getSB()!;
        if (mode === "signup") {
          if (pw.length < 6) { setErr("Password must be at least 6 characters"); setLoading(false); return; }
          const { data, error } = await c.auth.signUp({ email, password: pw, options: { data: { name: name || email.split("@")[0] } } });
          if (error) { setErr(error.message); setLoading(false); return; }
          if (data.user) { setOk("Account created!"); setTimeout(() => onLogin({ id: data.user!.id, email, name: name || email.split("@")[0], mode: "supabase" }), 500); return; }
        } else {
          const { data, error } = await c.auth.signInWithPassword({ email, password: pw });
          if (error) { setErr(error.message); setLoading(false); return; }
          if (data.user) { onLogin({ id: data.user.id, email: data.user.email || "", name: data.user.user_metadata?.name || email.split("@")[0], mode: "supabase" }); return; }
        }
        setErr("Something went wrong"); setLoading(false);
      } else {
        // Local auth fallback
        const usersRaw = localStorage.getItem("sr_local_users") || "[]";
        const users: { id: string; email: string; name: string; hash: string; salt: string }[] = JSON.parse(usersRaw);
        if (mode === "signup") {
          if (!email.trim() || email.length < 3) { setErr("Username must be at least 3 characters"); setLoading(false); return; }
          if (pw.length < 6) { setErr("Password must be at least 6 characters"); setLoading(false); return; }
          if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) { setErr("Account already exists"); setLoading(false); return; }
          const salt = genSalt(); const hash = await hashPw(pw, salt);
          const nu = { id: uid(), email: email.trim(), name: name.trim() || email.trim(), hash, salt };
          users.push(nu); localStorage.setItem("sr_local_users", JSON.stringify(users));
          setOk("Account created!"); setTimeout(() => onLogin({ id: nu.id, email: nu.email, name: nu.name, mode: "local" }), 500);
        } else {
          const u = users.find(u => u.email.toLowerCase() === email.toLowerCase());
          if (!u) { setErr("Account not found"); setLoading(false); return; }
          const hash = await hashPw(pw, u.salt);
          if (hash !== u.hash) { setErr("Incorrect password"); setLoading(false); return; }
          onLogin({ id: u.id, email: u.email, name: u.name, mode: "local" });
        }
      }
    } catch (ex: any) { setErr(ex?.message || "Error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-80 h-80 bg-blue-100/20 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-block relative mb-4">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-3xl shadow-2xl shadow-indigo-200/50">
              <span className="text-4xl">🧠</span>
            </div>
            <span className="absolute -top-2 -right-2 text-2xl">✨</span>
          </div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Space<span className="text-indigo-600">Rev</span></h1>
          <p className="text-gray-500 mt-2 text-sm">Spaced Revision & Exam Tracker</p>
          <div className="mt-3">
            {HAS_SB ? (
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />Cloud Sync · Multi-device
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold">
                💾 Local Storage Mode
              </span>
            )}
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-100/80 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(""); setOk(""); }}
                className={`flex-1 py-4 text-sm font-bold transition-colors relative ${mode === m ? "text-indigo-600" : "text-gray-400 hover:text-gray-600"}`}>
                {m === "login" ? "Sign In" : "Create Account"}
                {mode === m && <div className="absolute bottom-0 left-6 right-6 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" />}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={submit} className="p-6 sm:p-8 space-y-5">
            <div className="text-center mb-1">
              <h2 className="text-xl font-bold text-gray-900">{mode === "login" ? "Welcome Back!" : "Create Your Account"}</h2>
              <p className="text-sm text-gray-500 mt-1">{mode === "login" ? "Sign in to access your data" : "Start your revision journey"}</p>
            </div>

            {mode === "signup" && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><IUser sz={16} /></div>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Rupam" className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{HAS_SB ? "Email" : "Username"}</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 4L12 13 2 4" /></svg>
                </div>
                <input type={HAS_SB ? "email" : "text"} value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder={HAS_SB ? "you@email.com" : "Enter username"}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                </div>
                <input type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} required minLength={6}
                  placeholder={mode === "signup" ? "Min 6 characters" : "Enter password"}
                  className="w-full pl-11 pr-16 py-3 rounded-xl border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100">
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {err && <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"><span>⚠️</span>{err}</div>}
            {ok && <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700"><span>✅</span>{ok}</div>}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "⏳ Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
            </button>

            <p className="text-center text-sm text-gray-500">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); setOk(""); }}
                className="text-indigo-600 font-semibold hover:text-indigo-700">{mode === "login" ? "Sign Up" : "Sign In"}</button>
            </p>
          </form>
        </div>

        {/* Feature cards */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          {([["🧠", "Spaced\nRevision"], ["📝", "Exam\nTracker"], ["🤖", "AI\nFeedback"]] as const).map(([e, l]) => (
            <div key={l} className="text-center p-4 bg-white/60 backdrop-blur rounded-2xl border border-gray-100 shadow-sm">
              <div className="text-2xl mb-1.5">{e}</div>
              <p className="text-xs font-medium text-gray-600 whitespace-pre-line leading-tight">{l}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">🔒 Secured with SHA-256 encryption · by Rupam</p>
      </div>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                       MAIN APP                               ║
// ╚══════════════════════════════════════════════════════════════╝
export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [checking, setChecking] = useState(true);

  // Restore session
  useEffect(() => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; setChecking(false); } }, 2500);

    (async () => {
      // Check Supabase session
      if (HAS_SB) {
        try {
          const c = getSB()!;
          const { data } = await c.auth.getSession();
          if (data.session?.user) {
            const u = data.session.user;
            if (!done) { done = true; setUser({ id: u.id, email: u.email || "", name: u.user_metadata?.name || u.email?.split("@")[0] || "User", mode: "supabase" }); setChecking(false); return; }
          }
        } catch {}
      }
      // Check local session
      try {
        const s = localStorage.getItem("sr_session");
        if (s) { const u = JSON.parse(s); if (!done) { done = true; setUser(u); setChecking(false); return; } }
      } catch {}
      if (!done) { done = true; setChecking(false); }
    })();

    return () => clearTimeout(timer);
  }, []);

  const login = (u: AppUser) => {
    setUser(u);
    localStorage.setItem("sr_session", JSON.stringify(u));
  };

  const logout = async () => {
    if (HAS_SB) try { getSB()?.auth.signOut(); } catch {}
    localStorage.removeItem("sr_session");
    setUser(null);
  };

  // Loading
  if (checking) return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
      <div className="text-center">
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-3xl shadow-xl inline-block mb-4 animate-pulse"><span className="text-3xl">🧠</span></div>
        <p className="text-gray-500 text-sm font-medium">Loading SpaceRev...</p>
      </div>
    </div>
  );

  // Auth screen
  if (!user) return <AuthPage onLogin={login} />;

  // Main app
  return <Dashboard user={user} onLogout={logout} />;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                     DASHBOARD                                ║
// ╚══════════════════════════════════════════════════════════════╝
function Dashboard({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const userId = user.id;
  const [topics, setTopics] = useSync<Topic[]>("topics", [], userId);
  const [exams, setExams] = useSync<Exam[]>("exams", [], userId);
  const [memory, setMemory] = useSync<MemItem[]>("memory", [], userId);
  const [cats, setCats] = useSync<string[]>("cats", CATS_T, userId);
  const [subs, setSubs] = useSync<string[]>("subs", [], userId);
  const [memCats, setMemCats] = useSync<string[]>("memcats", CATS_M, userId);

  // Load from Supabase
  useEffect(() => {
    if (user.mode !== "supabase") return;
    loadFromSB(userId).then(d => {
      if (d.topics?.length) setTopics(d.topics);
      if (d.exams?.length) setExams(d.exams);
      if (d.memory?.length) setMemory(d.memory);
      if (d.cats?.length) setCats(d.cats);
      if (d.subs?.length) setSubs(d.subs);
      if (d.memcats?.length) setMemCats(d.memcats);
    });
  }, [userId]);

  const [tab, setTab] = useState<Tab>("topics");
  const [view, setView] = useState<"list" | "cal">("list");
  const [q, setQ] = useState(""); const [cf, setCf] = useState("all");
  const [modal, setModal] = useState<null | "topic" | "exam" | "memory">(null);
  const [editT, setEditT] = useState<Topic | null>(null);
  const [editE, setEditE] = useState<Exam | null>(null);
  const [editM, setEditM] = useState<MemItem | null>(null);
  const [expId, setExpId] = useState<string | null>(null);
  const [aiId, setAiId] = useState<string | null>(null);

  const fTopics = useMemo(() => { let r = [...topics]; if (q) { const s = q.toLowerCase(); r = r.filter(t => t.title.toLowerCase().includes(s) || t.subject.toLowerCase().includes(s) || t.cat.toLowerCase().includes(s)); } if (cf !== "all") r = r.filter(t => t.cat === cf); r.sort((a, b) => daysDiff(a.next) - daysDiff(b.next)); return r; }, [topics, q, cf]);
  const fExams = useMemo(() => { let r = [...exams]; if (q) { const s = q.toLowerCase(); r = r.filter(e => e.name.toLowerCase().includes(s) || e.subject.toLowerCase().includes(s) || e.cat.toLowerCase().includes(s)); } if (cf !== "all") r = r.filter(e => e.cat === cf); r.sort((a, b) => b.date.localeCompare(a.date)); return r; }, [exams, q, cf]);
  const fMemory = useMemo(() => { let r = [...memory]; if (q) { const s = q.toLowerCase(); r = r.filter(m => m.title.toLowerCase().includes(s) || m.tags.some(t => t.toLowerCase().includes(s)) || m.cat.toLowerCase().includes(s)); } if (cf !== "all") r = r.filter(m => m.cat === cf); r.sort((a, b) => b.updated.localeCompare(a.updated)); return r; }, [memory, q, cf]);

  const over = topics.filter(t => getSt(t) === "over").length;
  const due = topics.filter(t => getSt(t) === "due").length;
  const sched = topics.filter(t => getSt(t) === "sched").length;
  const upcoming = topics.filter(t => getSt(t) === "soon").length;

  const saveTopic = useCallback((t: Topic) => { setTopics(p => { const i = p.findIndex(x => x.id === t.id); return i >= 0 ? p.map(x => x.id === t.id ? t : x) : [t, ...p]; }); setModal(null); setEditT(null); }, []);
  const delTopic = useCallback((id: string) => { if (confirm("Delete?")) setTopics(p => p.filter(t => t.id !== id)); }, []);
  const markStudied = useCallback((id: string, yes: boolean) => { setTopics(p => p.map(t => { if (t.id !== id) return t; if (yes) return { ...t, studied: true, sched: false, lvl: 0, next: nxt(iso(), 0), revs: [...t.revs, { date: iso(), ok: true, lvl: 0 }] }; return { ...t, studied: false, next: addD(t.next, 1), revs: [...t.revs, { date: iso(), ok: false, lvl: t.lvl }] }; })); }, []);
  const markRevised = useCallback((id: string) => { setTopics(p => p.map(t => { if (t.id !== id) return t; const nl = t.lvl + 1; return { ...t, lvl: nl, next: nxt(iso(), nl), revs: [...t.revs, { date: iso(), ok: true, lvl: nl }] }; })); }, []);
  const undoRev = useCallback((id: string) => { setTopics(p => p.map(t => { if (t.id !== id || !t.revs.length) return t; const rv = t.revs.slice(0, -1); const nl = Math.max(0, t.lvl - 1); const nr = rv.length ? nxt(rv[rv.length - 1].date, rv.length - 1) : t.date; return { ...t, lvl: nl, next: nr, revs: rv }; })); }, []);
  const saveExam = useCallback((e: Exam) => { setExams(p => { const i = p.findIndex(x => x.id === e.id); return i >= 0 ? p.map(x => x.id === e.id ? e : x) : [e, ...p]; }); setModal(null); setEditE(null); }, []);
  const delExam = useCallback((id: string) => { if (confirm("Delete?")) setExams(p => p.filter(e => e.id !== id)); }, []);
  const runAI = useCallback(async (eid: string) => { const ex = exams.find(e => e.id === eid); if (!ex?.answer) return; setAiId(eid); try { const r = await (window as any).puter.ai.chat(`Evaluate answer for "${ex.name}" (${ex.subject}).\n1.Rating/10 2.Strengths 3.Weaknesses 4.Missing 5.Tips\n\n${ex.answer}`, { model: "perplexity/sonar" }); const txt = typeof r === "string" ? r : r?.message?.content || String(r); setExams(p => p.map(e => e.id === eid ? { ...e, ai: txt } : e)); } catch (err: any) { setExams(p => p.map(e => e.id === eid ? { ...e, ai: "Error: " + (err?.message || "AI unavailable") } : e)); } finally { setAiId(null); } }, [exams]);
  const saveMem = useCallback((m: MemItem) => { setMemory(p => { const i = p.findIndex(x => x.id === m.id); return i >= 0 ? p.map(x => x.id === m.id ? m : x) : [m, ...p]; }); setModal(null); setEditM(null); }, []);
  const delMem = useCallback((id: string) => { if (confirm("Delete?")) setMemory(p => p.filter(m => m.id !== id)); }, []);
  const addCat = (c: string) => { if (c && !cats.includes(c)) setCats(p => [...p, c]); };
  const addSub = (s: string) => { if (s && !subs.includes(s)) setSubs(p => [...p, s]); };
  const addMemCat = (c: string) => { if (c && !memCats.includes(c)) setMemCats(p => [...p, c]); };
  const doExport = () => { const b = new Blob([JSON.stringify({ topics, exams, memory, cats, subs, memCats }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `spacerev-${iso()}.json`; a.click(); };
  const doImport = () => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.onchange = (e: any) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev: any) => { try { const d = JSON.parse(ev.target.result); if (d.topics) setTopics(d.topics); if (d.exams) setExams(d.exams); if (d.memory) setMemory(d.memory); } catch { alert("Invalid file"); } }; r.readAsText(f); }; inp.click(); };

  const curCats = tab === "memory" ? memCats : cats;
  const curItems = tab === "topics" ? topics : tab === "exams" ? exams : memory;

  const Modal = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}><div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>{children}</div></div>);

  const RichEditor = ({ value, onChange }: { value: string; onChange: (h: string) => void }) => {
    const ref = useRef<HTMLDivElement>(null);
    const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); ref.current?.focus(); onChange(ref.current?.innerHTML || ""); };
    useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, []);
    const colors = ["#000","#EF4444","#3B82F6","#10B981","#8B5CF6","#F59E0B","#EC4899","#6366F1"];
    return (<div className="border border-gray-200 rounded-xl overflow-hidden"><div className="bg-gray-50 border-b p-2 flex flex-wrap gap-1"><button type="button" onClick={() => exec("bold")} className="px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-gray-200">B</button><button type="button" onClick={() => exec("italic")} className="px-2.5 py-1 rounded-lg text-xs italic hover:bg-gray-200">I</button><button type="button" onClick={() => exec("underline")} className="px-2.5 py-1 rounded-lg text-xs underline hover:bg-gray-200">U</button><button type="button" onClick={() => exec("strikeThrough")} className="px-2.5 py-1 rounded-lg text-xs line-through hover:bg-gray-200">S</button><div className="w-px bg-gray-300 mx-0.5" /><button type="button" onClick={() => exec("formatBlock", "H2")} className="px-2.5 py-1 rounded-lg text-xs font-bold hover:bg-gray-200">H</button><button type="button" onClick={() => exec("insertUnorderedList")} className="px-2.5 py-1 rounded-lg text-xs hover:bg-gray-200">• List</button><button type="button" onClick={() => exec("insertOrderedList")} className="px-2.5 py-1 rounded-lg text-xs hover:bg-gray-200">1. List</button><div className="w-px bg-gray-300 mx-0.5" />{colors.map(c => <button key={c} type="button" onClick={() => exec("foreColor", c)} className="w-5 h-5 rounded-full border border-gray-300 hover:scale-125 transition-transform" style={{ backgroundColor: c }} />)}<div className="w-px bg-gray-300 mx-0.5" /><button type="button" onClick={() => exec("hiliteColor", "#FEF08A")} className="px-2 py-1 rounded-lg text-xs bg-yellow-200 hover:bg-yellow-300">HL</button><button type="button" onClick={() => exec("removeFormat")} className="px-2 py-1 rounded-lg text-xs text-gray-500 hover:bg-gray-200">Clear</button></div><div ref={ref} contentEditable suppressContentEditableWarning onInput={() => onChange(ref.current?.innerHTML || "")} className="min-h-[160px] p-4 outline-none text-sm leading-relaxed prose prose-sm max-w-none" /></div>);
  };

  // ── Topic Form ──
  const TopicForm = () => {
    const [title,sT]=useState(editT?.title||"");const [sub,sS]=useState(editT?.subject||"");const [cat,sC]=useState(editT?.cat||"");const [desc,sD]=useState(editT?.desc||"");const [dt,sDt]=useState(editT?.date||iso());const [lnk,sL]=useState<Lnk[]>(editT?.links?.length?editT.links:[{id:uid(),label:"",url:""}]);const [nS,sNS]=useState("");const [nC,sNC]=useState("");const [showNS,sSNS]=useState(false);const [showNC,sSNC]=useState(false);
    const save=(e:React.FormEvent)=>{e.preventDefault();if(!title.trim())return;const f=isFut(dt);saveTopic({id:editT?.id||uid(),title:title.trim(),subject:sub,cat,desc,date:dt,studied:editT?.studied??(f?null:true),links:lnk.filter(l=>l.url.trim()),revs:editT?.revs||[],next:f?dt:nxt(dt,editT?.lvl||0),lvl:editT?.lvl||0,sched:f,created:editT?.created||new Date().toISOString()});};
    return (<Modal onClose={()=>{setModal(null);setEditT(null);}}><form onSubmit={save} className="p-6 sm:p-8 space-y-5"><div className="flex items-center gap-3"><div className="bg-indigo-100 p-2.5 rounded-2xl"><span className="text-xl">📚</span></div><div><h2 className="text-xl font-bold">{editT?"Edit Topic":"Add Topic"}</h2><p className="text-sm text-gray-500">Track for spaced revision</p></div></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Title *</label><input value={title} onChange={e=>sT(e.target.value)} required placeholder="e.g., Binary Search" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" /></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject</label>{!showNS?(<div className="flex gap-2"><select value={sub} onChange={e=>sS(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-gray-200 bg-white outline-none"><option value="">Select...</option>{subs.map(s=><option key={s}>{s}</option>)}</select><button type="button" onClick={()=>sSNS(true)} className="px-4 rounded-xl border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50"><IPlus sz={16}/></button></div>):(<div className="flex gap-2"><input value={nS} onChange={e=>sNS(e.target.value)} placeholder="New subject..." className="flex-1 px-4 py-3 rounded-xl border border-gray-200 outline-none" autoFocus onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSub(nS.trim());sS(nS.trim());sNS("");sSNS(false);}}}/><button type="button" onClick={()=>{addSub(nS.trim());sS(nS.trim());sNS("");sSNS(false);}} className="px-4 py-3 rounded-xl bg-indigo-500 text-white text-sm">Add</button><button type="button" onClick={()=>sSNS(false)} className="p-3 text-gray-400"><IX sz={14}/></button></div>)}</div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Category</label>{!showNC?(<div className="flex flex-wrap gap-2">{cats.map(c=><button key={c} type="button" onClick={()=>sC(cat===c?"":c)} className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border-2 ${cat===c?"bg-indigo-100 text-indigo-700 border-indigo-300":"bg-white text-gray-600 border-gray-200"}`}>{c}</button>)}<button type="button" onClick={()=>sSNC(true)} className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border-2 border-dashed border-indigo-300 text-indigo-600">+ Add</button></div>):(<div className="flex gap-2"><input value={nC} onChange={e=>sNC(e.target.value)} placeholder="New category..." className="flex-1 px-4 py-3 rounded-xl border border-gray-200 outline-none" autoFocus onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addCat(nC.trim());sC(nC.trim());sNC("");sSNC(false);}}}/><button type="button" onClick={()=>{addCat(nC.trim());sC(nC.trim());sNC("");sSNC(false);}} className="px-4 py-3 rounded-xl bg-indigo-500 text-white text-sm">Add</button><button type="button" onClick={()=>sSNC(false)} className="p-3 text-gray-400"><IX sz={14}/></button></div>)}</div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Study Date</label><input type="date" value={dt} onChange={e=>sDt(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/>{isFut(dt)&&<p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl">📅 Scheduled</p>}</div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label><textarea value={desc} onChange={e=>sD(e.target.value)} rows={3} placeholder="Notes..." className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none resize-none"/></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Links</label>{lnk.map((l,i)=>(<div key={l.id} className="flex gap-2 mt-2"><input value={l.label} onChange={e=>sL(lnk.map(x=>x.id===l.id?{...x,label:e.target.value}:x))} placeholder={`Label ${i+1}`} className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none"/><input value={l.url} onChange={e=>sL(lnk.map(x=>x.id===l.id?{...x,url:e.target.value}:x))} placeholder="https://..." className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none"/>{lnk.length>1&&<button type="button" onClick={()=>sL(lnk.filter(x=>x.id!==l.id))} className="p-2 text-gray-300 hover:text-red-500"><IX sz={14}/></button>}</div>))}<button type="button" onClick={()=>sL([...lnk,{id:uid(),label:"",url:""}])} className="mt-2 text-sm font-medium text-indigo-600"><IPlus sz={14}/> Add link</button></div><div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={()=>{setModal(null);setEditT(null);}} className="px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button><button type="submit" className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg">Save</button></div></form></Modal>);
  };

  // ── Exam Form ──
  const ExamForm = () => {
    const [name,sN]=useState(editE?.name||"");const [sub,sS]=useState(editE?.subject||"");const [cat,sC]=useState(editE?.cat||"");const [dt,sDt]=useState(editE?.date||iso());const [desc,sD]=useState(editE?.desc||"");const [mx,sMx]=useState(String(editE?.max??100));const [gt,sGt]=useState(String(editE?.got??""));const [ans,sAns]=useState(editE?.answer||"");const [lnk,sL]=useState<Lnk[]>(editE?.links?.length?editE.links:[{id:uid(),label:"",url:""}]);
    const save=(e:React.FormEvent)=>{e.preventDefault();if(!name.trim())return;const m=+mx||100,g=+gt||0,p=m>0?Math.round(g/m*100):0;saveExam({id:editE?.id||uid(),name:name.trim(),subject:sub,cat,date:dt,desc,links:lnk.filter(l=>l.url.trim()),max:m,got:g,pct:p,grade:calcGr(p),answer:ans,ai:editE?.ai||"",created:editE?.created||new Date().toISOString()});};
    return (<Modal onClose={()=>{setModal(null);setEditE(null);}}><form onSubmit={save} className="p-6 sm:p-8 space-y-5"><div className="flex items-center gap-3"><div className="bg-amber-100 p-2.5 rounded-2xl"><span className="text-xl">📝</span></div><div><h2 className="text-xl font-bold">{editE?"Edit Exam":"Add Exam"}</h2><p className="text-sm text-gray-500">Track scores & get AI feedback</p></div></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Exam Name *</label><input value={name} onChange={e=>sN(e.target.value)} required placeholder="e.g., UPSC Mock" className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject</label><select value={sub} onChange={e=>sS(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white outline-none"><option value="">Select...</option>{subs.map(s=><option key={s}>{s}</option>)}</select></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Category</label><select value={cat} onChange={e=>sC(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white outline-none"><option value="">Select...</option>{cats.map(c=><option key={c}>{c}</option>)}</select></div></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Date</label><input type="date" value={dt} onChange={e=>sDt(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Max Marks</label><input type="number" value={mx} onChange={e=>sMx(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Obtained</label><input type="number" value={gt} onChange={e=>sGt(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/></div></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Answer Sheet (AI)</label><textarea value={ans} onChange={e=>sAns(e.target.value)} rows={4} placeholder="Paste answer..." className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none resize-none"/></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Links</label>{lnk.map((l,i)=>(<div key={l.id} className="flex gap-2 mt-2"><input value={l.label} onChange={e=>sL(lnk.map(x=>x.id===l.id?{...x,label:e.target.value}:x))} placeholder={`Label ${i+1}`} className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none"/><input value={l.url} onChange={e=>sL(lnk.map(x=>x.id===l.id?{...x,url:e.target.value}:x))} placeholder="https://..." className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none"/></div>))}<button type="button" onClick={()=>sL([...lnk,{id:uid(),label:"",url:""}])} className="mt-2 text-sm font-medium text-amber-600"><IPlus sz={14}/> Add link</button></div><div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={()=>{setModal(null);setEditE(null);}} className="px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button><button type="submit" className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-600 shadow-lg">Save</button></div></form></Modal>);
  };

  // ── Memory Form ──
  const MemoryForm = () => {
    const [title,sT]=useState(editM?.title||"");const [cat,sC]=useState(editM?.cat||"");const [content,sCont]=useState(editM?.content||"");const [tags,sTags]=useState(editM?.tags?.join(", ")||"");const [nC,sNC]=useState("");const [showNC,sSNC]=useState(false);
    const save=(e:React.FormEvent)=>{e.preventDefault();if(!title.trim())return;saveMem({id:editM?.id||uid(),title:title.trim(),cat,content,tags:tags.split(",").map(t=>t.trim()).filter(Boolean),created:editM?.created||new Date().toISOString(),updated:new Date().toISOString()});};
    return (<Modal onClose={()=>{setModal(null);setEditM(null);}}><form onSubmit={save} className="p-6 sm:p-8 space-y-5"><div className="flex items-center gap-3"><div className="bg-teal-100 p-2.5 rounded-2xl"><span className="text-xl">🧠</span></div><div><h2 className="text-xl font-bold">{editM?"Edit Memory":"Add Memory"}</h2><p className="text-sm text-gray-500">Thinkers, concepts, notes</p></div></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Title *</label><input value={title} onChange={e=>sT(e.target.value)} required placeholder="e.g., Amartya Sen — Capability Approach" className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"/></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Category</label>{!showNC?(<div className="flex flex-wrap gap-2">{memCats.map(c=><button key={c} type="button" onClick={()=>sC(cat===c?"":c)} className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border-2 ${cat===c?"bg-teal-100 text-teal-700 border-teal-300":"bg-white text-gray-600 border-gray-200"}`}>{c}</button>)}<button type="button" onClick={()=>sSNC(true)} className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border-2 border-dashed border-teal-300 text-teal-600">+ Add</button></div>):(<div className="flex gap-2"><input value={nC} onChange={e=>sNC(e.target.value)} placeholder="New category..." className="flex-1 px-4 py-3 rounded-xl border border-gray-200 outline-none" autoFocus onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addMemCat(nC.trim());sC(nC.trim());sNC("");sSNC(false);}}}/><button type="button" onClick={()=>{addMemCat(nC.trim());sC(nC.trim());sNC("");sSNC(false);}} className="px-4 py-3 rounded-xl bg-teal-500 text-white text-sm">Add</button><button type="button" onClick={()=>sSNC(false)} className="p-3 text-gray-400"><IX sz={14}/></button></div>)}</div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Content</label><RichEditor value={content} onChange={sCont}/></div><div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Tags (comma separated)</label><input value={tags} onChange={e=>sTags(e.target.value)} placeholder="Philosophy, Justice, Ethics" className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none"/></div><div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={()=>{setModal(null);setEditM(null);}} className="px-5 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button><button type="submit" className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-emerald-600 shadow-lg">Save</button></div></form></Modal>);
  };

  // ── Calendar ──
  const CalView = () => {
    const [mo,sMo]=useState(new Date().getMonth());const [yr,sYr]=useState(new Date().getFullYear());const days=new Date(yr,mo+1,0).getDate();const f1=new Date(yr,mo,1).getDay();const td=iso();const MO=["January","February","March","April","May","June","July","August","September","October","November","December"];
    const items=(day:number)=>{const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;if(tab==="topics")return topics.filter(t=>t.date===ds||t.next===ds).map(t=>({k:t.id,t:t.title,c:t.next===ds?"bg-emerald-100 text-emerald-700":"bg-blue-100 text-blue-700"}));if(tab==="exams")return exams.filter(e=>e.date===ds).map(e=>({k:e.id,t:e.name,c:e.pct>=70?"bg-emerald-100 text-emerald-700":e.pct>=50?"bg-amber-100 text-amber-700":"bg-red-100 text-red-700"}));return memory.filter(m=>m.created.startsWith(ds)).map(m=>({k:m.id,t:m.title,c:"bg-teal-100 text-teal-700"}));};
    return (<div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"><div className="flex items-center justify-between p-5 border-b"><button onClick={()=>{if(mo===0){sMo(11);sYr(yr-1);}else sMo(mo-1);}} className="p-2.5 rounded-xl hover:bg-gray-100"><IChevL sz={18}/></button><h3 className="text-lg font-bold">{MO[mo]} {yr}</h3><button onClick={()=>{if(mo===11){sMo(0);sYr(yr+1);}else sMo(mo+1);}} className="p-2.5 rounded-xl hover:bg-gray-100"><IChevR sz={18}/></button></div><div className="p-4"><div className="grid grid-cols-7 gap-1 mb-2">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>)}</div><div className="grid grid-cols-7 gap-1">{Array.from({length:f1}).map((_,i)=><div key={`b${i}`} className="min-h-[68px] rounded-xl bg-gray-50/60"/>)}{Array.from({length:days}).map((_,i)=>{const day=i+1;const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;const its=items(day);const isT=ds===td;return(<div key={day} className={`min-h-[68px] p-1.5 rounded-xl border ${isT?"border-indigo-400 bg-indigo-50 shadow-sm":its.length?"border-gray-200":"border-gray-100 bg-gray-50/40"}`}><div className={`text-xs font-bold mb-0.5 ${isT?"text-indigo-600":its.length?"text-gray-800":"text-gray-400"}`}>{day}</div>{its.slice(0,2).map(it=><div key={it.k} className={`${it.c} px-1 py-0.5 rounded-md truncate text-[9px] font-medium mb-0.5`}>{it.t}</div>)}{its.length>2&&<div className="text-[9px] text-gray-400">+{its.length-2}</div>}</div>);})}</div></div></div>);
  };

  const stCfg = (t: Topic) => { const s = getSt(t); const d = daysDiff(t.next); const m: Record<string, [string, string, string]> = { sched: ["bg-violet-100 text-violet-700 border-violet-200", "Scheduled", "border-l-violet-400"], over: ["bg-red-100 text-red-700 border-red-200", `${Math.abs(d)}d overdue`, "border-l-red-400"], due: ["bg-amber-100 text-amber-700 border-amber-200", "Due today", "border-l-amber-400"], soon: ["bg-emerald-100 text-emerald-700 border-emerald-200", `In ${d}d`, "border-l-emerald-400"] }; return m[s]; };

  // ══════════════════════ RENDER ══════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-indigo-50/30">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="relative"><div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-2xl shadow-lg shadow-indigo-200"><span className="text-xl">🧠</span></div><span className="absolute -top-1 -right-1 text-xs">✨</span></div><div><h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">Space<span className="text-indigo-600">Rev</span></h1><div className="flex items-center gap-2"><p className="text-[10px] text-gray-400 hidden sm:block">by Rupam</p>{user.mode==="supabase"&&<span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>Synced</span>}</div></div></div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-xs"><IUser sz={14} cls="text-gray-400"/><span className="font-medium text-gray-600 max-w-[80px] truncate">{user.name}</span></div>
            <div className="flex bg-gray-100 rounded-xl p-1"><button onClick={()=>setView("list")} className={`p-2 rounded-lg ${view==="list"?"bg-white shadow-sm text-gray-900":"text-gray-500"}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></svg></button><button onClick={()=>setView("cal")} className={`p-2 rounded-lg ${view==="cal"?"bg-white shadow-sm text-gray-900":"text-gray-500"}`}><ICal sz={16}/></button></div>
            <button onClick={doImport} className="p-2.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 hidden sm:block"><IUL sz={18}/></button>
            <button onClick={doExport} className="p-2.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 hidden sm:block"><IDL sz={18}/></button>
            <button onClick={onLogout} className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50" title="Sign Out"><ILogOut sz={18}/></button>
            <button onClick={()=>{if(tab==="topics"){setEditT(null);setModal("topic");}else if(tab==="exams"){setEditE(null);setModal("exam");}else{setEditM(null);setModal("memory");}}} className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 shadow-md hover:shadow-lg"><IPlus sz={16}/><span className="hidden sm:inline">Add</span></button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 border border-gray-100 shadow-sm w-fit">{([["topics","📚","Topics",topics.length],["exams","📝","Exams",exams.length],["memory","🧠","Memory",memory.length]] as [Tab,string,string,number][]).map(([k,e,l,n])=><button key={k} onClick={()=>{setTab(k);setCf("all");}} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab===k?(k==="topics"?"bg-indigo-100 text-indigo-700":k==="exams"?"bg-amber-100 text-amber-700":"bg-teal-100 text-teal-700"):"text-gray-500 hover:bg-gray-50"}`}>{e} {l} ({n})</button>)}</div>

        {tab==="topics"&&topics.length>0&&(<div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{([["Total",topics.length,"📚","blue"],["Overdue",over,"⚠️","red"],["Due Today",due,"🔔","amber"],["Scheduled",sched,"📅","violet"],["Upcoming",upcoming,"📈","emerald"]] as [string,number,string,string][]).map(([l,v,e,c])=>(<div key={l} className={`relative overflow-hidden bg-white rounded-2xl border p-4 shadow-sm hover:shadow-md transition-shadow`}><div className="flex items-center gap-3"><div className={`bg-${c}-50 p-2.5 rounded-xl`}><span className="text-lg">{e}</span></div><div><p className="text-2xl font-bold text-gray-900">{v}</p><p className="text-xs font-medium text-gray-500">{l}</p></div></div><div className={`absolute bottom-0 left-0 right-0 h-1 bg-${c}-500`}/></div>))}</div>)}

        {curItems.length>0&&(<div className="space-y-3"><div className="relative"><div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><ISearch sz={18}/></div><input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${tab}...`} className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none shadow-sm"/></div><div className="flex gap-2 overflow-x-auto no-scrollbar pb-1"><button onClick={()=>setCf("all")} className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border-2 ${cf==="all"?"bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-transparent shadow-md":"bg-white text-gray-600 border-gray-200"}`}>All</button>{curCats.map(c=>{const n=tab==="topics"?topics.filter(t=>t.cat===c).length:tab==="exams"?exams.filter(e=>e.cat===c).length:memory.filter(m=>m.cat===c).length;return<button key={c} onClick={()=>setCf(cf===c?"all":c)} className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border-2 ${cf===c?"bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-transparent shadow-md":"bg-white text-gray-600 border-gray-200"}`}>{c}{n>0&&<span className="ml-1.5 opacity-70">({n})</span>}</button>;})}</div></div>)}

        {view==="cal"&&<CalView/>}

        {/* TOPICS */}
        {view==="list"&&tab==="topics"&&(topics.length===0?(<div className="text-center py-20 bg-white rounded-3xl border shadow-sm"><div className="w-20 h-20 bg-indigo-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">📚</span></div><h3 className="text-xl font-bold mb-2">No topics yet</h3><p className="text-gray-500 mb-8">Start tracking your revision</p><button onClick={()=>setModal("topic")} className="px-6 py-3 rounded-xl text-white bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold shadow-lg">+ Add Topic</button></div>):fTopics.length===0?<p className="text-center text-gray-400 py-12">No matches.</p>:(<div className="space-y-3">{fTopics.map(t=>{const [badge,badgeText,border]=stCfg(t);const s=getSt(t);const exp=expId===t.id;const prog=Math.min((t.lvl/IV.length)*100,100);return(<div key={t.id} className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all border-l-4 ${border}`}><div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{t.title}</h3><span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge}`}><span className={`w-1.5 h-1.5 rounded-full animate-pulse ${s==="over"?"bg-red-500":s==="due"?"bg-amber-500":s==="sched"?"bg-violet-500":"bg-emerald-500"}`}/>{badgeText}</span></div><div className="mt-2 flex gap-2 flex-wrap">{t.subject&&<span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-xs">{t.subject}</span>}{t.cat&&<span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs">{t.cat}</span>}</div><p className="mt-2 text-xs text-gray-500">Studied: {fmt(t.date)} · Next: {fmt(t.next)} · Level: {t.lvl}/{IV.length}</p><div className="mt-3 flex items-center gap-3"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style={{width:`${prog}%`}}/></div><span className="text-xs font-medium text-gray-500 w-10 text-right">{t.lvl}/{IV.length}</span></div></div><div className="flex items-center gap-1 shrink-0">{s==="sched"&&<><button onClick={()=>markStudied(t.id,true)} className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><ICheck sz={16}/></button><button onClick={()=>markStudied(t.id,false)} className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100"><IX sz={16}/></button></>}{(s==="over"||s==="due")&&<button onClick={()=>markRevised(t.id)} className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><ICheck sz={16}/></button>}{s==="soon"&&<button onClick={()=>markRevised(t.id)} className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100"><IRefresh sz={16}/></button>}{t.revs.length>0&&<button onClick={()=>undoRev(t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IUndo sz={16}/></button>}<button onClick={()=>{setEditT(t);setModal("topic");}} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16}/></button><button onClick={()=>delTopic(t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16}/></button><button onClick={()=>setExpId(exp?null:t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp?<IChevU sz={16}/>:<IChevD sz={16}/>}</button></div></div></div>{exp&&<div className="px-4 sm:px-5 pb-4 border-t pt-4 space-y-4">{t.desc&&<p className="text-sm text-gray-700 whitespace-pre-wrap">{t.desc}</p>}{t.links.length>0&&<div className="flex flex-wrap gap-2">{t.links.map(l=><a key={l.id} href={l.url} target="_blank" className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm hover:bg-indigo-100">🔗 {l.label||"Link"}</a>)}</div>}{t.revs.length>0&&<div className="flex flex-wrap gap-2">{t.revs.map((r,i)=><span key={i} className={`px-3 py-1.5 rounded-lg text-xs ${r.ok?"bg-emerald-50 text-emerald-700":"bg-red-50 text-red-700"}`}>#{i+1} {fmt(r.date)} {r.ok?"✓":"✕"}</span>)}</div>}</div>}</div>);})}</div>))}

        {/* EXAMS */}
        {view==="list"&&tab==="exams"&&(exams.length===0?(<div className="text-center py-20 bg-white rounded-3xl border shadow-sm"><div className="w-20 h-20 bg-amber-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">📝</span></div><h3 className="text-xl font-bold mb-2">No exams yet</h3><p className="text-gray-500 mb-8">Track scores & get AI feedback</p><button onClick={()=>setModal("exam")} className="px-6 py-3 rounded-xl text-white bg-gradient-to-r from-amber-500 to-orange-600 font-semibold shadow-lg">+ Add Exam</button></div>):fExams.length===0?<p className="text-center text-gray-400 py-12">No matches.</p>:(<div className="space-y-3">{fExams.map(e=>{const exp=expId===e.id;const bc=e.pct>=70?"border-l-emerald-400":e.pct>=50?"border-l-amber-400":"border-l-red-400";const gc=e.pct>=70?"text-emerald-600 bg-emerald-50":e.pct>=50?"text-amber-600 bg-amber-50":"text-red-600 bg-red-50";const barc=e.pct>=70?"from-emerald-400 to-green-500":e.pct>=50?"from-amber-400 to-orange-500":"from-red-400 to-red-500";return(<div key={e.id} className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all border-l-4 ${bc}`}><div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="text-base sm:text-lg font-semibold truncate">{e.name}</h3><span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${gc}`}>{e.grade}</span></div><div className="mt-2 flex gap-2 flex-wrap">{e.subject&&<span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-xs">{e.subject}</span>}{e.cat&&<span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs">{e.cat}</span>}</div><p className="mt-2 text-xs text-gray-500">{fmt(e.date)} · {e.got}/{e.max} · {e.pct}%</p><div className="mt-3 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r ${barc} rounded-full`} style={{width:`${e.pct}%`}}/></div></div><div className="flex items-center gap-1 shrink-0"><button onClick={()=>{setEditE(e);setModal("exam");}} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16}/></button><button onClick={()=>delExam(e.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16}/></button><button onClick={()=>setExpId(exp?null:e.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp?<IChevU sz={16}/>:<IChevD sz={16}/>}</button></div></div></div>{exp&&<div className="px-4 sm:px-5 pb-4 border-t pt-4 space-y-4">{e.desc&&<p className="text-sm text-gray-700 whitespace-pre-wrap">{e.desc}</p>}{e.links.length>0&&<div className="flex flex-wrap gap-2">{e.links.map(l=><a key={l.id} href={l.url} target="_blank" className="px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-sm hover:bg-amber-100">🔗 {l.label||"Link"}</a>)}</div>}<div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl p-5 border border-purple-100"><h4 className="text-sm font-bold text-purple-800 mb-3">✨ AI Analysis</h4>{e.answer?(<><button onClick={()=>runAI(e.id)} disabled={aiId===e.id} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-indigo-600 shadow-md disabled:opacity-50 mb-3">{aiId===e.id?"⏳ Analyzing...":"✨ Analyze with AI"}</button>{e.ai&&<div className="bg-white border border-purple-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{e.ai}</div>}</>):<p className="text-sm text-purple-600/70">Add answer text to enable AI</p>}</div></div>}</div>);})}</div>))}

        {/* MEMORY */}
        {view==="list"&&tab==="memory"&&(memory.length===0?(<div className="text-center py-20 bg-white rounded-3xl border shadow-sm"><div className="w-20 h-20 bg-teal-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">🧠</span></div><h3 className="text-xl font-bold mb-2">No memory items yet</h3><p className="text-gray-500 mb-8">Store thinkers, concepts, key facts</p><button onClick={()=>setModal("memory")} className="px-6 py-3 rounded-xl text-white bg-gradient-to-r from-teal-500 to-emerald-600 font-semibold shadow-lg">+ Add Memory</button></div>):fMemory.length===0?<p className="text-center text-gray-400 py-12">No matches.</p>:(<div className="space-y-3">{fMemory.map(m=>{const exp=expId===m.id;return(<div key={m.id} className="bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all border-l-4 border-l-teal-400"><div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{m.title}</h3>{m.cat&&<span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700 border border-teal-200">{m.cat}</span>}</div>{m.tags.length>0&&<div className="mt-2 flex flex-wrap gap-1.5">{m.tags.map(t=><span key={t} className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs">#{t}</span>)}</div>}<p className="mt-1.5 text-[11px] text-gray-400">Updated: {fmt(m.updated.split("T")[0])}</p></div><div className="flex items-center gap-1 shrink-0"><button onClick={()=>{setEditM(m);setModal("memory");}} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16}/></button><button onClick={()=>delMem(m.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16}/></button><button onClick={()=>setExpId(exp?null:m.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp?<IChevU sz={16}/>:<IChevD sz={16}/>}</button></div></div></div>{exp&&<div className="px-4 sm:px-5 pb-5 border-t pt-4"><div className="prose prose-sm max-w-none text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{__html:m.content}}/></div>}</div>);})}</div>))}

        {tab==="topics"&&topics.length>0&&(<div className="bg-white/80 rounded-2xl border p-5"><h3 className="text-sm font-bold text-gray-700 mb-3">✨ Revision Levels</h3><div className="grid grid-cols-7 gap-2">{IV.map((d,i)=><div key={d} className="text-center p-2 rounded-xl bg-gradient-to-b from-indigo-50 to-purple-50"><div className="text-xs font-bold text-indigo-600">L{i+1}</div><div className="text-sm font-semibold text-gray-800 mt-1">{d<30?`${d}d`:`${Math.round(d/30)}mo`}</div></div>)}</div><p className="text-xs text-gray-500 mt-3">✓ advances · ✕ postpones · ↩ undo</p></div>)}
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-8 text-center"><p className="text-xs text-gray-400">SpaceRev — by Rupam{user.mode==="supabase"?" · ☁️ Cloud synced":" · 💾 Local storage"}</p></footer>

      {modal==="topic"&&<TopicForm/>}
      {modal==="exam"&&<ExamForm/>}
      {modal==="memory"&&<MemoryForm/>}
    </div>
  );
}

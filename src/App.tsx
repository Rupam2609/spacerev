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
// ══════════════════════════════════════════════════════════════╝
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
  grade: string; answer: string; ai: string; attachments: FileAttachment[]; created: string;
}
interface MemItem {
  id: string; title: string; cat: string; content: string; tags: string[];
  created: string; updated: string;
}
interface DailyTask {
  id: string; date: string; answerWriting: boolean; mcqSolved: number; caMcqSolved: number; notes: string;
}
interface FileAttachment {
  id: string; name: string; type: string; size: number; dataUrl: string; textContent?: string;
}
interface AppUser { id: string; email: string; name: string; mode: "supabase" | "local" }
type Tab = "topics" | "exams" | "memory" | "stats" | "daily";

// ╔══════════════════════════════════════════════════════════════╗
// ║                       HELPERS                                ║
// ╚══════════════════════════════════════════════════════════════╝
const IV = [1, 3, 7, 14, 30, 60, 120];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const iso = () => new Date().toISOString().split("T")[0];
const addD = (s: string, n: number) => { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
const nxt = (f: string, i: number) => addD(f, IV[Math.min(i, 6)]);
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const isFut = (s: string) => s > iso();
const daysDiff = (s: string) => Math.round((new Date(s).getTime() - new Date(iso()).getTime()) / 864e5);
const getSt = (t: Topic) => { if (t.sched && t.studied === null) return "sched"; const d = daysDiff(t.next); return d < 0 ? "over" : d === 0 ? "due" : "soon"; };
const calcGr = (p: number) => p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B+" : p >= 60 ? "B" : p >= 50 ? "C" : p >= 40 ? "D" : "F";
const CATS_T = ["GS", "Optional", "Prelims", "Mains", "Essay"];
const CATS_M = ["GS1", "GS2", "GS3", "GS4", "Ethics", "Optional", "Essay", "Current Affairs"];

async function hashPw(pw: string, salt: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw + salt));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function genSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join(""); }

// ╔══════════════════════════════════════════════════════════════╗
// ║              SYNCED STORE WITH REALTIME                      ║
// ╚══════════════════════════════════════════════════════════════╝
function useSyncRealtime<T>(key: string, init: T, userId: string | null): [T, (fn: T | ((p: T) => T)) => void, boolean] {
  const lsKey = userId ? `sr_${userId}_${key}` : `sr_${key}`;
  const [val, setVal] = useState<T>(() => { try { const s = localStorage.getItem(lsKey); return s ? JSON.parse(s) : init; } catch { return init; } });
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!HAS_SB || !userId) { setLoading(false); return; }
    const loadData = async () => {
      try {
        const c = getSB()!;
        const { data, error } = await c.from("user_store").select("value").eq("user_id", userId).eq("key", key).single();
        if (!error && data?.value) { setVal(data.value); localStorage.setItem(lsKey, JSON.stringify(data.value)); }
      } catch (err) { console.log(`No ${key} data in Supabase yet`); }
      finally { setLoading(false); }
    };
    loadData();
    const c = getSB()!;
    channelRef.current = c.channel(`user_store:${userId}:${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_store', filter: `user_id=eq.${userId} AND key=eq.${key}` }, (payload: any) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const newVal = payload.new.value; setVal(newVal); localStorage.setItem(lsKey, JSON.stringify(newVal));
        }
      }).subscribe();
    return () => { if (channelRef.current) c.removeChannel(channelRef.current); };
  }, [userId, key, lsKey]);

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(val)); } catch {}
    if (HAS_SB && userId && !loading) {
      const c = getSB()!;
      c.from("user_store").upsert({ user_id: userId, key, value: val, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" }).then(() => {});
    }
  }, [val, lsKey, key, userId, loading]);

  const setValWrapper = useCallback((fn: T | ((p: T) => T)) => {
    setVal(prev => typeof fn === 'function' ? (fn as (p: T) => T)(prev) : fn);
  }, []);

  return [val, setValWrapper, loading];
}

async function loadAllFromSB(userId: string): Promise<Record<string, any>> {
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
const ICal = (p: any) => <Ic {...p} d="M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18" />;
const IDL = (p: any) => <Ic {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />;
const IUL = (p: any) => <Ic {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />;
const ILogOut = (p: any) => <Ic {...p} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />;
const IUser = (p: any) => <Ic {...p} d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z" />;
const IEdit2 = (p: any) => <Ic {...p} d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z" />;
const ICloud = (p: any) => <Ic {...p} d="M17.5 19c0-1.7-1.3-3-3-3h-1.1c-.1-2.9-2.5-5.2-5.4-5.2C5.2 10.8 3 13 3 15.8c0 .4 0 .8.1 1.2C1.3 17.5 0 19.2 0 21.2 0 23.7 2 25.8 4.5 25.8h13c2.8 0 5-2.2 5-5s-2.2-5-5-5z" />;
const IChart = (p: any) => <Ic {...p} d="M18 20V10M12 20V4M6 20v-6" />;
const IFile = (p: any) => <Ic {...p} d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />;
const IImage = (p: any) => <Ic {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m18 0l-6-6-6 6M12 12v9m0-9a4 4 0 100-8 4 4 0 000 8z" />;
const ICalendar = (p: any) => <Ic {...p} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />;
const ITarget = (p: any) => <Ic {...p} d="M22 12h-4l-3 9L9 3l-3 9H2" />;

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
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block relative mb-4">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-3xl shadow-2xl">
              <span className="text-4xl">🧠</span>
            </div>
            <span className="absolute -top-2 -right-2 text-2xl">✨</span>
          </div>
          <h1 className="text-4xl font-black text-gray-900">Space<span className="text-indigo-600">Rev</span></h1>
          <p className="text-gray-500 mt-2 text-sm">Spaced Revision & Exam Tracker</p>
          <div className="mt-3">
            {HAS_SB ? (
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                <ICloud sz={14} /> Cloud Sync · Multi-device
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold">💾 Local Mode</span>
            )}
          </div>
        </div>

        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="flex border-b">
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setErr(""); setOk(""); }}
                className={`flex-1 py-4 text-sm font-bold ${mode === m ? "text-indigo-600" : "text-gray-400"}`}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="p-6 sm:p-8 space-y-5">
            {mode === "signup" && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{HAS_SB ? "Email" : "Username"}</label>
              <input type={HAS_SB ? "email" : "text"} value={email} onChange={e => setEmail(e.target.value)} required placeholder={HAS_SB ? "you@email.com" : "Username"} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-100" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <input type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} required minLength={6} placeholder="Min 6 characters" className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-100" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="text-xs text-gray-400 mt-1">{showPw ? "Hide" : "Show"}</button>
            </div>
            {err && <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">⚠️ {err}</div>}
            {ok && <div className="p-3 rounded-xl bg-emerald-50 text-sm text-emerald-700">✅ {ok}</div>}
            <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-600 disabled:opacity-60">
              {loading ? "⏳ Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
            </button>
            <p className="text-center text-sm text-gray-500">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); setOk(""); }} className="text-indigo-600 font-semibold">{mode === "login" ? "Sign Up" : "Sign In"}</button>
            </p>
          </form>
        </div>
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

  useEffect(() => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; setChecking(false); } }, 3000);
    (async () => {
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
      try {
        const s = localStorage.getItem("sr_session");
        if (s) { const u = JSON.parse(s); if (!done) { done = true; setUser(u); setChecking(false); return; } }
      } catch {}
      if (!done) { done = true; setChecking(false); }
    })();
    return () => clearTimeout(timer);
  }, []);

  const login = (u: AppUser) => { setUser(u); localStorage.setItem("sr_session", JSON.stringify(u)); };
  const logout = async () => { if (HAS_SB) try { getSB()?.auth.signOut(); } catch {}; localStorage.removeItem("sr_session"); setUser(null); };

  if (checking) return (<div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center"><div className="text-center"><div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-3xl shadow-xl inline-block mb-4 animate-pulse"><span className="text-3xl">🧠</span></div><p className="text-gray-500 text-sm">Loading...</p></div></div>);
  if (!user) return <AuthPage onLogin={login} />;

  return <Dashboard user={user} onLogout={logout} />;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                     DASHBOARD                                ║
// ╚══════════════════════════════════════════════════════════════╝
function Dashboard({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const userId = user.id;
  const [topics, setTopics, topicsLoading] = useSyncRealtime<Topic[]>("topics", [], userId);
  const [exams, setExams, examsLoading] = useSyncRealtime<Exam[]>("exams", [], userId);
  const [memory, setMemory, memoryLoading] = useSyncRealtime<MemItem[]>("memory", [], userId);
  const [daily, setDaily, dailyLoading] = useSyncRealtime<DailyTask[]>("daily", [], userId);
  const [cats, setCats] = useSyncRealtime<string[]>("cats", CATS_T, userId);
  const [subs, setSubs] = useSyncRealtime<string[]>("subs", [], userId);
  const [memCats, setMemCats] = useSyncRealtime<string[]>("memcats", CATS_M, userId);
  const [examSubs, setExamSubs] = useSyncRealtime<string[]>("examsubs", [], userId);

  // Auto-postpone overdue
  useEffect(() => {
    const today = iso();
    let changed = false;
    const updated = topics.map(t => {
      if (!t.sched && t.studied !== null && daysDiff(t.next) < 0) {
        changed = true;
        return { ...t, next: addD(today, 1) };
      }
      return t;
    });
    if (changed) setTopics(updated);
  }, []);

  useEffect(() => {
    if (user.mode !== "supabase") return;
    loadAllFromSB(userId).then(d => {
      if (d.topics?.length) setTopics(d.topics);
      if (d.exams?.length) setExams(d.exams);
      if (d.memory?.length) setMemory(d.memory);
      if (d.daily?.length) setDaily(d.daily);
      if (d.cats?.length) setCats(d.cats);
      if (d.subs?.length) setSubs(d.subs);
      if (d.memcats?.length) setMemCats(d.memcats);
      if (d.examsubs?.length) setExamSubs(d.examsubs);
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
  const [revEdit, setRevEdit] = useState<{ tid: string; revIdx: number; date: string } | null>(null);

  const fTopics = useMemo(() => { let r = [...topics]; if (q) { const s = q.toLowerCase(); r = r.filter(t => t.title.toLowerCase().includes(s) || t.subject.toLowerCase().includes(s) || t.cat.toLowerCase().includes(s)); } if (cf !== "all") r = r.filter(t => t.cat === cf); r.sort((a, b) => daysDiff(a.next) - daysDiff(b.next)); return r; }, [topics, q, cf]);
  const fExams = useMemo(() => { let r = [...exams]; if (q) { const s = q.toLowerCase(); r = r.filter(e => e.name.toLowerCase().includes(s) || e.subject.toLowerCase().includes(s) || e.cat.toLowerCase().includes(s)); } if (cf !== "all") r = r.filter(e => e.cat === cf); r.sort((a, b) => b.date.localeCompare(a.date)); return r; }, [exams, q, cf]);

  const over = topics.filter(t => getSt(t) === "over").length;
  const due = topics.filter(t => getSt(t) === "due").length;
  const sched = topics.filter(t => getSt(t) === "sched").length;

  const saveTopic = useCallback((t: Topic) => { setTopics(p => { const i = p.findIndex(x => x.id === t.id); return i >= 0 ? p.map(x => x.id === t.id ? t : x) : [t, ...p]; }); setModal(null); setEditT(null); }, []);
  const delTopic = useCallback((id: string) => { if (confirm("Delete?")) setTopics(p => p.filter(t => t.id !== id)); }, []);
  const markStudied = useCallback((id: string, yes: boolean) => {
    setTopics(p => p.map(t => {
      if (t.id !== id) return t;
      if (yes) return { ...t, studied: true, sched: false, lvl: 0, next: nxt(iso(), 0), revs: [...t.revs, { date: iso(), ok: true, lvl: 0 }] };
      return { ...t, studied: false, next: addD(t.next, 1), revs: [...t.revs, { date: iso(), ok: false, lvl: t.lvl }] };
    }));
  }, []);
  const markRevised = useCallback((id: string) => { setTopics(p => p.map(t => { if (t.id !== id) return t; const nl = t.lvl + 1; return { ...t, lvl: nl, next: nxt(iso(), nl), revs: [...t.revs, { date: iso(), ok: true, lvl: nl }] }; })); }, []);
  const undoRev = useCallback((id: string) => { setTopics(p => p.map(t => { if (t.id !== id || !t.revs.length) return t; const rv = t.revs.slice(0, -1); const nl = Math.max(0, t.lvl - 1); const nr = rv.length ? nxt(rv[rv.length - 1].date, rv.length - 1) : t.date; return { ...t, lvl: nl, next: nr, revs: rv }; })); }, []);
  const updateRevDate = useCallback((tid: string, revIdx: number, newDate: string) => { setTopics(p => p.map(t => { if (t.id !== tid) return t; const newRevs = t.revs.map((r, i) => i === revIdx ? { ...r, date: newDate } : r); return { ...t, revs: newRevs, next: nxt(newDate, t.lvl) }; })); setRevEdit(null); }, []);
  const deleteRev = useCallback((tid: string, revIdx: number) => { setTopics(p => p.map(t => { if (t.id !== tid || !t.revs[revIdx]) return t; const newRevs = t.revs.filter((_, i) => i !== revIdx); const nl = newRevs.length; const nr = newRevs.length ? nxt(newRevs[newRevs.length - 1].date, nl - 1) : t.date; return { ...t, lvl: nl, revs: newRevs, next: nr }; })); }, []);

  const saveExam = useCallback((e: Exam) => { setExams(p => { const i = p.findIndex(x => x.id === e.id); return i >= 0 ? p.map(x => x.id === e.id ? e : x) : [e, ...p]; }); setModal(null); setEditE(null); }, []);
  const delExam = useCallback((id: string) => { if (confirm("Delete?")) setExams(p => p.filter(e => e.id !== id)); }, []);
  
  const runAI = useCallback(async (eid: string, fileData?: string) => {
    const ex = exams.find(e => e.id === eid);
    if (!ex && !fileData) return;
    setAiId(eid);
    try {
      let prompt = `Evaluate this answer for "${ex?.name || 'Exam'}" (${ex?.subject || 'Subject'}).\n1.Rating/10 2.Strengths 3.Weaknesses 4.Missing 5.Tips\n\n`;
      if (ex?.answer) prompt += `Answer:\n${ex.answer}\n\n`;
      if (fileData) prompt += `Attached file/image content:\n${fileData}\n\n`;
      
      const r = await (window as any).puter.ai.chat(prompt, { model: "perplexity/sonar" });
      const txt = typeof r === "string" ? r : r?.message?.content || "Error";
      setExams(p => p.map(e => e.id === eid ? { ...e, ai: txt } : e));
    } catch { setExams(p => p.map(e => e.id === eid ? { ...e, ai: "AI error" } : e)); }
    finally { setAiId(null); }
  }, [exams]);

  const saveMem = useCallback((m: MemItem) => { setMemory(p => { const i = p.findIndex(x => x.id === m.id); return i >= 0 ? p.map(x => x.id === m.id ? m : x) : [m, ...p]; }); setModal(null); setEditM(null); }, []);
  const delMem = useCallback((id: string) => { if (confirm("Delete?")) setMemory(p => p.filter(m => m.id !== id)); }, []);
  
  // Daily tracker
  const todayTask = useMemo(() => daily.find(d => d.date === iso()), [daily]);
  const saveDaily = useCallback((task: DailyTask) => {
    setDaily(p => { const i = p.findIndex(x => x.date === task.date); return i >= 0 ? p.map(x => x.date === task.date ? task : x) : [task, ...p]; });
  }, []);
  const getDaily = useCallback((date: string) => daily.find(d => d.date === date), [daily]);

  const addCat = (c: string) => { if (c && !cats.includes(c)) setCats(p => [...p, c]); };
  const addSub = (s: string) => { if (s && !subs.includes(s)) setSubs(p => [...p, s]); };
  const addExamSub = (s: string) => { if (s && !examSubs.includes(s)) setExamSubs(p => [...p, s]); };
  const addMemCat = (c: string) => { if (c && !memCats.includes(c)) setMemCats(p => [...p, c]); };

  const curCats = tab === "memory" ? memCats : cats;
  const curItems = tab === "topics" ? topics : tab === "exams" ? exams : memory;

  const Modal = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}><div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>{children}</div></div>);

  if (topicsLoading || examsLoading || memoryLoading || dailyLoading) {
    return (<div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-indigo-50/30 flex items-center justify-center"><div className="text-center"><div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-5 rounded-3xl shadow-xl inline-block mb-4 animate-pulse"><span className="text-3xl">🧠</span></div><p className="text-gray-500 text-sm">Syncing your data...</p></div></div>);
  }

  // ═══════════════ STATS TAB ═══════════════
  const StatsTab = () => {
    const catStats = useMemo(() => {
      const stats: Record<string, { total: number; avg: number; best: number; exams: Exam[] }> = {};
      cats.forEach(c => stats[c] = { total: 0, avg: 0, best: 0, exams: [] });
      exams.forEach(e => {
        if (!stats[e.cat]) stats[e.cat] = { total: 0, avg: 0, best: 0, exams: [] };
        stats[e.cat].total++;
        stats[e.cat].exams.push(e);
        stats[e.cat].avg = Math.round(stats[e.cat].exams.reduce((sum, ex) => sum + ex.pct, 0) / stats[e.cat].total);
        stats[e.cat].best = Math.max(stats[e.cat].best, e.pct);
      });
      return stats;
    }, [exams, cats]);

    const recentTrend = useMemo(() => {
      const last7 = exams.slice(0, 7).reverse();
      return last7.map(e => ({ date: fmt(e.date), pct: e.pct, name: e.name }));
    }, [exams]);

    const overallAvg = exams.length > 0 ? Math.round(exams.reduce((sum, e) => sum + e.pct, 0) / exams.length) : 0;
    const totalExams = exams.length;
    const improvement = recentTrend.length >= 2 ? recentTrend[recentTrend.length - 1].pct - recentTrend[0].pct : 0;

    return (
      <div className="space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[["Total Exams", totalExams, "📝", "blue"], ["Average Score", `${overallAvg}%`, "📊", "purple"], ["Best Score", `${Math.max(...exams.map(e => e.pct), 0)}%`, "🏆", "amber"], ["Improvement", `${improvement >= 0 ? "+" : ""}${improvement}%`, improvement >= 0 ? "📈" : "📉", improvement >= 0 ? "emerald" : "red"]].map(([l, v, e, c]) => (
            <div key={l} className={`bg-white rounded-2xl border p-4 shadow-sm border-l-4 border-l-${c}-400`}>
              <div className="flex items-center gap-3"><div className={`bg-${c}-50 p-2.5 rounded-xl`}><span className="text-lg">{e}</span></div><div><p className="text-2xl font-bold text-gray-900">{v}</p><p className="text-xs text-gray-500">{l}</p></div></div>
            </div>
          ))}
        </div>

        {/* Category Performance */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4">📊 Performance by Category</h3>
          <div className="space-y-4">
            {cats.map(c => {
              const s = catStats[c];
              if (s.total === 0) return null;
              return (
                <div key={c} className="space-y-2">
                  <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-700">{c}</span><span className="text-sm text-gray-500">{s.total} exams · Best: {s.best}%</span></div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${s.avg >= 70 ? "bg-emerald-500" : s.avg >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${s.avg}%` }} /></div>
                  <p className="text-xs text-gray-500">Average: {s.avg}%</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Trend */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4">📈 Recent Performance</h3>
          {recentTrend.length > 0 ? (
            <div className="flex items-end gap-2 h-40">
              {recentTrend.map((t, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full rounded-t-lg ${t.pct >= 70 ? "bg-emerald-500" : t.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ height: `${t.pct * 1.2}px` }} />
                  <span className="text-[10px] text-gray-500 rotate-45">{t.date.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-gray-500 text-center py-8">No exams yet</p>}
        </div>

        {/* Google Calendar Integration */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-5">
          <h3 className="text-lg font-bold text-blue-900 mb-3">📅 Add to Google Calendar</h3>
          <p className="text-sm text-blue-700 mb-4">Create study reminders and exam planning events</p>
          <div className="space-y-3">
            {["Daily Study Session", "Weekly Revision", "Mock Test"].map((title, i) => {
              const start = new Date(); start.setDate(start.getDate() + i); start.setHours(9 + i, 0, 0);
              const end = new Date(start); end.setHours(start.getHours() + 1);
              const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start.toISOString().replace(/[-:]/g, "").split(".")[0]}Z/${end.toISOString().replace(/[-:]/g, "").split(".")[0]}Z&details=SpaceRev+Study+Session`;
              return (
                <a key={title} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-white rounded-xl border border-blue-200 hover:border-blue-400 transition-colors">
                  <div className="flex items-center gap-3"><div className="bg-blue-100 p-2 rounded-lg"><ICalendar sz={16} cls="text-blue-600" /></div><span className="text-sm font-medium text-gray-700">{title}</span></div>
                  <span className="text-xs text-blue-600 font-medium">Add →</span>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════ DAILY TRACKER TAB ═══════════════
  const DailyTracker = () => {
    const [selectedDate, setSelectedDate] = useState(iso());
    const task = getDaily(selectedDate) || { id: uid(), date: selectedDate, answerWriting: false, mcqSolved: 0, caMcqSolved: 0, notes: "" };

    const updateTask = (updates: Partial<DailyTask>) => {
      saveDaily({ ...task, ...updates });
    };

    const weekDays = useMemo(() => {
      const days = [];
      for (let i = -3; i <= 3; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        days.push(d.toISOString().split("T")[0]);
      }
      return days;
    }, []);

    const streak = useMemo(() => {
      let count = 0;
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().split("T")[0];
        const t = daily.find(x => x.date === ds);
        if (t && (t.answerWriting || t.mcqSolved > 0 || t.caMcqSolved > 0)) count++;
        else break;
      }
      return count;
    }, [daily]);

    return (
      <div className="space-y-6">
        {/* Streak Card */}
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl border border-orange-200 p-5">
          <div className="flex items-center justify-between">
            <div><h3 className="text-lg font-bold text-orange-900">🔥 Current Streak</h3><p className="text-sm text-orange-700">Days with at least one task completed</p></div>
            <div className="text-4xl font-black text-orange-600">{streak} <span className="text-lg font-medium text-orange-500">days</span></div>
          </div>
        </div>

        {/* Date Selector */}
        <div className="bg-white rounded-2xl border p-4 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-3">📅 Select Date</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {weekDays.map(d => {
              const dt = new Date(d + "T00:00:00");
              const isToday = d === iso();
              const isSelected = d === selectedDate;
              const t = daily.find(x => x.date === d);
              const completed = t && (t.answerWriting || t.mcqSolved > 0 || t.caMcqSolved > 0);
              return (
                <button key={d} onClick={() => setSelectedDate(d)} className={`flex-shrink-0 p-3 rounded-xl border-2 transition-all ${isSelected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-gray-300"} ${completed ? "ring-2 ring-emerald-400" : ""}`}>
                  <p className={`text-xs font-medium ${isToday ? "text-indigo-600" : "text-gray-500"}`}>{isToday ? "Today" : dt.toLocaleDateString("en-US", { weekday: "short" })}</p>
                  <p className="text-lg font-bold text-gray-900">{dt.getDate()}</p>
                  {completed && <p className="text-[10px] text-emerald-600 font-medium">✓ Done</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tasks */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm space-y-4">
          <h3 className="text-lg font-bold text-gray-900">✅ Daily Tasks - {fmt(selectedDate)}</h3>
          
          <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-xl border border-indigo-100">
            <div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${task.answerWriting ? "bg-indigo-500" : "bg-white border border-indigo-300"}`}><ICheck sz={16} cls={task.answerWriting ? "text-white" : "text-indigo-400"} /></div><span className="font-medium text-gray-700">Answer Writing Practice</span></div>
            <button onClick={() => updateTask({ answerWriting: !task.answerWriting })} className={`px-4 py-2 rounded-xl text-sm font-semibold ${task.answerWriting ? "bg-indigo-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{task.answerWriting ? "✓ Completed" : "Mark Done"}</button>
          </div>

          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-emerald-500"><ITarget sz={16} cls="text-white" /></div><span className="font-medium text-gray-700">MCQs Solved</span></div><span className="text-2xl font-bold text-emerald-600">{task.mcqSolved}</span></div>
            <input type="range" min="0" max="100" value={task.mcqSolved} onChange={e => updateTask({ mcqSolved: +e.target.value })} className="w-full h-2 bg-emerald-200 rounded-lg appearance-none cursor-pointer" />
            <div className="flex justify-between text-xs text-emerald-600 mt-1"><span>0</span><span>50</span><span>100</span></div>
          </div>

          <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-amber-500"><ITarget sz={16} cls="text-white" /></div><span className="font-medium text-gray-700">CA MCQs Solved</span></div><span className="text-2xl font-bold text-amber-600">{task.caMcqSolved}</span></div>
            <input type="range" min="0" max="50" value={task.caMcqSolved} onChange={e => updateTask({ caMcqSolved: +e.target.value })} className="w-full h-2 bg-amber-200 rounded-lg appearance-none cursor-pointer" />
            <div className="flex justify-between text-xs text-amber-600 mt-1"><span>0</span><span>25</span><span>50</span></div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">📝 Notes</label>
            <textarea value={task.notes} onChange={e => updateTask({ notes: e.target.value })} placeholder="What did you study today? Key takeaways..." rows={3} className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none resize-none" />
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════ RENDER ══════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-indigo-50/30">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-2xl"><span className="text-xl">🧠</span></div>
            <div><h1 className="text-xl font-extrabold">Space<span className="text-indigo-600">Rev</span></h1><p className="text-[10px] text-gray-400">by Rupam</p></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-50 border text-xs"><IUser sz={14} cls="text-gray-400" /><span className="font-medium text-gray-600">{user.name}</span></div>
            {user.mode === "supabase" && <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold"><ICloud sz={12} />Synced</span>}
            <button onClick={onLogout} className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50"><ILogOut sz={18} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* TABS */}
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 border w-fit">
          {[["topics", "📚", "Topics", topics.length], ["exams", "📝", "Exams", exams.length], ["memory", "🧠", "Memory", memory.length], ["stats", "📊", "Stats", exams.length], ["daily", "✅", "Daily", daily.length]].map(([k, e, l, n]) => (
            <button key={k} onClick={() => { setTab(k as Tab); setCf("all"); }} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${tab === k ? (k === "topics" ? "bg-indigo-100 text-indigo-700" : k === "exams" ? "bg-amber-100 text-amber-700" : k === "stats" ? "bg-purple-100 text-purple-700" : k === "daily" ? "bg-emerald-100 text-emerald-700" : "bg-teal-100 text-teal-700") : "text-gray-500 hover:bg-gray-50"}`}>{e} {l}{n > 0 && <span className="text-[10px] opacity-70">({n})</span>}</button>
          ))}
        </div>

        {/* STATS TAB */}
        {tab === "stats" && <StatsTab />}

        {/* DAILY TRACKER TAB */}
        {tab === "daily" && <DailyTracker />}

        {/* TOPICS LIST */}
        {tab === "topics" && view === "list" && (topics.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border"><div className="w-20 h-20 bg-indigo-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">📚</span></div><h3 className="text-xl font-bold mb-2">No topics yet</h3><p className="text-gray-500 mb-8">Start tracking your revision</p><button onClick={() => { setEditT(null); setModal("topic"); }} className="px-6 py-3 rounded-xl text-white bg-indigo-600 font-semibold">+ Add Topic</button></div>
        ) : fTopics.length === 0 ? <p className="text-center text-gray-400 py-12">No matches.</p> : (
          <div className="space-y-3">
            {fTopics.map(t => {
              const s = getSt(t); const exp = expId === t.id; const prog = Math.min((t.lvl / IV.length) * 100, 100);
              const badge = s === "sched" ? "bg-violet-100 text-violet-700" : s === "over" ? "bg-red-100 text-red-700" : s === "due" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
              const badgeText = s === "sched" ? "Scheduled" : s === "over" ? `${Math.abs(daysDiff(t.next))}d overdue` : s === "due" ? "Due today" : `In ${daysDiff(t.next)}d`;
              const border = s === "sched" ? "border-l-violet-400" : s === "over" ? "border-l-red-400" : s === "due" ? "border-l-amber-400" : "border-l-emerald-400";
              return (
                <div key={t.id} className={`bg-white rounded-2xl border shadow-sm border-l-4 ${border}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold">{t.title}</h3><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge}`}>{badgeText}</span></div>
                        <div className="mt-2 flex gap-2 flex-wrap">{t.subject && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-xs">{t.subject}</span>}{t.cat && <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{t.cat}</span>}</div>
                        <p className="mt-2 text-xs text-gray-500">Studied: {fmt(t.date)} · Next: {fmt(t.next)} · Level: {t.lvl}/{IV.length}</p>
                        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${prog}%` }} /></div>
                      </div>
                      <div className="flex items-center gap-1">
                        {s === "sched" && <><button onClick={() => markStudied(t.id, true)} className="p-2 rounded-xl bg-emerald-50 text-emerald-600"><ICheck sz={16} /></button><button onClick={() => markStudied(t.id, false)} className="p-2 rounded-xl bg-red-50 text-red-600"><IX sz={16} /></button></>}
                        {(s === "over" || s === "due") && <button onClick={() => markRevised(t.id)} className="p-2 rounded-xl bg-emerald-50 text-emerald-600"><ICheck sz={16} /></button>}
                        {s === "soon" && <button onClick={() => markRevised(t.id)} className="p-2 rounded-xl bg-blue-50 text-blue-600"><IRefresh sz={16} /></button>}
                        {t.revs.length > 0 && <button onClick={() => undoRev(t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IUndo sz={16} /></button>}
                        <button onClick={() => { setEditT(t); setModal("topic"); }} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16} /></button>
                        <button onClick={() => delTopic(t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16} /></button>
                        <button onClick={() => setExpId(exp ? null : t.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp ? <IChevU sz={16} /> : <IChevD sz={16} />}</button>
                      </div>
                    </div>
                  </div>
                  {exp && (
                    <div className="px-4 pb-4 border-t pt-4 space-y-4">
                      {t.desc && <p className="text-sm text-gray-700">{t.desc}</p>}
                      {t.links.length > 0 && <div className="flex flex-wrap gap-2">{t.links.map(l => <a key={l.id} href={l.url} target="_blank" className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-sm">🔗 {l.label || "Link"}</a>)}</div>}
                      {t.revs.length > 0 && <div className="flex flex-wrap gap-2">{t.revs.map((r, i) => <span key={i} className={`px-3 py-1.5 rounded-lg text-xs ${r.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>#{i + 1} {fmt(r.date)} {r.ok ? "✓" : "✕"}</span>)}{t.revs.map((r, i) => <button key={`e${i}`} onClick={() => setRevEdit({ tid: t.id, revIdx: i, date: r.date })} className="p-1 text-gray-400 hover:text-indigo-600"><IEdit2 sz={12} /></button>)}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* EXAMS LIST */}
        {tab === "exams" && view === "list" && (exams.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border"><div className="w-20 h-20 bg-amber-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">📝</span></div><h3 className="text-xl font-bold mb-2">No exams yet</h3><p className="text-gray-500 mb-8">Track scores & get AI feedback</p><button onClick={() => { setEditE(null); setModal("exam"); }} className="px-6 py-3 rounded-xl text-white bg-amber-600 font-semibold">+ Add Exam</button></div>
        ) : fExams.length === 0 ? <p className="text-center text-gray-400 py-12">No matches.</p> : (
          <div className="space-y-3">
            {fExams.map(e => {
              const exp = expId === e.id;
              const gc = e.pct >= 70 ? "text-emerald-600 bg-emerald-50" : e.pct >= 50 ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
              const barc = e.pct >= 70 ? "bg-emerald-500" : e.pct >= 50 ? "bg-amber-500" : "bg-red-500";
              const bc = e.pct >= 70 ? "border-l-emerald-400" : e.pct >= 50 ? "border-l-amber-400" : "border-l-red-400";
              return (
                <div key={e.id} className={`bg-white rounded-2xl border shadow-sm border-l-4 ${bc}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold">{e.name}</h3><span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${gc}`}>{e.grade}</span></div>
                        <div className="mt-2 flex gap-2 flex-wrap">{e.subject && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-xs">{e.subject}</span>}{e.cat && <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{e.cat}</span>}</div>
                        <p className="mt-2 text-xs text-gray-500">{fmt(e.date)} · {e.got}/{e.max} · {e.pct}%</p>
                        <div className="mt-3 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${barc} rounded-full`} style={{ width: `${e.pct}%` }} /></div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditE(e); setModal("exam"); }} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16} /></button>
                        <button onClick={() => delExam(e.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16} /></button>
                        <button onClick={() => setExpId(exp ? null : e.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp ? <IChevU sz={16} /> : <IChevD sz={16} />}</button>
                      </div>
                    </div>
                  </div>
                  {exp && (
                    <div className="px-4 pb-4 border-t pt-4 space-y-4">
                      {e.desc && <p className="text-sm text-gray-700">{e.desc}</p>}
                      {e.links.length > 0 && <div className="flex flex-wrap gap-2">{e.links.map(l => <a key={l.id} href={l.url} target="_blank" className="px-3 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-sm">🔗 {l.label || "Link"}</a>)}</div>}
                      <div className="bg-purple-50 rounded-2xl p-5 border border-purple-100">
                        <h4 className="text-sm font-bold text-purple-800 mb-3">✨ AI Analysis</h4>
                        {e.answer || e.attachments?.length ? (<><button onClick={() => runAI(e.id)} disabled={aiId === e.id} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-purple-600 disabled:opacity-50 mb-3">{aiId === e.id ? "⏳ Analyzing..." : "✨ Analyze with AI"}</button>{e.ai && <div className="bg-white border border-purple-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap">{e.ai}</div>}</>) : <p className="text-sm text-purple-600/70">Add answer text or upload file to enable AI</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* MEMORY LIST */}
        {tab === "memory" && (memory.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border"><div className="w-20 h-20 bg-teal-50 rounded-3xl mx-auto mb-6 flex items-center justify-center"><span className="text-4xl">🧠</span></div><h3 className="text-xl font-bold mb-2">No memory items yet</h3><p className="text-gray-500 mb-8">Store thinkers, concepts, key facts</p><button onClick={() => { setEditM(null); setModal("memory"); }} className="px-6 py-3 rounded-xl text-white bg-teal-600 font-semibold">+ Add Memory</button></div>
        ) : fMemory.length === 0 ? <p className="text-center text-gray-400 py-12">No matches.</p> : (
          <div className="space-y-3">
            {fMemory.map(m => {
              const exp = expId === m.id;
              return (
                <div key={m.id} className="bg-white rounded-2xl border shadow-sm border-l-4 border-l-teal-400">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold">{m.title}</h3>{m.cat && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700 border border-teal-200">{m.cat}</span>}</div>
                        {m.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{m.tags.map(t => <span key={t} className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">#{t}</span>)}</div>}
                        <p className="mt-1.5 text-[11px] text-gray-400">Updated: {fmt(m.updated.split("T")[0])}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditM(m); setModal("memory"); }} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><IEdit sz={16} /></button>
                        <button onClick={() => delMem(m.id)} className="p-2 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500"><ITrash sz={16} /></button>
                        <button onClick={() => setExpId(exp ? null : m.id)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100">{exp ? <IChevU sz={16} /> : <IChevD sz={16} />}</button>
                      </div>
                    </div>
                  </div>
                  {exp && <div className="px-4 pb-5 border-t pt-4"><div className="prose prose-sm max-w-none text-gray-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: m.content }} /></div>}
                </div>
              );
            })}
          </div>
        ))}

        {/* Revision Edit Modal */}
        {revEdit && (() => {
          const t = topics.find(x => x.id === revEdit.tid);
          if (!t) return null;
          return (
            <Modal onClose={() => setRevEdit(null)}>
              <div className="p-6">
                <h3 className="text-lg font-bold mb-4">Edit Revision Date</h3>
                <div className="space-y-4">
                  <div><label className="block text-sm font-semibold text-gray-700 mb-1.5">New Date</label><input type="date" value={revEdit.date} onChange={e => setRevEdit({ ...revEdit, date: e.target.value })} className="w-full px-4 py-3 rounded-xl border outline-none" /></div>
                  <div className="flex gap-3">
                    <button onClick={() => deleteRev(revEdit.tid, revEdit.revIdx)} className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-red-500">Delete Revision</button>
                    <button onClick={() => setRevEdit(null)} className="flex-1 px-4 py-3 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button onClick={() => updateRevDate(revEdit.tid, revEdit.revIdx, revEdit.date)} className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600">Save</button>
                  </div>
                </div>
              </div>
            </Modal>
          );
        })()}
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-8 text-center"><p className="text-xs text-gray-400">SpaceRev — by Rupam{user.mode === "supabase" ? " · ☁️ Real-time cloud sync" : " · 💾 Local storage"}</p></footer>

      {modal === "topic" && <TopicForm />}
      {modal === "exam" && <ExamForm />}
      {modal === "memory" && <MemoryForm />}
    </div>
  );
}

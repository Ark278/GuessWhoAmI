"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Users, Clock, HelpCircle, ArrowRight, Trophy } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your display name");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/room/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create room");

      localStorage.setItem(`whoami_session_${data.roomCode.toUpperCase()}`, data.sessionToken);
      localStorage.setItem(`whoami_name`, name.trim());
      router.push(`/room/${data.roomCode.toUpperCase()}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your display name");
      return;
    }
    if (!roomCode.trim()) {
      setError("Please enter a 6-letter room code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/room/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: roomCode.trim().toUpperCase(),
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join room");

      localStorage.setItem(`whoami_session_${data.roomCode.toUpperCase()}`, data.sessionToken);
      localStorage.setItem(`whoami_name`, name.trim());
      router.push(`/room/${data.roomCode.toUpperCase()}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#090b10] text-slate-100 flex flex-col justify-between p-4 sm:p-6 lg:p-8 relative selection:bg-amber-400 selection:text-black">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-gradient-to-b from-indigo-900/25 via-violet-900/10 to-transparent blur-3xl pointer-events-none" />

      {/* Header & Logo */}
      <div className="max-w-4xl mx-auto w-full pt-6 sm:pt-12 text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-300 text-xs sm:text-sm font-medium mb-4">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Multiplayer Party Game (2–10 Players)</span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-4">
          WHO <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400">AM I?</span>
        </h1>

        <p className="text-base sm:text-xl text-slate-400 max-w-2xl mx-auto mb-8 sm:mb-12 font-normal leading-relaxed">
          The classic <span className="text-amber-300 font-semibold">&ldquo;sticky note on your forehead&rdquo;</span> game. Everyone in the room can see your famous identity—except you! Ask questions out loud to guess who you are before your 2-minute timer runs out.
        </p>

        {/* Action Card */}
        <div className="max-w-md mx-auto bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative">
          {/* Tab selector */}
          <div className="flex bg-slate-950 p-1 rounded-2xl mb-6 border border-slate-800/80">
            <button
              type="button"
              onClick={() => { setMode("create"); setError(null); }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                mode === "create"
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Create Room
            </button>
            <button
              type="button"
              onClick={() => { setMode("join"); setError(null); }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                mode === "join"
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Join Room
            </button>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-950/60 border border-rose-800/50 text-rose-300 text-sm text-left animate-shake">
              {error}
            </div>
          )}

          {mode === "create" ? (
            <form onSubmit={handleCreate} className="space-y-4 text-left">
              <div>
                <label htmlFor="create-name" className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
                  Your Display Name
                </label>
                <input
                  id="create-name"
                  type="text"
                  maxLength={25}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alex, Maya, Jordan..."
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-base"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 hover:brightness-110 active:scale-[0.99] text-slate-950 font-bold text-base transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Creating Room..." : "Create Room as Host"}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4 text-left">
              <div>
                <label htmlFor="join-name" className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
                  Your Display Name
                </label>
                <input
                  id="join-name"
                  type="text"
                  maxLength={25}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sam, Taylor..."
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-base"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="room-code" className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
                  6-Letter Room Code
                </label>
                <input
                  id="room-code"
                  type="text"
                  maxLength={6}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g. ABCXYZ"
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-2xl px-4 py-3 text-white placeholder-slate-500 uppercase tracking-widest font-mono text-center text-lg focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 hover:brightness-110 active:scale-[0.99] text-slate-950 font-bold text-base transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 disabled:opacity-50 cursor-pointer"
              >
                {loading ? "Joining Room..." : "Join Game"}
                {!loading && <ArrowRight className="w-5 h-5" />}
              </button>
            </form>
          )}
        </div>

        {/* 3 Step rules visual */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto mt-12 sm:mt-16 text-left">
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400">
              <HelpCircle className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">1. Secret Identities</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Everyone gets a world-famous celebrity assigned to them. You see everyone else&rsquo;s, but yours is hidden!
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center text-cyan-400">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">2. Ask Questions Aloud</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sit together and ask questions verbally: &ldquo;Am I an athlete? Am I alive?&rdquo; Other players answer Yes or No.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-400/10 border border-rose-400/20 flex items-center justify-center text-rose-400">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">3. 2-Minute Race</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Type your guess on your phone or laptop. The fastest player to guess their own identity wins the round!
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-600 py-6 border-t border-slate-900 mt-12">
        <p>Who Am I? &bull; Multiplayer In-Person Party Game &bull; Built with Next.js &amp; Supabase</p>
      </footer>
    </main>
  );
}

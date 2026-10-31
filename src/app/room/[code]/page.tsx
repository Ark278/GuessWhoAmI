"use client";

import { useEffect, useState, use } from "react";
import { useParams, useRouter } from "next/navigation";
import { useGameSync } from "@/lib/useGameSync";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import confetti from "canvas-confetti";
import {
  Users,
  Clock,
  Crown,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  HelpCircle,
  Trophy,
  ArrowRight,
  Flame,
  AlertTriangle,
  RotateCcw,
  Hourglass,
  Target,
  Volume2,
} from "lucide-react";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const resolvedParams = use(params);
  const roomCode = resolvedParams.code?.toUpperCase() || "";
  const router = useRouter();

  const {
    gameState,
    loading,
    error,
    timeRemaining,
    isSubmitting,
    toggleReady,
    startGame,
    submitGuess,
    nextRound,
  } = useGameSync(roomCode);

  const [copied, setCopied] = useState(false);
  const [guessInput, setGuessInput] = useState("");
  const [guessFeedback, setGuessFeedback] = useState<string | null>(null);
  const [isWrongGuess, setIsWrongGuess] = useState(false);
  const [hasCelebrated, setHasCelebrated] = useState(false);

  // Trigger confetti when player solves
  useEffect(() => {
    if (gameState?.self.status === "SOLVED" && !hasCelebrated) {
      setHasCelebrated(true);
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
    }
    if (gameState?.room.status === "PLAYING" && gameState?.self.status === "PLAYING") {
      setHasCelebrated(false);
    }
  }, [gameState?.self.status, gameState?.room.status, hasCelebrated]);

  // Trigger celebration on results screen for the winner
  useEffect(() => {
    if (gameState?.room.status === "RESULTS") {
      confetti({
        particleCount: 90,
        spread: 100,
        origin: { y: 0.4 },
      });
    }
  }, [gameState?.room.status]);

  const copyRoomCode = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGuessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessInput.trim()) return;

    const result = await submitGuess(guessInput.trim());
    if (result.correct) {
      setGuessFeedback(`🎉 Correct! You are ${result.identityName}!`);
      setIsWrongGuess(false);
      setGuessInput("");
    } else {
      setIsWrongGuess(true);
      setGuessFeedback("❌ Not quite! Keep asking questions.");
      setTimeout(() => setIsWrongGuess(false), 600);
    }
  };

  if (loading && !gameState) {
    return (
      <div className="min-h-screen bg-[#090b10] text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Entering Room {roomCode}...</p>
        </div>
      </div>
    );
  }

  if (error && !gameState) {
    return (
      <div className="min-h-screen bg-[#090b10] text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Room Error</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="w-full py-3 px-6 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-all cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!gameState) return null;

  const { room, self, players, currentTurnPlayer } = gameState;
  const isHost = self.isHost;
  const allReady = players.length >= 2 && players.every((p) => p.isReady);
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // =========================================================================
  // SCREEN 1: LOBBY
  // =========================================================================
  if (room.status === "LOBBY") {
    return (
      <main className="min-h-screen bg-[#090b10] text-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-between max-w-5xl mx-auto">
        {/* Top Room Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
          <div>
            <span className="text-xs font-semibold tracking-wider text-amber-400 uppercase">Room Lobby</span>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-widest text-white font-mono bg-slate-950 px-4 py-1.5 rounded-2xl border border-slate-800">
                {room.code}
              </h1>
              <button
                onClick={copyRoomCode}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                title="Copy Room Code"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? "Copied!" : "Share Code"}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs sm:text-sm">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>{players.length} / 10 Players</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Sync Active</span>
            </div>
          </div>
        </div>

        {/* Players Grid */}
        <div className="my-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Players in Room</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                Min 2 required
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {allReady ? "All players are ready!" : "Waiting for all players to click Ready..."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {players.map((p) => {
              const isSelf = p.id === self.id;
              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${
                    isSelf
                      ? "bg-slate-900/90 border-amber-400/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-400/20"
                      : "bg-slate-900/50 border-slate-800/80"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-12 h-12 rounded-2xl bg-gradient-to-tr ${getAvatarColor(
                        p.name
                      )} flex items-center justify-center text-white font-bold text-base shadow-md`}
                    >
                      {getInitials(p.name)}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white text-base">
                          {p.name}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/20">
                            You
                          </span>
                        )}
                        {p.isHost && (
                          <span title="Party Host">
                            <Crown className="w-4 h-4 text-amber-400" />
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        {p.isHost ? "Party Host" : "Player"}
                      </span>
                    </div>
                  </div>

                  <div>
                    {p.isReady ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-xl bg-slate-800 text-slate-400 text-xs font-medium">
                        Waiting
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 backdrop-blur-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => toggleReady(!self.isReady)}
              disabled={isSubmitting}
              className={`w-full sm:w-auto py-3.5 px-6 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
                self.isReady
                  ? "bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:brightness-110 shadow-lg shadow-emerald-500/20"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {self.isReady ? "Ready (Click to Cancel)" : "Click When Ready"}
            </button>
          </div>

          <div className="w-full sm:w-auto flex flex-col sm:flex-row items-center gap-3">
            {isHost ? (
              <button
                onClick={startGame}
                disabled={!allReady || isSubmitting}
                className="w-full sm:w-auto py-3.5 px-8 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-slate-950 font-bold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Sparkles className="w-5 h-5" />
                <span>Start Game</span>
              </button>
            ) : (
              <p className="text-xs text-slate-400 text-center sm:text-right">
                Waiting for the Host to start the game once everyone is ready.
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // =========================================================================
  // SCREEN 2: ACTIVE GAMEPLAY (SIMULTANEOUS GUESSING)
  // =========================================================================
  if (room.status === "PLAYING") {
    const isTimerCritical = timeRemaining <= 10;
    const isTimerWarning = timeRemaining <= 30 && !isTimerCritical;
    const isSolved = self.status === "SOLVED";
    const isTimedOut = self.status === "TIMED_OUT";
    const otherPlayers = players.filter((p) => p.id !== self.id);
    const solvedCount = players.filter((p) => p.status === "SOLVED").length;

    return (
      <main className="min-h-screen bg-[#090b10] text-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-between max-w-5xl mx-auto">
        {/* Top HUD */}
        <header className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
              Round {room.currentRound} &bull; Simultaneous Guessing
            </span>
            <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <span>Who Am I?</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                {room.code}
              </span>
            </h1>
          </div>

          {/* 120s Countdown Timer */}
          <div className="flex flex-col items-center">
            <div
              className={`flex items-center gap-2 px-5 py-2 rounded-2xl font-mono text-2xl sm:text-3xl font-extrabold border shadow-lg transition-all ${
                isTimerCritical
                  ? "bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse-fast shadow-rose-500/30"
                  : isTimerWarning
                  ? "bg-amber-950/80 border-amber-500 text-amber-300 shadow-amber-500/20"
                  : "bg-slate-900 border-slate-700 text-cyan-300 shadow-cyan-500/10"
              }`}
            >
              <Clock className="w-6 h-6" />
              <span>{formattedTime}</span>
            </div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">
              Time Remaining
            </span>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-400">Solved Status</span>
            <div className="text-sm sm:text-base font-bold text-emerald-400">
              {solvedCount} / {players.length} Solved
            </div>
          </div>
        </header>

        {/* TOP SECTION: YOUR FOREHEAD CARD & GUESS SUBMISSION */}
        <section className="my-6">
          <div className="max-w-2xl mx-auto bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-amber-400/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-amber-500/10 relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center text-center">
              <span className="text-xs font-black uppercase tracking-widest text-amber-400 mb-2">
                Your Secret Identity Card
              </span>

              {isSolved ? (
                <div className="w-full p-6 rounded-2xl bg-emerald-950/80 border border-emerald-500/50 text-center shadow-lg">
                  <span className="text-xs uppercase font-bold text-emerald-400 block mb-1">
                    🎉 You Guessed It!
                  </span>
                  <h3 className="text-2xl sm:text-4xl font-black text-white">
                    {self.revealedIdentity?.name}
                  </h3>
                  <p className="text-xs text-emerald-300 mt-1">
                    {self.revealedIdentity?.tag} &bull; Solved in {self.completionTimeSeconds}s!
                  </p>
                  <p className="text-xs text-slate-400 mt-3 border-t border-emerald-500/20 pt-2">
                    Help your friends by answering their questions aloud until the round ends!
                  </p>
                </div>
              ) : isTimedOut ? (
                <div className="w-full p-6 rounded-2xl bg-rose-950/80 border border-rose-500/50 text-center shadow-lg">
                  <span className="text-xs uppercase font-bold text-rose-400 block mb-1">
                    ⏰ Time&rsquo;s Up
                  </span>
                  <h3 className="text-xl sm:text-2xl font-bold text-white">
                    You ran out of time this round!
                  </h3>
                  <p className="text-xs text-slate-400 mt-2">
                    Keep answering other players&rsquo; questions until everyone finishes.
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  <div className="p-5 sm:p-6 rounded-2xl bg-amber-400 text-slate-950 font-bold sticky-note text-center">
                    <span className="text-3xl sm:text-4xl font-black font-mono block mb-1">
                      ? ? ?
                    </span>
                    <span className="text-sm sm:text-base font-extrabold block">
                      Your identity is stuck to your forehead!
                    </span>
                    <p className="text-xs text-amber-950 font-semibold mt-1">
                      Ask questions aloud to the room: &ldquo;Am I an actor? Am I alive?&rdquo;
                    </p>
                  </div>

                  <form onSubmit={handleGuessSubmit} className="mt-5 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={guessInput}
                        onChange={(e) => setGuessInput(e.target.value)}
                        placeholder="Type your guess (e.g. Taylor Swift)..."
                        className={`flex-1 bg-slate-950 border rounded-2xl px-4 py-3.5 text-white placeholder-slate-500 focus:outline-none text-base transition-all ${
                          isWrongGuess
                            ? "border-rose-500 focus:ring-2 focus:ring-rose-500/20 animate-shake"
                            : "border-slate-700 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                        }`}
                        autoFocus
                      />
                      <button
                        type="submit"
                        disabled={!guessInput.trim()}
                        className="py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:brightness-110 active:scale-[0.99] text-slate-950 font-bold text-base transition-all shadow-md shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                      >
                        Submit Guess
                      </button>
                    </div>

                    {guessFeedback && (
                      <p
                        className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                          isWrongGuess ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        {guessFeedback}
                      </p>
                    )}
                  </form>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* BOTTOM SECTION: OTHER PLAYERS' IDENTITIES (ANSWER THEIR QUESTIONS ALOUD) */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4 px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <span>Other Players &bull; Look here to answer their questions!</span>
            </h3>
            <span className="text-xs text-slate-500">
              {otherPlayers.length} Other Players
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherPlayers.map((p) => {
              const isOtherSolved = p.status === "SOLVED";
              const isOtherTimedOut = p.status === "TIMED_OUT";

              return (
                <div
                  key={p.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                    isOtherSolved
                      ? "bg-emerald-950/20 border-emerald-500/40"
                      : isOtherTimedOut
                      ? "bg-slate-950/40 border-slate-800 opacity-70"
                      : "bg-slate-950 border-slate-800/90"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${getAvatarColor(
                          p.name
                        )} flex items-center justify-center text-white font-bold text-xs shadow`}
                      >
                        {getInitials(p.name)}
                      </div>
                      <span className="font-bold text-white text-sm truncate">
                        {p.name}
                      </span>
                    </div>

                    <div>
                      {isOtherSolved ? (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                          Solved in {p.completionTimeSeconds}s
                        </span>
                      ) : isOtherTimedOut ? (
                        <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                          Timed Out
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-400/20 text-amber-300 text-[10px] font-semibold animate-pulse">
                          Guessing...
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 text-center mt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      Assigned Identity
                    </span>
                    <span className="text-base sm:text-lg font-black text-amber-300 block">
                      {p.identityName || "Mystery Identity"}
                    </span>
                    {p.identityTag && (
                      <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                        {p.identityTag}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  // =========================================================================
  // SCREEN 3: RESULTS & LEADERBOARD
  // =========================================================================
  if (room.status === "RESULTS") {
    const sortedPlayers = [...players].sort((a, b) => {
      if (a.status === "SOLVED" && b.status !== "SOLVED") return -1;
      if (a.status !== "SOLVED" && b.status === "SOLVED") return 1;
      if (a.status === "SOLVED" && b.status === "SOLVED") {
        return (a.completionTimeSeconds || 120) - (b.completionTimeSeconds || 120);
      }
      return 0;
    });

    const winner = sortedPlayers[0]?.status === "SOLVED" ? sortedPlayers[0] : null;

    return (
      <main className="min-h-screen bg-[#090b10] text-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-between max-w-4xl mx-auto">
        <div className="text-center pt-4 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-300 text-xs font-semibold mb-3">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>Round {room.currentRound} Complete!</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white mb-2">
            LEADERBOARD
          </h1>

          {winner ? (
            <p className="text-sm sm:text-base text-slate-300">
              🏆 <span className="font-bold text-amber-400">{winner.name}</span> won with the fastest guess in{" "}
              <span className="font-mono font-bold text-white">{winner.completionTimeSeconds}s</span>!
            </p>
          ) : (
            <p className="text-sm text-slate-400">
              Everyone timed out this round. Give it another shot!
            </p>
          )}
        </div>

        {/* Podium Rankings Table */}
        <div className="my-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl backdrop-blur-xl">
            <h2 className="text-xs uppercase font-bold tracking-wider text-slate-400 mb-4 px-2">
              Final Standings &amp; Identities
            </h2>

            <div className="space-y-3">
              {sortedPlayers.map((p, idx) => {
                const isSolved = p.status === "SOLVED";
                const rank = idx + 1;
                const isWinner = rank === 1 && isSolved;

                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isWinner
                        ? "bg-gradient-to-r from-amber-950/40 via-orange-950/20 to-slate-900 border-amber-400/50 shadow-lg shadow-amber-500/10"
                        : "bg-slate-950/60 border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                          rank === 1 && isSolved
                            ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30"
                            : rank === 2 && isSolved
                            ? "bg-slate-300 text-slate-950"
                            : rank === 3 && isSolved
                            ? "bg-amber-700 text-white"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {rank === 1 && isSolved ? <Crown className="w-5 h-5" /> : `#${rank}`}
                      </div>

                      <div
                        className={`w-11 h-11 rounded-2xl bg-gradient-to-tr ${getAvatarColor(
                          p.name
                        )} flex items-center justify-center text-white font-bold text-sm shrink-0`}
                      >
                        {getInitials(p.name)}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-base">{p.name}</span>
                          {p.id === self.id && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/20">
                              You
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-amber-300 font-semibold block">
                          Was: {p.identityName || "Secret Celebrity"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      {isSolved ? (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {p.completionTimeSeconds}s
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
                          Timed Out
                        </span>
                      )}

                      <span
                        className={`text-xs px-2.5 py-1 rounded-xl font-medium ${
                          p.isReady
                            ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                            : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {p.isReady ? "Ready" : "Waiting"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Next Round Controls */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 backdrop-blur-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <button
            onClick={() => toggleReady(!self.isReady)}
            disabled={isSubmitting}
            className={`w-full sm:w-auto py-3.5 px-6 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer ${
              self.isReady
                ? "bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:brightness-110 shadow-lg shadow-emerald-500/20"
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            {self.isReady ? "Ready for Next Round!" : "Click When Ready Again"}
          </button>

          {isHost ? (
            <button
              onClick={nextRound}
              disabled={!allReady || isSubmitting}
              className="w-full sm:w-auto py-3.5 px-8 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 text-slate-950 font-bold text-base hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Sparkles className="w-5 h-5" />
              <span>Start Next Round</span>
            </button>
          ) : (
            <p className="text-xs text-slate-400 text-center sm:text-right">
              {allReady
                ? "Everyone is ready! Waiting for Host to start next round."
                : "Waiting for all players to click Ready Again..."}
            </p>
          )}
        </div>
      </main>
    );
  }

  return null;
}

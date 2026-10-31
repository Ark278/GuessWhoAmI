"use client";

import { useEffect, useState, useCallback } from "react";
import { GameStateResponse } from "./types";
import { supabase, isSupabaseConfigured } from "./supabase";

export function useGameSync(roomCode: string, initialSessionToken?: string) {
  const [gameState, setGameState] = useState<GameStateResponse | null>(null);
  const [sessionToken, setSessionToken] = useState<string>(initialSessionToken || "");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(120);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load session token from localStorage if not provided
  useEffect(() => {
    if (!sessionToken && typeof window !== "undefined") {
      const stored = localStorage.getItem(`whoami_session_${roomCode.toUpperCase()}`);
      if (stored) {
        setSessionToken(stored);
      }
    }
  }, [roomCode, sessionToken]);

  // Fetch latest state from server
  const fetchState = useCallback(async () => {
    if (!roomCode) return;
    try {
      const token = sessionToken || (typeof window !== "undefined" ? localStorage.getItem(`whoami_session_${roomCode.toUpperCase()}`) || "" : "");
      const res = await fetch(`/api/game/state?code=${roomCode.toUpperCase()}&sessionToken=${token}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load game");
      }
      setGameState(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomCode, sessionToken]);

  // Initial fetch and interval polling fallback (every 1.5s)
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1500);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Supabase Realtime subscription on public rooms table
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !roomCode) return;

    const channel = supabase
      .channel(`room_${roomCode.toUpperCase()}`)
      .on("broadcast", { event: "state_change" }, () => {
        fetchState();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `code=eq.${roomCode.toUpperCase()}` },
        () => fetchState()
      )
      .subscribe();

    return () => {
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [roomCode, fetchState]);

  // Synchronized Countdown Timer (120 seconds for simultaneous guessing)
  useEffect(() => {
    const startTimeStr = gameState?.room.roundStartTime;
    if (!gameState || gameState.room.status !== "PLAYING" || !startTimeStr) {
      setTimeRemaining(120);
      return;
    }

    const startTimestamp = new Date(startTimeStr).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimestamp) / 1000);
      const remaining = Math.max(0, 120 - elapsed);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const timerInterval = setInterval(updateTimer, 500);
    return () => clearInterval(timerInterval);
  }, [gameState]);

  // Actions
  const toggleReady = async (isReady: boolean) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/room/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: roomCode, sessionToken, isReady }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startGame = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: roomCode, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitGuess = async (guess: string): Promise<{ correct: boolean; identityName?: string; completionTime?: number }> => {
    try {
      const res = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: roomCode, sessionToken, guess }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchState();
      return data;
    } catch (err: any) {
      setError(err.message);
      return { correct: false };
    }
  };

  const nextRound = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/game/next-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: roomCode, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    gameState,
    loading,
    error,
    timeRemaining,
    isSubmitting,
    toggleReady,
    startGame,
    submitGuess,
    nextRound,
    refetch: fetchState,
  };
}

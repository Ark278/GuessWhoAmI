import { Room, Player, RoundAssignment, GameStateResponse, PlayerPublicView } from "./types";
import { IDENTITIES, Identity } from "./identities";
import { isCorrectGuess } from "./normalize";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase-admin";

export function formatDbError(err: any): string {
  if (!err) return "Unknown database error";
  const parts: string[] = [];
  if (err.message && err.message.trim()) parts.push(err.message.trim());
  if (err.code) parts.push(`Code: ${err.code}`);
  if (err.details && err.details.trim()) parts.push(`Details: ${err.details.trim()}`);
  if (err.hint && err.hint.trim()) parts.push(`Hint: ${err.hint.trim()}`);
  return parts.length > 0 ? parts.join(" | ") : (typeof err === "string" ? err : JSON.stringify(err));
}

export function classifyDbError(err: any, httpStatus?: number): string {
  if (httpStatus === 401) {
    return "INVALID_API_KEY_OR_UNAUTHORIZED (HTTP 401: Authentication failed - check if SUPABASE_SERVICE_ROLE_KEY is a valid service_role secret/JWT)";
  }
  if (httpStatus === 403) {
    return "FORBIDDEN_OR_INSUFFICIENT_PERMISSIONS (HTTP 403: Role lacks EXECUTE permission on create_room_and_host or RLS blocked request)";
  }
  if (httpStatus === 404 || err?.code === "PGRST202") {
    return "RPC_FUNCTION_NOT_FOUND (HTTP 404 / PGRST202: public.create_room_and_host not found in PostgREST schema cache - run NOTIFY pgrst, 'reload schema')";
  }
  if (err?.code && (String(err.code).startsWith("23") || String(err.code).startsWith("42") || String(err.code).startsWith("P0001"))) {
    return `POSTGRESQL_EXECUTION_ERROR (SQLSTATE ${err.code}: Database constraint or procedure logic error)`;
  }
  if (err?.code && String(err.code).startsWith("PGRST")) {
    return `POSTGREST_ERROR (Code: ${err.code})`;
  }
  if (err?.name === "FetchError" || err?.message?.includes("fetch failed") || (err as any)?.cause?.code === "ECONNREFUSED") {
    return "NETWORK_FAILURE (Failed to connect to Supabase URL)";
  }
  if (httpStatus && httpStatus >= 500) {
    return `SUPABASE_SERVER_ERROR (HTTP ${httpStatus})`;
  }
  return `POSTGREST_OR_HTTP_ERROR (HTTP ${httpStatus || "unknown"})`;
}

function logDbError(operation: string, err: any) {
  if (!err) return;
  console.error(`[Database Error] ${operation}:`, {
    code: err.code,
    message: err.message,
    details: err.details,
    hint: err.hint,
  });
}

interface MemoryDB {
  rooms: Map<string, Room>; // key: room code
  players: Map<string, Player[]>; // key: room id
  assignments: Map<string, RoundAssignment[]>; // key: `${roomId}_${roundNumber}`
  usedIdentityIds: Map<string, Set<string>>; // key: roomId -> Set of used identity IDs
}

const globalForDB = globalThis as unknown as { __gameDB?: MemoryDB };
const memoryDB: MemoryDB = globalForDB.__gameDB || {
  rooms: new Map(),
  players: new Map(),
  assignments: new Map(),
  usedIdentityIds: new Map(),
};
if (process.env.NODE_ENV !== "production") globalForDB.__gameDB = memoryDB;

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameService {
  // 1. ATOMIC CREATE ROOM & HOST PLAYER
  static async createRoom(hostName: string): Promise<{ room: Room; player: Player }> {
    const trimmedName = hostName.trim();
    if (!trimmedName) throw new Error("Display name is required");

    const code = generateRoomCode();
    const roomId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();

    const room: Room = {
      id: roomId,
      code,
      hostPlayerId: playerId,
      status: "LOBBY",
      currentRound: 1,
      roundStartTime: null,
      currentTurnPlayerId: null,
      turnStartTime: null,
      createdAt: now,
      updatedAt: now,
    };

    const player: Player = {
      id: playerId,
      roomId,
      name: trimmedName,
      isReady: false,
      isHost: true,
      sessionToken,
      createdAt: now,
    };

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable in production");

      // 1. Attempt atomic RPC creation
      const {
        data: rpcData,
        error: rpcErr,
        status: rpcStatus,
        statusText: rpcStatusText,
      } = await admin.rpc("create_room_and_host", {
        p_code: code,
        p_room_id: roomId,
        p_host_player_id: playerId,
        p_host_name: trimmedName,
        p_session_token: sessionToken,
      });

      if (!rpcErr && rpcData) {
        return { room, player };
      }

      // If in production, NEVER fall back to non-atomic creation
      if (rpcErr) {
        // Log original raw error object BEFORE formatting it
        console.error("[RPC create_room_and_host Raw Diagnostic]:", {
          constructorName: (rpcErr as any)?.constructor?.name ?? typeof rpcErr,
          name: (rpcErr as any)?.name,
          message: (rpcErr as any)?.message,
          keys: rpcErr && typeof rpcErr === "object" ? Object.keys(rpcErr) : [],
          cause: (rpcErr as any)?.cause,
          stack: (rpcErr as any)?.stack,
          httpStatus: rpcStatus,
          httpStatusText: rpcStatusText,
          code: (rpcErr as any)?.code,
          details: (rpcErr as any)?.details,
          hint: (rpcErr as any)?.hint,
        });

        const classified = classifyDbError(rpcErr, rpcStatus);
        console.error(`[Database Error Classification]: ${classified}`);

        logDbError("createRoom (rpc create_room_and_host)", rpcErr);
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            `Database error creating room: Atomic procedure create_room_and_host failed [${classified}] (${formatDbError(
              rpcErr
            )} | HTTP ${rpcStatus} ${rpcStatusText || ""}). Non-atomic fallback is forbidden in production.`
          );
        }
      }

      const { error: roomErr } = await admin.from("rooms").insert({
        id: roomId,
        code,
        host_player_id: playerId,
        status: "LOBBY",
        current_round: 1,
      });

      if (roomErr) {
        logDbError("createRoom (table: rooms)", roomErr);
        throw new Error(`Database error creating room: ${formatDbError(roomErr)}`);
      }

      const { error: playerErr } = await admin.from("players").insert({
        id: playerId,
        room_id: roomId,
        name: trimmedName,
        is_ready: false,
        is_host: true,
        session_token: sessionToken,
      });

      if (playerErr) {
        logDbError("createRoom (table: players)", playerErr);
        // Rollback created room to prevent orphaned room records
        await admin.from("rooms").delete().eq("id", roomId);
        throw new Error(`Database error creating player: ${formatDbError(playerErr)}`);
      }
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production. In-memory mode is disabled.");
      }
      memoryDB.rooms.set(code, room);
      memoryDB.players.set(roomId, [player]);
      memoryDB.usedIdentityIds.set(roomId, new Set());
    }

    return { room, player };
  }

  // 2. JOIN ROOM
  static async joinRoom(code: string, playerName: string): Promise<{ room: Room; player: Player }> {
    const upperCode = code.trim().toUpperCase();
    const trimmedName = playerName.trim();
    if (!upperCode) throw new Error("Room code is required");
    if (!trimmedName) throw new Error("Display name is required");

    let room: Room | null = null;
    let players: Player[] = [];

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: roomData, error: roomErr } = await admin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();

      if (roomErr || !roomData) {
        if (roomErr && roomErr.code !== "PGRST116") {
          logDbError("joinRoom (table: rooms select)", roomErr);
        }
        throw new Error("Room not found. Please check the code.");
      }

      room = {
        id: roomData.id,
        code: roomData.code,
        hostPlayerId: roomData.host_player_id,
        status: roomData.status,
        currentRound: roomData.current_round,
        roundStartTime: roomData.round_start_time,
        currentTurnPlayerId: roomData.current_turn_player_id,
        turnStartTime: roomData.turn_start_time,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      const { data: playersData, error: playersErr } = await admin
        .from("players")
        .select("*")
        .eq("room_id", room.id);

      if (playersErr) {
        logDbError("joinRoom (table: players select)", playersErr);
      }

      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      room = memoryDB.rooms.get(upperCode) || null;
      if (!room) throw new Error("Room not found. Please check the code.");
      players = memoryDB.players.get(room.id) || [];
    }

    const existingPlayer = players.find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (existingPlayer) {
      return { room, player: existingPlayer };
    }

    if (room.status !== "LOBBY") {
      throw new Error("Game is currently in progress. Cannot join room now.");
    }

    if (players.length >= 10) {
      throw new Error("Room is full (maximum 10 players).");
    }

    const playerId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();

    const newPlayer: Player = {
      id: playerId,
      roomId: room.id,
      name: trimmedName,
      isReady: false,
      isHost: false,
      sessionToken,
      createdAt: now,
    };

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { error: insertErr } = await admin.from("players").insert({
        id: playerId,
        room_id: room.id,
        name: trimmedName,
        is_ready: false,
        is_host: false,
        session_token: sessionToken,
      });

      if (insertErr) {
        logDbError("joinRoom (table: players insert)", insertErr);
        throw new Error(formatDbError(insertErr));
      }

      // Touch rooms.updated_at so Realtime instantly notifies other players in the room
      await admin.from("rooms").update({ updated_at: now }).eq("id", room.id);
    } else {
      players.push(newPlayer);
      memoryDB.players.set(room.id, players);
    }

    return { room, player: newPlayer };
  }

  // 3. SET PLAYER READINESS
  static async setReady(code: string, sessionToken: string, isReady: boolean): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: room, error: roomErr } = await admin
        .from("rooms")
        .select("id")
        .eq("code", upperCode)
        .single();

      if (roomErr || !room) {
        if (roomErr && roomErr.code !== "PGRST116") {
          logDbError("setReady (table: rooms select)", roomErr);
        }
        throw new Error("Room not found");
      }

      const { error } = await admin
        .from("players")
        .update({ is_ready: isReady })
        .eq("room_id", room.id)
        .eq("session_token", sessionToken);

      if (error) {
        logDbError("setReady (table: players update)", error);
        throw new Error(formatDbError(error));
      }

      // Touch rooms.updated_at so Realtime instantly notifies all lobby clients
      await admin.from("rooms").update({ updated_at: new Date().toISOString() }).eq("id", room.id);
      return true;
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      const room = memoryDB.rooms.get(upperCode);
      if (!room) throw new Error("Room not found");
      const players = memoryDB.players.get(room.id) || [];
      const player = players.find((p) => p.sessionToken === sessionToken);
      if (!player) throw new Error("Player session not found");
      player.isReady = isReady;
      return true;
    }
  }

  // 4. START GAME (SIMULTANEOUS GUESSING: ALL PLAYERS PLAY AT ONCE)
  static async startGame(code: string, sessionToken: string): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: roomData, error: roomErr } = await admin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();

      if (roomErr || !roomData) {
        logDbError("startGame (table: rooms select)", roomErr);
        throw new Error("Room not found");
      }

      room = {
        id: roomData.id,
        code: roomData.code,
        hostPlayerId: roomData.host_player_id,
        status: roomData.status,
        currentRound: roomData.current_round,
        roundStartTime: roomData.round_start_time,
        currentTurnPlayerId: roomData.current_turn_player_id,
        turnStartTime: roomData.turn_start_time,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      const { data: playersData, error: playersErr } = await admin
        .from("players")
        .select("*")
        .eq("room_id", room.id);

      if (playersErr) {
        logDbError("startGame (table: players select)", playersErr);
      }

      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      const foundRoom = memoryDB.rooms.get(upperCode);
      if (!foundRoom) throw new Error("Room not found");
      room = foundRoom;
      players = memoryDB.players.get(room.id) || [];
    }

    const hostPlayer = players.find((p) => p.sessionToken === sessionToken);
    if (!hostPlayer || !hostPlayer.isHost) {
      throw new Error("Only the host can start the game.");
    }

    if (players.length < 2) {
      throw new Error("At least 2 players are required to start the game.");
    }

    const notReady = players.filter((p) => !p.isReady);
    if (notReady.length > 0) {
      throw new Error("All players must click Ready before the game can start.");
    }

    // Pick unique identities
    let usedIds = new Set<string>();
    if (!isSupabaseAdminConfigured()) {
      usedIds = memoryDB.usedIdentityIds.get(room.id) || new Set();
    }

    let availableIdentities = IDENTITIES.filter((i) => !usedIds.has(i.id));
    if (availableIdentities.length < players.length) {
      usedIds.clear();
      availableIdentities = [...IDENTITIES];
    }

    const shuffled = shuffle(availableIdentities);
    const roundNumber = room.currentRound;
    const now = new Date().toISOString();

    // In simultaneous mode, ALL players start with status "PLAYING"
    const assignments: RoundAssignment[] = [];
    players.forEach((player, idx) => {
      const identity = shuffled[idx];
      usedIds.add(identity.id);

      assignments.push({
        id: crypto.randomUUID(),
        roomId: room.id,
        roundNumber,
        playerId: player.id,
        identityId: identity.id,
        identityName: identity.name,
        identityCategory: identity.category,
        identityTag: identity.tag,
        identityAliases: identity.aliases,
        status: "PLAYING",
        solvedAt: null,
        completionTimeSeconds: null,
      });
    });

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const insertRows = assignments.map((a) => ({
        id: a.id,
        room_id: a.roomId,
        round_number: a.roundNumber,
        player_id: a.playerId,
        identity_id: a.identityId,
        identity_name: a.identityName,
        identity_category: a.identityCategory,
        identity_tag: a.identityTag,
        identity_aliases: a.identityAliases,
        status: a.status,
      }));

      const { error: assignErr } = await admin.from("round_assignments").insert(insertRows);
      if (assignErr) {
        logDbError("startGame (table: round_assignments insert)", assignErr);
        throw new Error(formatDbError(assignErr));
      }

      const { error: roomUpErr } = await admin
        .from("rooms")
        .update({
          status: "PLAYING",
          round_start_time: now,
          updated_at: now,
        })
        .eq("id", room.id);

      if (roomUpErr) {
        logDbError("startGame (table: rooms update)", roomUpErr);
        throw new Error(formatDbError(roomUpErr));
      }
    } else {
      room.status = "PLAYING";
      room.roundStartTime = now;
      room.updatedAt = now;
      memoryDB.assignments.set(`${room.id}_${roundNumber}`, assignments);
      memoryDB.usedIdentityIds.set(room.id, usedIds);
    }

    return true;
  }

  // 5. SUBMIT GUESS (CONCURRENT SIMULTANEOUS GUESSES FROM ANY ACTIVE PLAYER)
  static async submitGuess(
    code: string,
    sessionToken: string,
    guess: string
  ): Promise<{ correct: boolean; identityName?: string; completionTime?: number }> {
    const upperCode = code.trim().toUpperCase();
    const cleanGuess = (guess || "").trim();
    if (!cleanGuess) return { correct: false };

    let room: Room;
    let players: Player[];
    let assignments: RoundAssignment[];

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: roomData, error: roomErr } = await admin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (roomErr || !roomData) throw new Error("Room not found");

      room = {
        id: roomData.id,
        code: roomData.code,
        hostPlayerId: roomData.host_player_id,
        status: roomData.status,
        currentRound: roomData.current_round,
        roundStartTime: roomData.round_start_time,
        currentTurnPlayerId: roomData.current_turn_player_id,
        turnStartTime: roomData.turn_start_time,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      const { data: playersData, error: playersErr } = await admin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
      if (playersErr) logDbError("submitGuess (table: players select)", playersErr);

      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));

      const { data: assignData, error: assignErr } = await admin
        .from("round_assignments")
        .select("*")
        .eq("room_id", room.id)
        .eq("round_number", room.currentRound);
      if (assignErr) logDbError("submitGuess (table: round_assignments select)", assignErr);

      assignments = (assignData || []).map((a: any) => ({
        id: a.id,
        roomId: a.room_id,
        roundNumber: a.round_number,
        playerId: a.player_id,
        identityId: a.identity_id,
        identityName: a.identity_name,
        identityCategory: a.identity_category,
        identityTag: a.identity_tag,
        identityAliases: a.identity_aliases || [],
        status: a.status,
        solvedAt: a.solved_at,
        completionTimeSeconds: a.completion_time_seconds,
      }));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      const foundRoom = memoryDB.rooms.get(upperCode);
      if (!foundRoom) throw new Error("Room not found");
      room = foundRoom;
      players = memoryDB.players.get(room.id) || [];
      assignments = memoryDB.assignments.get(`${room.id}_${room.currentRound}`) || [];
    }

    if (room.status !== "PLAYING") {
      throw new Error("Game is not currently active.");
    }

    const player = players.find((p) => p.sessionToken === sessionToken);
    if (!player) throw new Error("Invalid session token");

    const playerAssignment = assignments.find((a) => a.playerId === player.id);
    if (!playerAssignment) throw new Error("No assignment found for player in this round.");

    // If player has already solved or timed out, return their status
    if (playerAssignment.status !== "PLAYING") {
      return {
        correct: playerAssignment.status === "SOLVED",
        identityName: playerAssignment.identityName,
        completionTime: playerAssignment.completionTimeSeconds || undefined,
      };
    }

    // Check individual player timer (120s from roundStartTime)
    const now = new Date();
    const startTime = room.roundStartTime ? new Date(room.roundStartTime) : now;
    const elapsedSeconds = Math.max(0, (now.getTime() - startTime.getTime()) / 1000);

    if (elapsedSeconds > 120) {
      playerAssignment.status = "TIMED_OUT";

      // Check if all players have now completed their turns
      const allFinished = assignments.every(
        (a) => (a.playerId === player.id ? "TIMED_OUT" : a.status) !== "PLAYING"
      );

      if (isSupabaseAdminConfigured()) {
        const admin = getSupabaseAdmin();
        if (admin) {
          const { error: toErr } = await admin
            .from("round_assignments")
            .update({ status: "TIMED_OUT" })
            .eq("id", playerAssignment.id)
            .eq("status", "PLAYING");
          if (toErr) logDbError("submitGuess timeout (table: round_assignments update)", toErr);

          // Touch rooms.updated_at to notify all clients via Realtime
          const { error: roomErr } = await admin
            .from("rooms")
            .update({
              updated_at: now.toISOString(),
              ...(allFinished ? { status: "RESULTS" } : {}),
            })
            .eq("id", room.id);
          if (roomErr) logDbError("submitGuess timeout room update (table: rooms update)", roomErr);
        }
      } else {
        if (allFinished) {
          room.status = "RESULTS";
          room.updatedAt = now.toISOString();
        }
      }

      return { correct: false };
    }

    // Validate guess against target identity
    const targetIdentity: Identity = {
      id: playerAssignment.identityId,
      name: playerAssignment.identityName,
      category: playerAssignment.identityCategory as any,
      tag: playerAssignment.identityTag,
      aliases: playerAssignment.identityAliases,
    };

    const isMatch = isCorrectGuess(cleanGuess, targetIdentity);

    if (isMatch) {
      const completionTime = Math.min(120, Math.round(elapsedSeconds * 10) / 10);
      playerAssignment.status = "SOLVED";
      playerAssignment.solvedAt = now.toISOString();
      playerAssignment.completionTimeSeconds = completionTime;

      // Check if all players have now completed
      const allFinished = assignments.every(
        (a) => (a.playerId === player.id ? "SOLVED" : a.status) !== "PLAYING"
      );

      if (isSupabaseAdminConfigured()) {
        const admin = getSupabaseAdmin();
        if (admin) {
          const { error: solveErr } = await admin
            .from("round_assignments")
            .update({
              status: "SOLVED",
              solved_at: now.toISOString(),
              completion_time_seconds: completionTime,
            })
            .eq("id", playerAssignment.id)
            .eq("status", "PLAYING");
          if (solveErr) logDbError("submitGuess solve (table: round_assignments update)", solveErr);

          // Touch rooms.updated_at to notify all clients via Realtime
          const { error: roomErr } = await admin
            .from("rooms")
            .update({
              updated_at: now.toISOString(),
              ...(allFinished ? { status: "RESULTS" } : {}),
            })
            .eq("id", room.id);
          if (roomErr) logDbError("submitGuess all finished (table: rooms update)", roomErr);
        }
      } else {
        if (allFinished) {
          room.status = "RESULTS";
          room.updatedAt = now.toISOString();
        }
      }

      return {
        correct: true,
        identityName: playerAssignment.identityName,
        completionTime,
      };
    }

    return { correct: false };
  }

  // 6. GET GAME STATE WITH PRIVACY-PRESERVING FILTERING
  static async getGameState(code: string, sessionToken?: string): Promise<GameStateResponse> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];
    let assignments: RoundAssignment[];

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: roomData, error: roomErr } = await admin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (roomErr || !roomData) throw new Error("Room not found");

      room = {
        id: roomData.id,
        code: roomData.code,
        hostPlayerId: roomData.host_player_id,
        status: roomData.status,
        currentRound: roomData.current_round,
        roundStartTime: roomData.round_start_time,
        currentTurnPlayerId: roomData.current_turn_player_id,
        turnStartTime: roomData.turn_start_time,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      const { data: playersData, error: playersErr } = await admin
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true });
      if (playersErr) logDbError("getGameState (table: players select)", playersErr);

      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));

      const { data: assignData, error: assignErr } = await admin
        .from("round_assignments")
        .select("*")
        .eq("room_id", room.id)
        .eq("round_number", room.currentRound);
      if (assignErr) logDbError("getGameState (table: round_assignments select)", assignErr);

      assignments = (assignData || []).map((a: any) => ({
        id: a.id,
        roomId: a.room_id,
        roundNumber: a.round_number,
        playerId: a.player_id,
        identityId: a.identity_id,
        identityName: a.identity_name,
        identityCategory: a.identity_category,
        identityTag: a.identity_tag,
        identityAliases: a.identity_aliases || [],
        status: a.status,
        solvedAt: a.solved_at,
        completionTimeSeconds: a.completion_time_seconds,
      }));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      const foundRoom = memoryDB.rooms.get(upperCode);
      if (!foundRoom) throw new Error("Room not found");
      room = foundRoom;
      players = memoryDB.players.get(room.id) || [];
      assignments = memoryDB.assignments.get(`${room.id}_${room.currentRound}`) || [];
    }

    // Auto timeout check on active simultaneous players (120 seconds)
    const now = new Date();
    if (room.status === "PLAYING" && room.roundStartTime) {
      const startTime = new Date(room.roundStartTime);
      const elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;

      if (elapsedSeconds >= 120) {
        let hasChanges = false;
        const timedOutAssignmentIds: string[] = [];

        assignments.forEach((a) => {
          if (a.status === "PLAYING") {
            a.status = "TIMED_OUT";
            hasChanges = true;
            timedOutAssignmentIds.push(a.id);
          }
        });

        if (hasChanges) {
          room.status = "RESULTS";
          room.updatedAt = now.toISOString();

          if (isSupabaseAdminConfigured()) {
            const admin = getSupabaseAdmin();
            if (admin) {
              if (timedOutAssignmentIds.length > 0) {
                await admin
                  .from("round_assignments")
                  .update({ status: "TIMED_OUT" })
                  .in("id", timedOutAssignmentIds);
              }
              await admin
                .from("rooms")
                .update({ status: "RESULTS", updated_at: now.toISOString() })
                .eq("id", room.id);
            }
          }
        }
      }
    }

    const selfPlayer = players.find((p) => p.sessionToken === sessionToken) || players[0];
    const selfAssignment = assignments.find((a) => a.playerId === selfPlayer?.id);

    const isRoomFinished = room.status === "RESULTS";
    const isSelfSolved = selfAssignment?.status === "SOLVED";

    // Strictly enforce identity visibility:
    // A player NEVER receives their own identity until they have SOLVED it or the round ends in RESULTS.
    // Session tokens are NEVER included in public player views.
    const publicPlayers: PlayerPublicView[] = players.map((player) => {
      const assignment = assignments.find((a) => a.playerId === player.id);
      const isSelf = player.id === selfPlayer?.id;
      const shouldReveal = !isSelf || isRoomFinished || (isSelf && isSelfSolved);

      return {
        id: player.id,
        name: player.name,
        isReady: player.isReady,
        isHost: player.isHost,
        isCurrentTurn: assignment?.status === "PLAYING",
        status: assignment?.status || "PLAYING",
        solvedAt: assignment?.solvedAt || null,
        completionTimeSeconds: typeof assignment?.completionTimeSeconds === "number" ? assignment.completionTimeSeconds : null,
        identityName: shouldReveal ? assignment?.identityName || null : null,
        identityCategory: shouldReveal ? assignment?.identityCategory || null : null,
        identityTag: shouldReveal ? assignment?.identityTag || null : null,
        isSelf,
      };
    });

    return {
      room: {
        id: room.id,
        code: room.code,
        status: room.status,
        currentRound: room.currentRound,
        roundStartTime: room.roundStartTime,
        currentTurnPlayerId: null,
        turnStartTime: null,
        isHost: selfPlayer?.isHost || false,
      },
      self: {
        id: selfPlayer?.id || "",
        name: selfPlayer?.name || "",
        isReady: selfPlayer?.isReady || false,
        isHost: selfPlayer?.isHost || false,
        isCurrentTurn: selfAssignment?.status === "PLAYING",
        status: selfAssignment?.status || "PLAYING",
        solvedAt: selfAssignment?.solvedAt || null,
        completionTimeSeconds: typeof selfAssignment?.completionTimeSeconds === "number" ? selfAssignment.completionTimeSeconds : null,
        revealedIdentity:
          isSelfSolved || isRoomFinished
            ? {
                name: selfAssignment?.identityName || "",
                category: selfAssignment?.identityCategory || "",
                tag: selfAssignment?.identityTag || "",
              }
            : null,
      },
      currentTurnPlayer: null,
      players: publicPlayers,
      serverTime: now.toISOString(),
    };
  }

  // 7. ADVANCE TO NEXT ROUND
  static async nextRound(code: string, sessionToken: string): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const { data: roomData, error: roomErr } = await admin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (roomErr || !roomData) throw new Error("Room not found");

      room = {
        id: roomData.id,
        code: roomData.code,
        hostPlayerId: roomData.host_player_id,
        status: roomData.status,
        currentRound: roomData.current_round,
        roundStartTime: roomData.round_start_time,
        currentTurnPlayerId: roomData.current_turn_player_id,
        turnStartTime: roomData.turn_start_time,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      const { data: playersData, error: playersErr } = await admin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
      if (playersErr) logDbError("nextRound (table: players select)", playersErr);

      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("CRITICAL: Supabase is required in production.");
      }
      const foundRoom = memoryDB.rooms.get(upperCode);
      if (!foundRoom) throw new Error("Room not found");
      room = foundRoom;
      players = memoryDB.players.get(room.id) || [];
    }

    const hostPlayer = players.find((p) => p.sessionToken === sessionToken);
    if (!hostPlayer || !hostPlayer.isHost) {
      throw new Error("Only the host can advance to the next round.");
    }

    const notReady = players.filter((p) => !p.isReady);
    if (notReady.length > 0) {
      throw new Error("All players must click Ready Again before starting the round.");
    }

    const nextRoundNumber = room.currentRound + 1;
    const now = new Date().toISOString();

    let usedIds = new Set<string>();
    if (!isSupabaseAdminConfigured()) {
      usedIds = memoryDB.usedIdentityIds.get(room.id) || new Set();
    }

    let availableIdentities = IDENTITIES.filter((i) => !usedIds.has(i.id));
    if (availableIdentities.length < players.length) {
      usedIds.clear();
      availableIdentities = [...IDENTITIES];
    }

    const shuffled = shuffle(availableIdentities);
    const assignments: RoundAssignment[] = [];

    players.forEach((player, idx) => {
      const identity = shuffled[idx];
      usedIds.add(identity.id);

      assignments.push({
        id: crypto.randomUUID(),
        roomId: room.id,
        roundNumber: nextRoundNumber,
        playerId: player.id,
        identityId: identity.id,
        identityName: identity.name,
        identityCategory: identity.category,
        identityTag: identity.tag,
        identityAliases: identity.aliases,
        status: "PLAYING",
        solvedAt: null,
        completionTimeSeconds: null,
      });
    });

    if (isSupabaseAdminConfigured()) {
      const admin = getSupabaseAdmin();
      if (!admin) throw new Error("Database admin client unavailable");

      const insertRows = assignments.map((a) => ({
        id: a.id,
        room_id: a.roomId,
        round_number: a.roundNumber,
        player_id: a.playerId,
        identity_id: a.identityId,
        identity_name: a.identityName,
        identity_category: a.identityCategory,
        identity_tag: a.identityTag,
        identity_aliases: a.identityAliases,
        status: a.status,
      }));

      const { error: assignErr } = await admin.from("round_assignments").insert(insertRows);
      if (assignErr) {
        logDbError("nextRound (table: round_assignments insert)", assignErr);
        throw new Error(formatDbError(assignErr));
      }

      const { error: pErr } = await admin
        .from("players")
        .update({ is_ready: false })
        .eq("room_id", room.id);
      if (pErr) logDbError("nextRound (table: players update)", pErr);

      const { error: roomErr } = await admin
        .from("rooms")
        .update({
          current_round: nextRoundNumber,
          status: "PLAYING",
          round_start_time: now,
          updated_at: now,
        })
        .eq("id", room.id);
      if (roomErr) {
        logDbError("nextRound (table: rooms update)", roomErr);
        throw new Error(formatDbError(roomErr));
      }
    } else {
      players.forEach((p) => (p.isReady = false));
      room.currentRound = nextRoundNumber;
      room.status = "PLAYING";
      room.roundStartTime = now;
      room.updatedAt = now;
      memoryDB.assignments.set(`${room.id}_${nextRoundNumber}`, assignments);
      memoryDB.usedIdentityIds.set(room.id, usedIds);
    }

    return true;
  }
}

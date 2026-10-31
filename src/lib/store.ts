import { Room, Player, RoundAssignment, GameStateResponse, PlayerPublicView } from "./types";
import { IDENTITIES, Identity } from "./identities";
import { isCorrectGuess } from "./normalize";
import { supabaseAdmin, getSupabaseAdmin, isSupabaseConfigured } from "./supabase";

export function formatDbError(err: any): string {
  if (!err) return "Unknown database error";
  const parts: string[] = [];
  if (err.message && err.message.trim()) parts.push(err.message.trim());
  if (err.code) parts.push(`Code: ${err.code}`);
  if (err.details && err.details.trim()) parts.push(`Details: ${err.details.trim()}`);
  if (err.hint && err.hint.trim()) parts.push(`Hint: ${err.hint.trim()}`);
  return parts.length > 0 ? parts.join(" | ") : (typeof err === "string" ? err : JSON.stringify(err));
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
  // 1. CREATE ROOM
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

    const admin = getSupabaseAdmin() || supabaseAdmin;

    if (isSupabaseConfigured && admin) {
      const { error: roomErr } = await admin.from("rooms").insert({
        id: roomId,
        code,
        host_player_id: playerId,
        status: "LOBBY",
        current_round: 1,
      });

      if (roomErr) {
        console.error("[Database Error] createRoom (table: rooms):", {
          code: roomErr.code,
          message: roomErr.message,
          details: roomErr.details,
          hint: roomErr.hint,
        });
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
        console.error("[Database Error] createRoom (table: players):", {
          code: playerErr.code,
          message: playerErr.message,
          details: playerErr.details,
          hint: playerErr.hint,
        });
        throw new Error(`Database error creating player: ${formatDbError(playerErr)}`);
      }
    } else {
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

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: roomData, error: roomErr } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (roomErr || !roomData) throw new Error("Room not found. Please check the code.");

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

      const { data: playersData } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
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

    if (isSupabaseConfigured && supabaseAdmin) {
      const { error: insertErr } = await supabaseAdmin.from("players").insert({
        id: playerId,
        room_id: room.id,
        name: trimmedName,
        is_ready: false,
        is_host: false,
        session_token: sessionToken,
      });
      if (insertErr) throw new Error(insertErr.message);
    } else {
      players.push(newPlayer);
      memoryDB.players.set(room.id, players);
    }

    return { room, player: newPlayer };
  }

  // 3. SET PLAYER READINESS
  static async setReady(code: string, sessionToken: string, isReady: boolean): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: room } = await supabaseAdmin
        .from("rooms")
        .select("id")
        .eq("code", upperCode)
        .single();
      if (!room) throw new Error("Room not found");

      const { error } = await supabaseAdmin
        .from("players")
        .update({ is_ready: isReady })
        .eq("room_id", room.id)
        .eq("session_token", sessionToken);

      if (error) throw new Error(error.message);
      return true;
    } else {
      const room = memoryDB.rooms.get(upperCode);
      if (!room) throw new Error("Room not found");
      const players = memoryDB.players.get(room.id) || [];
      const player = players.find((p) => p.sessionToken === sessionToken);
      if (!player) throw new Error("Player session not found");
      player.isReady = isReady;
      return true;
    }
  }

  // 4. START GAME (TURN-BASED SEQUENTIAL SELECTION)
  static async startGame(code: string, sessionToken: string): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (!roomData) throw new Error("Room not found");
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

      const { data: playersData } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
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
    if (!isSupabaseConfigured) {
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

    // Randomly select one player to start the guessing turn
    const shuffledPlayers = shuffle(players);
    const firstTurnPlayer = shuffledPlayers[0];

    const assignments: RoundAssignment[] = [];
    players.forEach((player, idx) => {
      const identity = shuffled[idx];
      usedIds.add(identity.id);
      const isFirstTurn = player.id === firstTurnPlayer.id;

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
        status: isFirstTurn ? "PLAYING" : "WAITING_TURN",
        solvedAt: null,
        completionTimeSeconds: null,
      });
    });

    if (isSupabaseConfigured && supabaseAdmin) {
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
      await supabaseAdmin.from("round_assignments").insert(insertRows);

      await supabaseAdmin
        .from("rooms")
        .update({
          status: "PLAYING",
          round_start_time: now,
          current_turn_player_id: firstTurnPlayer.id,
          turn_start_time: now,
          updated_at: now,
        })
        .eq("id", room.id);
    } else {
      room.status = "PLAYING";
      room.roundStartTime = now;
      room.currentTurnPlayerId = firstTurnPlayer.id;
      room.turnStartTime = now;
      room.updatedAt = now;
      memoryDB.assignments.set(`${room.id}_${roundNumber}`, assignments);
      memoryDB.usedIdentityIds.set(room.id, usedIds);
    }

    return true;
  }

  // Helper: Advance to next unattempted player or finish round
  private static advanceNextTurn(
    room: Room,
    assignments: RoundAssignment[],
    players: Player[]
  ): string | null {
    // Find players who are still WAITING_TURN
    const remainingWaiting = assignments.filter((a) => a.status === "WAITING_TURN");

    if (remainingWaiting.length > 0) {
      // Randomly pick one among the remaining waiting players
      const nextAssignment = remainingWaiting[Math.floor(Math.random() * remainingWaiting.length)];
      nextAssignment.status = "PLAYING";
      const now = new Date().toISOString();
      room.currentTurnPlayerId = nextAssignment.playerId;
      room.turnStartTime = now;
      room.updatedAt = now;
      return nextAssignment.playerId;
    } else {
      // Everyone has had a go!
      const now = new Date().toISOString();
      room.status = "RESULTS";
      room.currentTurnPlayerId = null;
      room.turnStartTime = null;
      room.updatedAt = now;
      return null;
    }
  }

  // 5. SUBMIT GUESS
  static async submitGuess(
    code: string,
    sessionToken: string,
    guess: string
  ): Promise<{ correct: boolean; identityName?: string; completionTime?: number; nextPlayerId?: string | null }> {
    const upperCode = code.trim().toUpperCase();
    const cleanGuess = (guess || "").trim();
    if (!cleanGuess) return { correct: false };

    let room: Room;
    let players: Player[];
    let assignments: RoundAssignment[];

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (!roomData) throw new Error("Room not found");
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

      const { data: playersData } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));

      const { data: assignData } = await supabaseAdmin
        .from("round_assignments")
        .select("*")
        .eq("room_id", room.id)
        .eq("round_number", room.currentRound);
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

    // Enforce that ONLY the currently selected player can submit guesses!
    if (room.currentTurnPlayerId !== player.id) {
      throw new Error("It is not your turn to guess!");
    }

    const playerAssignment = assignments.find((a) => a.playerId === player.id);
    if (!playerAssignment) throw new Error("No assignment found for player in this round.");

    if (playerAssignment.status !== "PLAYING") {
      return {
        correct: playerAssignment.status === "SOLVED",
        identityName: playerAssignment.identityName,
        completionTime: playerAssignment.completionTimeSeconds || undefined,
      };
    }

    // Check individual turn timer (120s from turnStartTime)
    const now = new Date();
    const startTime = room.turnStartTime ? new Date(room.turnStartTime) : now;
    const elapsedSeconds = Math.max(0, (now.getTime() - startTime.getTime()) / 1000);

    if (elapsedSeconds > 120) {
      playerAssignment.status = "TIMED_OUT";
      const nextPlayerId = GameService.advanceNextTurn(room, assignments, players);

      if (isSupabaseConfigured && supabaseAdmin) {
        await supabaseAdmin
          .from("round_assignments")
          .update({ status: "TIMED_OUT" })
          .eq("id", playerAssignment.id);

        if (nextPlayerId) {
          await supabaseAdmin
            .from("round_assignments")
            .update({ status: "PLAYING" })
            .eq("room_id", room.id)
            .eq("round_number", room.currentRound)
            .eq("player_id", nextPlayerId);
        }

        await supabaseAdmin
          .from("rooms")
          .update({
            status: room.status,
            current_turn_player_id: room.currentTurnPlayerId,
            turn_start_time: room.turnStartTime,
            updated_at: room.updatedAt,
          })
          .eq("id", room.id);
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

      // Advance to next remaining player or finish round
      const nextPlayerId = GameService.advanceNextTurn(room, assignments, players);

      if (isSupabaseConfigured && supabaseAdmin) {
        await supabaseAdmin
          .from("round_assignments")
          .update({
            status: "SOLVED",
            solved_at: now.toISOString(),
            completion_time_seconds: completionTime,
          })
          .eq("id", playerAssignment.id);

        if (nextPlayerId) {
          await supabaseAdmin
            .from("round_assignments")
            .update({ status: "PLAYING" })
            .eq("room_id", room.id)
            .eq("round_number", room.currentRound)
            .eq("player_id", nextPlayerId);
        }

        await supabaseAdmin
          .from("rooms")
          .update({
            status: room.status,
            current_turn_player_id: room.currentTurnPlayerId,
            turn_start_time: room.turnStartTime,
            updated_at: room.updatedAt,
          })
          .eq("id", room.id);
      }

      return {
        correct: true,
        identityName: playerAssignment.identityName,
        completionTime,
        nextPlayerId,
      };
    }

    return { correct: false };
  }

  // 6. GET GAME STATE
  static async getGameState(code: string, sessionToken?: string): Promise<GameStateResponse> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];
    let assignments: RoundAssignment[];

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (!roomData) throw new Error("Room not found");
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

      const { data: playersData } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true });
      players = (playersData || []).map((p: any) => ({
        id: p.id,
        roomId: p.room_id,
        name: p.name,
        isReady: p.is_ready,
        isHost: p.is_host,
        sessionToken: p.session_token,
        createdAt: p.created_at,
      }));

      const { data: assignData } = await supabaseAdmin
        .from("round_assignments")
        .select("*")
        .eq("room_id", room.id)
        .eq("round_number", room.currentRound);
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
      const foundRoom = memoryDB.rooms.get(upperCode);
      if (!foundRoom) throw new Error("Room not found");
      room = foundRoom;
      players = memoryDB.players.get(room.id) || [];
      assignments = memoryDB.assignments.get(`${room.id}_${room.currentRound}`) || [];
    }

    // Auto timeout check on active turn player
    const now = new Date();
    if (room.status === "PLAYING" && room.turnStartTime && room.currentTurnPlayerId) {
      const startTime = new Date(room.turnStartTime);
      const elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
      if (elapsedSeconds >= 120) {
        const activeAssignment = assignments.find((a) => a.playerId === room.currentTurnPlayerId);
        if (activeAssignment && activeAssignment.status === "PLAYING") {
          activeAssignment.status = "TIMED_OUT";

          const nextPlayerId = GameService.advanceNextTurn(room, assignments, players);

          if (isSupabaseConfigured && supabaseAdmin) {
            await supabaseAdmin
              .from("round_assignments")
              .update({ status: "TIMED_OUT" })
              .eq("id", activeAssignment.id);

            if (nextPlayerId) {
              await supabaseAdmin
                .from("round_assignments")
                .update({ status: "PLAYING" })
                .eq("room_id", room.id)
                .eq("round_number", room.currentRound)
                .eq("player_id", nextPlayerId);
            }

            await supabaseAdmin
              .from("rooms")
              .update({
                status: room.status,
                current_turn_player_id: room.currentTurnPlayerId,
                turn_start_time: room.turnStartTime,
                updated_at: room.updatedAt,
              })
              .eq("id", room.id);
          }
        }
      }
    }

    const selfPlayer = players.find((p) => p.sessionToken === sessionToken) || players[0];
    const selfAssignment = assignments.find((a) => a.playerId === selfPlayer?.id);

    const isRoomFinished = room.status === "RESULTS";
    const isSelfSolved = selfAssignment?.status === "SOLVED";

    // Find current active turn player details
    const activeTurnPlayer = players.find((p) => p.id === room.currentTurnPlayerId) || null;
    const activeTurnAssignment = assignments.find((a) => a.playerId === room.currentTurnPlayerId) || null;

    const isActiveSelf = activeTurnPlayer?.id === selfPlayer?.id;
    const showActiveIdentityToSelf = isRoomFinished || (isActiveSelf && isSelfSolved);

    const currentTurnPlayerInfo = activeTurnPlayer
      ? {
          id: activeTurnPlayer.id,
          name: activeTurnPlayer.name,
          identityName: !isActiveSelf || showActiveIdentityToSelf ? activeTurnAssignment?.identityName || null : null,
          identityCategory: !isActiveSelf || showActiveIdentityToSelf ? activeTurnAssignment?.identityCategory || null : null,
          identityTag: !isActiveSelf || showActiveIdentityToSelf ? activeTurnAssignment?.identityTag || null : null,
          isSelf: isActiveSelf,
        }
      : null;

    // Build public players view with strictly enforced identity visibility
    const publicPlayers: PlayerPublicView[] = players.map((player) => {
      const assignment = assignments.find((a) => a.playerId === player.id);
      const isSelf = player.id === selfPlayer?.id;
      const isCurrentTurn = player.id === room.currentTurnPlayerId;

      const shouldReveal = !isSelf || isRoomFinished || (isSelf && isSelfSolved);

      return {
        id: player.id,
        name: player.name,
        isReady: player.isReady,
        isHost: player.isHost,
        isCurrentTurn,
        status: assignment?.status || "WAITING_TURN",
        solvedAt: assignment?.solvedAt || null,
        completionTimeSeconds: assignment?.completionTimeSeconds || null,
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
        currentTurnPlayerId: room.currentTurnPlayerId,
        turnStartTime: room.turnStartTime,
        isHost: selfPlayer?.isHost || false,
      },
      self: {
        id: selfPlayer?.id || "",
        name: selfPlayer?.name || "",
        isReady: selfPlayer?.isReady || false,
        isHost: selfPlayer?.isHost || false,
        isCurrentTurn: selfPlayer?.id === room.currentTurnPlayerId,
        status: selfAssignment?.status || "WAITING_TURN",
        solvedAt: selfAssignment?.solvedAt || null,
        completionTimeSeconds: selfAssignment?.completionTimeSeconds || null,
        revealedIdentity:
          isSelfSolved || isRoomFinished
            ? {
                name: selfAssignment?.identityName || "",
                category: selfAssignment?.identityCategory || "",
                tag: selfAssignment?.identityTag || "",
              }
            : null,
      },
      currentTurnPlayer: currentTurnPlayerInfo,
      players: publicPlayers,
      serverTime: now.toISOString(),
    };
  }

  // 7. NEXT ROUND
  static async nextRound(code: string, sessionToken: string): Promise<boolean> {
    const upperCode = code.trim().toUpperCase();

    let room: Room;
    let players: Player[];

    if (isSupabaseConfigured && supabaseAdmin) {
      const { data: roomData } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("code", upperCode)
        .single();
      if (!roomData) throw new Error("Room not found");
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

      const { data: playersData } = await supabaseAdmin
        .from("players")
        .select("*")
        .eq("room_id", room.id);
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
    if (!isSupabaseConfigured) {
      usedIds = memoryDB.usedIdentityIds.get(room.id) || new Set();
    }

    let availableIdentities = IDENTITIES.filter((i) => !usedIds.has(i.id));
    if (availableIdentities.length < players.length) {
      usedIds.clear();
      availableIdentities = [...IDENTITIES];
    }

    const shuffled = shuffle(availableIdentities);
    const shuffledPlayers = shuffle(players);
    const firstTurnPlayer = shuffledPlayers[0];

    const assignments: RoundAssignment[] = [];

    players.forEach((player, idx) => {
      const identity = shuffled[idx];
      usedIds.add(identity.id);
      const isFirstTurn = player.id === firstTurnPlayer.id;

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
        status: isFirstTurn ? "PLAYING" : "WAITING_TURN",
        solvedAt: null,
        completionTimeSeconds: null,
      });
    });

    if (isSupabaseConfigured && supabaseAdmin) {
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
      await supabaseAdmin.from("round_assignments").insert(insertRows);

      await supabaseAdmin.from("players").update({ is_ready: false }).eq("room_id", room.id);
      await supabaseAdmin
        .from("rooms")
        .update({
          current_round: nextRoundNumber,
          status: "PLAYING",
          round_start_time: now,
          current_turn_player_id: firstTurnPlayer.id,
          turn_start_time: now,
          updated_at: now,
        })
        .eq("id", room.id);
    } else {
      players.forEach((p) => (p.isReady = false));
      room.currentRound = nextRoundNumber;
      room.status = "PLAYING";
      room.roundStartTime = now;
      room.currentTurnPlayerId = firstTurnPlayer.id;
      room.turnStartTime = now;
      room.updatedAt = now;
      memoryDB.assignments.set(`${room.id}_${nextRoundNumber}`, assignments);
      memoryDB.usedIdentityIds.set(room.id, usedIds);
    }

    return true;
  }
}

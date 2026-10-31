export type RoomStatus = "LOBBY" | "PLAYING" | "RESULTS";
export type PlayerAssignmentStatus = "WAITING_TURN" | "PLAYING" | "SOLVED" | "TIMED_OUT";

export interface Player {
  id: string;
  roomId: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
  sessionToken: string;
  createdAt: string;
}

export interface PlayerPublicView {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
  isCurrentTurn: boolean;
  status: PlayerAssignmentStatus;
  solvedAt: string | null;
  completionTimeSeconds: number | null;
  // If this is another player, identity is visible. If it is current player, identity is null unless solved or room is in RESULTS.
  identityName: string | null;
  identityCategory: string | null;
  identityTag: string | null;
  isSelf: boolean;
}

export interface Room {
  id: string;
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  currentRound: number;
  roundStartTime: string | null;
  currentTurnPlayerId: string | null;
  turnStartTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoundAssignment {
  id: string;
  roomId: string;
  roundNumber: number;
  playerId: string;
  identityId: string;
  identityName: string;
  identityCategory: string;
  identityTag: string;
  identityAliases: string[];
  status: PlayerAssignmentStatus;
  solvedAt: string | null;
  completionTimeSeconds: number | null;
}

export interface GameStateResponse {
  room: {
    id: string;
    code: string;
    status: RoomStatus;
    currentRound: number;
    roundStartTime: string | null;
    currentTurnPlayerId: string | null;
    turnStartTime: string | null;
    isHost: boolean;
  };
  self: {
    id: string;
    name: string;
    isReady: boolean;
    isHost: boolean;
    isCurrentTurn: boolean;
    status: PlayerAssignmentStatus;
    solvedAt: string | null;
    completionTimeSeconds: number | null;
    // Revealed only if solved or room in RESULTS
    revealedIdentity: {
      name: string;
      category: string;
      tag: string;
    } | null;
  };
  currentTurnPlayer: {
    id: string;
    name: string;
    identityName: string | null;
    identityCategory: string | null;
    identityTag: string | null;
    isSelf: boolean;
  } | null;
  players: PlayerPublicView[];
  serverTime: string;
}

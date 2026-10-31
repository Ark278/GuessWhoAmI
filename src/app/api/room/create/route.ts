import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = body?.name;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    const { room, player } = await GameService.createRoom(name);
    return NextResponse.json({
      roomCode: room.code,
      sessionToken: player.sessionToken,
      player: {
        id: player.id,
        name: player.name,
        isHost: true,
      },
    });
  } catch (err: any) {
    console.error("[API Error] POST /api/room/create:", err);

    const isDev = process.env.NODE_ENV !== "production";
    const errorMessage = isDev
      ? err.message || "Failed to create room"
      : "Failed to create room. Please verify database setup and try again.";

    return NextResponse.json(
      {
        error: errorMessage,
        ...(isDev && { details: err.message }),
      },
      { status: 500 }
    );
  }
}

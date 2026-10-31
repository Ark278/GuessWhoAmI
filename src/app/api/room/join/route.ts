import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export const preferredRegion = "bom1";

export async function POST(req: Request) {
  try {
    const { code, name } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Room code is required" }, { status: 400 });
    }
    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    const { room, player } = await GameService.joinRoom(code, name);
    return NextResponse.json({
      roomCode: room.code,
      sessionToken: player.sessionToken,
      player: {
        id: player.id,
        name: player.name,
        isHost: player.isHost,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to join room" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    if (!name || typeof name !== "string") {
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
    return NextResponse.json({ error: err.message || "Failed to create room" }, { status: 400 });
  }
}

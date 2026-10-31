import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const { code, sessionToken } = await req.json();
    if (!code || !sessionToken) {
      return NextResponse.json({ error: "Room code and session token are required" }, { status: 400 });
    }

    await GameService.startGame(code, sessionToken);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start game" }, { status: 400 });
  }
}

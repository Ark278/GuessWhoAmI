import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const sessionToken = searchParams.get("sessionToken") || undefined;

    if (!code) {
      return NextResponse.json({ error: "Room code is required" }, { status: 400 });
    }

    const state = await GameService.getGameState(code, sessionToken);
    return NextResponse.json(state);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch game state" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const { code, sessionToken } = await req.json();
    if (!code) {
      return NextResponse.json({ error: "Room code is required" }, { status: 400 });
    }

    const state = await GameService.getGameState(code, sessionToken);
    return NextResponse.json(state);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch game state" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const { code, sessionToken, isReady } = await req.json();
    if (!code || !sessionToken) {
      return NextResponse.json({ error: "Room code and session token are required" }, { status: 400 });
    }

    await GameService.setReady(code, sessionToken, Boolean(isReady));
    return NextResponse.json({ success: true, isReady: Boolean(isReady) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update ready status" }, { status: 400 });
  }
}

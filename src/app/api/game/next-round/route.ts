import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export const preferredRegion = "bom1";

export async function POST(req: Request) {
  try {
    const { code, sessionToken } = await req.json();
    if (!code || !sessionToken) {
      return NextResponse.json({ error: "Missing room code or session token" }, { status: 400 });
    }

    await GameService.nextRound(code, sessionToken);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to start next round" }, { status: 400 });
  }
}

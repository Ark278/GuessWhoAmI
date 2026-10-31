import { NextResponse } from "next/server";
import { GameService } from "@/lib/store";

export const preferredRegion = "bom1";

export async function POST(req: Request) {
  try {
    const { code, sessionToken, guess } = await req.json();
    if (!code || !sessionToken || !guess) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await GameService.submitGuess(code, sessionToken, guess);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit guess" }, { status: 400 });
  }
}

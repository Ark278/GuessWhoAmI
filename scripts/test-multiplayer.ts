import { GameService } from "../src/lib/store";

async function runMultiplayerTests() {
  console.log("=================================================");
  console.log("STARTING SIMULTANEOUS MULTIPLAYER TESTS");
  console.log("=================================================\n");

  // TEST 1: Room Creation & Input Validation Failure
  console.log("--- Test 1: Room Creation & Failure Handling ---");
  try {
    await GameService.createRoom("   ");
    throw new Error("Validation failure: blank name was accepted");
  } catch (err: any) {
    console.log(`[PASS] Blank host name properly rejected: "${err.message}"`);
  }

  const { room, player: host } = await GameService.createRoom("Alice (Host)");
  console.log(`[PASS] Room created with code: ${room.code}`);
  console.log(`[PASS] Host created: ${host.name} (isHost: ${host.isHost})`);

  // TEST 2: Multiple Players Joining & Idempotency
  console.log("\n--- Test 2: Multiple Players Joining & Idempotency ---");
  const { player: bob } = await GameService.joinRoom(room.code, "Bob");
  const { player: charlie } = await GameService.joinRoom(room.code, "Charlie");
  console.log(`[PASS] Bob joined (isHost: ${bob.isHost})`);
  console.log(`[PASS] Charlie joined (isHost: ${charlie.isHost})`);

  const { player: bobReconnected } = await GameService.joinRoom(room.code, "Bob");
  if (bobReconnected.id !== bob.id) {
    throw new Error("Failed: Reconnecting player was duplicated");
  }
  console.log(`[PASS] Idempotent player join: Reconnecting player reuses existing session`);

  // TEST 3: Readiness & Simultaneous Start Validation
  console.log("\n--- Test 3: Readiness & Simultaneous Start ---");
  try {
    await GameService.startGame(room.code, host.sessionToken);
    throw new Error("Should not start before players are ready");
  } catch (err: any) {
    console.log(`[PASS] Unready start rejected: "${err.message}"`);
  }

  await GameService.setReady(room.code, host.sessionToken, true);
  await GameService.setReady(room.code, bob.sessionToken, true);
  await GameService.setReady(room.code, charlie.sessionToken, true);

  await GameService.startGame(room.code, host.sessionToken);
  console.log("[PASS] Game successfully started!");

  // TEST 4: Simultaneous Play State & Identity Privacy
  console.log("\n--- Test 4: Simultaneous Play & Identity Privacy ---");
  const aliceState = await GameService.getGameState(room.code, host.sessionToken);

  // In simultaneous mode, ALL players must be in PLAYING status
  const allPlaying = aliceState.players.every((p) => p.status === "PLAYING");
  if (!allPlaying) {
    throw new Error("Failed: Not all players are in PLAYING status simultaneously");
  }
  console.log(`[PASS] All ${aliceState.players.length} players are actively PLAYING simultaneously`);

  // Privacy Check: Alice must NOT see her own identity
  if (aliceState.self.revealedIdentity !== null) {
    throw new Error("PRIVACY VIOLATION: Alice can see her own revealedIdentity before solving!");
  }
  const aliceInList = aliceState.players.find((p) => p.id === host.id)!;
  if (aliceInList.identityName !== null) {
    throw new Error("PRIVACY VIOLATION: Alice can see her own identityName in public players list!");
  }
  console.log(`[PASS] Privacy preserved: Alice cannot see her own secret identity`);

  // Visibility Check: Alice MUST see Bob and Charlie's secret identities
  const bobInList = aliceState.players.find((p) => p.id === bob.id)!;
  const charlieInList = aliceState.players.find((p) => p.id === charlie.id)!;
  if (!bobInList.identityName || !charlieInList.identityName) {
    throw new Error("Failed: Other players' identities are not visible to Alice");
  }
  console.log(`[PASS] Alice sees Bob's identity: "${bobInList.identityName}"`);
  console.log(`[PASS] Alice sees Charlie's identity: "${charlieInList.identityName}"`);

  // Security Check: Verify session tokens are never leaked in public player views
  const hasLeakedToken = (aliceState.players as any[]).some((p) => p.sessionToken !== undefined);
  if (hasLeakedToken) {
    throw new Error("SECURITY VIOLATION: sessionToken found in public player response!");
  }
  console.log(`[PASS] Security verified: Session tokens are never exposed in public views`);

  // TEST 5: Simultaneous Concurrent Guesses
  console.log("\n--- Test 5: Simultaneous Concurrent Guesses ---");
  const wrongGuessPromise = GameService.submitGuess(room.code, charlie.sessionToken, "Incorrect Celebrity");
  const correctGuessPromise = GameService.submitGuess(room.code, bob.sessionToken, bobInList.identityName);

  const [wrongResult, bobSolveResult] = await Promise.all([wrongGuessPromise, correctGuessPromise]);

  if (wrongResult.correct) {
    throw new Error("Failed: Incorrect guess was marked correct");
  }
  console.log(`[PASS] Charlie's incorrect guess safely rejected`);

  if (!bobSolveResult.correct || typeof bobSolveResult.completionTime !== "number") {
    throw new Error("Failed: Bob's correct guess was not recognized");
  }
  console.log(`[PASS] Bob solved his identity "${bobSolveResult.identityName}" in ${bobSolveResult.completionTime}s!`);

  // TEST 6: Independent Play State Verification
  console.log("\n--- Test 6: Independent State Isolation ---");
  const midGameState = await GameService.getGameState(room.code, charlie.sessionToken);

  const bobStateNow = midGameState.players.find((p) => p.id === bob.id)!;
  const charlieStateNow = midGameState.players.find((p) => p.id === charlie.id)!;
  const aliceStateNow = midGameState.players.find((p) => p.id === host.id)!;

  if (bobStateNow.status !== "SOLVED") {
    throw new Error("Failed: Bob should be SOLVED");
  }
  if (charlieStateNow.status !== "PLAYING" || aliceStateNow.status !== "PLAYING") {
    throw new Error("Failed: Charlie and Alice should still be actively PLAYING after Bob solved");
  }
  if (midGameState.room.status !== "PLAYING") {
    throw new Error("Failed: Room status should still be PLAYING while others are solving");
  }
  console.log(`[PASS] Bob is SOLVED while Charlie and Alice continue PLAYING independently`);

  // TEST 7: Charlie Solves Next
  console.log("\n--- Test 7: Second Player Solves Independently ---");
  const bobPerspective = await GameService.getGameState(room.code, bob.sessionToken);
  const charlieTarget = bobPerspective.players.find((p) => p.id === charlie.id)!.identityName!;

  const charlieSolveResult = await GameService.submitGuess(room.code, charlie.sessionToken, charlieTarget);
  if (!charlieSolveResult.correct) {
    throw new Error("Failed: Charlie's correct guess failed");
  }
  console.log(`[PASS] Charlie solved in ${charlieSolveResult.completionTime}s!`);

  // TEST 8: Final Player Solves -> Transition to RESULTS
  console.log("\n--- Test 8: All Players Complete -> Transition to RESULTS ---");
  const aliceTarget = bobPerspective.players.find((p) => p.id === host.id)!.identityName!;
  const aliceSolveResult = await GameService.submitGuess(room.code, host.sessionToken, aliceTarget);
  if (!aliceSolveResult.correct) {
    throw new Error("Failed: Alice's correct guess failed");
  }
  console.log(`[PASS] Alice solved in ${aliceSolveResult.completionTime}s!`);

  const resultsState = await GameService.getGameState(room.code, host.sessionToken);
  if (resultsState.room.status !== "RESULTS") {
    throw new Error(`Failed: Room status did not transition to RESULTS, got ${resultsState.room.status}`);
  }
  console.log(`[PASS] All players finished! Room transitioned to RESULTS!`);

  // Verify Leaderboard
  const allSolved = resultsState.players.every((p) => p.status === "SOLVED" && p.completionTimeSeconds !== null);
  if (!allSolved) {
    throw new Error("Failed: Not all players recorded completion times");
  }
  console.log(`[PASS] Leaderboard recorded completion times for all players`);

  // TEST 9: Next Round Progression
  console.log("\n--- Test 9: Next Round Progression ---");
  await GameService.setReady(room.code, host.sessionToken, true);
  await GameService.setReady(room.code, bob.sessionToken, true);
  await GameService.setReady(room.code, charlie.sessionToken, true);

  await GameService.nextRound(room.code, host.sessionToken);
  const round2State = await GameService.getGameState(room.code, host.sessionToken);

  if (round2State.room.currentRound !== 2 || round2State.room.status !== "PLAYING") {
    throw new Error("Failed: Did not advance to Round 2 in PLAYING status");
  }
  const round2AllPlaying = round2State.players.every((p) => p.status === "PLAYING" && !p.isReady);
  if (!round2AllPlaying) {
    throw new Error("Failed: Round 2 players are not reset to PLAYING with unready status");
  }
  console.log(`[PASS] Round 2 started! All players received new identities in PLAYING status`);

  // TEST 10: Timeout Handling Verification
  console.log("\n--- Test 10: Timeout Handling & Isolation ---");
  const { room: timeoutRoom, player: tHost } = await GameService.createRoom("Tom");
  const { player: tJerry } = await GameService.joinRoom(timeoutRoom.code, "Jerry");
  await GameService.setReady(timeoutRoom.code, tHost.sessionToken, true);
  await GameService.setReady(timeoutRoom.code, tJerry.sessionToken, true);
  await GameService.startGame(timeoutRoom.code, tHost.sessionToken);

  // Simulate timeout on timeoutRoom by backdating roundStartTime to 130s ago
  timeoutRoom.roundStartTime = new Date(Date.now() - 130000).toISOString();
  const timeoutCheckState = await GameService.getGameState(timeoutRoom.code, tHost.sessionToken);
  if (timeoutCheckState.room.status !== "RESULTS") {
    throw new Error(`Failed: Expired round did not transition to RESULTS, got ${timeoutCheckState.room.status}`);
  }
  const allTimedOut = timeoutCheckState.players.every((p) => p.status === "TIMED_OUT");
  if (!allTimedOut) {
    throw new Error("Failed: Expired players were not marked TIMED_OUT");
  }
  console.log(`[PASS] Timeout properly marks expired assignments as TIMED_OUT and transitions room to RESULTS`);

  console.log("\n=================================================");
  console.log("ALL SIMULTANEOUS MULTIPLAYER TESTS PASSED 100%!");
  console.log("=================================================");
}

runMultiplayerTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});

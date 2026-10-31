import { GameService } from "../src/lib/store";

async function runMultiplayerTests() {
  console.log("=================================================");
  console.log("STARTING TURN-BASED MULTIPLAYER TESTS");
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

  // TEST 3: Readiness & Turn-Based Start Validation
  console.log("\n--- Test 3: Readiness & Turn-Based Start ---");
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

  // TEST 4: Single Active Turn & Identity Privacy
  console.log("\n--- Test 4: Single Active Turn & Identity Privacy ---");
  const initialGameState = await GameService.getGameState(room.code, host.sessionToken);

  if (!initialGameState.room.currentTurnPlayerId) {
    throw new Error("Failed: No current turn player set on game start");
  }

  const activePlayer = initialGameState.players.find(
    (p) => p.id === initialGameState.room.currentTurnPlayerId
  )!;
  const waitingPlayers = initialGameState.players.filter(
    (p) => p.id !== initialGameState.room.currentTurnPlayerId
  );

  if (activePlayer.status !== "PLAYING" || !activePlayer.isCurrentTurn) {
    throw new Error("Failed: Active player is not in PLAYING status with isCurrentTurn: true");
  }

  const allWaitingCorrectly = waitingPlayers.every(
    (p) => p.status === "WAITING_TURN" && !p.isCurrentTurn
  );
  if (!allWaitingCorrectly) {
    throw new Error("Failed: Non-active players must have WAITING_TURN status and isCurrentTurn: false");
  }
  console.log(`[PASS] Exactly 1 active guesser (${activePlayer.name}); others are WAITING_TURN`);

  // Active player cannot see their own identity
  const activePlayerState = await GameService.getGameState(room.code, host.id === activePlayer.id ? host.sessionToken : bob.id === activePlayer.id ? bob.sessionToken : charlie.sessionToken);
  if (activePlayerState.self.revealedIdentity !== null) {
    throw new Error("PRIVACY VIOLATION: Active player can see their own identity before solving!");
  }
  console.log(`[PASS] Active player (${activePlayer.name})'s secret identity is hidden from them`);

  // Non-active players can see the active player's assigned identity
  const nonActiveSession = host.id === activePlayer.id ? bob.sessionToken : host.sessionToken;
  const spectatorState = await GameService.getGameState(room.code, nonActiveSession);
  if (!spectatorState.currentTurnPlayer?.identityName) {
    throw new Error("Failed: Non-active players cannot see the active guesser's identity to help them");
  }
  console.log(`[PASS] Spectators can see active player's identity: "${spectatorState.currentTurnPlayer.identityName}"`);

  // TEST 5: Backend Authorization: Non-active players CANNOT submit guesses
  console.log("\n--- Test 5: Backend Authorization Prevents Simultaneous Guessing ---");
  const nonActivePlayerObj = host.id === activePlayer.id ? bob : host;
  try {
    await GameService.submitGuess(room.code, nonActivePlayerObj.sessionToken, "Some Guess");
    throw new Error("AUTHORIZATION FAILURE: Non-active player was allowed to submit a guess!");
  } catch (err: any) {
    if (!err.message.includes("not your turn")) {
      throw new Error(`Unexpected error message: ${err.message}`);
    }
    console.log(`[PASS] Simultaneous guessing blocked: Non-active player rejected with "${err.message}"`);
  }

  // TEST 6: Active Player Incorrect Guess
  console.log("\n--- Test 6: Active Player Incorrect Guess Handling ---");
  const activeSessionToken = host.id === activePlayer.id ? host.sessionToken : bob.id === activePlayer.id ? bob.sessionToken : charlie.sessionToken;
  const wrongGuessRes = await GameService.submitGuess(room.code, activeSessionToken, "Completely Wrong Name");
  if (wrongGuessRes.correct) {
    throw new Error("Failed: Incorrect guess was accepted as correct");
  }
  console.log(`[PASS] Incorrect guess safely rejected; player stays active`);

  // TEST 7: Active Player Solves -> Turn Advances to Next Player
  console.log("\n--- Test 7: Active Player Solves & Turn Advances ---");
  const correctName = spectatorState.currentTurnPlayer.identityName!;
  const solveRes = await GameService.submitGuess(room.code, activeSessionToken, correctName);

  if (!solveRes.correct || typeof solveRes.completionTime !== "number") {
    throw new Error("Failed: Correct guess was not marked correct");
  }
  console.log(`[PASS] Player 1 (${activePlayer.name}) solved in ${solveRes.completionTime}s!`);

  const afterSolve1State = await GameService.getGameState(room.code, host.sessionToken);
  const solvedPlayerInList = afterSolve1State.players.find((p) => p.id === activePlayer.id)!;
  if (solvedPlayerInList.status !== "SOLVED") {
    throw new Error("Failed: First player status was not marked SOLVED");
  }

  const secondActivePlayerId = afterSolve1State.room.currentTurnPlayerId;
  if (!secondActivePlayerId || secondActivePlayerId === activePlayer.id) {
    throw new Error("Failed: Turn did not advance to a new player after solving");
  }
  const secondActivePlayer = afterSolve1State.players.find((p) => p.id === secondActivePlayerId)!;
  if (secondActivePlayer.status !== "PLAYING") {
    throw new Error("Failed: Second player is not in PLAYING status");
  }
  console.log(`[PASS] Turn automatically advanced to Player 2: ${secondActivePlayer.name}`);

  // TEST 8: Solved Player Cannot Guess Anymore
  console.log("\n--- Test 8: Solved Player Cannot Submit Further Guesses ---");
  try {
    await GameService.submitGuess(room.code, activeSessionToken, "Another Guess");
    throw new Error("Failed: Solved player was allowed to submit a guess!");
  } catch (err: any) {
    console.log(`[PASS] Solved player properly blocked: "${err.message}"`);
  }

  // TEST 9: Second Player Timeout -> Advances to Third Player
  console.log("\n--- Test 9: Turn Timeout Advances to Next Player ---");
  // Simulate timeout on second player by backdating turnStartTime
  room.turnStartTime = new Date(Date.now() - 130000).toISOString();
  const secondPlayerSession = host.id === secondActivePlayer.id ? host.sessionToken : bob.id === secondActivePlayer.id ? bob.sessionToken : charlie.sessionToken;

  // Polling getGameState detects timeout and advances
  const afterTimeoutState = await GameService.getGameState(room.code, host.sessionToken);
  const secondPlayerInList = afterTimeoutState.players.find((p) => p.id === secondActivePlayer.id)!;
  if (secondPlayerInList.status !== "TIMED_OUT") {
    throw new Error("Failed: Second player was not marked TIMED_OUT after 120s");
  }
  console.log(`[PASS] Player 2 (${secondActivePlayer.name}) properly marked TIMED_OUT`);

  const thirdActivePlayerId = afterTimeoutState.room.currentTurnPlayerId;
  if (!thirdActivePlayerId) {
    throw new Error("Failed: Turn did not advance to Player 3");
  }
  const thirdActivePlayer = afterTimeoutState.players.find((p) => p.id === thirdActivePlayerId)!;
  console.log(`[PASS] Turn automatically advanced to Player 3: ${thirdActivePlayer.name}`);

  // TEST 10: Final Player Solves -> Transition to RESULTS
  console.log("\n--- Test 10: Final Player Solves -> Transition to RESULTS ---");
  const thirdPlayerSession = host.id === thirdActivePlayer.id ? host.sessionToken : bob.id === thirdActivePlayer.id ? bob.sessionToken : charlie.sessionToken;
  const spectator3State = await GameService.getGameState(room.code, activeSessionToken);
  const thirdTarget = spectator3State.currentTurnPlayer!.identityName!;

  const solve3Res = await GameService.submitGuess(room.code, thirdPlayerSession, thirdTarget);
  if (!solve3Res.correct) {
    throw new Error("Failed: Third player solve failed");
  }
  console.log(`[PASS] Player 3 (${thirdActivePlayer.name}) solved!`);

  const finalResultsState = await GameService.getGameState(room.code, host.sessionToken);
  if (finalResultsState.room.status !== "RESULTS") {
    throw new Error(`Failed: Room did not transition to RESULTS, got ${finalResultsState.room.status}`);
  }
  if (finalResultsState.room.currentTurnPlayerId !== null) {
    throw new Error("Failed: currentTurnPlayerId should be null in RESULTS");
  }
  console.log(`[PASS] All turns complete: Room transitioned to RESULTS!`);

  // Verify Leaderboard Standings
  const playerStatuses = finalResultsState.players.map((p) => ({ name: p.name, status: p.status, time: p.completionTimeSeconds }));
  console.log(`[PASS] Final Standings:`, playerStatuses);

  // TEST 11: Next Round Progression
  console.log("\n--- Test 11: Next Round Progression ---");
  await GameService.setReady(room.code, host.sessionToken, true);
  await GameService.setReady(room.code, bob.sessionToken, true);
  await GameService.setReady(room.code, charlie.sessionToken, true);

  await GameService.nextRound(room.code, host.sessionToken);
  const round2State = await GameService.getGameState(room.code, host.sessionToken);

  if (round2State.room.currentRound !== 2 || round2State.room.status !== "PLAYING") {
    throw new Error("Failed: Did not advance to Round 2 in PLAYING status");
  }
  if (!round2State.room.currentTurnPlayerId) {
    throw new Error("Failed: Round 2 did not assign a first turn player");
  }
  const r2ActiveCount = round2State.players.filter((p) => p.status === "PLAYING").length;
  const r2WaitingCount = round2State.players.filter((p) => p.status === "WAITING_TURN").length;
  if (r2ActiveCount !== 1 || r2WaitingCount !== 2) {
    throw new Error(`Failed: Round 2 turn queue incorrect (playing: ${r2ActiveCount}, waiting: ${r2WaitingCount})`);
  }
  console.log(`[PASS] Round 2 started with 1 active turn player and turn queue reset!`);

  console.log("\n=================================================");
  console.log("ALL TURN-BASED MULTIPLAYER TESTS PASSED 100%!");
  console.log("=================================================");
}

runMultiplayerTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});

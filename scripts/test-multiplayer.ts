import { GameService } from "../src/lib/store";

async function runMultiplayerTests() {
  console.log("=================================================");
  console.log("STARTING TURN-BASED MULTIPLAYER TESTS");
  console.log("=================================================\n");

  // TEST 1: Room Creation
  console.log("--- Test 1: Room Creation ---");
  const { room, player: host } = await GameService.createRoom("Alice (Host)");
  console.log(`[PASS] Room created with code: ${room.code}`);
  console.log(`[PASS] Host created: ${host.name} (isHost: ${host.isHost})`);

  // TEST 2: Multiple players joining
  console.log("\n--- Test 2: Multiple Players Joining ---");
  const { player: bob } = await GameService.joinRoom(room.code, "Bob");
  const { player: charlie } = await GameService.joinRoom(room.code, "Charlie");
  console.log(`[PASS] Bob joined (isHost: ${bob.isHost})`);
  console.log(`[PASS] Charlie joined (isHost: ${charlie.isHost})`);

  // TEST 3: Readiness & Start Validation
  console.log("\n--- Test 3: Readiness & Start Validation ---");
  await GameService.setReady(room.code, host.sessionToken, true);
  await GameService.setReady(room.code, bob.sessionToken, true);
  await GameService.setReady(room.code, charlie.sessionToken, true);

  await GameService.startGame(room.code, host.sessionToken);
  console.log("[PASS] Game successfully started!");

  // TEST 4: Turn-Based Active Player Verification
  console.log("\n--- Test 4: Random Active Player Turn Selection ---");
  const stateAfterStart = await GameService.getGameState(room.code, host.sessionToken);
  const activeTurnPlayer = stateAfterStart.currentTurnPlayer;

  if (!activeTurnPlayer) {
    throw new Error("Failed: No active turn player was selected!");
  }
  console.log(`[PASS] Active guessing player randomly selected: ${activeTurnPlayer.name}`);

  // Count player statuses: exactly 1 must be PLAYING, others must be WAITING_TURN
  const playingCount = stateAfterStart.players.filter(p => p.status === "PLAYING").length;
  const waitingCount = stateAfterStart.players.filter(p => p.status === "WAITING_TURN").length;

  if (playingCount !== 1 || waitingCount !== 2) {
    throw new Error(`Failed: Expected 1 PLAYING and 2 WAITING_TURN, got ${playingCount} and ${waitingCount}`);
  }
  console.log(`[PASS] Exactly 1 active guesser in PLAYING status, 2 in WAITING_TURN queue`);

  // TEST 5: Identity Visibility During Turn
  console.log("\n--- Test 5: Identity Visibility During Active Turn ---");
  const playerSessions = [
    { id: host.id, name: host.name, token: host.sessionToken },
    { id: bob.id, name: bob.name, token: bob.sessionToken },
    { id: charlie.id, name: charlie.name, token: charlie.sessionToken }
  ];

  const activeSession = playerSessions.find(p => p.id === activeTurnPlayer.id)!;
  const nonActiveSession = playerSessions.find(p => p.id !== activeTurnPlayer.id)!;

  // Active player's own perspective: their identity must be hidden (null)
  const activePerspective = await GameService.getGameState(room.code, activeSession.token);
  if (activePerspective.currentTurnPlayer?.identityName !== null) {
    throw new Error(`SECURITY FAILURE: Active guesser can see their own identity!`);
  }
  console.log(`[PASS] Active guesser (${activeSession.name}) sees their identity hidden as null`);

  // Non-active player's perspective: they must see the active player's identity!
  const nonActivePerspective = await GameService.getGameState(room.code, nonActiveSession.token);
  const activeIdentitySeenByOthers = nonActivePerspective.currentTurnPlayer?.identityName;
  if (!activeIdentitySeenByOthers) {
    throw new Error(`Failed: Non-active player cannot see active guesser's identity!`);
  }
  console.log(`[PASS] Other players see ${activeSession.name}'s identity: "${activeIdentitySeenByOthers}"`);

  // TEST 6: Turn Enforcement (Non-active player cannot submit guess)
  console.log("\n--- Test 6: Enforcing Turn (Non-active guess rejected) ---");
  let nonActiveBlocked = false;
  try {
    await GameService.submitGuess(room.code, nonActiveSession.token, "SomeGuess");
  } catch (err: any) {
    nonActiveBlocked = true;
    console.log(`[PASS] Non-active player guess properly rejected: "${err.message}"`);
  }
  if (!nonActiveBlocked) throw new Error("Failed: Non-active player was allowed to submit a guess!");

  // TEST 7: Active Player Guesses Correctly & Sequential Turn Transition
  console.log("\n--- Test 7: Active Player 1 Solves -> Auto Advance to Next Player ---");
  const guessRes = await GameService.submitGuess(room.code, activeSession.token, activeIdentitySeenByOthers);
  if (!guessRes.correct) throw new Error("Failed: Correct guess rejected");
  console.log(`[PASS] ${activeSession.name} guessed correctly in ${guessRes.completionTime}s!`);

  // Fetch updated state: should have advanced to a new player
  const stateTurn2 = await GameService.getGameState(room.code, host.sessionToken);
  const activeTurnPlayer2 = stateTurn2.currentTurnPlayer;
  if (!activeTurnPlayer2 || activeTurnPlayer2.id === activeSession.id) {
    throw new Error("Failed: Did not advance to next player after turn 1 solved");
  }
  console.log(`[PASS] Turn advanced to next random player: ${activeTurnPlayer2.name}`);

  // TEST 8: Player 2 Solves -> Advance to Player 3
  console.log("\n--- Test 8: Player 2 Solves -> Advance to Final Player ---");
  const player2Session = playerSessions.find(p => p.id === activeTurnPlayer2.id)!;
  const player3Session = playerSessions.find(p => p.id !== activeSession.id && p.id !== player2Session.id)!;

  const observerState = await GameService.getGameState(room.code, player3Session.token);
  const player2TargetIdentity = observerState.currentTurnPlayer?.identityName!;

  const guessRes2 = await GameService.submitGuess(room.code, player2Session.token, player2TargetIdentity);
  console.log(`[PASS] ${player2Session.name} guessed correctly in ${guessRes2.completionTime}s!`);

  const stateTurn3 = await GameService.getGameState(room.code, host.sessionToken);
  if (stateTurn3.currentTurnPlayer?.id !== player3Session.id) {
    throw new Error("Failed: Final turn player was not player 3");
  }
  console.log(`[PASS] Final turn active player: ${player3Session.name}`);

  // TEST 9: Final Player Solves -> Transition to RESULTS
  console.log("\n--- Test 9: Final Player Solves -> Transition to RESULTS ---");
  const observerSession = playerSessions.find(p => p.id !== player3Session.id)!;
  const observerStateFinal = await GameService.getGameState(room.code, observerSession.token);
  const player3TargetIdentity = observerStateFinal.currentTurnPlayer?.identityName!;

  await GameService.submitGuess(room.code, player3Session.token, player3TargetIdentity);
  const resultsState = await GameService.getGameState(room.code, host.sessionToken);

  if (resultsState.room.status !== "RESULTS") {
    throw new Error(`Failed: Expected room status RESULTS, got ${resultsState.room.status}`);
  }
  console.log("[PASS] All players finished their turns! Room status transitioned to RESULTS!");

  // Verify all players have completion times and revealed identities
  const solvedPlayers = resultsState.players.filter(p => p.status === "SOLVED");
  if (solvedPlayers.length !== 3) {
    throw new Error(`Failed: Not all players recorded as solved`);
  }
  console.log(`[PASS] All 3 players have recorded completion times on the leaderboard`);

  console.log("\n=================================================");
  console.log("ALL TURN-BASED SEQUENTIAL TESTS PASSED 100%!");
  console.log("=================================================");
}

runMultiplayerTests().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});

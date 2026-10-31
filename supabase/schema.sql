-- ==============================================================================
-- WHO AM I? - MULTIPLAYER PARTY GAME DATABASE SCHEMA
-- Compatible with Supabase PostgreSQL & Supabase Realtime
-- ==============================================================================

-- 1. ROOMS TABLE
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) UNIQUE NOT NULL,
  host_player_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'PLAYING', 'RESULTS')),
  current_round INT NOT NULL DEFAULT 1,
  round_start_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms (code);

-- 2. PLAYERS TABLE
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  is_ready BOOLEAN NOT NULL DEFAULT false,
  is_host BOOLEAN NOT NULL DEFAULT false,
  session_token UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_room_player_name UNIQUE (room_id, name)
);

CREATE INDEX IF NOT EXISTS idx_players_room_id ON players (room_id);
CREATE INDEX IF NOT EXISTS idx_players_session_token ON players (session_token);

-- 3. ROUND ASSIGNMENTS TABLE
CREATE TABLE IF NOT EXISTS round_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  identity_id VARCHAR(100) NOT NULL,
  identity_name VARCHAR(100) NOT NULL,
  identity_category VARCHAR(50) NOT NULL,
  identity_tag VARCHAR(100) NOT NULL,
  identity_aliases TEXT[] DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'PLAYING' CHECK (status IN ('PLAYING', 'SOLVED', 'TIMED_OUT')),
  solved_at TIMESTAMPTZ,
  completion_time_seconds NUMERIC(6, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_round_player UNIQUE (room_id, round_number, player_id)
);

CREATE INDEX IF NOT EXISTS idx_round_assignments_room_round ON round_assignments (room_id, round_number);
CREATE INDEX IF NOT EXISTS idx_round_assignments_player ON round_assignments (player_id);

-- 4. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE round_assignments ENABLE ROW LEVEL SECURITY;

-- Rooms can be read by code for client-side state listeners
DROP POLICY IF EXISTS "Public read rooms" ON rooms;
CREATE POLICY "Public read rooms" ON rooms FOR SELECT USING (true);

-- Never expose players (session tokens) or round_assignments (secret identities) publicly.
-- All gameplay and identity visibility is securely arbitrated server-side.
DROP POLICY IF EXISTS "Public read players" ON players;
DROP POLICY IF EXISTS "Public read round_assignments" ON round_assignments;

DROP POLICY IF EXISTS "Service role full access rooms" ON rooms;
CREATE POLICY "Service role full access rooms" ON rooms 
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access players" ON players;
CREATE POLICY "Service role full access players" ON players 
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access round_assignments" ON round_assignments;
CREATE POLICY "Service role full access round_assignments" ON round_assignments 
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5. ATOMIC ROOM AND HOST CREATION FUNCTION
CREATE OR REPLACE FUNCTION create_room_and_host(
  p_code VARCHAR(6),
  p_room_id UUID,
  p_host_player_id UUID,
  p_host_name VARCHAR(50),
  p_session_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_room rooms%ROWTYPE;
  v_player players%ROWTYPE;
BEGIN
  INSERT INTO rooms (id, code, host_player_id, status, current_round, created_at, updated_at)
  VALUES (p_room_id, p_code, p_host_player_id, 'LOBBY', 1, v_now, v_now)
  RETURNING * INTO v_room;

  INSERT INTO players (id, room_id, name, is_ready, is_host, session_token, created_at, last_seen_at)
  VALUES (p_host_player_id, p_room_id, p_host_name, false, true, p_session_token, v_now, v_now)
  RETURNING * INTO v_player;

  RETURN jsonb_build_object(
    'room', to_jsonb(v_room),
    'player', to_jsonb(v_player)
  );
END;
$$;

-- Hardening: Revoke execution from PUBLIC, anon, and authenticated roles.
-- Only the server (service_role) is authorized to execute this RPC.
REVOKE ALL ON FUNCTION create_room_and_host(VARCHAR(6), UUID, UUID, VARCHAR(50), UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_room_and_host(VARCHAR(6), UUID, UUID, VARCHAR(50), UUID) FROM anon;
REVOKE ALL ON FUNCTION create_room_and_host(VARCHAR(6), UUID, UUID, VARCHAR(50), UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_room_and_host(VARCHAR(6), UUID, UUID, VARCHAR(50), UUID) TO service_role;

-- 6. ENABLE SUPABASE REALTIME PUBLICATION
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  END IF;
END $$;

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
  current_turn_player_id UUID,
  turn_start_time TIMESTAMPTZ,
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
  status VARCHAR(20) NOT NULL DEFAULT 'WAITING_TURN' CHECK (status IN ('WAITING_TURN', 'PLAYING', 'SOLVED', 'TIMED_OUT')),
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

CREATE POLICY "Public read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Public read players" ON players FOR SELECT USING (true);
CREATE POLICY "Public read round_assignments" ON round_assignments FOR SELECT USING (true);

CREATE POLICY "Service role full access rooms" ON rooms USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access players" ON players USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access round_assignments" ON round_assignments USING (auth.role() = 'service_role');

-- 5. ENABLE SUPABASE REALTIME PUBLICATION
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE players;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'round_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE round_assignments;
  END IF;
END $$;

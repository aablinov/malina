/**
 * SQLite migrations: number = index + 1, applied ones are remembered by `PRAGMA user_version`.
 * New schema goes only as a new string at the end, old ones are never edited. Time is Unix milliseconds everywhere.
 */
export const MIGRATIONS: string[] = [
  // 001_init
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- lower-case name: NOCASE in SQLite only understands Latin letters
    name_key TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE profiles (
    player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    host_id TEXT NOT NULL REFERENCES players(id),
    map TEXT NOT NULL,
    max INTEGER NOT NULL,
    private INTEGER NOT NULL,
    state TEXT NOT NULL,
    seed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX rooms_state ON rooms(state, private);
  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id),
    seat INTEGER NOT NULL,
    ready INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    gone_at INTEGER,
    PRIMARY KEY (room_id, player_id)
  );
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    map TEXT NOT NULL,
    players INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    result TEXT,
    wave INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX matches_ended ON matches(ended_at);
  CREATE INDEX matches_map ON matches(map, result);
  CREATE TABLE match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id),
    seat INTEGER NOT NULL,
    berries INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, player_id)
  );
  CREATE INDEX match_players_player ON match_players(player_id);
  `,
  // 002_loot: the player's battle reward (battle.loot) has been credited — not accepted a second time
  `
  ALTER TABLE match_players ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
  `,
  // 003_friends: friends — an "added by name" list, one-directional
  `
  CREATE TABLE friends (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, friend_id)
  );
  `,
];

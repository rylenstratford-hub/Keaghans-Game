window.IslandFoundry = (() => {
  const SAVE_KEY_BASE = "keaghans-game-save-v1";
  const SLOT_COUNT = 5;
  const COLS = 10;
  const ROWS = 10;
  /** Indoor base map — same size as the island, split into rooms. */
  const INTERIOR_COLS = 10;
  const INTERIOR_ROWS = 10;
  /** Bump when starter resource layout / terrain heightmap changes. */
  const WORLD_LAYOUT_VERSION = 5;
  /** Outdoor hills: 0 = flat, each step rises upward only. */
  const TILE_HEIGHT_MAX = 2;
  const { GameData } = window;

  function saveKeyFor(profileId, slot) {
    const n = Number(slot);
    if (!profileId || !Number.isInteger(n) || n < 1 || n > SLOT_COUNT) {
      return SAVE_KEY_BASE;
    }
    return `${SAVE_KEY_BASE}:${profileId}:slot${n}`;
  }

  function legacySaveKey(profileId) {
    return profileId ? `${SAVE_KEY_BASE}:${profileId}` : SAVE_KEY_BASE;
  }

  function migrateLegacySave(profileId) {
    if (!profileId) return;
    const legacy = localStorage.getItem(legacySaveKey(profileId));
    const slot1Key = saveKeyFor(profileId, 1);
    if (legacy && !localStorage.getItem(slot1Key)) {
      localStorage.setItem(slot1Key, legacy);
      localStorage.removeItem(legacySaveKey(profileId));
    }
  }

  function saveKey() {
    const id = window.KeaghanProfiles?.getActiveId?.();
    const slot = window.KeaghanProfiles?.getActiveSlot?.() ?? 1;
    if (id) migrateLegacySave(id);
    return saveKeyFor(id, slot);
  }

  function summarizeSave(raw) {
    try {
      const saved = JSON.parse(raw);
      const gathered = saved.stats?.gathered || {};
      const totalGathered = Object.values(gathered).reduce((sum, n) => sum + (Number(n) || 0), 0);
      const startedAt = saved.startedAt || null;
      return {
        empty: false,
        startedAt,
        totalGathered,
        drilled: saved.stats?.drilled || 0,
        tool: saved.activeTool || "hand",
      };
    } catch {
      return { empty: true };
    }
  }

  function getSlotMeta(profileId, slot) {
    if (!profileId) return { empty: true, slot };
    migrateLegacySave(profileId);
    const raw = localStorage.getItem(saveKeyFor(profileId, slot));
    if (!raw) return { empty: true, slot };
    return { ...summarizeSave(raw), slot };
  }

  function clearSlot(profileId, slot) {
    if (!profileId) return;
    localStorage.removeItem(saveKeyFor(profileId, slot));
  }

  /** Wipe progress but keep a fresh save in the slot (select-save screen). */
  function resetSlot(profileId, slot) {
    if (!profileId) return;
    const fresh = createState();
    ensureBag(fresh);
    localStorage.setItem(saveKeyFor(profileId, slot), JSON.stringify(fresh));
  }

  function clearAllSlots(profileId) {
    if (!profileId) return;
    localStorage.removeItem(legacySaveKey(profileId));
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      clearSlot(profileId, slot);
    }
  }

  function emptyInv() {
    const inv = {};
    for (const id of Object.keys(GameData.items)) inv[id] = 0;
    return inv;
  }

  const BAG_SIZE = 27;

  function emptyBag() {
    return Array.from({ length: BAG_SIZE }, () => null);
  }

  function normalizeBag(bag) {
    const next = Array.isArray(bag) ? [...bag] : [];
    while (next.length < BAG_SIZE) next.push(null);
    return next.slice(0, BAG_SIZE).map((s) => {
      if (!s || !s.id || s.count <= 0) return null;
      // Legacy free Water stacks → Water Buckets (now need Iron Buckets to scoop).
      const id = s.id === "water" ? "waterBucket" : s.id;
      if (!GameData.items[id]) return null;
      return { id, count: s.count };
    });
  }

  function rebuildInventoryFromBag(state) {
    const inv = emptyInv();
    for (const stack of state.bag || []) {
      if (!stack) continue;
      inv[stack.id] = (inv[stack.id] || 0) + stack.count;
    }
    state.inventory = inv;
  }

  /** Fill bag from a flat inventory map (save migration). */
  function bagFromInventoryMap(inventory) {
    const bag = emptyBag();
    let slot = 0;
    for (const [id, n] of Object.entries(inventory || {})) {
      if (!n || n < 1) continue;
      if (slot >= BAG_SIZE) {
        // Overflow merges into an existing stack of the same id.
        const existing = bag.find((s) => s && s.id === id);
        if (existing) existing.count += n;
        continue;
      }
      bag[slot] = { id, count: n };
      slot += 1;
    }
    return bag;
  }

  function ensureBag(state) {
    if (!state) return;
    if (!Array.isArray(state.bag)) {
      state.bag = bagFromInventoryMap(state.inventory);
    }
    state.bag = normalizeBag(state.bag);

    // Migrate legacy "wood" → "log".
    for (let i = 0; i < state.bag.length; i++) {
      const stack = state.bag[i];
      if (stack?.id === "wood") stack.id = "log";
    }
    if (state.inventory?.wood) {
      state.inventory.log = (state.inventory.log || 0) + state.inventory.wood;
      delete state.inventory.wood;
    }
    if (state.stats?.gathered?.wood) {
      state.stats.gathered.log = (state.stats.gathered.log || 0) + state.stats.gathered.wood;
      delete state.stats.gathered.wood;
    }
    for (const m of state.machines || []) {
      if (m.type === "smelter" && m.fuelId === "wood") m.fuelId = "log";
      if (Array.isArray(m.craftGrid)) {
        for (const cell of m.craftGrid) {
          if (cell?.id === "wood") cell.id = "log";
        }
      }
      if (Array.isArray(m.input)) {
        for (const cell of m.input) {
          if (cell?.id === "wood") cell.id = "log";
        }
      }
    }
    for (let i = 0; i < (playerCraftGrid?.length || 0); i++) {
      if (playerCraftGrid[i]?.id === "wood") playerCraftGrid[i].id = "log";
    }

    rebuildInventoryFromBag(state);
  }

  /**
   * Soft outdoor hills (0–2). Higher tiles only rise upward (top-down cam
   * with a little of the back face) so steps stay smooth.
   */
  function heightForIsland(x, y) {
    let h = 0;
    // NW tree hill — peak + one-step ring (smoother slope)
    if (x <= 2 && y <= 2) h = Math.max(h, x + y <= 1 ? 2 : 1);
    // East iron rise
    if (x >= 8 && y >= 2 && y <= 4) h = Math.max(h, x >= 9 && y === 3 ? 2 : 1);
    // Small SW mound by carrots — keep the south edge flat so lifted
    // tiles don't leave an empty dark strip above the ADA panel.
    if (x <= 1 && y === 8) h = Math.max(h, 1);
    // Spawn pocket stays flat
    if (x >= 4 && x <= 6 && y >= 4 && y <= 6) h = 0;
    return Math.min(TILE_HEIGHT_MAX, Math.max(0, h));
  }

  function makeWorld() {
    const tiles = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        tiles.push({
          x,
          y,
          height: heightForIsland(x, y),
          kind: "grass",
          node: null,
          machine: null,
          hp: 0,
          maxHp: 0,
        });
      }
    }

    const place = (x, y, nodeType) => {
      const t = tiles[y * COLS + x];
      const def = GameData.nodeTypes[nodeType];
      t.kind = "node";
      t.node = nodeType;
      t.hp = def.hp;
      t.maxHp = def.hp;
    };

    // Scrambled 10×10 starter resources — clusters around the island.
    // Trees (NW grove + a few strays)
    place(0, 1, "tree");
    place(1, 0, "tree");
    place(1, 2, "tree");
    place(2, 1, "tree");
    place(3, 0, "tree");
    place(0, 3, "tree");
    place(4, 2, "tree");
    // Rocks (west / center)
    place(1, 4, "rock");
    place(2, 5, "rock");
    place(0, 6, "rock");
    place(3, 4, "rock");
    place(2, 7, "rock");
    // Coal (north-east)
    place(6, 0, "coal");
    place(7, 1, "coal");
    place(8, 0, "coal");
    place(5, 1, "coal");
    // Iron (east)
    place(8, 3, "iron");
    place(9, 2, "iron");
    place(9, 4, "iron");
    place(7, 4, "iron");
    // Copper (south / south-east) — easy to spot from the bottom of the map
    place(5, 8, "copper");
    place(6, 7, "copper");
    place(7, 8, "copper");
    place(8, 9, "copper");
    place(4, 9, "copper");
    // Carrot patches (south-west grass)
    place(0, 8, "carrot");
    place(1, 9, "carrot");
    place(2, 8, "carrot");
    place(3, 9, "carrot");

    return tiles;
  }

  function tileHeight(tile) {
    if (!tile) return 0;
    const h = Math.floor(Number(tile.height) || 0);
    return Math.min(TILE_HEIGHT_MAX, Math.max(0, h));
  }

  /**
   * Visible dirt under a raised top: each height block is one rise step.
   * Land to the south (lower on screen) covers the lower steps of a taller
   * face — e.g. height 2 with height-1 south shows only one step of dirt.
   * No south neighbor (map edge) → no hanging face (avoids stubs off the grid).
   */
  function tileBackFaceHeight(gameState, tile) {
    const h = tileHeight(tile);
    if (h <= 0 || !gameState) return 0;
    const south = getTile(gameState, tile.x, tile.y + 1);
    if (!south) return 0;
    const cover = tileHeight(south);
    return Math.max(0, h - cover);
  }

  /** Older saves: sprinkle carrot plants on empty grass once. */
  function ensureFoodNodes(gameState) {
    if (!gameState?.tiles?.length) return;
    if (gameState.tiles.some((t) => t.node === "carrot")) return;
    const def = GameData.nodeTypes.carrot;
    if (!def) return;
    const empties = gameState.tiles.filter((t) => !t.node && !t.machine);
    const spots = [
      [0, 8],
      [1, 9],
      [2, 8],
      [3, 9],
    ];
    for (const [x, y] of spots) {
      const tile = gameState.tiles[y * COLS + x];
      if (!tile || tile.node || tile.machine) continue;
      tile.kind = "node";
      tile.node = "carrot";
      tile.hp = def.hp;
      tile.maxHp = def.hp;
    }
    // Fallback if preferred spots were occupied.
    if (!gameState.tiles.some((t) => t.node === "carrot") && empties.length) {
      for (let i = 0; i < Math.min(4, empties.length); i++) {
        const tile = empties[i];
        tile.kind = "node";
        tile.node = "carrot";
        tile.hp = def.hp;
        tile.maxHp = def.hp;
      }
    }
  }

  /** Rebuild the island layout while keeping any placed buildings. */
  function rebuildWorldKeepingMachines(machines) {
    const tiles = makeWorld();
    for (const m of machines || []) {
      if (!m || m.x < 0 || m.y < 0 || m.x >= COLS || m.y >= ROWS) continue;
      const tile = tiles[m.y * COLS + m.x];
      tile.machine = m.type === "powerStation" ? "craftingStation" : m.type;
      if (!tile.node) tile.kind = "machine";
      if (m.type === "drill") {
        m.resource = tile.node ? GameData.nodeTypes[tile.node].resource : null;
      }
    }
    return tiles;
  }

  /** Keep saves on the current 10×10 grid after map-size / layout changes. */
  function normalizeWorldTiles(savedTiles, machines, layoutVersion) {
    if (!Array.isArray(savedTiles) || savedTiles.length !== COLS * ROWS) {
      return rebuildWorldKeepingMachines(machines);
    }
    if (layoutVersion !== WORLD_LAYOUT_VERSION) {
      return rebuildWorldKeepingMachines(machines);
    }

    return savedTiles.map((t, i) => {
      const baseX = i % COLS;
      const baseY = Math.floor(i / COLS);
      const next =
        t?.machine === "powerStation" ? { ...t, machine: "craftingStation" } : t;
      const height = Number.isFinite(next?.height)
        ? Math.min(TILE_HEIGHT_MAX, Math.max(0, Math.floor(next.height)))
        : heightForIsland(baseX, baseY);
      return {
        x: baseX,
        y: baseY,
        height,
        kind: next?.kind || "grass",
        node: next?.node ?? null,
        machine: next?.machine ?? null,
        hp: Number.isFinite(next?.hp) ? next.hp : 0,
        maxHp: Number.isFinite(next?.maxHp) ? next.maxHp : 0,
        respawn: next?.respawn ?? null,
      };
    });
  }

  function createState() {
    return {
      inventory: emptyInv(),
      bag: emptyBag(),
      unlockedTools: ["hand"],
      activeTool: "hand",
      buildMode: null, // null | drill | smelter | generator | powerPole | cable | craftingStation | demolish
      tiles: makeWorld(),
      machines: [],
      stats: { gathered: {}, smelted: {}, crafted: {}, drilled: 0, poweredDrill: 0, manualSmelted: 0 },
      goalsDone: {},
      eggsDone: {},
      toast: "",
      toastUntil: 0,
      startedAt: Date.now(),
      worldLayoutVersion: WORLD_LAYOUT_VERSION,
      // Minutes past midnight (0 = 12:00 a.m.). New games start at 6:00 a.m.
      worldMinutes: 6 * 60,
      // kind: null | "rain" | "thunder"; rolls on :00 / :30.
      // thunderLocked: after thunder → rain, rain cannot become thunder again.
      weather: { kind: null, minutesLeft: 0, thunderLocked: false },
      hunger: GameData.hunger?.max ?? 10000,
      hungerWarned: false,
      health: GameData.health?.max ?? 10000,
      healthWarned: false,
      lastActionTile: null, // { x, y } — death crate prefers this spot
      // Avatar on the island — moved with WASD.
      player: defaultPlayerPos(),
      // Night-only threats — spawn 6:00 p.m., clear 6:00 a.m.
      monsters: [],
      // Indoor base map — when true, #world-grid shows interiorTiles.
      insideBase: false,
      outdoorPlayer: null, // { x, y } stashed while indoors
      interiorTiles: null,
      // Per-door lock flags: { "x,y": true|false }. true = locked.
      baseDoorLocks: {},
      // Base Key hangs on the south-hall hook when true.
      baseKeyOnHook: true,
      // Indoor workroom 3×3 craft grid (same recipes as a Crafting Table).
      workroomCraft: { type: "craftingStation", craftGrid: Array(9).fill(null) },
      // Indoor kitchen pantry — food only (15×50).
      kitchenStorage: Array.from({ length: 15 }, () => null),
      // Indoor storage room — non-food, not Base Key (15×50).
      storageChest: Array.from({ length: 15 }, () => null),
      // ADA helper lines already heard this save: { lineId: true }
      adaHeard: {},
      adaLine: null,
      // Personal Ice cool-down remaining (in-game minutes).
      playerCoolMinutesLeft: 0,
    };
  }

  function defaultPlayerPos() {
    return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
  }

  function interiorSpawnPos() {
    // Just inside the east doors, in the hallway.
    return { x: 7, y: 4 };
  }

  function activeMapSize(gameState) {
    if (gameState?.insideBase) {
      return { cols: INTERIOR_COLS, rows: INTERIOR_ROWS };
    }
    return { cols: COLS, rows: ROWS };
  }

  function isInsideBase(gameState) {
    return Boolean(gameState?.insideBase);
  }

  const INTERIOR_ROOM_LABELS = {
    hall: "Hallway",
    upgrade: "Upgrade Room",
    kitchen: "Kitchen",
    living: "Living Room",
    storage: "Storage",
    bedroom: "Bedroom",
    workroom: "Workroom",
  };

  /**
   * 10×10 indoor base:
   *   NW Kitchen · N Upgrade · NE Living
   *   W Workroom · SW Storage · SE Bedroom · rest Hall · doors on the east wall
   */
  function hasBaseKey(gameState) {
    if (!gameState) return false;
    if ((gameState.inventory?.baseKey || 0) >= 1) return true;
    return Boolean(
      gameState.bag?.some((stack) => stack?.id === "baseKey" && stack.count > 0)
    );
  }

  function makeInteriorWorld(tier) {
    const t = Math.max(1, Math.min(3, Math.floor(Number(tier) || 1)));
    const wall = () => ({
      kind: "wall",
      room: null,
      feature: null,
      icon: null,
      label: "Wall",
    });
    const cells = Array.from({ length: INTERIOR_ROWS }, () =>
      Array.from({ length: INTERIOR_COLS }, wall)
    );

    function paint(x0, y0, x1, y1, room) {
      const label = INTERIOR_ROOM_LABELS[room] || "Floor";
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          cells[y][x] = {
            kind: "floor",
            room,
            feature: null,
            icon: null,
            label,
          };
        }
      }
    }

    function set(x, y, patch) {
      cells[y][x] = { ...cells[y][x], ...patch };
    }

    // 1) Hall fills the indoor area, then rooms overwrite.
    paint(1, 1, 8, 8, "hall");

    // 2) Rooms (north/south mirrored: 2-tile deep rooms + 3-tile front walls)
    paint(1, 1, 2, 2, "kitchen"); // NW
    paint(4, 1, 5, 2, "upgrade"); // North
    paint(7, 1, 8, 2, "living"); // NE
    paint(1, 4, 2, 5, "workroom"); // West (between kitchen & storage)
    paint(1, 7, 2, 8, "storage"); // SW
    paint(7, 7, 8, 8, "bedroom"); // SE

    // 3) Divider walls between rooms
    for (const y of [1, 2]) {
      set(3, y, wall());
      set(6, y, wall());
    }
    for (const y of [7, 8]) {
      set(3, y, wall());
      set(6, y, wall());
    }
    // Workroom east wall (1-tile door into the hall)
    set(3, 4, wall());
    set(3, 5, wall());
    // North front walls (kitchen / living); center stays open hall into Upgrade
    set(1, 3, wall());
    set(2, 3, wall());
    set(3, 3, wall());
    set(6, 3, wall());
    set(7, 3, wall());
    set(8, 3, wall());
    // South front walls (storage SW + bedroom SE); center hall stays open at x=4,5
    set(1, 6, wall());
    set(2, 6, wall());
    set(3, 6, wall());
    set(6, 6, wall());
    set(7, 6, wall());
    set(8, 6, wall());
    // Only the 1-tile gaps get locked doors (need Base Key).
    // The east 2-tile front doors are kind "exit" and stay unlocked.
    function roomDoor(x, y, into) {
      set(x, y, {
        kind: "door",
        room: "hall",
        feature: "door",
        icon: "🚪",
        needsKey: true,
        locked: true,
        into,
        label: `Locked door — ${into} (Base Key toggles lock)`,
      });
    }
    roomDoor(3, 2, "Kitchen / Upgrade");
    roomDoor(6, 2, "Upgrade / Living Room");
    roomDoor(3, 4, "Workroom");
    roomDoor(3, 7, "Storage");
    roomDoor(6, 7, "Bedroom");

    // 4) Outer walls
    for (let x = 0; x < INTERIOR_COLS; x++) {
      set(x, 0, wall());
      set(x, 9, wall());
    }
    for (let y = 0; y < INTERIOR_ROWS; y++) {
      set(0, y, wall());
      set(9, y, wall());
    }

    // 5) East doors
    set(9, 4, {
      kind: "exit",
      room: "hall",
      feature: "exit",
      icon: "🚪",
      label: "Front door — leave the base",
    });
    set(9, 5, {
      kind: "exit",
      room: "hall",
      feature: "exit",
      icon: "🚪",
      label: "Front door — leave the base",
    });

    // 6) Upgrade bench
    set(4, 2, {
      kind: "upgrade",
      room: "upgrade",
      feature: "upgrade",
      icon: "⬆",
      label: "Upgrade bench",
    });

    // 7) Props
    const props = [
      [1, 1, "🍳", "Stove"],
      [2, 2, "🧊", "Fridge — food storage"],
      [1, 2, "🔪", "Counter"],
      [7, 1, "🛋", "Sofa"],
      [8, 2, "🪑", "Chair"],
      [8, 1, "🪴", "Plant"],
      [7, 2, "📺", "TV — click living room to watch"],
      [1, 4, "🔧", "Workbench"],
      [2, 4, "🪚", "Sawhorse"],
      [1, 5, "🧰", "Tool chest"],
      [1, 7, "📦", "Crate — item storage"],
      [2, 8, "📦", "Crate — item storage"],
      [1, 8, "📦", "Crate — item storage"],
      [7, 7, "🛏", "Bed"],
      [8, 7, "🧸", "Nightstand"],
      [8, 8, "🪟", "Window"],
      [4, 4, "🕯", "Hall lamp"],
      [5, 5, "🕯", "Hall lamp"],
    ];
    for (const [x, y, icon, label] of props) {
      const cell = cells[y][x];
      if (
        cell.kind === "wall" ||
        cell.kind === "exit" ||
        cell.kind === "door" ||
        cell.feature === "upgrade" ||
        cell.feature === "keyHook"
      ) {
        continue;
      }
      const room = cell.room || "hall";
      set(x, y, {
        kind: "floor",
        room,
        feature: "prop",
        icon,
        label: `${INTERIOR_ROOM_LABELS[room] || "Room"} — ${label}`,
      });
    }

    // Key hook in the south hall — blocks walking; stand next to it and click
    set(5, 8, {
      kind: "keyHook",
      room: "hall",
      feature: "keyHook",
      icon: "🔑",
      label: "Key hook — click to take the Base Key",
    });

    const tiles = [];
    for (let y = 0; y < INTERIOR_ROWS; y++) {
      for (let x = 0; x < INTERIOR_COLS; x++) {
        const cell = cells[y][x];
        tiles.push({
          x,
          y,
          kind: cell.kind,
          room: cell.room,
          feature: cell.feature,
          icon: cell.icon,
          label: cell.label,
          needsKey: cell.needsKey,
          locked: cell.locked,
          into: cell.into,
          node: null,
          machine: null,
          hp: 0,
          maxHp: 0,
          tier: t,
        });
      }
    }
    return tiles;
  }

  function getActiveTile(gameState, x, y) {
    if (!gameState) return null;
    if (isInsideBase(gameState)) {
      if (x < 0 || y < 0 || x >= INTERIOR_COLS || y >= INTERIOR_ROWS) return null;
      return gameState.interiorTiles?.[y * INTERIOR_COLS + x] || null;
    }
    return getTile(gameState, x, y);
  }

  function doorNeedsKey(tile) {
    // 1-tile room doors use the Base Key; front exits do not.
    return Boolean(tile && tile.kind === "door" && tile.needsKey !== false);
  }

  function doorLockKey(tile) {
    return `${tile.x},${tile.y}`;
  }

  function normalizeBaseDoorLocks(gameState) {
    if (!gameState) return;
    if (!gameState.baseDoorLocks || typeof gameState.baseDoorLocks !== "object") {
      gameState.baseDoorLocks = {};
    }
  }

  function isDoorLocked(tile) {
    if (!doorNeedsKey(tile)) return false;
    return tile.locked !== false;
  }

  function refreshDoorLabel(tile) {
    if (!doorNeedsKey(tile)) return;
    const into = tile.into || "Room";
    tile.label = isDoorLocked(tile)
      ? `Locked door — ${into} (Base Key toggles lock)`
      : `Unlocked door — ${into} (Base Key toggles lock)`;
  }

  function applyDoorLockState(gameState) {
    if (!gameState?.interiorTiles) return;
    normalizeBaseDoorLocks(gameState);
    for (const tile of gameState.interiorTiles) {
      if (!doorNeedsKey(tile)) continue;
      const key = doorLockKey(tile);
      if (Object.prototype.hasOwnProperty.call(gameState.baseDoorLocks, key)) {
        tile.locked = Boolean(gameState.baseDoorLocks[key]);
      } else {
        tile.locked = true;
      }
      refreshDoorLabel(tile);
    }
  }

  /** If standing on a door that just locked, step onto a neighboring walkable tile. */
  function shovePlayerOffDoor(gameState, doorTile) {
    if (!gameState || !doorTile) return false;
    normalizePlayer(gameState);
    if (gameState.player.x !== doorTile.x || gameState.player.y !== doorTile.y) {
      return false;
    }
    const { cols, rows } = activeMapSize(gameState);
    const neighbors = [
      [doorTile.x + 1, doorTile.y],
      [doorTile.x - 1, doorTile.y],
      [doorTile.x, doorTile.y + 1],
      [doorTile.x, doorTile.y - 1],
    ];
    for (const [x, y] of neighbors) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const next = getActiveTile(gameState, x, y);
      if (!isWalkableTile(next, gameState)) continue;
      gameState.player = { x, y };
      return true;
    }
    ensurePlayerOnWalkable(gameState);
    return (
      gameState.player.x !== doorTile.x || gameState.player.y !== doorTile.y
    );
  }

  /** Click a room door while holding the Base Key to lock/unlock it. */
  function tryToggleDoorWithKey(gameState, tile) {
    if (!gameState || !doorNeedsKey(tile)) return false;
    if (!hasBaseKey(gameState)) {
      setToast(
        gameState,
        isDoorLocked(tile)
          ? "Locked — pick up the Base Key on the south side of the hall"
          : "Door is unlocked — walk through (need Base Key to lock it)"
      );
      return false;
    }
    normalizeBaseDoorLocks(gameState);
    tile.locked = !isDoorLocked(tile);
    gameState.baseDoorLocks[doorLockKey(tile)] = tile.locked;
    refreshDoorLabel(tile);
    if (tile.locked) {
      const shoved = shovePlayerOffDoor(gameState, tile);
      setToast(gameState, shoved ? "Door locked — stepped clear" : "Door locked");
    } else {
      setToast(gameState, "Door unlocked");
    }
    return true;
  }

  function isInteriorWalkable(tile, gameState) {
    if (!tile) return false;
    // Walk through only when unlocked (key toggles; holding key is not enough alone).
    if (tile.kind === "door") return !isDoorLocked(tile);
    // keyHook blocks the tile — stand next to it and click
    return tile.kind === "floor" || tile.kind === "exit" || tile.kind === "upgrade";
  }

  function normalizeBaseKeyHook(gameState) {
    if (!gameState) return;
    if (typeof gameState.baseKeyOnHook !== "boolean") {
      // Migrate older saves: key in bag → hook empty; otherwise key on hook.
      gameState.baseKeyOnHook = !hasBaseKey(gameState);
    }
  }

  function findKeyHookTile(gameState) {
    return gameState?.interiorTiles?.find((t) => t?.feature === "keyHook") || null;
  }

  function refreshKeyHookTile(tile, onHook) {
    if (!tile || tile.feature !== "keyHook") return;
    tile.kind = "keyHook";
    tile.room = "hall";
    tile.feature = "keyHook";
    if (onHook) {
      tile.icon = "🔑";
      tile.label = "Key hook — click to take the Base Key";
    } else {
      tile.icon = "🪝";
      tile.label = "Key hook — click to hang the Base Key";
    }
  }

  function applyKeyHookState(gameState) {
    if (!gameState?.interiorTiles) return;
    normalizeBaseKeyHook(gameState);
    // Keep hook/inventory in sync if saves disagree.
    if (gameState.baseKeyOnHook && hasBaseKey(gameState)) {
      gameState.baseKeyOnHook = false;
    }
    const hook = findKeyHookTile(gameState);
    if (hook) refreshKeyHookTile(hook, gameState.baseKeyOnHook);
  }

  /** Force the Base Key back onto the hook (e.g. death leave). */
  function returnBaseKeyToHook(gameState) {
    if (!gameState || !hasBaseKey(gameState)) return false;
    removeItem(gameState, "baseKey", gameState.inventory?.baseKey || 1);
    // Clear any leftover bag stacks just in case.
    while (hasBaseKey(gameState)) {
      if (removeItem(gameState, "baseKey", 1) < 1) break;
    }
    gameState.baseKeyOnHook = true;
    const hook = findKeyHookTile(gameState);
    if (hook) refreshKeyHookTile(hook, true);
    return true;
  }

  /** Take the key from the hook, or hang it back. */
  function tryUseKeyHook(gameState, tile) {
    if (!gameState || tile?.feature !== "keyHook") return false;
    normalizeBaseKeyHook(gameState);

    if (gameState.baseKeyOnHook) {
      if (hasBaseKey(gameState)) {
        gameState.baseKeyOnHook = false;
        refreshKeyHookTile(tile, false);
        setToast(gameState, "You already have the Base Key");
        return true;
      }
      addItem(gameState, "baseKey", 1);
      gameState.baseKeyOnHook = false;
      refreshKeyHookTile(tile, false);
      setToast(gameState, "Took the Base Key — click a room door to lock/unlock it");
      return true;
    }

    if (!hasBaseKey(gameState)) {
      setToast(gameState, "Key hook is empty — nothing to hang");
      return false;
    }
    // Prefer inventory spend; fall back to bag stacks if counts drifted.
    let hung = removeItem(gameState, "baseKey", 1) >= 1;
    if (!hung && gameState.bag) {
      for (let i = 0; i < gameState.bag.length; i++) {
        const stack = gameState.bag[i];
        if (stack?.id !== "baseKey" || stack.count < 1) continue;
        stack.count -= 1;
        if (stack.count <= 0) gameState.bag[i] = null;
        rebuildInventoryFromBag(gameState);
        hung = true;
        break;
      }
    }
    if (!hung) {
      setToast(gameState, "Couldn't hang the Base Key");
      return false;
    }
    gameState.baseKeyOnHook = true;
    refreshKeyHookTile(tile, true);
    setToast(gameState, "Hung the Base Key on the hook");
    return true;
  }

  function normalizePlayer(gameState) {
    if (!gameState) return;
    if (isInsideBase(gameState)) {
      const fallback = interiorSpawnPos();
      const raw = gameState.player;
      const x = Number.isFinite(raw?.x) ? Math.floor(raw.x) : fallback.x;
      const y = Number.isFinite(raw?.y) ? Math.floor(raw.y) : fallback.y;
      gameState.player = {
        x: Math.max(0, Math.min(INTERIOR_COLS - 1, x)),
        y: Math.max(0, Math.min(INTERIOR_ROWS - 1, y)),
      };
      return;
    }
    const fallback = defaultPlayerPos();
    const raw = gameState.player;
    const x = Number.isFinite(raw?.x) ? Math.floor(raw.x) : fallback.x;
    const y = Number.isFinite(raw?.y) ? Math.floor(raw.y) : fallback.y;
    gameState.player = {
      x: Math.max(0, Math.min(COLS - 1, x)),
      y: Math.max(0, Math.min(ROWS - 1, y)),
    };
  }

  function normalizeInsideBase(gameState) {
    if (!gameState) return;
    normalizeBaseDoorLocks(gameState);
    normalizeBaseKeyHook(gameState);
    gameState.insideBase = Boolean(gameState.insideBase);
    if (!gameState.insideBase) {
      gameState.interiorTiles = null;
      gameState.outdoorPlayer = null;
      return;
    }
    const base = gameState.machines?.find((m) => m?.type === "base");
    if (!base) {
      gameState.insideBase = false;
      gameState.interiorTiles = null;
      gameState.outdoorPlayer = null;
      return;
    }
    if (
      !gameState.outdoorPlayer ||
      !Number.isFinite(gameState.outdoorPlayer.x) ||
      !Number.isFinite(gameState.outdoorPlayer.y)
    ) {
      const w = base.w || getStructureSize("base").w;
      const h = base.h || getStructureSize("base").h;
      gameState.outdoorPlayer = {
        x: base.x + Math.floor(w / 2),
        y: base.y + Math.floor(h / 2),
      };
    }
    rebuildInteriorMap(gameState);
  }

  /** Chebyshev reach 1 → 3×3 area centered on the player (including their tile). */
  const PLAYER_REACH = 1;
  /** Night: 3×3 ring brightness (far tiles can rise up to this via moonlight). */
  const NIGHT_LIGHT_RING = 1;
  const NIGHT_LIGHT_CORE = 0.88;
  const NIGHT_LIGHT_DARK = 0.22;

  function isInPlayerReach(gameState, x, y) {
    if (!gameState) return false;
    normalizePlayer(gameState);
    const dx = Math.abs(Math.floor(x) - gameState.player.x);
    const dy = Math.abs(Math.floor(y) - gameState.player.y);
    return Math.max(dx, dy) <= PLAYER_REACH;
  }

  /** Moonlit ambient 0–1: when 1, the whole map matches the 3×3 ring brightness. */
  function nightMapAmbient(gameState) {
    if (!gameState || !isNightTime(gameState.worldMinutes)) return 1;
    const hand = clockHandBaseDegrees(gameState.worldMinutes);
    const moonPos = skyBodyPositionFromDegrees(hand + 180);
    return Math.max(0, Math.min(1, skyBodyOpacity(moonPos.elevation)));
  }

  /** Per-tile night light: ring (3×3 border) brightest, far tiles lift with ambient. */
  function tileNightLight(gameState, x, y, ambient) {
    if (!gameState || !isNightTime(gameState.worldMinutes)) return 1;
    normalizePlayer(gameState);
    const d = Math.max(
      Math.abs(Math.floor(x) - gameState.player.x),
      Math.abs(Math.floor(y) - gameState.player.y)
    );
    if (d === 1) return NIGHT_LIGHT_RING;
    if (d === 0) return NIGHT_LIGHT_CORE;
    const amb = Math.max(0, Math.min(1, Number(ambient) || 0));
    return NIGHT_LIGHT_DARK + (NIGHT_LIGHT_RING - NIGHT_LIGHT_DARK) * amb;
  }

  function toastOutOfReach(gameState) {
    setToast(gameState, "Too far — stand in a 3×3 of that tile (WASD)");
  }

  function monsterAt(gameState, x, y, except = null) {
    if (!gameState || !Array.isArray(gameState.monsters)) return null;
    return (
      gameState.monsters.find((m) => m && m !== except && m.x === x && m.y === y) || null
    );
  }

  /** Live trees / rocks / ores / carrots — blocks both you and monsters. */
  function terrainBlocksMovement(tile) {
    return Boolean(tile?.node && tile.hp > 0);
  }

  /** Empty land or Iron Base floor — no live resources, other structures, or monsters. */
  function isWalkableTile(tile, gameState) {
    if (!tile) return false;
    if (gameState && isInsideBase(gameState)) return isInteriorWalkable(tile, gameState);
    // You may walk on Iron Base; other buildings block.
    if (tile.machine && tile.machine !== "base") return false;
    if (terrainBlocksMovement(tile)) return false;
    if (gameState && monsterAt(gameState, tile.x, tile.y)) return false;
    return true;
  }

  function isPlayerOnBase(gameState) {
    if (!gameState) return false;
    if (isInsideBase(gameState)) return true;
    normalizePlayer(gameState);
    const tile = getTile(gameState, gameState.player.x, gameState.player.y);
    return tile?.machine === "base";
  }

  /** If standing on a blocked tile (regrowth, old save), slide to nearest empty land. */
  function ensurePlayerOnWalkable(gameState) {
    if (!gameState) return;
    normalizePlayer(gameState);
    const here = getActiveTile(gameState, gameState.player.x, gameState.player.y);
    if (isWalkableTile(here, gameState)) return;
    const ox = gameState.player.x;
    const oy = gameState.player.y;
    const { cols, rows } = activeMapSize(gameState);
    let best = null;
    let bestDist = Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tile = getActiveTile(gameState, x, y);
        if (!isWalkableTile(tile, gameState)) continue;
        const dist = Math.abs(x - ox) + Math.abs(y - oy);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
    if (best) gameState.player = best;
    else gameState.player = isInsideBase(gameState) ? interiorSpawnPos() : defaultPlayerPos();
  }

  function hungerMax() {
    return GameData.hunger?.max ?? 10000;
  }

  function hungerPointsPerPercent() {
    return GameData.hunger?.pointsPerPercent ?? 100;
  }

  function hungerPercent(points) {
    return Math.max(0, Math.min(100, Math.floor((points || 0) / hungerPointsPerPercent())));
  }

  function healthMax() {
    return GameData.health?.max ?? 10000;
  }

  function healthPointsPerPercent() {
    return GameData.health?.pointsPerPercent ?? 100;
  }

  function healthPercent(points) {
    return Math.max(0, Math.min(100, Math.floor((points || 0) / healthPointsPerPercent())));
  }

  function normalizeHunger(gameState) {
    if (!gameState) return;
    const max = hungerMax();
    const raw = Number(gameState.hunger);
    gameState.hunger = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : max;
    const warnAt = (GameData.hunger?.warnPercent ?? 5) * hungerPointsPerPercent();
    if (gameState.hunger > warnAt) gameState.hungerWarned = false;
    else if (typeof gameState.hungerWarned !== "boolean") gameState.hungerWarned = true;
  }

  function normalizeHealth(gameState) {
    if (!gameState) return;
    const max = healthMax();
    const raw = Number(gameState.health);
    gameState.health = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : max;
    const warnAt = (GameData.health?.warnPercent ?? 5) * healthPointsPerPercent();
    if (gameState.health > warnAt) gameState.healthWarned = false;
    else if (typeof gameState.healthWarned !== "boolean") gameState.healthWarned = true;
  }

  function hungerActionCost() {
    return GameData.hunger?.actionCost ?? GameData.hunger?.hitCost ?? 50;
  }

  function applyHungerCost(gameState, cost) {
    if (!gameState || !cost) return;
    normalizeHunger(gameState);
    gameState.hunger = Math.max(0, gameState.hunger - cost);
    const warnPct = GameData.hunger?.warnPercent ?? 5;
    const pct = hungerPercent(gameState.hunger);
    if (pct <= warnPct && !gameState.hungerWarned) {
      gameState.hungerWarned = true;
      setToast(
        gameState,
        "You're starving — eat something (Apple, Carrot). Drop food on Eat in inventory."
      );
    }
    if (pct > warnPct) gameState.hungerWarned = false;
  }

  function flashDamageVignette() {
    const el = document.getElementById("damage-flash");
    if (!el) return;
    // Keep on <body> so parent screens/modals never clip it.
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.classList.remove("is-active");
    // Force style flush so re-adding is-active always restarts the keyframes.
    void el.offsetWidth;
    el.classList.add("is-active");
    const onEnd = (event) => {
      if (event.target !== el || event.animationName !== "damage-vignette") return;
      el.classList.remove("is-active");
      el.removeEventListener("animationend", onEnd);
    };
    el.addEventListener("animationend", onEnd);
  }

  function applyHealthCost(gameState, cost) {
    if (!gameState || !cost) return;
    normalizeHealth(gameState);
    const before = gameState.health;
    gameState.health = Math.max(0, gameState.health - cost);
    if (gameState.health < before) flashDamageVignette();
    if (before > 0 && gameState.health <= 0) {
      handlePlayerDeath(gameState);
      return;
    }
    const warnPct = GameData.health?.warnPercent ?? 5;
    const pct = healthPercent(gameState.health);
    if (pct <= warnPct && !gameState.healthWarned) {
      gameState.healthWarned = true;
      setToast(gameState, "Health is low — eat something to recover.");
    }
    if (pct > warnPct) gameState.healthWarned = false;
  }

  /** Show / clear the 3×3 lightning telegraph (survives renderWorld rebuilds). */
  function previewLightningStrike(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    lightningWarnCell = { x, y };
    if (state && playActive) renderWorld();
  }

  function clearLightningPreview() {
    if (!lightningWarnCell) return;
    lightningWarnCell = null;
    if (state && playActive) renderWorld();
  }

  /**
   * Thunder impact on outdoor island: 3×3 around (x,y).
   * Standing in that radius electrifies you for 1/5 max health.
   */
  function onLightningStrike(x, y) {
    lightningWarnCell = null;
    if (!state || !playActive) return;
    if (isInsideBase(state)) {
      renderWorld();
      return;
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      renderWorld();
      return;
    }
    normalizePlayer(state);
    const dx = Math.abs(state.player.x - x);
    const dy = Math.abs(state.player.y - y);
    if (Math.max(dx, dy) <= 1) {
      const dmg = Math.max(1, Math.floor(healthMax() / 5));
      applyHealthCost(state, dmg);
      if (state.health > 0) {
        setToast(state, "Electrified! Lightning took 1/5 of your health.");
      }
    }
    renderWorld();
    renderHud();
  }

  function applyHealthGain(gameState, amount) {
    if (!gameState || !amount) return;
    normalizeHealth(gameState);
    gameState.health = Math.min(healthMax(), gameState.health + amount);
    if (healthPercent(gameState.health) > (GameData.health?.warnPercent ?? 5)) {
      gameState.healthWarned = false;
    }
  }

  /** False when HP is 0 — blocks actions (death should have already fired). */
  function canActWithHealth(gameState) {
    if (!gameState) return false;
    normalizeHealth(gameState);
    if (gameState.health > 0) return true;
    setToast(gameState, "You're dead — wait for respawn");
    return false;
  }

  function rememberActionTile(gameState, x, y) {
    if (!gameState || !Number.isInteger(x) || !Number.isInteger(y)) return;
    gameState.lastActionTile = { x, y };
  }

  function findDeathCrateSpot(gameState) {
    const startX = Number.isInteger(gameState.lastActionTile?.x)
      ? gameState.lastActionTile.x
      : Math.floor(COLS / 2);
    const startY = Number.isInteger(gameState.lastActionTile?.y)
      ? gameState.lastActionTile.y
      : Math.floor(ROWS / 2);

    const tryTile = (x, y) => {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
      const tile = gameState.tiles[y * COLS + x];
      if (!tile || tile.machine) return null;
      return { x, y, tile };
    };

    const first = tryTile(startX, startY);
    if (first) return first;

    for (let radius = 1; radius < Math.max(COLS, ROWS); radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const hit = tryTile(startX + dx, startY + dy);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  function snapshotBagLoot(gameState) {
    ensureBag(gameState);
    const loot = [];
    const equipped = equippedToolId(gameState);
    if (equipped !== "hand") {
      loot.push({ id: equipped, count: 1 });
      gameState.activeTool = "hand";
    }
    for (let i = 0; i < gameState.bag.length; i++) {
      const stack = gameState.bag[i];
      if (stack && stack.count > 0) loot.push({ id: stack.id, count: stack.count });
      gameState.bag[i] = null;
    }
    rebuildInventoryFromBag(gameState);
    return loot;
  }

  function addItemWithRemainder(gameState, id, count) {
    if (!id || count < 1) return 0;
    const before = gameState.inventory[id] || 0;
    addItem(gameState, id, count);
    const after = gameState.inventory[id] || 0;
    return Math.max(0, count - (after - before));
  }

  function lootDeathCrate(gameState, tile) {
    if (!gameState || !tile || tile.machine !== "deathCrate") return false;
    const machine = gameState.machines.find(
      (m) => m.type === "deathCrate" && m.x === tile.x && m.y === tile.y
    );
    if (!machine) return false;
    if (!Array.isArray(machine.loot)) machine.loot = [];

    const remaining = [];
    let recovered = 0;
    for (const stack of machine.loot) {
      if (!stack?.id || !(stack.count > 0)) continue;
      const left = addItemWithRemainder(gameState, stack.id, stack.count);
      recovered += stack.count - left;
      if (left > 0) remaining.push({ id: stack.id, count: left });
    }
    machine.loot = remaining;

    if (remaining.length === 0) {
      gameState.machines = gameState.machines.filter(
        (m) => !(m.type === "deathCrate" && m.x === tile.x && m.y === tile.y)
      );
      tile.machine = null;
      if (!tile.node) tile.kind = "grass";
      else tile.kind = "node";
      setToast(
        gameState,
        recovered > 0 ? "Recovered your items from the death crate" : "Death crate was empty"
      );
    } else {
      setToast(gameState, "Inventory full — some items remain in the death crate");
    }
    return true;
  }

  function handlePlayerDeath(gameState) {
    if (!gameState || gameState._handlingDeath) return;
    gameState._handlingDeath = true;
    try {
      if (isInsideBase(gameState)) {
        leaveBaseInterior(gameState, { silent: true, skipRender: true });
      }
      clearBuildMode();
      if (typeof closePlayerInvUi === "function") closePlayerInvUi();
      if (typeof closeSmelterUi === "function") closeSmelterUi();
      if (typeof closeGeneratorUi === "function") closeGeneratorUi();
      if (typeof closeCraftTableUi === "function") closeCraftTableUi();
      if (typeof closeRecipesUi === "function") closeRecipesUi();
      if (typeof closeBuildUi === "function") closeBuildUi();

      // Pull crafting-grid items back into the bag before the drop.
      if (Array.isArray(playerCraftGrid)) {
        playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
        returnGridToInv(playerCraftGrid);
      }
      for (const m of gameState.machines) {
        if (m?.type === "craftingStation") {
          ensureCraftTableShape(m);
          returnGridToInv(m.craftGrid);
        }
      }
      if (gameState.workroomCraft) {
        ensureCraftTableShape(ensureWorkroomCraft(gameState));
        returnGridToInv(gameState.workroomCraft.craftGrid);
      }

      const loot = snapshotBagLoot(gameState);
      let spot = findDeathCrateSpot(gameState);
      if (!spot) {
        // Map packed — merge into an existing crate, or force center after clearing nothing.
        const existing = gameState.machines.find((m) => m.type === "deathCrate");
        if (existing) {
          existing.loot = [...(existing.loot || []), ...loot];
        } else {
          const x = Math.floor(COLS / 2);
          const y = Math.floor(ROWS / 2);
          const tile = gameState.tiles[y * COLS + x];
          if (tile?.machine) {
            // Last resort: keep loot on a crate even if we overwrite a marker tile
            // only when it's already a death crate; otherwise append to bag again.
            for (const stack of loot) addItem(gameState, stack.id, stack.count);
            setToast(gameState, "You died — no space for a death crate (items kept)");
          } else {
            spot = { x, y, tile };
          }
        }
      }

      if (spot) {
        spot.tile.machine = "deathCrate";
        if (!spot.tile.node) spot.tile.kind = "machine";
        gameState.machines.push({
          type: "deathCrate",
          x: spot.x,
          y: spot.y,
          loot,
          timer: 0,
          interval: 0,
        });
      }

      const hpPct = GameData.health?.respawnHealthPercent ?? 50;
      const foodPct = GameData.health?.respawnHungerPercent ?? 40;
      gameState.health = Math.floor((healthMax() * hpPct) / 100);
      gameState.hunger = Math.floor((hungerMax() * foodPct) / 100);
      gameState.healthWarned = false;
      gameState.hungerWarned = false;
      gameState.player = defaultPlayerPos();
      ensurePlayerOnWalkable(gameState);
      setToast(
        gameState,
        loot.length
          ? "You died! Collect your items from the death crate (📦)."
          : "You died and respawned."
      );
      if (typeof render === "function" && state === gameState) render();
    } finally {
      gameState._handlingDeath = false;
    }
  }

  function isFoodItem(id) {
    return Boolean(GameData.getItem(id)?.food);
  }

  function isCoolantItem(id) {
    return Boolean(GameData.getItem(id)?.coolant);
  }

  function normalizePlayerCool(gameState) {
    if (!gameState) return;
    if (!Number.isFinite(gameState.playerCoolMinutesLeft) || gameState.playerCoolMinutesLeft < 0) {
      gameState.playerCoolMinutesLeft = 0;
    }
  }

  function tickPlayerCool(gameState, minutes) {
    normalizePlayerCool(gameState);
    if (gameState.playerCoolMinutesLeft <= 0) return;
    gameState.playerCoolMinutesLeft = Math.max(
      0,
      gameState.playerCoolMinutesLeft - Math.max(0, Math.floor(minutes))
    );
  }

  /** Spend one Ice from a drag source (bag / craft grid). */
  function takeCoolantFromDrag(drag) {
    if (!state || !drag || !isCoolantItem(drag.itemId)) return false;
    if (drag.from === "bag") {
      ensureBag(state);
      const stack = state.bag[drag.bagIndex];
      if (!stack || stack.id !== drag.itemId || stack.count < 1) return false;
      stack.count -= 1;
      if (stack.count <= 0) state.bag[drag.bagIndex] = null;
      rebuildInventoryFromBag(state);
      return true;
    }
    if (drag.from === "grid") {
      const bench = getActiveBench();
      const stack = bench?.grid?.[drag.gridIndex];
      if (!stack || stack.missing || stack.id !== drag.itemId || stack.count < 1) return false;
      stack.count -= 1;
      if (stack.count <= 0) bench.grid[drag.gridIndex] = null;
      return true;
    }
    return false;
  }

  function applyPlayerCoolant() {
    if (!state) return false;
    normalizePlayerCool(state);
    const mins = GameData.cooling?.playerMinutes ?? 45;
    state.playerCoolMinutesLeft = Math.max(state.playerCoolMinutesLeft, mins);
    setToast(state, `Cooled down (−${GameData.cooling?.playerDropC ?? 10}°C for a while)`);
    return true;
  }

  function useCoolantFromDrag(drag) {
    if (!takeCoolantFromDrag(drag)) return false;
    return applyPlayerCoolant();
  }

  function applyIceToGenerator(m) {
    if (!state || !m) return false;
    ensureGeneratorShape(m);
    if ((state.inventory.ice || 0) < 1) {
      setToast(state, "Need Ice to cool the generator");
      return false;
    }
    removeItem(state, "ice", 1);
    const drop = GameData.cooling?.generatorDropC ?? 35;
    const before = Math.round(m.tempC);
    m.tempC = Math.max(GEN_TEMP_AMBIENT, m.tempC - drop);
    setToast(state, `Ice cools the generator ${before}°C → ${Math.round(m.tempC)}°C`);
    return true;
  }

  /** Food restores 10% — refuse when already at 90%+ hunger (no waste). */
  function foodFullnessThresholdPercent() {
    return 100 - (GameData.hunger?.foodRestorePercent ?? 10);
  }

  function canAcceptFood(gameState) {
    if (!gameState) return false;
    normalizeHunger(gameState);
    return hungerPercent(gameState.hunger) < foodFullnessThresholdPercent();
  }

  function toastFoodFull(gameState) {
    setToast(
      gameState,
      `Already full — eat only below ${foodFullnessThresholdPercent()}% food`
    );
  }

  function restoreHungerFromFood(gameState, id) {
    normalizeHunger(gameState);
    normalizeHealth(gameState);
    const hungerPct = GameData.hunger?.foodRestorePercent ?? 10;
    const healthPct = GameData.health?.foodRestorePercent ?? 10;
    gameState.hunger = Math.min(
      hungerMax(),
      gameState.hunger + hungerPct * hungerPointsPerPercent()
    );
    gameState.health = Math.min(
      healthMax(),
      gameState.health + healthPct * healthPointsPerPercent()
    );
    if (hungerPercent(gameState.hunger) > (GameData.hunger?.warnPercent ?? 5)) {
      gameState.hungerWarned = false;
    }
    if (healthPercent(gameState.health) > (GameData.health?.warnPercent ?? 5)) {
      gameState.healthWarned = false;
    }
    window.KeaghanSfx?.playFoodMunch?.();
    const name = GameData.getItem(id).name;
    setToast(
      gameState,
      `Ate ${name} · +${hungerPct}% food · +${healthPct}% HP`
    );
  }

  function eatFoodFromBag(gameState, bagIndex) {
    if (!gameState) return false;
    ensureBag(gameState);
    const stack = gameState.bag[bagIndex];
    if (!stack || stack.count < 1 || !isFoodItem(stack.id)) return false;
    if (!canAcceptFood(gameState)) {
      toastFoodFull(gameState);
      return false;
    }
    const id = stack.id;
    stack.count -= 1;
    if (stack.count <= 0) gameState.bag[bagIndex] = null;
    rebuildInventoryFromBag(gameState);
    restoreHungerFromFood(gameState, id);
    return true;
  }

  /** Eat one food item from a drag (bag or craft grid). */
  function eatFromCraftDrag(drag) {
    if (!state || !drag?.itemId) return false;
    if (!isFoodItem(drag.itemId)) {
      setToast(state, "Only food goes in Eat (Apple, Carrot)");
      return false;
    }
    if (!canAcceptFood(state)) {
      toastFoodFull(state);
      return false;
    }
    if (drag.from === "bag") {
      return eatFoodFromBag(state, drag.bagIndex);
    }
    if (drag.from === "grid") {
      const bench = getActiveBench();
      const stack = bench?.grid?.[drag.gridIndex];
      if (!stack || stack.missing || stack.count < 1 || !isFoodItem(stack.id)) return false;
      const id = stack.id;
      stack.count -= 1;
      if (stack.count <= 0) bench.grid[drag.gridIndex] = null;
      restoreHungerFromFood(state, id);
      return true;
    }
    return false;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(saveKey());
      if (!raw) return createState();
      const saved = JSON.parse(raw);
      const fresh = createState();
      const worldMinutes =
        Number.isFinite(saved.worldMinutes) && saved.worldMinutes >= 0
          ? Math.floor(saved.worldMinutes) % (24 * 60)
          : fresh.worldMinutes;

      // Migrate old Power Station → Crafting Station.
      const inventory = { ...fresh.inventory, ...saved.inventory };
      if (inventory.powerStation) {
        inventory.craftingStation = (inventory.craftingStation || 0) + inventory.powerStation;
        delete inventory.powerStation;
      }
      const machines = (saved.machines || [])
        .map((m) => (m?.type === "powerStation" ? { ...m, type: "craftingStation" } : m))
        .filter((m) => m && m.x >= 0 && m.y >= 0 && m.x < COLS && m.y < ROWS);
      const tiles = normalizeWorldTiles(saved.tiles, machines, saved.worldLayoutVersion);

      const state = {
        ...fresh,
        ...saved,
        worldMinutes,
        inventory,
        machines,
        tiles,
        worldLayoutVersion: WORLD_LAYOUT_VERSION,
        weather: normalizeWeather(saved.weather),
        stats: {
          gathered: { ...saved.stats?.gathered },
          smelted: { ...saved.stats?.smelted },
          crafted: { ...saved.stats?.crafted },
          drilled: saved.stats?.drilled || 0,
          poweredDrill: saved.stats?.poweredDrill || 0,
          manualSmelted: saved.stats?.manualSmelted || 0,
        },
      };
      ensureBag(state);
      ensureEggsDone(state);
      normalizeHunger(state);
      normalizeHealth(state);
      normalizeMonsters(state);
      normalizeBaseTiers(state);
      normalizeInsideBase(state);
      normalizeAda(state);
      normalizeEquipment(state);
      normalizePlayerCool(state);
      retireOutdoorCraftingTables(state);
      if (!isInsideBase(state)) {
        normalizePlayer(state);
        ensurePlayerOnWalkable(state);
      }
      ensureFoodNodes(state);
      return state;
    } catch (err) {
      console.error("[IslandFoundry] loadState failed — keeping disk save, using fresh session", err);
      const fresh = createState();
      // Prevent autosave from overwriting a good save after a load bug.
      fresh._skipPersist = true;
      return fresh;
    }
  }

  function menusBlockPlayerMove() {
    return Boolean(
      openPlayerInv ||
        openCraftTable ||
        openKitchen ||
        openStorage ||
        openSmelter ||
        openGenerator ||
        openRecipes ||
        openBuildMenu ||
        openBaseEnterPrompt ||
        openBaseLeavePrompt ||
        openSleepPrompt ||
        openTvPrompt
    );
  }

  /** WASD step — empty land only. Click still harvests / opens machines in 3×3 reach. */
  function tryMovePlayer(dx, dy) {
    if (!state || !playActive || gamePaused || menusBlockPlayerMove()) return false;
    ensurePlayerOnWalkable(state);
    const prevX = state.player.x;
    const prevY = state.player.y;
    const nx = prevX + dx;
    const ny = prevY + dy;
    const { cols, rows } = activeMapSize(state);
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    if (nx === prevX && ny === prevY) return false;
    const dest = getActiveTile(state, nx, ny);
    if (!isWalkableTile(dest, state)) {
      const lockedDoor = isInsideBase(state) && isDoorLocked(dest);
      const onKeyHook =
        isInsideBase(state) &&
        (dest?.feature === "keyHook" || dest?.kind === "keyHook");
      setToast(
        state,
        lockedDoor
          ? "Locked — click the door with the Base Key to unlock it"
          : onKeyHook
            ? "Key hook — stand next to it and click"
            : !isInsideBase(state) && monsterAt(state, nx, ny)
              ? "A monster blocks the way"
              : isInsideBase(state)
                ? dest?.kind === "wall"
                  ? "Can't walk through the wall"
                  : "Can't walk there"
                : "Can't walk there — only empty land"
      );
      renderHud();
      return false;
    }
    // Outdoor hills: one-block steps only (steeper cliffs block).
    if (!isInsideBase(state)) {
      const from = getActiveTile(state, prevX, prevY);
      const step = Math.abs(tileHeight(dest) - tileHeight(from));
      if (step > 1) {
        setToast(state, "Too steep — find a gentler slope");
        renderHud();
        return false;
      }
    }
    const wasOnBase =
      !isInsideBase(state) && getTile(state, prevX, prevY)?.machine === "base";
    state.player.x = nx;
    state.player.y = ny;
    if (!isInsideBase(state)) {
      rememberActionTile(state, nx, ny);
      const nowOnBase = getTile(state, nx, ny)?.machine === "base";
      // Stepping onto the base footprint → ask to come inside (decline pushes back).
      if (nowOnBase && !wasOnBase) {
        baseEnterFrom = { x: prevX, y: prevY };
        renderWorld();
        refreshBuildPreview();
        saveState(state);
        promptBaseEnter();
        return true;
      }
    } else {
      const prevTile = getActiveTile(state, prevX, prevY);
      const here = getActiveTile(state, nx, ny);
      const wasExit = prevTile?.kind === "exit" || prevTile?.feature === "exit";
      const nowExit = here?.kind === "exit" || here?.feature === "exit";
      // Stepping onto a front door → ask to leave (Stay inside pushes back).
      if (nowExit && !wasExit) {
        baseLeaveFrom = { x: prevX, y: prevY };
        renderWorld();
        refreshBuildPreview();
        saveState(state);
        promptBaseLeave();
        return true;
      }
    }
    renderWorld();
    refreshBuildPreview();
    saveState(state);
    return true;
  }

  function saveState(gameState) {
    if (!gameState || gameState._skipPersist) return;
    ensureBag(gameState);
    const {
      _poweredTiles,
      toast,
      toastUntil,
      _handlingDeath,
      _skipPersist,
      ...persist
    } = gameState;
    try {
      localStorage.setItem(saveKey(), JSON.stringify(persist));
    } catch (err) {
      console.error("[IslandFoundry] saveState failed", err);
    }
  }

  function canAfford(state, cost) {
    ensureBag(state);
    return Object.entries(cost).every(([id, n]) => (state.inventory[id] || 0) >= n);
  }

  function spend(state, cost) {
    ensureBag(state);
    for (const [id, n] of Object.entries(cost)) {
      let need = n;
      for (let i = 0; i < state.bag.length && need > 0; i++) {
        const stack = state.bag[i];
        if (!stack || stack.id !== id) continue;
        const take = Math.min(stack.count, need);
        stack.count -= take;
        need -= take;
        if (stack.count <= 0) state.bag[i] = null;
      }
    }
    rebuildInventoryFromBag(state);
  }

  function addItem(state, id, count) {
    if (!id || count < 1) return;
    ensureBag(state);
    let left = count;

    for (let i = 0; i < state.bag.length && left > 0; i++) {
      const stack = state.bag[i];
      if (!stack || stack.id !== id) continue;
      stack.count += left;
      left = 0;
    }
    for (let i = 0; i < state.bag.length && left > 0; i++) {
      if (state.bag[i]) continue;
      state.bag[i] = { id, count: left };
      left = 0;
    }
    if (left > 0) {
      // Bag full — merge into any matching stack.
      for (let i = 0; i < state.bag.length && left > 0; i++) {
        if (state.bag[i]?.id !== id) continue;
        state.bag[i].count += left;
        left = 0;
      }
    }
    rebuildInventoryFromBag(state);
  }

  function removeItem(state, id, count) {
    if (!id || count < 1) return 0;
    const have = state.inventory[id] || 0;
    const take = Math.min(have, count);
    if (take < 1) return 0;
    spend(state, { [id]: take });
    return take;
  }

  /** Move `amount` from a bag slot into the craft grid (or all if amount is Infinity). */
  function moveBagSlotToCraft(slotIndex, amount = 1) {
    ensureBag(state);
    const stack = state.bag[slotIndex];
    if (!stack) return 0;
    const want = Math.min(amount === Infinity ? stack.count : amount, stack.count);
    if (want < 1) return 0;
    const moved = pushToActiveGridFromBag(slotIndex, want);
    return moved;
  }

  function pushToActiveGridFromBag(slotIndex, amount) {
    const bench = getActiveBench();
    ensureBag(state);
    const stack = state.bag[slotIndex];
    if (!bench || !stack || amount < 1) return 0;
    let left = Math.min(amount, stack.count);
    let moved = 0;

    for (let i = 0; i < bench.size && left > 0; i++) {
      const cell = bench.grid[i];
      if (!cell || cell.missing || cell.id !== stack.id) continue;
      cell.count += 1;
      left -= 1;
      moved += 1;
      stack.count -= 1;
    }
    for (let i = 0; i < bench.size && left > 0; i++) {
      if (bench.grid[i]) continue;
      bench.grid[i] = { id: stack.id, count: 1 };
      left -= 1;
      moved += 1;
      stack.count -= 1;
    }
    if (stack.count <= 0) state.bag[slotIndex] = null;
    rebuildInventoryFromBag(state);
    return moved;
  }

  /** Place a bag stack into a specific craft cell (merge same id, or swap). */
  function placeBagIntoCraftSlot(bagIndex, gridIndex) {
    const bench = getActiveBench();
    ensureBag(state);
    const stack = state.bag[bagIndex];
    if (!bench || !stack || stack.count < 1) return 0;
    if (gridIndex < 0 || gridIndex >= bench.size) return 0;

    const cell = bench.grid[gridIndex];
    if (cell && !cell.missing && cell.count > 0) {
      if (cell.id === stack.id) {
        const moved = stack.count;
        cell.count += moved;
        state.bag[bagIndex] = null;
        rebuildInventoryFromBag(state);
        return moved;
      }
      // Swap whole stacks.
      const craftId = cell.id;
      const craftCount = cell.count;
      const bagId = stack.id;
      const bagCount = stack.count;
      bench.grid[gridIndex] = { id: bagId, count: bagCount };
      state.bag[bagIndex] = { id: craftId, count: craftCount };
      rebuildInventoryFromBag(state);
      return bagCount;
    }

    const moved = stack.count;
    bench.grid[gridIndex] = { id: stack.id, count: moved };
    state.bag[bagIndex] = null;
    rebuildInventoryFromBag(state);
    return moved;
  }

  function placeStackInBagSlot(slotIndex, itemId, count) {
    ensureBag(state);
    if (slotIndex < 0 || slotIndex >= BAG_SIZE || count < 1) return 0;
    const dest = state.bag[slotIndex];
    if (!dest) {
      state.bag[slotIndex] = { id: itemId, count };
      rebuildInventoryFromBag(state);
      return count;
    }
    if (dest.id === itemId) {
      dest.count += count;
      rebuildInventoryFromBag(state);
      return count;
    }
    return 0;
  }

  function swapOrMergeBagSlots(fromIndex, toIndex) {
    ensureBag(state);
    if (fromIndex === toIndex) return false;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= BAG_SIZE || toIndex >= BAG_SIZE) return false;
    const a = state.bag[fromIndex];
    const b = state.bag[toIndex];
    if (!a) return false;
    if (!b) {
      state.bag[toIndex] = a;
      state.bag[fromIndex] = null;
      rebuildInventoryFromBag(state);
      return true;
    }
    if (a.id === b.id) {
      b.count += a.count;
      state.bag[fromIndex] = null;
      rebuildInventoryFromBag(state);
      return true;
    }
    state.bag[fromIndex] = b;
    state.bag[toIndex] = a;
    rebuildInventoryFromBag(state);
    return true;
  }

  /** Destroy a dragged bag/grid stack (drop on the inventory trash zone). */
  function destroyDraggedStack(drag) {
    if (!drag || !state) return false;
    ensureBag(state);
    if (drag.from === "bag") {
      const stack = state.bag[drag.bagIndex];
      if (!stack) return false;
      const name = GameData.getItem(stack.id).name;
      const count = stack.count;
      state.bag[drag.bagIndex] = null;
      rebuildInventoryFromBag(state);
      setToast(state, `Deleted ${name} ×${count}`);
      return true;
    }
    if (drag.from === "grid") {
      const bench = getActiveBench();
      const stack = bench?.grid?.[drag.gridIndex];
      if (!stack || stack.missing) return false;
      const name = GameData.getItem(stack.id).name;
      const count = stack.count;
      bench.grid[drag.gridIndex] = null;
      setToast(state, `Deleted ${name} ×${count}`);
      return true;
    }
    return false;
  }

  function bestTool(state) {
    const order = ["ironPick", "stonePick", "woodPick", "hand"];
    for (const t of order) {
      if (state.unlockedTools.includes(t)) return t;
    }
    return "hand";
  }

  const EQUIP_TOOL_IDS = new Set(["woodPick", "stonePick", "ironPick", "ironSword"]);

  function isEquippableTool(id) {
    return Boolean(id && EQUIP_TOOL_IDS.has(id));
  }

  function equippedToolId(gameState) {
    const tool = gameState?.activeTool || "hand";
    return isEquippableTool(tool) ? tool : "hand";
  }

  function toolDisplayName(id) {
    if (isSixSevenModInstalled()) return "6-7";
    if (!id || id === "hand") return "Hand";
    return GameData.getItem(id)?.name || id;
  }

  function toolDisplayIcon(id) {
    if (isSixSevenModInstalled()) return "6-7";
    if (!id || id === "hand") return "✋";
    return GameData.getItem(id)?.icon || "🔧";
  }

  /** Unlock a tool for progression; does not move items or equip. */
  function unlockTool(gameState, toolId) {
    if (!gameState || !isEquippableTool(toolId)) return;
    if (!Array.isArray(gameState.unlockedTools)) gameState.unlockedTools = ["hand"];
    if (!gameState.unlockedTools.includes("hand")) gameState.unlockedTools.unshift("hand");
    if (!gameState.unlockedTools.includes(toolId)) gameState.unlockedTools.push(toolId);
  }

  /**
   * Put a tool into the Equipment slot. Previous equipped tool returns to the bag.
   * `source` removes the newly equipped tool from bag/grid first when provided.
   */
  function equipTool(gameState, toolId, source = null) {
    if (!gameState || !isEquippableTool(toolId)) return false;
    ensureBag(gameState);

    if (source?.from === "bag") {
      const stack = gameState.bag[source.bagIndex];
      if (!stack || stack.id !== toolId || stack.count < 1) return false;
      stack.count -= 1;
      if (stack.count <= 0) gameState.bag[source.bagIndex] = null;
      rebuildInventoryFromBag(gameState);
    } else if (source?.from === "grid") {
      const bench = getActiveBench();
      const stack = bench?.grid?.[source.gridIndex];
      if (!stack || stack.missing || stack.id !== toolId || stack.count < 1) return false;
      stack.count -= 1;
      if (stack.count <= 0) bench.grid[source.gridIndex] = null;
    } else if ((gameState.inventory[toolId] || 0) < 1) {
      return false;
    } else {
      removeItem(gameState, toolId, 1);
    }

    const prev = equippedToolId(gameState);
    if (prev !== "hand") addItem(gameState, prev, 1);

    gameState.activeTool = toolId;
    unlockTool(gameState, toolId);
    setToast(gameState, `Equipped ${toolDisplayName(toolId)}`);
    return true;
  }

  /** Move equipped tool back to inventory (or a bag slot). Hands become empty. */
  function unequipTool(gameState, bagIndex = null) {
    if (!gameState) return false;
    const tool = equippedToolId(gameState);
    if (tool === "hand") return false;
    ensureBag(gameState);

    if (bagIndex != null && bagIndex >= 0) {
      const dest = gameState.bag[bagIndex];
      if (!dest) {
        gameState.bag[bagIndex] = { id: tool, count: 1 };
      } else if (dest.id === tool) {
        dest.count += 1;
      } else {
        addItem(gameState, tool, 1);
      }
      rebuildInventoryFromBag(gameState);
    } else {
      addItem(gameState, tool, 1);
    }

    gameState.activeTool = "hand";
    setToast(gameState, "Equipped Hand");
    return true;
  }

  /** Unequip into a craft-grid cell (for upgrade recipes). */
  function unequipToolToCraftSlot(gameState, gridIndex) {
    if (!gameState) return false;
    const tool = equippedToolId(gameState);
    if (tool === "hand") return false;
    const bench = getActiveBench();
    if (!bench || gridIndex < 0 || gridIndex >= bench.size) return false;
    const dest = bench.grid[gridIndex];
    if (dest?.missing) return false;
    if (!dest) {
      bench.grid[gridIndex] = { id: tool, count: 1 };
    } else if (dest.id === tool) {
      dest.count += 1;
    } else {
      return false;
    }
    gameState.activeTool = "hand";
    setToast(gameState, "Equipped Hand");
    return true;
  }

  function destroyEquippedTool(gameState) {
    if (!gameState) return false;
    const tool = equippedToolId(gameState);
    if (tool === "hand") return false;
    gameState.activeTool = "hand";
    setToast(gameState, `Deleted ${toolDisplayName(tool)}`);
    return true;
  }

  /**
   * Old saves kept the equipped tool in the bag too — pull one copy into the slot.
   */
  function normalizeEquipment(gameState) {
    if (!gameState) return;
    if (!Array.isArray(gameState.unlockedTools)) gameState.unlockedTools = ["hand"];
    if (!gameState.unlockedTools.includes("hand")) gameState.unlockedTools.unshift("hand");

    let tool = gameState.activeTool || "hand";
    if (!isEquippableTool(tool)) {
      gameState.activeTool = "hand";
      return;
    }
    unlockTool(gameState, tool);
    ensureBag(gameState);
    if ((gameState.inventory[tool] || 0) >= 1) {
      removeItem(gameState, tool, 1);
    }
  }

  const ADA_CONTROLS_MS = 12000;
  let adaControlsTimer = 0;

  function normalizeAda(gameState) {
    if (!gameState) return;
    if (!gameState.adaHeard || typeof gameState.adaHeard !== "object") {
      gameState.adaHeard = {};
    }
    if (typeof gameState.adaLine !== "string") gameState.adaLine = null;
  }

  function adaText(id) {
    // 6-7 Mod: ADA chat is only ever "6-7".
    if (isSixSevenModInstalled()) return "6-7";
    return GameData.ada?.lines?.[id] || null;
  }

  function renderAdaLine(text, { speaking = false } = {}) {
    const el = document.getElementById("ada-line");
    const box = el?.closest(".ada-helper");
    if (!el) return;
    const modOn = isSixSevenModInstalled();
    el.textContent = modOn ? "6-7" : text || GameData.ada?.idle || "Standing by.";
    const nameEl = box?.querySelector(".ada-helper__name");
    if (nameEl) {
      if (!nameEl.dataset.defaultName) nameEl.dataset.defaultName = nameEl.textContent;
      nameEl.textContent = modOn ? "6-7" : nameEl.dataset.defaultName;
    }
    if (!box) return;
    box.classList.toggle("is-speaking", Boolean(speaking));
    if (speaking) {
      window.setTimeout(() => box.classList.remove("is-speaking"), 500);
    }
  }

  /**
   * ADA's voice is wired to Base habitat speakers only —
   * indoors, or standing on the Base footprint (including first-Base online).
   */
  function adaSpeakersConnected(gameState, lineId = null) {
    if (!gameState) return false;
    if (isInsideBase(gameState)) return true;
    if (typeof isPlayerOnBase === "function" && isPlayerOnBase(gameState)) return true;
    // First Base placement brings speakers online even if you step off the pad.
    if (
      lineId === "firstBase" &&
      gameState.machines?.some((m) => m?.type === "base")
    ) {
      return true;
    }
    return false;
  }

  function playAdaVoice(gameState, text, lineId = null) {
    if (!text) return false;
    if (!adaSpeakersConnected(gameState, lineId)) {
      window.KeaghanSfx?.stopAdaSpeech?.();
      return false;
    }
    return Boolean(window.KeaghanSfx?.speakAdaLine?.(text));
  }

  /** Skip ADA's current spoken line (Enter). */
  function skipAdaSpeech() {
    if (!window.KeaghanSfx?.isAdaSpeaking?.()) return false;
    window.KeaghanSfx.stopAdaSpeech();
    const box = document.querySelector(".ada-helper");
    box?.classList.remove("is-speaking");
    return true;
  }

  /** ADA line once per id — text always; voice only through Base speakers. */
  function speakAda(gameState, lineId, { force = false } = {}) {
    if (!gameState || !lineId) return false;
    normalizeAda(gameState);
    const text = adaText(lineId);
    if (!text) return false;
    if (!force && gameState.adaHeard[lineId]) return false;
    gameState.adaHeard[lineId] = true;
    gameState.adaLine = text;
    if (adaControlsTimer) {
      window.clearTimeout(adaControlsTimer);
      adaControlsTimer = 0;
    }
    renderAdaLine(text, { speaking: true });
    playAdaVoice(gameState, text, lineId);
    return true;
  }

  function showAdaControls() {
    const text = isSixSevenModInstalled() ? "6-7" : GameData.ada?.controls || "";
    renderAdaLine(text, { speaking: true });
    // Controls list is long — keep it on-screen only, no TTS.
    window.KeaghanSfx?.stopAdaSpeech?.();
    if (adaControlsTimer) window.clearTimeout(adaControlsTimer);
    adaControlsTimer = window.setTimeout(() => {
      adaControlsTimer = 0;
      const fallback = isSixSevenModInstalled()
        ? "6-7"
        : state?.adaLine || GameData.ada?.idle || "";
      renderAdaLine(fallback);
    }, ADA_CONTROLS_MS);
  }

  function bindAdaUi() {
    const controlsBtn = document.getElementById("ada-controls-btn");
    if (controlsBtn && !controlsBtn.dataset.bound) {
      controlsBtn.dataset.bound = "1";
      controlsBtn.addEventListener("click", () => {
        showAdaControls();
      });
    }
  }

  function refreshAdaPanel() {
    if (!state) {
      renderAdaLine(isSixSevenModInstalled() ? "6-7" : GameData.ada?.idle || "");
      return;
    }
    normalizeAda(state);
    renderAdaLine(
      isSixSevenModInstalled()
        ? "6-7"
        : state.adaLine || GameData.ada?.idle || adaText("welcome")
    );
  }

  function maybeAdaAfterCraft(gameState, recipe) {
    if (!gameState || !recipe) return;
    const out = recipe.output?.id;
    if (out === "plank") speakAda(gameState, "firstPlanks");
    if (out === "woodPick" || recipe.unlocksTool === "woodPick") {
      speakAda(gameState, "woodPick");
    }
    if (out === "copperWire") speakAda(gameState, "firstWire");
    if (out === "bucket") speakAda(gameState, "firstBucket");
    if (out === "ice") speakAda(gameState, "firstIce");
  }

  function grantRecipeReturns(gameState, recipe) {
    const returns = recipe?.returns;
    if (!gameState || !returns) return;
    for (const [id, n] of Object.entries(returns)) {
      if (n > 0) addItem(gameState, id, n);
    }
  }

  function isWetWeather(gameState) {
    const kind = gameState?.weather?.kind;
    return kind === "rain" || kind === "thunder";
  }

  /** Fill an empty Iron Bucket from rain on empty outdoor ground. */
  function tryCollectRainWater(gameState, tile) {
    if (!gameState || !tile) return false;
    if (isInsideBase(gameState)) return false;
    if (!isWetWeather(gameState)) return false;
    if (tile.machine) return false;
    if (tile.node && tile.hp > 0) return false;
    if (!canActWithHealth(gameState)) return false;
    ensureBag(gameState);
    rebuildInventoryFromBag(gameState);
    if ((gameState.inventory.bucket || 0) < 1) {
      setToast(gameState, "Need an empty Iron Bucket to hold water");
      return true;
    }
    removeItem(gameState, "bucket", 1);
    addItem(gameState, "waterBucket", 1);
    applyHungerCost(gameState, hungerActionCost());
    setToast(gameState, "Filled Iron Bucket with rainwater");
    speakAda(gameState, "firstWater");
    return true;
  }

  /** Set a Water Bucket on the ground (freeze it beside a powered Fan). */
  function tryPlaceWaterBucket(gameState, tile) {
    if (!gameState || !tile) return false;
    if (isInsideBase(gameState)) return false;
    if (tile.machine) return false;
    if (tile.node && tile.hp > 0) return false;
    if (!canActWithHealth(gameState)) return false;
    ensureBag(gameState);
    rebuildInventoryFromBag(gameState);
    if ((gameState.inventory.waterBucket || 0) < 1) return false;
    removeItem(gameState, "waterBucket", 1);
    tile.machine = "waterBucket";
    if (!tile.node) tile.kind = "machine";
    gameState.machines.push({
      type: "waterBucket",
      x: tile.x,
      y: tile.y,
      freezeMinutes: 0,
      timer: 0,
      interval: 0,
    });
    applyHungerCost(gameState, hungerActionCost());
    setToast(gameState, "Water Bucket placed — put a powered Fan beside it to freeze Ice");
    return true;
  }

  function pickupPlacedWaterBucket(gameState, tile) {
    if (!gameState || !tile || tile.machine !== "waterBucket") return false;
    if (!canActWithHealth(gameState)) return false;
    gameState.machines = (gameState.machines || []).filter(
      (m) => !(m.type === "waterBucket" && m.x === tile.x && m.y === tile.y)
    );
    tile.machine = null;
    if (!tile.node) tile.kind = "grass";
    else tile.kind = "node";
    addItem(gameState, "waterBucket", 1);
    applyHungerCost(gameState, hungerActionCost());
    setToast(gameState, "Picked up Water Bucket");
    return true;
  }

  function waterBucketBesidePoweredFan(gameState, bucket, poweredTiles) {
    if (!gameState || !bucket) return false;
    for (const fan of gameState.machines || []) {
      if (fan.type !== "fan") continue;
      if (chebyshevDist(fan.x, fan.y, bucket.x, bucket.y) > 1) continue;
      if (isMachinePowered(gameState, fan, poweredTiles)) return true;
    }
    return false;
  }

  /** Powered Fans freeze adjacent placed Water Buckets into Ice. */
  function fanFreezesWaterBuckets(gameState, minutes) {
    if (!gameState || minutes < 1) return;
    const need = GameData.cooling?.fanFreezeMinutes ?? 5;
    const poweredTiles = computePoweredTiles(gameState);
    const done = [];
    for (const bucket of gameState.machines || []) {
      if (bucket.type !== "waterBucket") continue;
      if (!Number.isFinite(bucket.freezeMinutes)) bucket.freezeMinutes = 0;
      if (!waterBucketBesidePoweredFan(gameState, bucket, poweredTiles)) {
        bucket.freezeMinutes = 0;
        continue;
      }
      bucket.freezeMinutes += minutes;
      if (bucket.freezeMinutes < need) continue;
      done.push(bucket);
    }
    for (const bucket of done) {
      const tile = getTile(gameState, bucket.x, bucket.y);
      gameState.machines = gameState.machines.filter((m) => m !== bucket);
      if (tile && tile.machine === "waterBucket") {
        tile.machine = null;
        if (!tile.node) tile.kind = "grass";
        else tile.kind = "node";
      }
      addItem(gameState, "ice", 1);
      addItem(gameState, "bucket", 1);
      setToast(gameState, "Fan froze the water → +1 Ice (empty bucket returned)");
      speakAda(gameState, "firstFanIce");
      speakAda(gameState, "firstIce");
    }
  }

  function setToast(state, msg) {
    // 6-7 Mod: every word in toasts becomes 6-7.
    if (isSixSevenModInstalled()) {
      msg = window.KeaghanApp?.sixSevenizeText?.(msg) ?? String(msg).replace(/\S+/g, "6-7");
    }
    state.toast = msg;
    state.toastUntil = performance.now() + 2200;
  }

  const DAWN_MINUTES = 6 * 60; // 6:00 a.m. — monsters flee
  const DUSK_MINUTES = 18 * 60; // 6:00 p.m. — monsters appear

  const WEATHER_TICK_MINUTES = 30;
  const WEATHER_RAIN_MINUTES = 5 * 60;
  const WEATHER_THUNDER_MINUTES = 5 * 60;
  const WEATHER_THUNDER_AFTERMATH_RAIN_MINUTES = 3 * 60;
  const WEATHER_CLEAR_RAIN_CHANCE = 0.05;
  const WEATHER_RAIN_THUNDER_CHANCE = 0.05;

  function normalizeWeather(weather) {
    const kind = weather?.kind === "rain" || weather?.kind === "thunder" ? weather.kind : null;
    let minutesLeft = 0;
    if (kind && Number.isFinite(weather?.minutesLeft)) {
      minutesLeft = Math.max(0, Math.floor(weather.minutesLeft));
    } else if (kind && Number.isFinite(weather?.hoursLeft)) {
      // Migrate older hour-based weather saves.
      minutesLeft = Math.max(0, Math.floor(weather.hoursLeft) * 60);
    }
    const thunderLocked = Boolean(weather?.thunderLocked);
    if (!kind || minutesLeft < 1) {
      return { kind: null, minutesLeft: 0, thunderLocked: false };
    }
    return { kind, minutesLeft, thunderLocked };
  }

  function ensureWeather(gameState) {
    if (!gameState) return;
    gameState.weather = normalizeWeather(gameState.weather);
  }

  /** How many :00 / :30 clock boundaries are crossed from prev → next. */
  function weatherTicksCrossed(prev, next) {
    const day = 24 * 60;
    if (prev === next) return 0;
    const prevSlot = Math.floor(prev / WEATHER_TICK_MINUTES);
    const nextSlot = Math.floor(next / WEATHER_TICK_MINUTES);
    const slotsPerDay = day / WEATHER_TICK_MINUTES;
    if (next >= prev) return Math.max(0, nextSlot - prevSlot);
    return Math.max(0, slotsPerDay - prevSlot + nextSlot);
  }

  /**
   * On each clock :00 / :30:
   * - clear skies: 5% chance of rain (5h)
   * - raining: 5% chance to become thunder (unless thunderLocked)
   * - thunder ending → rain for 3h with thunderLocked (cannot return to thunder)
   */
  function tickWeatherInterval(gameState) {
    ensureWeather(gameState);
    const w = gameState.weather;

    if (w.kind === "thunder") {
      w.minutesLeft = Math.max(0, w.minutesLeft - WEATHER_TICK_MINUTES);
      if (w.minutesLeft > 0) return;
      w.kind = "rain";
      w.minutesLeft = WEATHER_THUNDER_AFTERMATH_RAIN_MINUTES;
      w.thunderLocked = true;
      setToast(gameState, "The storm eases into rain");
      return;
    }

    if (w.kind === "rain") {
      if (!w.thunderLocked && Math.random() < WEATHER_RAIN_THUNDER_CHANCE) {
        w.kind = "thunder";
        w.minutesLeft = WEATHER_THUNDER_MINUTES;
        setToast(gameState, "Thunder rolls in");
        return;
      }

      w.minutesLeft = Math.max(0, w.minutesLeft - WEATHER_TICK_MINUTES);
      if (w.minutesLeft > 0) return;

      w.kind = null;
      w.minutesLeft = 0;
      w.thunderLocked = false;
      setToast(gameState, "The rain has stopped");
      return;
    }

    // Clear skies — only rain can start (thunder only upgrades from rain).
    if (Math.random() < WEATHER_CLEAR_RAIN_CHANCE) {
      w.kind = "rain";
      w.minutesLeft = WEATHER_RAIN_MINUTES;
      w.thunderLocked = false;
      setToast(gameState, "Rain begins to fall");
    }
  }

  function isNightTime(worldMinutes) {
    const day = 24 * 60;
    const m = ((Math.floor(worldMinutes) % day) + day) % day;
    // Night: 6:00 p.m. … just before 6:00 a.m.
    return m >= DUSK_MINUTES || m < DAWN_MINUTES;
  }

  /**
   * 0 at dusk → 1 at dawn. Depleted-node center glows brighter as 6:00 a.m. nears.
   * Daytime returns 1 (nodes should already have regrown at dawn).
   */
  function dawnApproachProgress(worldMinutes) {
    const day = 24 * 60;
    const m = ((Math.floor(worldMinutes) % day) + day) % day;
    if (m >= DAWN_MINUTES && m < DUSK_MINUTES) return 1;
    const nightLen = day - DUSK_MINUTES + DAWN_MINUTES;
    const intoNight =
      m >= DUSK_MINUTES ? m - DUSK_MINUTES : day - DUSK_MINUTES + m;
    return Math.max(0, Math.min(1, intoNight / nightLen));
  }

  function crossedTimeBoundary(prev, next, boundary) {
    if (prev === next) return false;
    if (prev < next) return prev < boundary && next >= boundary;
    return false;
  }

  function crossedDawn(prev, next) {
    return crossedTimeBoundary(prev, next, DAWN_MINUTES);
  }

  function crossedDusk(prev, next) {
    return crossedTimeBoundary(prev, next, DUSK_MINUTES);
  }

  function clearNightMonsters(gameState, { toast } = {}) {
    if (!gameState) return;
    const had = Array.isArray(gameState.monsters) && gameState.monsters.length > 0;
    gameState.monsters = [];
    if (toast && had) setToast(gameState, "The monsters flee at dawn");
  }

  function monsterMaxHp() {
    return Math.max(1, Math.floor(GameData.monsters?.maxHp ?? 20));
  }

  function normalizeMonsters(gameState) {
    if (!gameState) return;
    if (!Array.isArray(gameState.monsters)) gameState.monsters = [];
    const maxHp = monsterMaxHp();
    gameState.monsters = gameState.monsters
      .filter(
        (m) =>
          m &&
          Number.isFinite(m.x) &&
          Number.isFinite(m.y) &&
          m.x >= 0 &&
          m.y >= 0 &&
          m.x < COLS &&
          m.y < ROWS
      )
      .map((m) => {
        const rawHp = Number.isFinite(m.hp) ? Math.floor(m.hp) : maxHp;
        return {
          x: Math.floor(m.x),
          y: Math.floor(m.y),
          hp: Math.max(1, Math.min(maxHp, rawHp)),
        };
      });
    if (!isNightTime(gameState.worldMinutes)) {
      gameState.monsters = [];
    }
  }

  function isMonsterSpawnTile(gameState, x, y) {
    // Same blockers as movement (not player walkability — base is off-limits to them).
    return isMonsterWalkable(gameState, x, y);
  }

  function spawnNightMonsters(gameState) {
    if (!gameState) return;
    const want = Math.max(1, Math.floor(GameData.monsters?.count ?? 3));
    const edge = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const onEdge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        if (!onEdge) continue;
        if (isMonsterSpawnTile(gameState, x, y)) edge.push({ x, y });
      }
    }
    // Fallback: any empty land if the rim is crowded.
    const pool = edge.length ? edge : [];
    if (!pool.length) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (isMonsterSpawnTile(gameState, x, y)) pool.push({ x, y });
        }
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const maxHp = monsterMaxHp();
    gameState.monsters = pool.slice(0, want).map((p) => ({ x: p.x, y: p.y, hp: maxHp }));
    ensureMonstersOnWalkable(gameState);
    if (gameState.monsters.length) {
      setToast(gameState, "Night monsters emerge — stay alert until dawn!");
      speakAda(gameState, "firstNight");
    }
  }

  /**
   * Monsters match the human for solid world blockers:
   * no trees, rocks, ores, carrots, or buildings (Iron Base included).
   * @param {object|null} exceptMonster — ignore this monster for occupancy (self).
   */
  function isMonsterWalkable(gameState, x, y, exceptMonster = null) {
    const tile = getTile(gameState, x, y);
    if (!tile) return false;
    if (tile.machine) return false;
    if (terrainBlocksMovement(tile)) return false;
    if (monsterAt(gameState, x, y, exceptMonster)) return false;
    normalizePlayer(gameState);
    // Stay adjacent — don't stack on the player (reach damage still applies).
    if (x === gameState.player.x && y === gameState.player.y) return false;
    return true;
  }

  /** Nudge monsters off illegal tiles (e.g. after a building appears under them). */
  function ensureMonstersOnWalkable(gameState) {
    if (!gameState || !Array.isArray(gameState.monsters)) return;
    for (const monster of gameState.monsters) {
      if (!monster) continue;
      if (isMonsterWalkable(gameState, monster.x, monster.y, monster)) continue;
      let best = null;
      let bestDist = Infinity;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!isMonsterWalkable(gameState, x, y, monster)) continue;
          const dist = Math.abs(x - monster.x) + Math.abs(y - monster.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = { x, y };
          }
        }
      }
      if (best) {
        monster.x = best.x;
        monster.y = best.y;
      }
    }
  }

  function stepMonsterTowardPlayer(gameState, monster) {
    normalizePlayer(gameState);
    const px = gameState.player.x;
    const py = gameState.player.y;
    const dx = Math.sign(px - monster.x);
    const dy = Math.sign(py - monster.y);
    const tries = [];
    if (dx || dy) {
      tries.push({ x: monster.x + dx, y: monster.y + dy });
      if (dx && dy) {
        tries.push({ x: monster.x + dx, y: monster.y });
        tries.push({ x: monster.x, y: monster.y + dy });
      }
    }
    for (const step of tries) {
      if (step.x < 0 || step.y < 0 || step.x >= COLS || step.y >= ROWS) continue;
      if (!isMonsterWalkable(gameState, step.x, step.y, monster)) continue;
      monster.x = step.x;
      monster.y = step.y;
      return;
    }
  }

  function applyMonsterContactDamage(gameState) {
    if (!gameState?.monsters?.length) return;
    if (isInsideBase(gameState)) return;
    normalizePlayer(gameState);
    // Iron Base is a safe zone — monsters can't hurt you on it.
    if (isPlayerOnBase(gameState)) return;
    const touching = gameState.monsters.some((m) =>
      isInPlayerReach(gameState, m.x, m.y)
    );
    if (!touching) return;
    const pct = GameData.monsters?.damagePercentPerFiveMinutes ?? 2;
    const dmg = Math.max(1, Math.floor((healthMax() * pct) / 100));
    applyHealthCost(gameState, dmg);
    if (gameState.health > 0) {
      setToast(gameState, "A monster claws you!");
    }
  }

  function tickMonsters(gameState, ticks = 1) {
    if (!gameState || ticks < 1) return;
    if (isInsideBase(gameState)) return;
    if (!isNightTime(gameState.worldMinutes)) return;
    normalizeMonsters(gameState);
    if (!gameState.monsters.length) return;
    for (let i = 0; i < ticks; i++) {
      ensureMonstersOnWalkable(gameState);
      for (const monster of gameState.monsters) {
        stepMonsterTowardPlayer(gameState, monster);
      }
      applyMonsterContactDamage(gameState);
      if (gameState.health <= 0) return;
    }
  }

  /** Click a monster in 3×3 reach: fist = 1 HP, Iron Sword = one-shot (20 HP). */
  function hitMonsterAt(gameState, x, y) {
    if (!gameState || !isInPlayerReach(gameState, x, y)) return false;
    const idx = gameState.monsters.findIndex((m) => m && m.x === x && m.y === y);
    if (idx < 0) return false;
    if (!canActWithHealth(gameState)) return false;

    const monster = gameState.monsters[idx];
    const maxHp = monsterMaxHp();
    if (!Number.isFinite(monster.hp)) monster.hp = maxHp;

    const tool = gameState.activeTool || "hand";
    const sword = GameData.monsters?.swordTool || "ironSword";
    const damage =
      tool === sword
        ? Math.max(1, Math.floor(GameData.monsters?.swordDamage ?? maxHp))
        : Math.max(1, Math.floor(GameData.monsters?.fistDamage ?? 1));

    monster.hp = Math.max(0, monster.hp - damage);
    applyHungerCost(gameState, hungerActionCost());

    if (monster.hp <= 0) {
      gameState.monsters.splice(idx, 1);
      setToast(
        gameState,
        gameState.monsters.length
          ? "You slew a monster!"
          : "You slew the last monster — for now"
      );
    } else {
      setToast(
        gameState,
        tool === sword
          ? `Monster ${monster.hp}/${maxHp}`
          : `Fist hit! Monster ${monster.hp}/${maxHp} HP`
      );
    }
    return true;
  }

  /** 0 = 12:00 a.m. … 720 = 12:00 p.m. Minutes wrap at 1440. */
  function advanceWorldTime(gameState, minutes = 5) {
    const day = 24 * 60;
    const prev = ((gameState.worldMinutes || 0) % day + day) % day;
    gameState.worldMinutes = (prev + minutes) % day;
    if (crossedDawn(prev, gameState.worldMinutes)) {
      clearNightMonsters(gameState, { toast: true });
      regrowNodesAtDawn(gameState);
    }
    if (crossedDusk(prev, gameState.worldMinutes)) {
      spawnNightMonsters(gameState);
    }
    const crossed = weatherTicksCrossed(prev, gameState.worldMinutes);
    for (let i = 0; i < crossed; i++) tickWeatherInterval(gameState);
    tickSmelters(gameState, minutes);
    fanFreezesWaterBuckets(gameState, minutes);
    recordGeneratorHourEnergy(gameState, minutes);
    tickPlayerCool(gameState, minutes);
    // Hunger + HP ticks every 5 in-game minutes.
    const step = 5;
    const ticks = Math.floor(Math.max(0, minutes) / step);
    if (ticks < 1) return;
    const hungerDrain = ticks * (GameData.hunger?.passivePerFiveMinutes ?? 5);
    applyHungerCost(gameState, hungerDrain);
    normalizeHunger(gameState);
    normalizeHealth(gameState);
    if (gameState.hunger <= 0) {
      // Starving: 1% of max HP per 5 in-game minutes.
      const starvePct = GameData.health?.starvePercentPerFiveMinutes ?? 1;
      const perTick = Math.max(1, Math.floor((healthMax() * starvePct) / 100));
      applyHealthCost(gameState, ticks * perTick);
    } else if (hungerPercent(gameState.hunger) >= (GameData.health?.regenHungerPercent ?? 50)) {
      applyHealthGain(gameState, ticks * (GameData.health?.regenPerFiveMinutes ?? 10));
    }
    // Night hunters move + bite after vitals so death from claws still works.
    if (gameState.health > 0) tickMonsters(gameState, ticks);
  }

  function regrowNodesAtDawn(gameState) {
    let grown = 0;
    let blocked = 0;
    for (const tile of gameState.tiles) {
      if (!tile.node) continue;
      if (tile.machine) {
        // Factory on top: resources stay gone until machinery is demolished.
        if (tile.hp <= 0) blocked += 1;
        continue;
      }
      const def = GameData.nodeTypes[tile.node];
      if (!def) continue;
      if (tile.hp < def.hp) {
        tile.hp = def.hp;
        tile.maxHp = def.hp;
        tile.respawn = null;
        tile.kind = "node";
        grown += 1;
      }
    }
    if (grown > 0) {
      setToast(
        gameState,
        blocked > 0
          ? `Dawn: ${grown} nodes grew back (${blocked} blocked by machines)`
          : `Dawn: resources grew back`
      );
    } else if (blocked > 0) {
      setToast(gameState, "Dawn: machines are blocking some nodes from growing");
    }
    // A node may have grown under the player — nudge them onto empty land.
    ensurePlayerOnWalkable(gameState);
  }

  function formatWorldTime(worldMinutes) {
    const total = ((Math.floor(worldMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const isPm = hour24 >= 12;
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    const mm = String(minute).padStart(2, "0");
    return `${hour12}:${mm} ${isPm ? "p.m." : "a.m."}`;
  }

  /** Arrow points: 6am left, noon up, 6pm right, midnight down. */
  function clockHandBaseDegrees(worldMinutes) {
    const total = ((Math.floor(worldMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
    // Hand graphic points UP at rotate(0). Midnight is down → +180°.
    return (total / (24 * 60)) * 360 + 180;
  }

  // Continuous hand angle so midnight doesn't wrap 540°→180° (CSS would spin CCW).
  let clockHandDegreesLive = null;
  let clockHandLastMinutes = null;

  function clockHandDegrees(worldMinutes) {
    const day = 24 * 60;
    const total = ((Math.floor(worldMinutes) % day) + day) % day;
    const base = clockHandBaseDegrees(total);

    if (clockHandDegreesLive == null || clockHandLastMinutes == null) {
      clockHandDegreesLive = base;
      clockHandLastMinutes = total;
      return clockHandDegreesLive;
    }

    let deltaMin = total - clockHandLastMinutes;
    if (deltaMin < -day / 2) deltaMin += day; // crossed midnight forward
    if (deltaMin > day / 2) deltaMin -= day; // rare backward jump
    clockHandDegreesLive += (deltaMin / day) * 360;
    clockHandLastMinutes = total;
    return clockHandDegreesLive;
  }

  function resetClockHandTracking() {
    clockHandDegreesLive = null;
    clockHandLastMinutes = null;
  }

  /**
   * Sky phases from the day clock:
   * sunrise 6–7am, day 7am–12pm, noon 12–1pm, day 1–6pm,
   * sunset 6–7pm, night 7pm–12am, midnight 12–1am, night 1–6am.
   */
  function skyPhaseFromMinutes(worldMinutes) {
    const day = 24 * 60;
    const t = ((Math.floor(worldMinutes) % day) + day) % day;
    if (t >= 6 * 60 && t < 7 * 60) return "sunrise";
    if (t >= 7 * 60 && t < 12 * 60) return "day-morning";
    if (t >= 12 * 60 && t < 13 * 60) return "noon";
    if (t >= 13 * 60 && t < 18 * 60) return "day-afternoon";
    if (t >= 18 * 60 && t < 19 * 60) return "sunset";
    if (t >= 19 * 60) return "night-evening";
    if (t < 60) return "midnight";
    return "night-late";
  }

  function ensureRainDrops() {
    const rain = document.getElementById("sky-rain");
    if (!rain || rain.childElementCount > 0) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 48; i++) {
      const drop = document.createElement("span");
      drop.className = "sky__raindrop";
      drop.style.left = `${Math.random() * 100}%`;
      drop.style.animationDelay = `${Math.random() * 1.6}s`;
      drop.style.animationDuration = `${0.55 + Math.random() * 0.55}s`;
      drop.style.opacity = `${0.35 + Math.random() * 0.5}`;
      frag.appendChild(drop);
    }
    rain.appendChild(frag);
  }

  /**
   * Place a sky body on the same compass as the clock hand.
   * Hand rotate(0)=up, 90=right, 180=down, 270=left — matches CSS clock.
   */
  function skyBodyPositionFromDegrees(degrees) {
    const rad = (degrees * Math.PI) / 180;
    // Match CSS clock rotate: 0=up, 90=right, 180=down, 270=left.
    const sx = Math.sin(rad);
    const sy = Math.cos(rad); // +1 up, -1 down
    // Elliptical orbit so bodies stay readable over the landscape.
    const left = 50 + sx * 42;
    const top = 48 - sy * 36;
    return { left, top, elevation: sy };
  }

  function skyBodyOpacity(elevation) {
    // Soft horizon fade: visible near sunrise/sunset, full when high, hidden below.
    return Math.max(0, Math.min(1, (elevation + 0.28) / 0.62));
  }

  function clearSkyBodyStyles(el) {
    if (!el) return;
    el.style.left = "";
    el.style.top = "";
    el.style.opacity = "";
    el.style.transform = "";
    el.style.background = "";
  }

  /** Mix two #rrggbb colors by t in [0,1]. */
  function mixHex(a, b, t) {
    const n = (hex) => {
      const h = hex.replace("#", "");
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    };
    const A = n(a);
    const B = n(b);
    const u = Math.max(0, Math.min(1, t));
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * u));
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  /**
   * Sky palette from sun elevation (-1..1) and whether the moon is lighting.
   * Warm near horizon, blue midday, deep blue at night (never pure black).
   */
  function skyPalette(elevation, useSun) {
    if (useSun) {
      const day = Math.max(0, Math.min(1, (elevation + 0.15) / 1.15));
      const horizon = Math.max(0, 1 - Math.abs(elevation) / 0.55);
      const top = mixHex(mixHex("#3a4a6a", "#6eb7e0", day), "#ffb070", horizon * 0.55);
      const mid = mixHex(mixHex("#c47a4a", "#9ed0c0", day), "#f0b429", horizon * 0.65);
      const bottom = mixHex(mixHex("#5a3a28", "#6a9a70", day), "#c47a4a", horizon * 0.45);
      const glowAlpha = (0.28 + day * 0.28 + horizon * 0.2).toFixed(2);
      const glowRgb = horizon > 0.35 ? "255, 150, 70" : "255, 235, 170";
      return {
        top,
        mid,
        bottom,
        glow: `rgba(${glowRgb}, ${glowAlpha})`,
      };
    }
    const nightLift = Math.max(0, Math.min(1, (elevation + 0.1) / 1.1));
    return {
      top: mixHex("#152038", "#2a3a58", nightLift),
      mid: mixHex("#1a2838", "#2e4058", nightLift),
      bottom: mixHex("#142028", "#1c2c30", nightLift),
      glow: `rgba(160, 190, 255, ${(0.16 + nightLift * 0.16).toFixed(2)})`,
    };
  }

  function updateSkyWash(bodyPos, elevation, useSun) {
    const wash = document.querySelector(".sky__wash");
    const glow = document.getElementById("sky-glow");
    if (!wash) return;

    const palette = skyPalette(elevation, useSun);
    const x = bodyPos.left.toFixed(2);
    const y = bodyPos.top.toFixed(2);
    // Bright spot is locked to the sun/moon — not a fixed phase corner.
    wash.style.background = [
      `radial-gradient(ellipse 58% 50% at ${x}% ${y}%, ${palette.glow}, transparent 64%)`,
      `linear-gradient(180deg, ${palette.top} 0%, ${palette.mid} 48%, ${palette.bottom} 100%)`,
    ].join(", ");

    if (glow) {
      const opacity = skyBodyOpacity(elevation) * (useSun ? 0.9 : 0.7);
      glow.style.left = `${bodyPos.left}%`;
      glow.style.top = `${bodyPos.top}%`;
      glow.style.opacity = String(opacity);
      glow.style.background = `radial-gradient(ellipse at center, ${palette.glow} 0%, transparent 70%)`;
    }
  }

  function updateSkyBodies(handDegrees) {
    const sun = document.querySelector(".sky__sun");
    const moon = document.querySelector(".sky__moon");
    if (!sun || !moon) return;

    const sunPos = skyBodyPositionFromDegrees(handDegrees);
    const moonPos = skyBodyPositionFromDegrees(handDegrees + 180);
    const sunOpacity = skyBodyOpacity(sunPos.elevation);
    const moonOpacity = skyBodyOpacity(moonPos.elevation);
    const sunScale = 0.9 + sunOpacity * 0.18;
    const moonScale = 0.9 + moonOpacity * 0.16;

    sun.style.left = `${sunPos.left}%`;
    sun.style.top = `${sunPos.top}%`;
    sun.style.opacity = String(sunOpacity);
    sun.style.transform = `translate(-50%, -50%) scale(${sunScale})`;

    moon.style.left = `${moonPos.left}%`;
    moon.style.top = `${moonPos.top}%`;
    moon.style.opacity = String(moonOpacity);
    moon.style.transform = `translate(-50%, -50%) scale(${moonScale})`;

    const useSun = sunOpacity >= moonOpacity;
    const lit = useSun ? sunPos : moonPos;
    updateSkyWash(lit, lit.elevation, useSun);
  }

  function updateSkyBackground(handDegrees = null) {
    const sky = document.getElementById("sky-layer");
    const atmo = document.querySelector(".atmosphere");
    if (!sky || !atmo) return;

    if (!playActive || !state) {
      sky.hidden = true;
      sky.removeAttribute("data-phase");
      sky.removeAttribute("data-weather");
      atmo.removeAttribute("data-sky-phase");
      atmo.removeAttribute("data-weather");
      clearSkyBodyStyles(document.querySelector(".sky__sun"));
      clearSkyBodyStyles(document.querySelector(".sky__moon"));
      clearSkyBodyStyles(document.getElementById("sky-glow"));
      window.KeaghanSfx?.setWeather?.(null);
      window.KeaghanSfx?.setWeatherMuffled?.(false);
      // Keep last wash colors — clearing background caused a black flash.
      return;
    }

    ensureWeather(state);
    ensureRainDrops();

    const phase = skyPhaseFromMinutes(state.worldMinutes);
    const weather = state.weather?.kind || "";
    const degrees =
      handDegrees == null ? clockHandDegrees(state.worldMinutes) : handDegrees;

    // Paint + show sky before touching atmosphere attrs (old solid phase fills flashed black).
    updateSkyBodies(degrees);
    if (sky.dataset.phase !== phase) sky.dataset.phase = phase;
    if ((sky.dataset.weather || "") !== weather) {
      if (weather) sky.dataset.weather = weather;
      else sky.removeAttribute("data-weather");
    }
    sky.hidden = false;

    if (atmo.dataset.skyPhase !== phase) atmo.dataset.skyPhase = phase;
    if ((atmo.dataset.weather || "") !== weather) {
      if (weather) atmo.dataset.weather = weather;
      else atmo.removeAttribute("data-weather");
    }

    // Rain loop while raining/storming; thunder cracks on the lightning cycle.
    // Indoors: keep the weather audible but muffled (walls dampen it).
    window.KeaghanSfx?.setWeather?.(weather || null);
    window.KeaghanSfx?.setWeatherMuffled?.(isInsideBase(state));
  }

  function renderVitalsMeter(kind) {
    if (!state) return;
    const isHealth = kind === "health";
    if (isHealth) normalizeHealth(state);
    else normalizeHunger(state);
    const points = isHealth ? state.health : state.hunger;
    const max = isHealth ? healthMax() : hungerMax();
    const pct = isHealth ? healthPercent(points) : hungerPercent(points);
    const fill = document.getElementById(isHealth ? "health-fill" : "hunger-fill");
    const pctEl = document.getElementById(isHealth ? "health-pct" : "hunger-pct");
    const ptsEl = document.getElementById(isHealth ? "health-points" : "hunger-points");
    const meter = document.getElementById(isHealth ? "health-meter" : "hunger-meter");
    if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, points / max))})`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (ptsEl) ptsEl.textContent = `${points}/${max}`;
    if (meter) {
      meter.setAttribute("aria-valuenow", String(points));
      meter.setAttribute("aria-valuetext", `${pct}% · ${points} / ${max}`);
      // Full >50%, orange-yellow ≤50%, red ≤15%.
      meter.classList.toggle("is-low", pct <= 50 && pct > 15);
      meter.classList.toggle("is-critical", pct <= 15);
    }
  }

  function renderHunger() {
    renderVitalsMeter("hunger");
    renderVitalsMeter("health");
  }

  /**
   * Outdoor island temperature from the day clock + weather.
   * Base is snug (~22°C). Night/storms cool; noon can get hot.
   */
  function outdoorTempC(gameState) {
    const day = 24 * 60;
    const t = ((Math.floor(gameState?.worldMinutes || 0) % day) + day) % day;
    // Piecewise day curve (°C).
    let temp;
    if (t < 60) temp = 8; // midnight hour
    else if (t < 6 * 60) {
      // 1am–6am: 8 → 12
      temp = 8 + ((t - 60) / (5 * 60)) * 4;
    } else if (t < 12 * 60) {
      // 6am–noon: 12 → 28
      temp = 12 + ((t - 6 * 60) / (6 * 60)) * 16;
    } else if (t < 18 * 60) {
      // noon–6pm: 28 → 22
      temp = 28 - ((t - 12 * 60) / (6 * 60)) * 6;
    } else if (t < 19 * 60) {
      // sunset hour: 22 → 16
      temp = 22 - ((t - 18 * 60) / 60) * 6;
    } else {
      // 7pm–midnight: 16 → 8
      temp = 16 - ((t - 19 * 60) / (5 * 60)) * 8;
    }

    const weather = gameState?.weather?.kind;
    if (weather === "rain") temp -= 4;
    else if (weather === "thunder") temp -= 7;

    return Math.round(temp);
  }

  /** What the pioneer feels — habitat softens outdoor extremes; Ice adds a chill buff. */
  function playerTempC(gameState) {
    let temp = outdoorTempC(gameState);
    if (isInsideBase(gameState)) {
      // Inside the Base: pull toward a comfy 22°C.
      temp = temp + (22 - temp) * 0.65;
    }
    normalizePlayerCool(gameState);
    if (gameState.playerCoolMinutesLeft > 0) {
      temp -= GameData.cooling?.playerDropC ?? 10;
    }
    // Powered Fan beside you (outdoor) — steady breeze.
    const powered = typeof poweredTilesCache !== "undefined" && poweredTilesCache
      ? poweredTilesCache
      : computePoweredTiles(gameState);
    if (playerNearPoweredFan(gameState, powered)) {
      temp -= GameData.cooling?.fanPlayerDropC ?? 8;
    }
    return Math.round(temp);
  }

  function playerTempNote(tempC, indoors, iced, fanBreeze) {
    if (fanBreeze) return "Fan breeze";
    if (iced) return "Iced";
    if (indoors) {
      if (tempC <= 14) return "Chilly inside";
      if (tempC >= 26) return "Warm inside";
      return "Habitat";
    }
    if (tempC <= 8) return "Freezing";
    if (tempC <= 14) return "Cold";
    if (tempC <= 20) return "Cool";
    if (tempC <= 26) return "Mild";
    if (tempC <= 30) return "Warm";
    return "Hot";
  }

  function renderPlayerTemp() {
    if (!root || !state) return;
    const wrap = root.querySelector("#player-temp");
    const fill = root.querySelector("#player-temp-fill");
    const valueEl = root.querySelector("#player-temp-value");
    const noteEl = root.querySelector("#player-temp-note");
    if (!wrap || !valueEl) return;

    normalizePlayerCool(state);
    const indoors = isInsideBase(state);
    const iced = state.playerCoolMinutesLeft > 0;
    const powered = poweredTilesCache || computePoweredTiles(state);
    const fanBreeze = playerNearPoweredFan(state, powered);
    const temp = playerTempC(state);
    const note = playerTempNote(temp, indoors, iced, fanBreeze);
    // Gauge span for fill height (~0–36°C).
    const minT = 0;
    const maxT = 36;
    const pct = Math.max(0, Math.min(100, ((temp - minT) / (maxT - minT)) * 100));

    valueEl.textContent = `${temp}°C`;
    if (noteEl) noteEl.textContent = note;
    if (fill) fill.style.height = `${pct}%`;
    wrap.classList.toggle("is-cold", temp <= 14 || iced || fanBreeze);
    wrap.classList.toggle("is-hot", !iced && !fanBreeze && temp >= 27 && temp < 31);
    wrap.classList.toggle("is-swelter", !iced && !fanBreeze && temp >= 31);
    wrap.classList.toggle("is-iced", iced || fanBreeze);
    const coolLeft = iced
      ? ` · Ice buff ${state.playerCoolMinutesLeft}m`
      : fanBreeze
        ? " · Fan breeze"
        : "";
    wrap.title = indoors
      ? `Inside Base · ${temp}°C (outdoor ${outdoorTempC(state)}°C)${coolLeft}`
      : `Island air · ${temp}°C${coolLeft}`;
  }

  function renderClock() {
    if (!root || !state) return;
    const timeEl = root.querySelector("#clock-time");
    const handEl = root.querySelector("#clock-hand");
    const label = formatWorldTime(state.worldMinutes);
    const handDegrees = clockHandDegrees(state.worldMinutes);
    if (timeEl) timeEl.textContent = label;
    if (handEl) {
      // Keep hub-centered pivot from CSS; only set rotation angle.
      handEl.style.transform = `translate(-50%, -100%) rotate(${handDegrees}deg)`;
    }
    updateSkyBackground(handDegrees);
    renderHunger();
    renderPlayerTemp();
  }

  function grantHarvest(state, resourceId, amount, labelHint) {
    addItem(state, resourceId, amount);
    state.stats.gathered[resourceId] = (state.stats.gathered[resourceId] || 0) + amount;
    const name = GameData.getItem(resourceId).name;
    setToast(state, labelHint ? `${labelHint} · +${amount} ${name}` : `+${amount} ${name}`);
    if (resourceId === "log" || resourceId === "wood") speakAda(state, "firstLogs");
  }

  function toolTiersMeet(activeToolId, minToolId) {
    const tiers = GameData.toolTier || {};
    const have = tiers[activeToolId || "hand"] ?? 0;
    const need = tiers[minToolId || "hand"] ?? 0;
    return have >= need;
  }

  /** Every tool deals 1 damage — trees, rocks, and ores always take 5 hits. */
  function harvestDamage(_toolId, _nodeType) {
    return 1;
  }

  /** Keep saved nodes on the 5-hit scale after balance changes. */
  function normalizeNodeHitPoints(gameState) {
    if (!gameState?.tiles) return;
    for (const tile of gameState.tiles) {
      if (!tile.node) continue;
      const def = GameData.nodeTypes[tile.node];
      if (!def) continue;
      const wasFull = tile.hp > 0 && tile.hp >= (tile.maxHp || tile.hp);
      tile.maxHp = def.hp;
      if (tile.hp <= 0) continue;
      tile.hp = wasFull ? def.hp : Math.min(tile.hp, def.hp);
    }
  }

  function harvestTile(state, tile) {
    if (!tile.node || tile.machine) return false;
    if (!canActWithHealth(state)) return false;
    // Broken-down / depleted nodes give nothing until they respawn.
    if (tile.hp <= 0) {
      setToast(state, "Depleted — wait for it to refill");
      return false;
    }

    const def = GameData.nodeTypes[tile.node];
    const toolId = state.activeTool || "hand";
    const minTool = def.minTool || "hand";
    if (!toolTiersMeet(toolId, minTool)) {
      const needName = minTool === "hand" ? "your hands" : GameData.getItem(minTool).name;
      setToast(state, `Need ${needName} to mine ${def.label}`);
      return false;
    }

    const nodeType = tile.node;
    tile.hp -= harvestDamage(toolId, nodeType);

    if (tile.hp > 0) {
      window.KeaghanSfx?.playHarvest?.(nodeType, false);
      grantHarvest(state, def.resource, 1, `${def.label}… ${tile.hp}/${tile.maxHp}`);
      if (nodeType === "tree" && Math.random() < 0.18) {
        addItem(state, "apple", 1);
        window.KeaghanSfx?.playFoodPop?.();
        setToast(state, `${state.toast} · +1 Apple`);
      }
    } else {
      window.KeaghanSfx?.playHarvest?.(nodeType, true);
      // Carrots are 1-hit pickups (1 each). Other nodes drop a small pile on break.
      const amount = nodeType === "carrot" ? def.yield || 1 : 3;
      grantHarvest(state, def.resource, amount);
      if (nodeType === "tree" && Math.random() < 0.55) {
        addItem(state, "apple", 1);
        window.KeaghanSfx?.playFoodPop?.();
        setToast(state, `${state.toast} · +1 Apple`);
      }
      // Stay depleted until 6:00 a.m. (blocked further if a machine sits here).
      tile.hp = 0;
      tile.respawn = null;
    }

    // After loot toast so a starve warning can replace it when needed.
    applyHungerCost(state, hungerActionCost());
    return true;
  }

  function craft(state, recipeId, { fromStation = false } = {}) {
    const recipe = GameData.recipes.find((r) => r.id === recipeId);
    if (!recipe) return false;
    if (!canActWithHealth(state)) return false;
    if (recipe.atStation && !fromStation) {
      setToast(state, "Craft that in the Base Workroom (3×3)");
      return false;
    }
    if (!canAfford(state, recipe.cost)) {
      setToast(state, "Need more materials");
      return false;
    }
    spend(state, recipe.cost);
    addItem(state, recipe.output.id, recipe.output.count);
    grantRecipeReturns(state, recipe);
    if (!state.stats.crafted) state.stats.crafted = {};
    state.stats.crafted[recipe.output.id] =
      (state.stats.crafted[recipe.output.id] || 0) + recipe.output.count;
    if (recipe.unlocksTool) unlockTool(state, recipe.unlocksTool);
    if (recipe.unlocksTool && equippedToolId(state) === "hand") {
      if (equipTool(state, recipe.unlocksTool)) {
        /* toast set by equipTool */
      } else {
        setToast(state, `Crafted ${recipe.name} — drag to Equipment`);
      }
    } else {
      setToast(
        state,
        recipe.unlocksTool
          ? `Crafted ${recipe.name} — drag to Equipment to use`
          : `Crafted ${recipe.name}`
      );
    }
    applyHungerCost(state, hungerActionCost());
    maybeAdaAfterCraft(state, recipe);
    return true;
  }

  const PLACEABLE = [
    "drill",
    "smelter",
    "generator",
    "fan",
    "powerPole",
    "cable",
    "base",
  ];
  const MACHINE_LABELS = {
    drill: "Drill",
    smelter: "Smelter",
    generator: "Coal Generator",
    fan: "Fan",
    powerPole: "Power Pole",
    cable: "Power Line",
    craftingStation: "Crafting Table",
    base: "Base",
    deathCrate: "Death Crate",
    waterBucket: "Water Bucket",
  };
  const BUILD_STRUCTURES = [
    "smelter",
    "drill",
    "generator",
    "fan",
    "powerPole",
    "cable",
    "base",
  ];
  const BUILD_HINTS = {
    smelter: "Grass or depleted nodes — costs Stone + Coal",
    drill: "Place on a resource node (ore/coal/rock/tree) — then power it",
    generator: "Grass or depleted nodes — click the generator to load Coal",
    fan: "Grass or depleted nodes — place next to a generator; needs power to cool",
    powerPole: "Grass or depleted nodes — costs Iron Ingot + Cable",
    cable: "Grass or depleted nodes — costs 1 Cable; wires output buildings to input buildings",
    base: "Clear 5×3 — 50 Planks. Upgrade inside (30 Stone, then 30 Iron). Walk on to enter",
    demolish: "Demolish locked (F) — click buildings to remove. F or a menu to exit.",
  };

  /** Outdoor Crafting Tables removed — refund materials; use the Base workroom instead. */
  function retireOutdoorCraftingTables(gameState) {
    if (!gameState) return;
    ensureBag(gameState);
    const refundPlanks = GameData.buildCosts?.craftingStation?.plank ?? 4;
    const kept = [];
    for (const m of gameState.machines || []) {
      if (m?.type !== "craftingStation") {
        kept.push(m);
        continue;
      }
      if (Array.isArray(m.craftGrid)) {
        ensureCraftTableShape(m);
        returnGridToInv(m.craftGrid);
      }
      addItem(gameState, "plank", refundPlanks);
      const tile = getTile(gameState, m.x, m.y);
      if (tile?.machine === "craftingStation") {
        tile.machine = null;
        if (!tile.node) tile.kind = "grass";
        else tile.kind = "node";
      }
    }
    gameState.machines = kept;
    const leftover = gameState.inventory?.craftingStation || 0;
    if (leftover > 0) {
      removeItem(gameState, "craftingStation", leftover);
      addItem(gameState, "plank", leftover * refundPlanks);
    }
    if (gameState.buildMode === "craftingStation") gameState.buildMode = null;
    if (Array.isArray(gameState.bag)) {
      for (let i = 0; i < gameState.bag.length; i++) {
        const stack = gameState.bag[i];
        if (stack?.id !== "craftingStation") continue;
        const n = stack.count || 0;
        gameState.bag[i] = null;
        if (n > 0) addItem(gameState, "plank", n * refundPlanks);
      }
      rebuildInventoryFromBag(gameState);
    }
  }

  function getBaseTierInfo(tier) {
    const t = Math.max(1, Math.min(3, Math.floor(Number(tier) || 1)));
    return GameData.baseTiers?.[t] || { name: "Base", icon: "🏠", label: "Wood" };
  }

  function normalizeBaseTiers(gameState) {
    if (!gameState?.machines) return;
    for (const m of gameState.machines) {
      if (m?.type !== "base") continue;
      const tier = Math.max(1, Math.min(3, Math.floor(Number(m.tier) || 1)));
      m.tier = tier;
    }
  }

  function getBaseRefund(base) {
    const refund = { ...(getBuildCost("base") || {}) };
    const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
    for (let t = 2; t <= tier; t++) {
      const cost = GameData.baseTiers?.[t]?.cost;
      if (!cost) continue;
      for (const [id, n] of Object.entries(cost)) {
        refund[id] = (refund[id] || 0) + n;
      }
    }
    return refund;
  }

  function findPlayerBase(gameState) {
    if (!gameState) return null;
    if (isInsideBase(gameState)) {
      return gameState.machines?.find((m) => m?.type === "base") || null;
    }
    normalizePlayer(gameState);
    return findBaseMachine(gameState, gameState.player.x, gameState.player.y);
  }

  function upgradePlayerBase(gameState) {
    if (!gameState) return false;
    const base = findPlayerBase(gameState);
    if (!base) {
      setToast(gameState, "Stand on your Base to upgrade it");
      return false;
    }
    const tier = Math.max(1, Math.floor(Number(base.tier) || 1));
    const next = tier + 1;
    const nextInfo = GameData.baseTiers?.[next];
    if (!nextInfo?.cost) {
      setToast(gameState, "Base is fully upgraded (Iron)");
      return false;
    }
    if (!canAfford(gameState, nextInfo.cost)) {
      setToast(gameState, `Need ${formatCost(nextInfo.cost)} to upgrade`);
      return false;
    }
    if (!canActWithHealth(gameState)) return false;
    spend(gameState, nextInfo.cost);
    base.tier = next;
    if (isInsideBase(gameState)) rebuildInteriorMap(gameState);
    applyHungerCost(gameState, hungerActionCost());
    setToast(gameState, `Upgraded to ${nextInfo.name}!`);
    if (next === 2) speakAda(gameState, "upgradeStone");
    else if (next === 3) speakAda(gameState, "upgradeIron");
    return true;
  }

  function getStructureSize(type) {
    const size = GameData.structureSize?.[type];
    if (size && size.w >= 1 && size.h >= 1) {
      return { w: Math.floor(size.w), h: Math.floor(size.h) };
    }
    return { w: 1, h: 1 };
  }

  /** Footprint cells for a structure (origin = top-left). */
  function getStructureFootprint(type, originX, originY) {
    const { w, h } = getStructureSize(type);
    const cells = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push({ x: originX + dx, y: originY + dy });
      }
    }
    return cells;
  }

  function findBaseMachine(gameState, x, y) {
    if (!gameState?.machines) return null;
    return (
      gameState.machines.find((m) => {
        if (!m || m.type !== "base") return false;
        const w = m.w || getStructureSize("base").w;
        const h = m.h || getStructureSize("base").h;
        return x >= m.x && x < m.x + w && y >= m.y && y < m.y + h;
      }) || null
    );
  }

  function closeBaseEnterPrompt() {
    openBaseEnterPrompt = false;
    hideModal("base-enter-modal");
  }

  /** Decline enter — shove the player back off the base footprint. */
  function declineBaseEnter() {
    closeBaseEnterPrompt();
    if (state && baseEnterFrom) {
      const { x, y } = baseEnterFrom;
      baseEnterFrom = null;
      state.player = {
        x: Math.max(0, Math.min(COLS - 1, Math.floor(x))),
        y: Math.max(0, Math.min(ROWS - 1, Math.floor(y))),
      };
      setToast(state, "Stayed outside");
      saveState(state);
      render();
      return;
    }
    baseEnterFrom = null;
    setToast(state, "Stayed outside");
    renderHud();
  }

  /** Ask before going indoors — Enter / Stay outside (Stay pushes you back off). */
  function promptBaseEnter() {
    if (!state || !playActive || gamePaused) return;
    if (isInsideBase(state)) return;
    if (!isPlayerOnBase(state)) {
      baseEnterFrom = null;
      return;
    }
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeRecipesUi();
    closeBuildUi();
    closeSleepPrompt();
    closeTvPrompt();

    const base = findPlayerBase(state);
    const name = getBaseTierInfo(base?.tier).name;
    const title = document.getElementById("base-enter-title");
    const hint = document.getElementById("base-enter-hint");
    if (title) title.textContent = `Enter ${name}?`;
    if (hint) {
      hint.textContent =
        "Come inside? Stay outside and you'll step back off the base.";
    }

    openBaseEnterPrompt = true;
    showModal("base-enter-modal");
    renderHud();
  }

  function rebuildInteriorMap(gameState) {
    if (!gameState) return;
    const base = gameState.machines?.find((m) => m?.type === "base");
    const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
    const pos = gameState.insideBase ? { ...gameState.player } : null;
    gameState.interiorTiles = makeInteriorWorld(tier);
    applyDoorLockState(gameState);
    applyKeyHookState(gameState);
    if (pos && gameState.insideBase) {
      gameState.player = pos;
      normalizePlayer(gameState);
      const here = getActiveTile(gameState, gameState.player.x, gameState.player.y);
      if (!isInteriorWalkable(here, gameState)) gameState.player = interiorSpawnPos();
    }
  }

  function enterBaseInterior() {
    if (!state || !playActive) return;
    if (isInsideBase(state)) return;
    if (!isPlayerOnBase(state)) {
      baseEnterFrom = null;
      setToast(state, "Walk onto your Base to go inside");
      renderHud();
      return;
    }
    closeBaseEnterPrompt();
    baseEnterFrom = null;
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeRecipesUi();
    closeBuildUi();

    const base = findPlayerBase(state);
    const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
    state.outdoorPlayer = { x: state.player.x, y: state.player.y };
    state.insideBase = true;
    rebuildInteriorMap(state);
    state.player = interiorSpawnPos();
    setToast(state, `Inside the ${getBaseTierInfo(tier).name}`);
    speakAda(state, "enterBase");
    updateGoals(state);
    saveState(state);
    render();
  }

  /** Nearest walkable yard tile just outside the base footprint. */
  function findSpotOutsideBase(gameState, preferNear) {
    const base = gameState?.machines?.find((m) => m?.type === "base");
    const fallback = preferNear || defaultPlayerPos();
    if (!base) return fallback;
    const w = base.w || getStructureSize("base").w;
    const h = base.h || getStructureSize("base").h;
    const px = Number.isFinite(preferNear?.x) ? Math.floor(preferNear.x) : base.x;
    const py = Number.isFinite(preferNear?.y) ? Math.floor(preferNear.y) : base.y;
    const candidates = [];
    for (let y = base.y - 1; y <= base.y + h; y++) {
      for (let x = base.x - 1; x <= base.x + w; x++) {
        if (x >= base.x && x < base.x + w && y >= base.y && y < base.y + h) continue;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        const tile = getTile(gameState, x, y);
        // Outside check must ignore "inside base" map — temporarily clear flag.
        if (!tile || (tile.machine && tile.machine !== "base")) continue;
        if (terrainBlocksMovement(tile)) continue;
        if (monsterAt(gameState, x, y)) continue;
        candidates.push({
          x,
          y,
          dist: Math.abs(x - px) + Math.abs(y - py),
        });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0] || fallback;
  }

  function leaveBaseInterior(gameState, { silent = false, skipRender = false } = {}) {
    if (!gameState || !isInsideBase(gameState)) return false;
    if (hasBaseKey(gameState)) {
      if (silent) {
        returnBaseKeyToHook(gameState);
      } else {
        closeBaseLeavePrompt();
        setToast(gameState, "Hang the Base Key on the hook before leaving");
        if (!skipRender && state === gameState) renderHud();
        return false;
      }
    }
    closeBaseLeavePrompt();
    baseLeaveFrom = null;
    if (state === gameState) {
      closeCraftTableUi();
      closeKitchenUi();
      closeStorageUi();
    }
    const outdoor = gameState.outdoorPlayer || defaultPlayerPos();
    gameState.insideBase = false;
    gameState.interiorTiles = null;
    gameState.outdoorPlayer = null;
    // Push fully off the base footprint so you aren't asked to re-enter immediately.
    const spot = findSpotOutsideBase(gameState, outdoor);
    gameState.player = {
      x: Math.max(0, Math.min(COLS - 1, Math.floor(spot.x))),
      y: Math.max(0, Math.min(ROWS - 1, Math.floor(spot.y))),
    };
    ensurePlayerOnWalkable(gameState);
    if (!silent) setToast(gameState, "Back outside");
    if (!skipRender && state === gameState) {
      updateGoals(gameState);
      saveState(gameState);
      render();
    }
    return true;
  }

  function closeBaseLeavePrompt() {
    openBaseLeavePrompt = false;
    hideModal("base-leave-modal");
  }

  /** Decline leave — shove the player back off the exit door if they walked onto it. */
  function declineBaseLeave() {
    closeBaseLeavePrompt();
    if (state && baseLeaveFrom && isInsideBase(state)) {
      const { x, y } = baseLeaveFrom;
      baseLeaveFrom = null;
      const { cols, rows } = activeMapSize(state);
      state.player = {
        x: Math.max(0, Math.min(cols - 1, Math.floor(x))),
        y: Math.max(0, Math.min(rows - 1, Math.floor(y))),
      };
      setToast(state, "Stayed inside");
      saveState(state);
      render();
      return;
    }
    baseLeaveFrom = null;
    setToast(state, "Stayed inside");
    renderHud();
  }

  /** Ask before leaving indoors — Leave / Stay inside (Stay pushes you back off the door). */
  function promptBaseLeave() {
    if (!state || !playActive || gamePaused) return;
    if (!isInsideBase(state)) return;

    if (hasBaseKey(state)) {
      // Walked onto the door with the key — don't leave them stranded on it.
      if (baseLeaveFrom) {
        declineBaseLeave();
        setToast(state, "Hang the Base Key on the hook before leaving");
        renderHud();
        return;
      }
      setToast(state, "Hang the Base Key on the hook before leaving");
      renderHud();
      return;
    }

    closeSleepPrompt();
    closeTvPrompt();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeRecipesUi();
    closeBuildUi();

    const base = findPlayerBase(state);
    const name = getBaseTierInfo(base?.tier).name;
    const title = document.getElementById("base-leave-title");
    const hint = document.getElementById("base-leave-hint");
    if (title) title.textContent = `Leave ${name}?`;
    if (hint) {
      hint.textContent =
        "Head back outside? Stay inside and you'll step back off the door.";
    }

    openBaseLeavePrompt = true;
    showModal("base-leave-modal");
    renderHud();
  }

  function bindBaseEnterPrompt() {
    const modal = document.getElementById("base-enter-modal");
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      const action = event.target.closest("[data-base-enter]")?.dataset.baseEnter;
      if (!action) return;
      if (action === "cancel") {
        declineBaseEnter();
        return;
      }
      if (action === "enter") {
        enterBaseInterior();
      }
    });
  }

  function bindBaseLeavePrompt() {
    const modal = document.getElementById("base-leave-modal");
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      const action = event.target.closest("[data-base-leave]")?.dataset.baseLeave;
      if (!action) return;
      if (action === "cancel") {
        declineBaseLeave();
        return;
      }
      if (action === "leave") {
        baseLeaveFrom = null;
        leaveBaseInterior(state);
      }
    });
  }

  function closeSleepPrompt() {
    openSleepPrompt = false;
    hideModal("sleep-modal");
  }

  const TV_FRAME_MS = 2800;

  const TV_CHANNELS = [
    {
      name: "Factory News",
      frames: [
        { icon: "📰", text: "Nodes regrow at 6:00 a.m. — film at eleven." },
        { icon: "🏭", text: "Local pioneer places eighth Power Pole. Crowd goes wild." },
        { icon: "⚡", text: "Grid report: load stays happier under 20." },
        { icon: "🗺️", text: "Weather desk: it may rain. It may not. Stay alert." },
      ],
    },
    {
      name: "Drill Cartoons",
      frames: [
        { icon: "⛏️", text: "Tiny Drill learns to share power with friends." },
        { icon: "🥕", text: "Carrot races a conveyor. Spoiler: belts win." },
        { icon: "🪵", text: "Log and Plank invent a slapstick sawmill gag." },
        { icon: "🤖", text: "ADA guest-stars… as a blinking cursor." },
      ],
    },
    {
      name: "Plank Sports",
      frames: [
        { icon: "🏆", text: "Competitive plank stacking — very intense." },
        { icon: "🪨", text: "Stone toss finals. Judges demand rounder rocks." },
        { icon: "⚙️", text: "Relay race: Wire → Cable → Power Line!" },
        { icon: "🎯", text: "Sudden death: who mines Iron without a pick?" },
      ],
    },
    {
      name: "Island Nature",
      frames: [
        { icon: "🌳", text: "Trees, rocks, and one brave carrot." },
        { icon: "🍎", text: "Apple grove secrets: ripe means +food, not +ore." },
        { icon: "🌊", text: "Tide pool special: no fish, just factory dreams." },
        { icon: "🌙", text: "Night tip: monsters leave at dawn. Beds help." },
      ],
    },
    {
      name: "Late Night Loop",
      frames: [
        { icon: "📺", text: "Late-night factory documentary — belts forever." },
        { icon: "🍳", text: "Pioneer Cooking: how to burn a carrot (again)." },
        { icon: "📡", text: "Static… then a cheerful jingle about Power Poles." },
        { icon: "💤", text: "Infomercial: sleep until 6:00 a.m. — bedroom only." },
      ],
    },
    {
      name: "Smelter Cinema",
      frames: [
        { icon: "🔥", text: "Feature: Ore to Ingot — a heat romance in four bars." },
        { icon: "🪙", text: "Coming soon: Copper Wire, the musical." },
        { icon: "🧱", text: "Critic's pick: Stone Pick Origin Story (director's cut)." },
        { icon: "6️⃣", text: "Intermission stinger: six… seven! The crowd loses it." },
        { icon: "🎬", text: "Trailers only: nobody crafts during the credits." },
      ],
    },
    {
      name: "ADA After Hours",
      frames: [
        { icon: "🛰️", text: "ADA reads fan mail. Most of it is about Power Poles." },
        { icon: "📦", text: "Storage tips: food left, junk right, Base Key on the hook." },
        { icon: "🛠️", text: "Workroom hour: shapes matter. Wrong extras block the craft." },
        { icon: "7️⃣", text: "Chat log recovered: pioneer requested channels 6–7. Also, 6-7." },
        { icon: "👋", text: "Sign-off: leave with the corner button — or finish the dial." },
      ],
    },
    {
      name: "Ice-Fans",
      frames: [
        { icon: "🧊", text: "For ice lovers — and Fan lovers. Cool pioneers, assemble!" },
        { icon: "🌀", text: "Fan of the week: powered, parked beside a hot Generator." },
        { icon: "❄️", text: "Tonight's crush: a perfect cube. No drips. No notes." },
        { icon: "🪣", text: "Pro tip: Water Bucket + powered Fan = homemade Ice." },
        { icon: "🌡️", text: "Call-in tip: drag Ice onto Cool — or stand next to a Fan." },
        { icon: "💙", text: "Ice-Fans motto: stay frosty. Spin those blades." },
      ],
    },
  ];

  /** Captions when the TV is locked on exact CH 6–7. */
  const TV_SIX_SEVEN_LINES = [
    "6-7.",
    "Did somebody say 6-7?",
    "It's giving… 6-7.",
    "Channel check: six. Channel check: seven.",
    "6-7 energy only. No notes.",
    "We don't talk about 5-8. We talk about 6-7.",
    "Breaking news: 6-7.",
    "Sports desk confirms: 6-7.",
    "Weather tonight: cloudy with a chance of 6-7.",
    "ADA translation: 6-7.",
    "Pioneer tip of the hour: 6-7.",
    "Infomercial: buy one 6, get one 7 free.",
    "Late-night special: 6-7 uncut.",
    "The crowd chants 6-7. The crowd is right.",
    "Static clears… still 6-7.",
    "You flipped the dial. You found 6-7.",
    "This program is rated 6-7.",
    "Coming up next: more 6-7.",
    "Don't touch that dial — unless it's 6-7.",
    "6… 7… 6-7!",
  ];

  const TV_LOOPS_MAX = 20;
  const TV_LOOPS_MIN = 0;
  /** 6-7 pre-load climbs to 66; the next loop after that becomes cursed 6-7. */
  const TV_SIX_SEVEN_LOOPS_MAX = 66;
  /** Speed dial notch 0..10 → ×1, ×2, ×4 … ×1024. */
  const TV_SPEED_MIN = 0;
  const TV_SPEED_MAX = 10;

  let tvChannelIndex = 0;
  let tvFrameIndex = 0;
  let tvFrameTimer = null;
  let tvPhase = "setup"; // setup | watch
  let tvLoopsPlanned = 0;
  /** Speed dial notch (0 = ×1 … 10 = ×1024). */
  let tvSpeedLevel = 0;
  /** Inclusive 0-based channel range for this session (first → last). */
  let tvChannelFirst = 0;
  let tvChannelLast = TV_CHANNELS.length - 1;
  /** How many times we've wrapped back to the first channel after finishing the last. */
  let tvWrapsDone = 0;
  let tvRailBuilt = false;
  let tvLeverDrag = null; // { which: "first"|"last", pointerId }
  let tvSpeedDrag = null; // { pointerId }
  /** performance.now() when 6–7 watch started — drives progressive corruption. */
  let tvSixSevenWatchStartedAt = 0;
  let tvCorruptTicker = null;
  let tvSixSevenOutroTimer = null;
  let tvSixSevenOutroActive = false;
  let tvSixSevenFinaleGlowTimer = null;
  let tvSixSevenFinaleGlowScheduled = false;
  let tvSixSevenOminousTimer = null;
  let tvSixSevenBlackoutLineTimers = [];
  /** True when the finale muted the regular background music. */
  let tvFinaleMutedBgm = false;
  /** Both meters cursed — next 1s tick starts the channel. */
  let tvSixSevenAwaitingStart = false;
  let tvSixSevenWasLockdown = false;
  /** True after the loop past 66 — dial + loops read cursed 6-7. */
  let tvSixSevenMetersCursed = false;
  /** Brief blackout flash when meters flip to cursed 6-7. */
  let tvSixSevenCursedFlashTimer = null;
  const TV_SIX_SEVEN_CURSED_FLASH_MS = 480;
  /** Real-time +1 loop / second while 6-7 pre-load is locked. */
  const TV_SIX_SEVEN_LOOP_MS = 1000;
  let tvSixSevenLoopTimer = null;

  function stopTvSixSevenLoopTimer() {
    if (tvSixSevenLoopTimer != null) {
      window.clearInterval(tvSixSevenLoopTimer);
      tvSixSevenLoopTimer = null;
    }
  }

  function syncTvSixSevenLoopTimer() {
    const want = !!state && openTvPrompt && isTvSixSevenLockdown() && !gamePaused;
    if (!want) {
      stopTvSixSevenLoopTimer();
      return;
    }
    if (tvSixSevenLoopTimer != null) return;
    tvSixSevenLoopTimer = window.setInterval(() => {
      if (!state || gamePaused || !openTvPrompt || !isTvSixSevenLockdown()) {
        stopTvSixSevenLoopTimer();
        return;
      }
      tickTvSixSevenLockdownLoops();
    }, TV_SIX_SEVEN_LOOP_MS);
  }

  function stopTvPlayback() {
    if (tvFrameTimer != null) {
      clearInterval(tvFrameTimer);
      clearTimeout(tvFrameTimer);
      tvFrameTimer = null;
    }
  }

  function clampTvLoops(n) {
    const value = Math.round(Number(n));
    if (!Number.isFinite(value)) return TV_LOOPS_MIN;
    return Math.min(TV_LOOPS_MAX, Math.max(TV_LOOPS_MIN, value));
  }

  function clampTvSixSevenLoops(n) {
    const value = Math.round(Number(n));
    if (!Number.isFinite(value)) return 0;
    return Math.min(TV_SIX_SEVEN_LOOPS_MAX, Math.max(0, value));
  }

  function clampTvSpeed(n) {
    const value = Math.round(Number(n));
    if (!Number.isFinite(value)) return TV_SPEED_MIN;
    return Math.min(TV_SPEED_MAX, Math.max(TV_SPEED_MIN, value));
  }

  function tvSpeedMultiplier(level = tvSpeedLevel) {
    return 2 ** clampTvSpeed(level);
  }

  function normalizeTvChannelRange() {
    const max = TV_CHANNELS.length - 1;
    let first = Math.round(Number(tvChannelFirst));
    let last = Math.round(Number(tvChannelLast));
    if (!Number.isFinite(first)) first = 0;
    if (!Number.isFinite(last)) last = max;
    first = Math.min(max, Math.max(0, first));
    last = Math.min(max, Math.max(0, last));
    if (first > last) {
      const swap = first;
      first = last;
      last = swap;
    }
    tvChannelFirst = first;
    tvChannelLast = last;
  }

  function tvLoopsPhrase(count = tvLoopsPlanned) {
    if (count <= 0) return "no loops";
    if (count === 1) return "1 loop";
    return `${count} loops`;
  }

  function tvRangePhrase() {
    normalizeTvChannelRange();
    const first = tvChannelFirst + 1;
    const last = tvChannelLast + 1;
    return first === last ? `CH ${first}` : `CH ${first}–${last}`;
  }

  function setTvPhase(phase) {
    tvPhase = phase;
    const setup = document.getElementById("tv-setup");
    const watch = document.getElementById("tv-watch");
    if (setup) {
      if (phase === "setup") {
        setup.hidden = false;
        setup.removeAttribute("hidden");
      } else {
        setup.hidden = true;
        setup.setAttribute("hidden", "");
      }
    }
    if (watch) {
      if (phase === "watch") {
        watch.hidden = false;
        watch.removeAttribute("hidden");
      } else {
        watch.hidden = true;
        watch.setAttribute("hidden", "");
      }
    }
    paintTvSixSevenEgg();
  }

  function paintTvLoopPicker() {
    const valueEl = document.getElementById("tv-loops-value");
    const labelEl = document.getElementById("tv-loops-label");
    const block = document.querySelector(".tv-setup__block--loops");
    const cursed = isTvSixSevenCursedMeters();
    if (valueEl) {
      valueEl.textContent = cursed ? "6-7" : String(tvLoopsPlanned);
      valueEl.classList.toggle("is-cursed-67", cursed);
    }
    if (labelEl) {
      if (cursed) labelEl.textContent = "cursed";
      else if (tvLoopsPlanned <= 0) labelEl.textContent = "no loops";
      else if (tvLoopsPlanned === 1) labelEl.textContent = "loop";
      else labelEl.textContent = "loops";
    }
    block?.classList.toggle("is-cursed-67", cursed);
    syncTvForbiddenHatch();
  }

  function paintTvSpeedDial() {
    const level = clampTvSpeed(tvSpeedLevel);
    const mult = tvSpeedMultiplier(level);
    const valueEl = document.getElementById("tv-speed-value");
    const needle = document.getElementById("tv-speed-dial-needle");
    const face = document.getElementById("tv-speed-dial-face");
    const cursed = isTvSixSevenCursedMeters();
    if (valueEl) {
      valueEl.textContent = cursed ? "6-7" : `×${mult}`;
      valueEl.classList.toggle("is-cursed-67", cursed);
    }
    // Notch 0..10 sweeps a 270° arc from -135° (×1) to +135° (×1024).
    // Cursed 6-7 parks the needle straight down (180°), past the ×1 notch.
    const angle = cursed ? 180 : -135 + (level / TV_SPEED_MAX) * 270;
    if (needle) needle.style.transform = `rotate(${angle}deg)`;
    if (face) {
      face.setAttribute("aria-valuenow", cursed ? 67 : String(mult));
      face.setAttribute("aria-valuetext", cursed ? "cursed 6-7" : `${mult} times speed`);
      face.classList.toggle("is-cranked", !cursed && level >= TV_SPEED_MAX);
      face.classList.toggle("is-cursed-down", cursed);
    }
    syncTvForbiddenHatch();
  }

  /** Cipher 12-5-3-2 → 12 loops, ×32 (level 5), CH 4–6 (3 channels, span 2). */
  function isTvForbiddenCodeArmed() {
    normalizeTvChannelRange();
    return (
      clampTvLoops(tvLoopsPlanned) === 12 &&
      clampTvSpeed(tvSpeedLevel) === 5 &&
      tvChannelFirst === 3 &&
      tvChannelLast === 5
    );
  }

  function syncTvForbiddenHatch() {
    const cabinet = document.getElementById("tv-forbidden");
    const cipher = document.getElementById("tv-forbidden-cipher");
    const btn = document.getElementById("tv-forbidden-btn");
    if (!cabinet) return;

    const inSetup = openTvPrompt && tvPhase === "setup";
    const armed = inSetup && isTvForbiddenCodeArmed() && !isTvSixSevenLockdown();
    const wasOpen = cabinet.classList.contains("is-open");

    cabinet.classList.toggle("is-armed", armed);
    cabinet.classList.toggle("is-open", armed);
    cabinet.setAttribute("aria-hidden", armed ? "false" : "true");
    cipher?.classList.toggle("is-armed", armed);
    cipher?.classList.toggle("is-open", armed);

    if (btn) {
      btn.disabled = !armed;
      btn.tabIndex = armed ? 0 : -1;
    }

    if (armed && !wasOpen) {
      unlockEasterEgg("forbiddenChannel");
      window.KeaghanSfx?.playMenuClick?.();
    }
    if (!armed) {
      cabinet.classList.remove("is-pressed");
      cipher?.classList.remove("is-pressed");
    }
  }

  function adjustTvSpeed(delta) {
    if (isTvSixSevenLockdown()) return;
    tvSpeedLevel = clampTvSpeed(tvSpeedLevel + delta);
    paintTvSpeedDial();
  }

  /** Map pointer angle on the dial face → speed notch. */
  function tvSpeedLevelFromClient(clientX, clientY) {
    const face = document.getElementById("tv-speed-dial-face");
    if (!face) return clampTvSpeed(tvSpeedLevel);
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // 0° = up; sweep clockwise from -135° (slow) to +135° (fast).
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    deg = Math.min(135, Math.max(-135, deg));
    const t = (deg + 135) / 270;
    return clampTvSpeed(Math.round(t * TV_SPEED_MAX));
  }

  /** Lever lines sit on boundaries: first on line N → CH N; last on line N → CH N-1. */
  function tvFirstLeverLine() {
    normalizeTvChannelRange();
    return tvChannelFirst + 1;
  }

  function tvLastLeverLine() {
    normalizeTvChannelRange();
    return tvChannelLast + 2;
  }

  function setTvRangeFromLeverLines(firstLine, lastLine, { announce = false } = {}) {
    const channelCount = TV_CHANNELS.length;
    const maxLine = channelCount + 1;
    let first = Math.round(Number(firstLine));
    let last = Math.round(Number(lastLine));
    if (!Number.isFinite(first)) first = 1;
    if (!Number.isFinite(last)) last = maxLine;
    first = Math.min(channelCount, Math.max(1, first));
    last = Math.min(maxLine, Math.max(2, last));
    if (last <= first) last = first + 1;
    tvChannelFirst = first - 1;
    tvChannelLast = last - 2;
    normalizeTvChannelRange();
    if (rejectUnavailableSixSevenChannel() && announce && state) {
      setToast(state, "CH 6–7 is unavailable while the 6-7 Mod is installed.");
    }
  }

  function ensureTvChannelRail() {
    if (tvRailBuilt) return;
    const channelsEl = document.getElementById("tv-ch-rail-channels");
    const linesEl = document.getElementById("tv-ch-rail-lines");
    if (!channelsEl || !linesEl) return;

    channelsEl.innerHTML = "";
    linesEl.innerHTML = "";
    const count = TV_CHANNELS.length;

    for (let i = 0; i < count; i++) {
      const cell = document.createElement("div");
      cell.className = "tv-ch-rail__ch";
      cell.dataset.tvChannel = String(i);
      cell.textContent = String(i + 1);
      cell.title = TV_CHANNELS[i]?.name || `Channel ${i + 1}`;
      channelsEl.appendChild(cell);
    }

    for (let line = 1; line <= count + 1; line++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tv-ch-rail__line";
      btn.dataset.tvLine = String(line);
      btn.setAttribute("aria-label", `Channel line ${line}`);
      btn.style.left = `calc(0.55rem + ((100% - 1.1rem) * ${(line - 1) / count}))`;
      linesEl.appendChild(btn);
    }

    tvRailBuilt = true;
  }

  function tvRailLeftForLine(line) {
    const count = TV_CHANNELS.length;
    return `calc(0.55rem + ((100% - 1.1rem) * ${(line - 1) / count}))`;
  }

  function setTvSixSevenVisibility(el, show) {
    if (!el) return;
    if (show) {
      el.hidden = false;
      el.removeAttribute("hidden");
      el.setAttribute("aria-hidden", "false");
    } else {
      el.hidden = true;
      el.setAttribute("hidden", "");
      el.setAttribute("aria-hidden", "true");
    }
  }

  function scrambleTvSixSevenClone(clone, index) {
    if (!clone) return;
    // Random bounce waypoints across the whole screen + staggered crazy timing.
    const rot = -40 + Math.random() * 80;
    const pct = () => `${(3 + Math.random() * 94).toFixed(1)}%`;
    const edgePct = () => {
      // Bias some points toward edges so it feels like bouncing off the screen.
      if (Math.random() < 0.55) {
        return Math.random() < 0.5
          ? `${(2 + Math.random() * 10).toFixed(1)}%`
          : `${(88 + Math.random() * 10).toFixed(1)}%`;
      }
      return pct();
    };
    for (let p = 0; p <= 5; p++) {
      clone.style.setProperty(`--b${p}x`, edgePct());
      clone.style.setProperty(`--b${p}y`, edgePct());
    }
    clone.style.left = clone.style.getPropertyValue("--b0x");
    clone.style.top = clone.style.getPropertyValue("--b0y");
    clone.style.setProperty("--tv-67-scatter-rot", `${rot.toFixed(1)}deg`);
    clone.style.setProperty("--tv-67-pulse-duration", `${(0.34 + (index % 5) * 0.07).toFixed(2)}s`);
    // Fast, uneven bounce loops — feels chaotic, not march-in-step.
    clone.style.setProperty("--tv-67-bounce-duration", `${(0.55 + Math.random() * 0.75).toFixed(2)}s`);
    clone.style.setProperty("--tv-67-pulse-delay", `${(-0.11 * index - Math.random() * 0.2).toFixed(2)}s`);
    clone.style.setProperty("--tv-67-bounce-delay", `${(-Math.random() * 0.9).toFixed(2)}s`);
    const six = clone.querySelector(".tv-six-seven__six");
    const seven = clone.querySelector(".tv-six-seven__seven");
    if (six) six.style.animationDelay = `${(-0.05 * index).toFixed(2)}s`;
    if (seven) seven.style.animationDelay = `${(-0.05 * index - 0.2).toFixed(2)}s`;
  }

  function makeTvSixSevenClone(index) {
    const clone = document.createElement("div");
    clone.className = "tv-six-seven tv-six-seven--clone is-shaking";
    clone.setAttribute("aria-hidden", "true");
    clone.innerHTML =
      '<span class="tv-six-seven__six">6</span>' +
      '<span class="tv-six-seven__dash">-</span>' +
      '<span class="tv-six-seven__seven">7</span>';
    scrambleTvSixSevenClone(clone, index);
    return clone;
  }

  /**
   * Keep floating 6-7 count in sync with the loop counter (add/remove as it climbs).
   * Returns newly added clones so callers can scramble only those.
   */
  function ensureTvSixSevenSwarm(count) {
    const screen = document.getElementById("tv-six-seven-screen");
    if (!screen) return [];
    // Clear old wing hosts if any leftovers remain from earlier builds.
    const left = document.getElementById("tv-six-seven-left");
    const right = document.getElementById("tv-six-seven-right");
    if (left) left.innerHTML = "";
    if (right) right.innerHTML = "";

    const want = Math.max(0, Math.round(Number(count) || 0));
    let have = screen.querySelectorAll(".tv-six-seven--clone").length;
    while (have > want) {
      const last = screen.lastElementChild;
      if (!last) break;
      last.remove();
      have -= 1;
    }
    const added = [];
    while (have < want) {
      const clone = makeTvSixSevenClone(have);
      screen.appendChild(clone);
      added.push(clone);
      have += 1;
    }
    return added;
  }

  function scrambleTvSixSevenSwarm() {
    const screen = document.getElementById("tv-six-seven-screen");
    const clones = screen
      ? screen.querySelectorAll(".tv-six-seven--clone")
      : document.querySelectorAll(".tv-six-seven--clone");
    clones.forEach((clone, index) => {
      scrambleTvSixSevenClone(clone, index);
    });
  }

  function setTvSixSevenScreenVisible(show) {
    const screen = document.getElementById("tv-six-seven-screen");
    if (!screen) return;
    if (show) {
      screen.hidden = false;
      screen.removeAttribute("hidden");
      screen.setAttribute("aria-hidden", "false");
    } else {
      screen.hidden = true;
      screen.setAttribute("hidden", "");
      screen.setAttribute("aria-hidden", "true");
    }
  }

  function setTvSixSevenBlackoutVisible(show) {
    const blackout = document.getElementById("tv-six-seven-blackout");
    if (!blackout) return;
    if (show) {
      blackout.hidden = false;
      blackout.removeAttribute("hidden");
      blackout.setAttribute("aria-hidden", "false");
      blackout.classList.add("is-on");
    } else {
      blackout.hidden = true;
      blackout.setAttribute("hidden", "");
      blackout.setAttribute("aria-hidden", "true");
      blackout.classList.remove("is-on");
      blackout.classList.remove("is-hard-out");
      blackout.classList.remove("is-cursed-flash");
      document.querySelector("#tv-modal .tv-panel")?.classList.remove("is-blackout-hidden");
    }
  }

  function clearTvSixSevenCursedFlash() {
    if (tvSixSevenCursedFlashTimer != null) {
      clearTimeout(tvSixSevenCursedFlashTimer);
      tvSixSevenCursedFlashTimer = null;
    }
    document.getElementById("tv-six-seven-blackout")?.classList.remove("is-cursed-flash");
  }

  /** Quick cursed blackout flash when meters hit cursed 6-7. */
  function flashTvSixSevenCursedBlackout() {
    const blackout = document.getElementById("tv-six-seven-blackout");
    if (!blackout) return;
    // Don't interrupt the long outro / finale blackout.
    if (tvSixSevenOutroActive || isTvSixSevenFinale()) return;
    clearTvSixSevenCursedFlash();
    setTvSixSevenBlackoutVisible(true);
    blackout.classList.remove("is-cursed-flash");
    void blackout.offsetWidth;
    blackout.classList.add("is-cursed-flash");
    tvSixSevenCursedFlashTimer = window.setTimeout(() => {
      tvSixSevenCursedFlashTimer = null;
      blackout.classList.remove("is-cursed-flash");
      if (!tvSixSevenOutroActive && !isTvSixSevenFinale()) {
        setTvSixSevenBlackoutVisible(false);
      }
    }, TV_SIX_SEVEN_CURSED_FLASH_MS);
  }

  /** Normal 6-7 glyphs become cursed when meters flip. */
  function applyTvSixSevenCursedGlyphs(on) {
    document.getElementById("tv-six-seven")?.classList.toggle("tv-six-seven--cursed", on);
    document.getElementById("tv-six-seven-watch")?.classList.toggle("tv-six-seven--cursed", on);
    document.querySelectorAll("#tv-six-seven-screen .tv-six-seven--clone").forEach((el) => {
      el.classList.toggle("tv-six-seven--cursed", on);
    });
  }

  function clearTvSixSevenFinaleGlow() {
    if (tvSixSevenFinaleGlowTimer != null) {
      clearTimeout(tvSixSevenFinaleGlowTimer);
      tvSixSevenFinaleGlowTimer = null;
    }
    tvSixSevenFinaleGlowScheduled = false;
    document.getElementById("tv-six-seven-blackout")?.classList.remove("is-finale-glow");
  }

  /** Red bottom glow at the 3rd second of the 10s hard blackout. */
  function scheduleTvSixSevenBlackoutGlow() {
    if (tvSixSevenFinaleGlowTimer != null) {
      clearTimeout(tvSixSevenFinaleGlowTimer);
      tvSixSevenFinaleGlowTimer = null;
    }
    document.getElementById("tv-six-seven-blackout")?.classList.remove("is-finale-glow");
    tvSixSevenFinaleGlowScheduled = true;
    tvSixSevenFinaleGlowTimer = window.setTimeout(() => {
      tvSixSevenFinaleGlowTimer = null;
      if (!openTvPrompt || !tvSixSevenOutroActive) return;
      document.getElementById("tv-six-seven-blackout")?.classList.add("is-finale-glow");
    }, TV_SIX_SEVEN_OUTRO_GLOW_AT_MS);
  }

  function clearTvSixSevenOminousTimer() {
    if (tvSixSevenOminousTimer != null) {
      clearTimeout(tvSixSevenOminousTimer);
      tvSixSevenOminousTimer = null;
    }
    window.KeaghanSfx?.stopOminousMusic?.();
  }

  function setTvSixSevenBlackoutLine(text, { fading = false } = {}) {
    const line = document.getElementById("tv-six-seven-blackout-line");
    if (!line) return;
    if (text == null) {
      line.hidden = true;
      line.setAttribute("hidden", "");
      line.setAttribute("aria-hidden", "true");
      line.classList.remove("is-on", "is-fading", "is-die");
      return;
    }
    line.textContent = text;
    line.hidden = false;
    line.removeAttribute("hidden");
    line.setAttribute("aria-hidden", "false");
    line.classList.remove("is-fading", "is-die");
    // Restart enter animation when a new line appears.
    line.classList.remove("is-on");
    void line.offsetWidth;
    line.classList.add("is-on");
    line.classList.toggle("is-fading", fading);
    if (/die/i.test(text)) line.classList.add("is-die");
  }

  function clearTvSixSevenBlackoutLine() {
    for (const id of tvSixSevenBlackoutLineTimers) clearTimeout(id);
    tvSixSevenBlackoutLineTimers = [];
    setTvSixSevenBlackoutLine(null);
    setTvSixSevenBlackoutCursedVisible(false);
    setTvSixSevenBlackoutEyesVisible(false);
  }

  function scheduleTvSixSevenBlackoutBeat(delayMs, fn) {
    const id = window.setTimeout(() => {
      tvSixSevenBlackoutLineTimers = tvSixSevenBlackoutLineTimers.filter((t) => t !== id);
      if (!openTvPrompt || !tvSixSevenOutroActive) return;
      fn();
    }, delayMs);
    tvSixSevenBlackoutLineTimers.push(id);
  }

  /** Creepy ominous bed starts on the 5th second of the blackout. */
  function scheduleTvSixSevenOminousMusic() {
    clearTvSixSevenOminousTimer();
    tvSixSevenOminousTimer = window.setTimeout(() => {
      tvSixSevenOminousTimer = null;
      if (!openTvPrompt || !tvSixSevenOutroActive) return;
      window.KeaghanSfx?.startOminousMusic?.();
    }, TV_SIX_SEVEN_OUTRO_OMINOUS_AT_MS);
  }

  function fadeTvSixSevenBlackoutLine() {
    const line = document.getElementById("tv-six-seven-blackout-line");
    if (!line || line.hidden) return;
    line.classList.add("is-fading");
  }

  /**
   * Blackout title cards:
   * 10s — "well well well..."
   * 15s — fade
   * 20s — "looks like you found my curse."
   * 25s — fade
   * 30s — "you should have not watch 6-7,"
   * 35s — fade
   * 40s — "..."
   * 45s — "...and the fate is over."
   * 50s — fade text + cursed 6-7s fade in
   * 55s — angry eyes + "and now you die!!"
   */
  function ensureTvSixSevenBlackoutCursedSwarm() {
    const host = document.getElementById("tv-six-seven-blackout-cursed");
    if (!host || host.childElementCount > 0) return host;
    const spots = [
      { x: "12%", y: "18%", s: 2.4, r: -18 },
      { x: "78%", y: "14%", s: 3.1, r: 22 },
      { x: "22%", y: "62%", s: 2.8, r: 8 },
      { x: "70%", y: "58%", s: 3.6, r: -26 },
      { x: "48%", y: "30%", s: 4.2, r: 4 },
      { x: "8%", y: "78%", s: 2.2, r: 30 },
      { x: "86%", y: "76%", s: 2.6, r: -12 },
      { x: "54%", y: "82%", s: 3.3, r: 16 },
    ];
    for (const spot of spots) {
      const el = document.createElement("div");
      el.className = "tv-six-seven tv-six-seven--cursed tv-six-seven--blackout-float";
      el.style.setProperty("--bx", spot.x);
      el.style.setProperty("--by", spot.y);
      el.style.setProperty("--tv-67-size", `${spot.s}rem`);
      el.style.setProperty("--br", `${spot.r}deg`);
      el.innerHTML =
        '<span class="tv-six-seven__six">6</span>' +
        '<span class="tv-six-seven__dash">-</span>' +
        '<span class="tv-six-seven__seven">7</span>';
      host.appendChild(el);
    }
    return host;
  }

  function setTvSixSevenBlackoutCursedVisible(show) {
    const host = ensureTvSixSevenBlackoutCursedSwarm();
    if (!host) return;
    if (show) {
      host.hidden = false;
      host.removeAttribute("hidden");
      host.setAttribute("aria-hidden", "false");
      host.classList.remove("is-on");
      void host.offsetWidth;
      host.classList.add("is-on");
    } else {
      host.hidden = true;
      host.setAttribute("hidden", "");
      host.setAttribute("aria-hidden", "true");
      host.classList.remove("is-on");
    }
  }

  function setTvSixSevenBlackoutEyesVisible(show) {
    const eyes = document.getElementById("tv-six-seven-blackout-eyes");
    if (!eyes) return;
    if (show) {
      eyes.hidden = false;
      eyes.removeAttribute("hidden");
      eyes.setAttribute("aria-hidden", "false");
      eyes.classList.remove("is-on");
      void eyes.offsetWidth;
      eyes.classList.add("is-on");
    } else {
      eyes.hidden = true;
      eyes.setAttribute("hidden", "");
      eyes.setAttribute("aria-hidden", "true");
      eyes.classList.remove("is-on");
    }
  }

  function scheduleTvSixSevenBlackoutLine() {
    clearTvSixSevenBlackoutLine();
    setTvSixSevenBlackoutCursedVisible(false);
    setTvSixSevenBlackoutEyesVisible(false);
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_AT_MS, () => {
      setTvSixSevenBlackoutLine("well well well...");
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_FADE_AT_MS, fadeTvSixSevenBlackoutLine);
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_CURSE_AT_MS, () => {
      setTvSixSevenBlackoutLine("looks like you found my curse.");
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_CURSE_FADE_AT_MS, fadeTvSixSevenBlackoutLine);
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_WARN_AT_MS, () => {
      setTvSixSevenBlackoutLine("you should have not watch 6-7,");
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_WARN_FADE_AT_MS, fadeTvSixSevenBlackoutLine);
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_DOTS_AT_MS, () => {
      setTvSixSevenBlackoutLine("...");
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_FATE_AT_MS, () => {
      setTvSixSevenBlackoutLine("...and the fate is over.");
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_FATE_FADE_AT_MS, () => {
      fadeTvSixSevenBlackoutLine();
      setTvSixSevenBlackoutCursedVisible(true);
    });
    scheduleTvSixSevenBlackoutBeat(TV_SIX_SEVEN_OUTRO_LINE_DIE_AT_MS, () => {
      setTvSixSevenBlackoutEyesVisible(true);
      setTvSixSevenBlackoutLine("and now you die!!");
    });
  }

  function clearTvSixSevenOutro() {
    if (tvSixSevenOutroTimer != null) {
      clearTimeout(tvSixSevenOutroTimer);
      tvSixSevenOutroTimer = null;
    }
    tvSixSevenOutroActive = false;
    clearTvSixSevenFinaleGlow();
    clearTvSixSevenOminousTimer();
    clearTvSixSevenBlackoutLine();
    window.KeaghanSfx?.stopSixSevenCrowdChant?.();
    document.getElementById("tv-six-seven-blackout")?.classList.remove("is-hard-out");
    document.querySelector("#tv-modal .tv-panel")?.classList.remove("is-blackout-hidden");
  }

  /**
   * After the finale's 10s message ends — full background blackout for 1 min
   * (glow 3s, music 5s, lines 10s→30s), then run onDone.
   */
  function beginTvSixSevenOutroBlackout(onDone) {
    if (tvSixSevenOutroActive) return;
    tvSixSevenOutroActive = true;
    stopTvPlayback();
    stopTvCorruptTicker();
    setTvSixSevenBlackoutVisible(true);
    const blackout = document.getElementById("tv-six-seven-blackout");
    blackout?.classList.add("is-hard-out");
    document.querySelector("#tv-modal .tv-panel")?.classList.add("is-blackout-hidden");
    window.KeaghanSfx?.setSixSevenAudio?.("off");
    // Final message is over — crowd cuts out for the blackout.
    window.KeaghanSfx?.stopSixSevenCrowdChant?.();
    paintTvSixSevenLockdown();
    scheduleTvSixSevenBlackoutGlow();
    scheduleTvSixSevenOminousMusic();
    scheduleTvSixSevenBlackoutLine();

    if (tvSixSevenOutroTimer != null) clearTimeout(tvSixSevenOutroTimer);
    tvSixSevenOutroTimer = window.setTimeout(() => {
      tvSixSevenOutroTimer = null;
      tvSixSevenOutroActive = false;
      clearTvSixSevenFinaleGlow();
      clearTvSixSevenOminousTimer();
      clearTvSixSevenBlackoutLine();
      window.KeaghanSfx?.stopSixSevenCrowdChant?.();
      blackout?.classList.remove("is-hard-out");
      document.querySelector("#tv-modal .tv-panel")?.classList.remove("is-blackout-hidden");
      onDone?.();
    }, TV_SIX_SEVEN_OUTRO_MS);
  }

  /** Whole TV panel shakes while watching exact 6–7 at max loops. */
  function paintTvWatchShake() {
    const panel = document.querySelector("#tv-modal .tv-panel");
    if (!panel) return;
    const shake =
      openTvPrompt &&
      tvPhase === "watch" &&
      isTvSixSevenRange() &&
      clampTvLoops(tvLoopsPlanned) >= TV_LOOPS_MAX;
    panel.classList.toggle("is-six-seven-max-shake", shake);
  }

  /** On 6–7's last channel, loops → 0 and speed dial bottoms out (cursed approach). */
  function enforceTvSixSevenLastChannelLoops() {
    if (!openTvPrompt || tvPhase !== "watch" || !isTvSixSevenRange()) return false;
    if (tvChannelIndex < tvPlaybackLast()) return false;
    let changed = false;
    if (tvLoopsPlanned > 0) {
      tvLoopsPlanned = 0;
      changed = true;
    }
    if (tvSpeedLevel !== TV_SPEED_MIN) {
      tvSpeedLevel = TV_SPEED_MIN;
      paintTvSpeedDial();
      changed = true;
    }
    if (changed) {
      paintTvSixSevenEgg();
      paintTvLoopLabel();
      scheduleTvPlaybackTick();
    }
    paintTvWatchShake();
    return changed;
  }

  function paintTvSixSevenEgg() {
    // Only when the selected range is exactly CH 6–7.
    const exactSixSeven = isTvSixSevenRange();
    const locked = isTvSixSevenLockdown();
    const rawLoops = locked
      ? clampTvSixSevenLoops(tvLoopsPlanned)
      : clampTvLoops(tvLoopsPlanned);
    // Pre-load: grow toward cursed (66 → peak at cursed meters).
    // Normal egg: still scales with 0–20 loops.
    let sizeRem;
    let bobPx;
    let shake;
    let duration;
    let shakeDuration;
    if (locked) {
      const t = tvSixSevenMetersCursed
        ? 1
        : clampTvSixSevenLoops(tvLoopsPlanned) / Math.max(1, TV_SIX_SEVEN_LOOPS_MAX);
      sizeRem = 2.6 + t * 9.4;
      bobPx = 8 + t * 36;
      shake = t * 32;
      duration = Math.max(0.2, 0.85 - t * 0.58);
      shakeDuration = Math.max(0.04, 0.18 - t * 0.13);
    } else {
      const loops = Math.min(TV_LOOPS_MAX, rawLoops);
      sizeRem = 2.6 + loops * 0.22;
      bobPx = 8 + loops * 0.9;
      shake = loops;
      duration = Math.max(0.28, 0.85 - loops * 0.028);
      shakeDuration = Math.max(0.06, 0.18 - loops * 0.0055);
    }
    const applyMotion = (el, scale = 1) => {
      if (!el) return;
      el.style.setProperty("--tv-67-size", `${(sizeRem * scale).toFixed(2)}rem`);
      el.style.setProperty("--tv-67-bob", `${(bobPx * scale).toFixed(1)}px`);
      el.style.setProperty("--tv-67-shake", shake.toFixed(2));
      el.style.setProperty("--tv-67-duration", `${duration.toFixed(3)}s`);
      el.style.setProperty("--tv-67-shake-duration", `${shakeDuration.toFixed(3)}s`);
      el.classList.toggle("is-shaking", shake > 0);
    };

    const stage = document.getElementById("tv-six-seven-stage");
    const setupEgg = document.getElementById("tv-six-seven");
    const watchEgg = document.getElementById("tv-six-seven-watch");
    applyMotion(setupEgg, 1);
    applyMotion(watchEgg, 0.9);
    if (stage) {
      stage.style.setProperty("--tv-67-stage-size", `${sizeRem.toFixed(2)}rem`);
      stage.style.setProperty("--tv-67-stage-bob", `${bobPx.toFixed(1)}px`);
    }

    const showSetup = openTvPrompt && tvPhase === "setup" && exactSixSeven;
    const showWatch = openTvPrompt && tvPhase === "watch" && exactSixSeven;
    // Floating 6-7 count = loop count (cursed meters stay at the 66 peak).
    const swarmCount = locked
      ? tvSixSevenMetersCursed
        ? TV_SIX_SEVEN_LOOPS_MAX
        : clampTvSixSevenLoops(tvLoopsPlanned)
      : clampTvLoops(tvLoopsPlanned);
    const showSwarm = showSetup && swarmCount > 0;

    setTvSixSevenVisibility(stage, showSetup);
    setTvSixSevenVisibility(watchEgg, showWatch);

    if (showSetup || showWatch) {
      unlockEasterEgg("sixSeven");
    }

    if (showSwarm) {
      const wasSwarm = stage?.classList.contains("is-max-swarm");
      const added = ensureTvSixSevenSwarm(swarmCount);
      stage?.classList.add("is-max-swarm");
      setTvSixSevenScreenVisible(true);
      const screen = document.getElementById("tv-six-seven-screen");
      screen?.querySelectorAll(".tv-six-seven--clone").forEach((clone) => {
        // Same base size tokens as main; CSS clone-scale + pulse makes them
        // start smaller than main, then grow larger than main.
        applyMotion(clone, 1);
        clone.classList.add("is-shaking");
      });
      // First appearance: scramble everyone. Later: only place the new ones.
      if (!wasSwarm) scrambleTvSixSevenSwarm();
      else added.forEach((clone, i) => scrambleTvSixSevenClone(clone, swarmCount - added.length + i));
      if (swarmCount >= TV_LOOPS_MAX) unlockEasterEgg("sixSevenMax");
    } else {
      stage?.classList.remove("is-max-swarm");
      setTvSixSevenScreenVisible(false);
      ensureTvSixSevenSwarm(0);
    }

    // Cursed meters: every on-screen 6-7 turns into cursed 6-7.
    applyTvSixSevenCursedGlyphs(locked && tvSixSevenMetersCursed);

    // Pre-load = crazy glitches (+ max frenzy theme); watching = zoomies.
    // Finale / outro kill the music.
    const audioLoops = locked
      ? Math.round(
          (tvSixSevenMetersCursed
            ? 1
            : clampTvSixSevenLoops(tvLoopsPlanned) / Math.max(1, TV_SIX_SEVEN_LOOPS_MAX)) *
            TV_LOOPS_MAX
        )
      : Math.min(TV_LOOPS_MAX, rawLoops);
    if (showSetup) window.KeaghanSfx?.setSixSevenAudio?.("setup", audioLoops);
    else if (showWatch && !isTvSixSevenFinale() && !tvSixSevenOutroActive) {
      window.KeaghanSfx?.setSixSevenAudio?.("watch", audioLoops);
    } else window.KeaghanSfx?.setSixSevenAudio?.("off");

    paintTvWatchShake();
    paintTvSixSevenLockdown();
  }

  function paintTvChannelRail() {
    ensureTvChannelRail();
    normalizeTvChannelRange();
    rejectUnavailableSixSevenChannel();
    const firstLine = tvFirstLeverLine();
    const lastLine = tvLastLeverLine();
    const modBlocksExact67 = isSixSevenModInstalled();

    const readout = document.getElementById("tv-range-readout");
    if (readout) readout.textContent = tvRangePhrase();

    const rail = document.getElementById("tv-ch-rail");
    rail?.classList.toggle("is-six-seven-mod-blocked", modBlocksExact67);
    if (readout && modBlocksExact67) {
      readout.title = "Exact CH 6–7 is unavailable while the 6-7 Mod is installed";
    } else if (readout) {
      readout.removeAttribute("title");
    }

    document.querySelectorAll(".tv-ch-rail__ch").forEach((cell) => {
      const index = Number(cell.dataset.tvChannel);
      cell.classList.toggle(
        "is-selected",
        Number.isFinite(index) && index >= tvChannelFirst && index <= tvChannelLast
      );
      if (Number.isFinite(index)) {
        cell.title = TV_CHANNELS[index]?.name || `Channel ${index + 1}`;
      }
    });

    const firstLever = document.getElementById("tv-lever-first");
    const lastLever = document.getElementById("tv-lever-last");
    if (firstLever) {
      firstLever.style.left = tvRailLeftForLine(firstLine);
      firstLever.setAttribute("aria-valuenow", String(firstLine));
      firstLever.title = `First lever · line ${firstLine} → CH ${tvChannelFirst + 1}`;
    }
    if (lastLever) {
      lastLever.style.left = tvRailLeftForLine(lastLine);
      lastLever.setAttribute("aria-valuenow", String(lastLine));
      lastLever.title = `Last lever · line ${lastLine} → CH ${tvChannelLast + 1}`;
    }

    paintTvSixSevenEgg();
    syncTvForbiddenHatch();
    if (tvPhase === "setup") syncTvSixSevenLockdown();
  }

  function paintTvSetupControls() {
    paintTvLoopPicker();
    paintTvSpeedDial();
    paintTvChannelRail();
    syncTvForbiddenHatch();
  }

  function tvLineFromClientX(clientX) {
    const track = document.getElementById("tv-ch-rail-track");
    if (!track) return tvFirstLeverLine();
    const rect = track.getBoundingClientRect();
    const pad = 8; // matches ~0.55rem side padding
    const inner = Math.max(1, rect.width - pad * 2);
    const x = Math.min(rect.right - pad, Math.max(rect.left + pad, clientX));
    const t = (x - (rect.left + pad)) / inner;
    const count = TV_CHANNELS.length;
    return Math.min(count + 1, Math.max(1, Math.round(t * count) + 1));
  }

  function moveTvLeverToLine(which, line) {
    if (isTvSixSevenLockdown()) return;
    const firstLine = tvFirstLeverLine();
    const lastLine = tvLastLeverLine();
    if (which === "first") {
      const maxFirst = lastLine - 1;
      setTvRangeFromLeverLines(Math.min(maxFirst, Math.max(1, line)), lastLine, {
        announce: true,
      });
    } else {
      const minLast = firstLine + 1;
      setTvRangeFromLeverLines(
        firstLine,
        Math.min(TV_CHANNELS.length + 1, Math.max(minLast, line)),
        { announce: true }
      );
    }
    paintTvChannelRail();
  }

  function isSixSevenModInstalled() {
    return Boolean(window.KeaghanApp?.isSixSevenModInstalled?.());
  }

  /** Exact CH 6–7 — disabled while the 6-7 Mod is installed. */
  function isTvSixSevenRange() {
    normalizeTvChannelRange();
    if (isSixSevenModInstalled()) return false;
    return tvChannelFirst === 5 && tvChannelLast === 6;
  }

  /**
   * With the mod on, exact CH 6–7 is unavailable (the mod already owns it).
   * Nudges the levers to CH 5–7 so TV still works.
   * @returns {boolean} true if the range had to be changed
   */
  function rejectUnavailableSixSevenChannel() {
    if (!isSixSevenModInstalled()) return false;
    normalizeTvChannelRange();
    if (tvChannelFirst !== 5 || tvChannelLast !== 6) return false;
    tvChannelFirst = 4; // CH 5–7
    tvChannelLast = 6;
    normalizeTvChannelRange();
    if (tvChannelFirst === 5 && tvChannelLast === 6) {
      tvChannelFirst = 0;
      tvChannelLast = TV_CHANNELS.length - 1;
      normalizeTvChannelRange();
    }
    return true;
  }

  /** Pre-load exact 6–7: trap the player until 20 auto-loops start watch. */
  function isTvSixSevenLockdown() {
    return Boolean(openTvPrompt && tvPhase === "setup" && isTvSixSevenRange());
  }

  /** No leaving while 6–7 owns the TV (pre-load, watch, or outro). */
  function isTvSixSevenTrapped() {
    if (!openTvPrompt || !isTvSixSevenRange()) return false;
    return tvPhase === "setup" || tvPhase === "watch" || tvSixSevenOutroActive;
  }

  /** Loops + dial both read "6-7" after the loop past 66. */
  function isTvSixSevenCursedMeters() {
    return isTvSixSevenLockdown() && tvSixSevenMetersCursed;
  }

  /**
   * 6-7 speed: ×1024 at 0 loops → dial down (×1) at 66 loops.
   * Cursed meters park the needle straight down (180°).
   */
  function syncTvSixSevenSpeedFromLoops() {
    if (!isTvSixSevenRange()) return;
    if (tvSixSevenMetersCursed) {
      tvSpeedLevel = TV_SPEED_MIN;
      paintTvSpeedDial();
      return;
    }
    const loops = isTvSixSevenLockdown()
      ? clampTvSixSevenLoops(tvLoopsPlanned)
      : clampTvLoops(tvLoopsPlanned);
    const maxLoops = isTvSixSevenLockdown() ? TV_SIX_SEVEN_LOOPS_MAX : TV_LOOPS_MAX;
    const level = Math.round(TV_SPEED_MAX * (1 - loops / Math.max(1, maxLoops)));
    tvSpeedLevel = clampTvSpeed(level);
    paintTvSpeedDial();
  }

  function dropTvSixSevenSpeedOneNotch() {
    if (!isTvSixSevenRange()) return;
    tvSpeedLevel = clampTvSpeed(tvSpeedLevel - 1);
    paintTvSpeedDial();
    // Live watch: rebuild the frame timer at the new speed.
    if (tvPhase === "watch" && openTvPrompt && !tvSixSevenOutroActive) {
      scheduleTvPlaybackTick();
    }
  }

  function paintTvSixSevenLockdown() {
    const modal = document.getElementById("tv-modal");
    const locked = isTvSixSevenLockdown();
    const trapped = isTvSixSevenTrapped();
    // Entering 6-7 pre-load: reset loops to 0 and park dial at ×1024.
    if (locked && !tvSixSevenWasLockdown) {
      tvLoopsPlanned = 0;
      tvSixSevenAwaitingStart = false;
      tvSixSevenMetersCursed = false;
      tvSpeedLevel = TV_SPEED_MAX;
      paintTvLoopPicker();
    }
    if (!locked) {
      tvSixSevenAwaitingStart = false;
      tvSixSevenMetersCursed = false;
    }
    tvSixSevenWasLockdown = locked;

    modal?.classList.toggle("is-six-seven-lockdown", locked);
    modal?.classList.toggle("is-six-seven-trapped", trapped);
    modal?.classList.toggle("is-six-seven-cursed-meters", isTvSixSevenCursedMeters());
    // Pre-load only: map loops → speed. Watch uses drop-per-loop / last-channel floor.
    if (locked) syncTvSixSevenSpeedFromLoops();
    else if (trapped && tvPhase === "watch" && tvChannelIndex >= tvPlaybackLast()) {
      tvSpeedLevel = TV_SPEED_MIN;
      paintTvSpeedDial();
    }
    paintTvLoopPicker();
    const hint = document.querySelector("#tv-setup .tv-setup__hint");
    if (hint) {
      if (locked) {
        hint.dataset.tvHintDefault ||= hint.textContent;
        hint.textContent = isTvSixSevenCursedMeters()
          ? "Cursed 6-7. Dial and loops are gone. One more second… then the channels begin."
          : "6-7 has you now. Loops reset to 0 and climb to 66 — one loop per second. Speed starts at ×1024 and drops each loop. The next loop after 66 curses both meters — then one more second starts the channels. No escape.";
      } else if (hint.dataset.tvHintDefault) {
        hint.textContent = hint.dataset.tvHintDefault;
      }
    }
    const watchBtn = document.querySelector('#tv-modal [data-tv="watch"]');
    if (watchBtn) {
      watchBtn.disabled = locked;
      watchBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    }
    const closeBtn = document.querySelector('#tv-modal [data-tv="off"]');
    if (closeBtn) {
      closeBtn.disabled = trapped;
      closeBtn.setAttribute("aria-disabled", trapped ? "true" : "false");
    }
    const skipWrap = document.getElementById("tv-six-seven-skip-wrap");
    if (skipWrap) {
      // Skip only after the 6-7 Mod has been unlocked (door escape once).
      const canSkip = locked && Boolean(window.KeaghanApp?.isSixSevenModUnlocked?.());
      skipWrap.hidden = !canSkip;
      skipWrap.setAttribute("aria-hidden", canSkip ? "false" : "true");
    }
    syncTvSixSevenLoopTimer();
  }

  /**
   * +1 loop / real second while locked (0→66).
   * The loop after 66 curses dial + loops; the second after that starts watch.
   */
  function tickTvSixSevenLockdownLoops() {
    if (!isTvSixSevenLockdown() || !state) return;

    // Fully cursed already — this second starts the channel.
    if (tvSixSevenAwaitingStart && isTvSixSevenCursedMeters()) {
      tvSixSevenAwaitingStart = false;
      tvSixSevenMetersCursed = false;
      tvLoopsPlanned = 0;
      tvSpeedLevel = TV_SPEED_MIN;
      stopTvSixSevenLoopTimer();
      setToast(state, "6-7 — cursed. Channels starting…");
      beginTvWatch();
      return;
    }

    // Climb 0 → 66.
    if (tvLoopsPlanned < TV_SIX_SEVEN_LOOPS_MAX) {
      tvLoopsPlanned = clampTvSixSevenLoops(tvLoopsPlanned + 1);
      syncTvSixSevenSpeedFromLoops();
      paintTvLoopPicker();
      paintTvSixSevenEgg();
      if (tvLoopsPlanned === 1 || tvLoopsPlanned % 10 === 0 || tvLoopsPlanned >= TV_SIX_SEVEN_LOOPS_MAX) {
        setToast(
          state,
          `6-7 locked — ${tvLoopsPlanned}/${TV_SIX_SEVEN_LOOPS_MAX} loops · ×${tvSpeedMultiplier()}`
        );
      }
      renderHud();
      return;
    }

    // Already at 66 — this next loop curses both meters.
    tvSixSevenMetersCursed = true;
    tvSpeedLevel = TV_SPEED_MIN;
    tvSixSevenAwaitingStart = true;
    paintTvLoopPicker();
    paintTvSpeedDial();
    paintTvSixSevenEgg();
    paintTvSixSevenLockdown();
    flashTvSixSevenCursedBlackout();
    setToast(state, "Cursed 6-7… one more second");
    renderHud();
  }

  function syncTvSixSevenLockdown() {
    paintTvSixSevenLockdown();
  }

  /**
   * Playback range while watching. Exact 6–7 still unlocks the egg,
   * but plays the full CH 1–8 lineup under the 6-7 branding.
   */
  function tvPlaybackFirst() {
    return isTvSixSevenRange() ? 0 : tvChannelFirst;
  }

  function tvPlaybackLast() {
    return isTvSixSevenRange() ? TV_CHANNELS.length - 1 : tvChannelLast;
  }

  /** While tuned to exact 6–7, every show is just "6-7". */
  function tvShowDisplayName(channel) {
    if (isTvSixSevenRange()) return "6-7";
    return channel?.name || "TV";
  }

  function tvSixSevenLine(frameIndex = tvFrameIndex, channelIndex = tvChannelIndex) {
    const lines = TV_SIX_SEVEN_LINES;
    if (!lines.length) return "6-7.";
    // Mix channel + frame so each beat feels like a new bit.
    const i = (channelIndex * 7 + frameIndex * 3) % lines.length;
    return lines[i];
  }

  const TV_SIX_SEVEN_ICONS = ["6️⃣", "7️⃣", "6️⃣7️⃣", "📺", "🗣️", "🔥"];

  function tvSixSevenIcon(frameIndex = tvFrameIndex, channelIndex = tvChannelIndex) {
    const icons = TV_SIX_SEVEN_ICONS;
    return icons[(channelIndex + frameIndex) % icons.length];
  }

  const TV_SIX_SEVEN_FINALE_LINE =
    "wow, so you found 6-7, ey? well, get 6-7ed!";
  const TV_SIX_SEVEN_FINALE_MS = 10000;
  const TV_SIX_SEVEN_OUTRO_MS = 60000;
  const TV_SIX_SEVEN_OUTRO_GLOW_AT_MS = 3000;
  const TV_SIX_SEVEN_OUTRO_OMINOUS_AT_MS = 5000;
  const TV_SIX_SEVEN_OUTRO_LINE_AT_MS = 9000;
  const TV_SIX_SEVEN_OUTRO_LINE_FADE_AT_MS = 14000;
  const TV_SIX_SEVEN_OUTRO_LINE_CURSE_AT_MS = 19000;
  const TV_SIX_SEVEN_OUTRO_LINE_CURSE_FADE_AT_MS = 24000;
  const TV_SIX_SEVEN_OUTRO_LINE_WARN_AT_MS = 29000;
  const TV_SIX_SEVEN_OUTRO_LINE_WARN_FADE_AT_MS = 34000;
  const TV_SIX_SEVEN_OUTRO_LINE_DOTS_AT_MS = 39000;
  const TV_SIX_SEVEN_OUTRO_LINE_FATE_AT_MS = 44000;
  const TV_SIX_SEVEN_OUTRO_LINE_FATE_FADE_AT_MS = 49000;
  const TV_SIX_SEVEN_OUTRO_LINE_DIE_AT_MS = 54000;

  /** Last channel + last frame while watching exact 6–7. */
  function isTvSixSevenFinale() {
    if (!isTvSixSevenRange() || tvPhase !== "watch") return false;
    const channel = TV_CHANNELS[tvChannelIndex];
    if (!channel?.frames?.length) return false;
    if (tvChannelIndex < tvPlaybackLast()) return false;
    return tvFrameIndex >= channel.frames.length - 1;
  }

  /**
   * 0–1: how hard the crowd should chant "6-7!" —
   * thin at watch intro, full mob on the finale message, silent once it ends.
   */
  function tvSixSevenCrowdChantLevel() {
    if (!openTvPrompt || !isTvSixSevenRange()) return 0;
    // Blackout / after the final message — no chant.
    if (tvSixSevenOutroActive) return 0;
    if (tvPhase !== "watch") return 0;
    if (isTvSixSevenFinale()) return 1;

    const playFirst = tvPlaybackFirst();
    const playLast = tvPlaybackLast();
    let totalFrames = 0;
    let seenFrames = 0;
    for (let i = playFirst; i <= playLast; i++) {
      const frames = TV_CHANNELS[i]?.frames?.length || 0;
      if (frames <= 0) continue;
      totalFrames += frames;
      if (i < tvChannelIndex) seenFrames += frames;
      else if (i === tvChannelIndex) seenFrames += Math.min(tvFrameIndex, frames - 1);
    }
    // Finale frame is the end of the climb (not counted in seenFrames above).
    const span = Math.max(1, totalFrames - 1);
    const t = Math.min(1, Math.max(0, seenFrames / span));
    // Soft start on intro; denser the closer the ending.
    return 0.08 + 0.92 * (t * t);
  }

  function syncTvSixSevenCrowdChant() {
    window.KeaghanSfx?.setSixSevenCrowdChant?.(tvSixSevenCrowdChantLevel());
  }

  /** 0–1: longer + deeper into 6–7 watch → more corrupted. */
  function tvSixSevenCorruptionLevel() {
    if (!openTvPrompt || tvPhase !== "watch" || !isTvSixSevenRange()) return 0;
    if (isTvSixSevenFinale()) return 1;
    const elapsedSec = Math.max(0, (performance.now() - tvSixSevenWatchStartedAt) / 1000);
    // Wall-clock ramp (~40s to full) so lingering really melts the signal.
    const timePart = Math.min(1, elapsedSec / 40);
    const playFirst = tvPlaybackFirst();
    const playLast = tvPlaybackLast();
    const span = Math.max(1, playLast - playFirst);
    const channel = TV_CHANNELS[tvChannelIndex];
    const frames = Math.max(1, channel?.frames?.length || 1);
    const progressPart = Math.min(
      1,
      (tvChannelIndex - playFirst) / span + tvFrameIndex / frames / (span + 1)
    );
    const raw = Math.min(1, timePart * 0.55 + progressPart * 0.6);
    // Ease-in: early watch stays mostly clean, then goes bad.
    return raw * raw;
  }

  function corruptSixSevenText(text, level) {
    if (!text || level < 0.06) return text;
    const glyphs = ["6", "7", "6", "7", "?", "█", "▓", "░", "ǂ"];
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s|[.,!;:'"-]/.test(ch)) {
        out += ch;
        continue;
      }
      const roll = Math.random();
      if (roll < level * 0.58) out += glyphs[(i + Math.floor(level * 9)) % glyphs.length];
      else if (roll < level * 0.78) out += ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      else out += ch;
    }
    if (level > 0.7) out = `${out} 6-7`;
    if (level > 0.9) out = `6-7 ${out}`;
    return out;
  }

  function stopTvCorruptTicker() {
    if (tvCorruptTicker != null) {
      clearInterval(tvCorruptTicker);
      tvCorruptTicker = null;
    }
  }

  function clearTvCorruptionPaint() {
    const nodes = [
      document.getElementById("tv-screen"),
      document.querySelector("#tv-modal .tv-panel"),
      document.getElementById("tv-six-seven-watch"),
      document.querySelector("#tv-watch .tv-set__bezel"),
      document.getElementById("tv-caption"),
      document.getElementById("tv-frame"),
    ];
    for (const el of nodes) {
      if (!el) continue;
      el.style.removeProperty("--tv-corrupt");
      el.classList.remove("is-corrupt");
      delete el.dataset.corrupt;
    }
  }

  function paintTvCorruption() {
    const level = tvSixSevenCorruptionLevel();
    const nodes = [
      document.getElementById("tv-screen"),
      document.querySelector("#tv-modal .tv-panel"),
      document.getElementById("tv-six-seven-watch"),
      document.querySelector("#tv-watch .tv-set__bezel"),
      document.getElementById("tv-caption"),
      document.getElementById("tv-frame"),
    ];
    const stage = Math.min(5, Math.floor(level * 5 + 0.001));
    for (const el of nodes) {
      if (!el) continue;
      el.style.setProperty("--tv-corrupt", level.toFixed(3));
      el.classList.toggle("is-corrupt", level > 0.02);
      el.dataset.corrupt = String(stage);
    }
    // Audio gets nastier as the signal rots (still keyed off 0–20 intensity).
    // Last message / outro keep the music dead.
    if (
      level > 0.02 &&
      isTvSixSevenRange() &&
      tvPhase === "watch" &&
      !isTvSixSevenFinale() &&
      !tvSixSevenOutroActive
    ) {
      const loops = clampTvLoops(tvLoopsPlanned);
      const audioIntensity = Math.max(loops, Math.round(level * 20));
      window.KeaghanSfx?.setSixSevenAudio?.("watch", audioIntensity);
    }
  }

  function startTvCorruptTicker() {
    stopTvCorruptTicker();
    if (!isTvSixSevenRange()) return;
    tvSixSevenWatchStartedAt = performance.now();
    paintTvCorruption();
    tvCorruptTicker = window.setInterval(() => {
      if (!openTvPrompt || tvPhase !== "watch" || !isTvSixSevenRange()) return;
      paintTvCorruption();
      if (isTvSixSevenFinale()) return;
      const captionEl = document.getElementById("tv-caption");
      if (!captionEl) return;
      const base = tvSixSevenLine(tvFrameIndex, tvChannelIndex);
      captionEl.textContent = corruptSixSevenText(base, tvSixSevenCorruptionLevel());
    }, 160);
  }

  /** Finale: dial faces straight down, stops BGM, holds the sting. */
  function applyTvSixSevenFinaleEffects() {
    if (!isTvSixSevenFinale()) return;
    tvSpeedLevel = TV_SPEED_MIN;
    paintTvSpeedDial();
    const face = document.getElementById("tv-speed-dial-face");
    const needle = document.getElementById("tv-speed-dial-needle");
    face?.classList.add("is-cursed-down");
    if (needle) needle.style.transform = "rotate(180deg)";
    window.KeaghanSfx?.stopSixSevenAudio?.();
    if (!tvFinaleMutedBgm) {
      tvFinaleMutedBgm = true;
      window.KeaghanSfx?.pauseMusic?.();
    }
  }

  function restoreTvFinaleBgm() {
    if (!tvFinaleMutedBgm) return;
    tvFinaleMutedBgm = false;
    if (!gamePaused) window.KeaghanSfx?.resumeMusic?.();
  }

  /** Channel flip speed from the middle dial (any range). */
  function tvChannelSpeedMultiplier() {
    return tvSpeedMultiplier();
  }

  function tvFrameIntervalMs() {
    if (isTvSixSevenFinale()) return TV_SIX_SEVEN_FINALE_MS;
    const mult = tvChannelSpeedMultiplier();
    return Math.max(30, Math.round(TV_FRAME_MS / mult));
  }

  function isTvFinalLoop() {
    return tvLoopsPlanned > 0 && tvWrapsDone === tvLoopsPlanned;
  }

  function paintTvLoopLabel() {
    const loopEl = document.getElementById("tv-loop-label");
    if (!loopEl) return;
    const mult = tvChannelSpeedMultiplier();
    const speedTag = mult > 1 ? ` · ×${mult}` : "";
    if (tvLoopsPlanned <= 0) {
      loopEl.textContent = `No loops${speedTag}`;
      return;
    }
    if (isTvFinalLoop()) {
      loopEl.textContent = `Final loop${speedTag}`;
      return;
    }
    loopEl.textContent = `Loop ${tvWrapsDone}/${tvLoopsPlanned}${speedTag}`;
  }

  function paintTvFrame() {
    const channel = TV_CHANNELS[tvChannelIndex];
    if (!channel) return;
    enforceTvSixSevenLastChannelLoops();
    const frame = channel.frames[tvFrameIndex % channel.frames.length];
    const finale = isTvSixSevenFinale();
    const chEl = document.getElementById("tv-channel-label");
    const showEl = document.getElementById("tv-show-name");
    const frameEl = document.getElementById("tv-frame");
    const captionEl = document.getElementById("tv-caption");
    const screenEl = document.getElementById("tv-screen");
    const cursedEl = document.getElementById("tv-six-seven-cursed");
    // Current / playback last (6–7 plays as full 1–8).
    const modOn = isSixSevenModInstalled();
    if (chEl) {
      chEl.textContent = modOn
        ? "CH 6-7"
        : `CH ${tvChannelIndex + 1}/${tvPlaybackLast() + 1}`;
    }
    if (showEl) {
      showEl.textContent = finale ? "6-7???" : modOn ? "6-7" : tvShowDisplayName(channel);
    }
    paintTvLoopLabel();
    paintTvWatchShake();
    setTvSixSevenVisibility(cursedEl, finale);
    setTvSixSevenBlackoutVisible(finale);
    const watchEgg = document.getElementById("tv-six-seven-watch");
    if (isTvSixSevenRange() && tvPhase === "watch") {
      // Cursed finale replaces the normal watch 6-7.
      setTvSixSevenVisibility(watchEgg, !finale);
    }
    if (frameEl) {
      if (finale) {
        frameEl.textContent = "";
        frameEl.classList.add("is-cursed-hidden");
      } else {
        frameEl.classList.remove("is-cursed-hidden");
        frameEl.textContent = isTvSixSevenRange()
          ? tvSixSevenIcon(tvFrameIndex, tvChannelIndex)
          : modOn
            ? "6-7"
            : frame.icon;
      }
      frameEl.classList.remove("is-flip");
      // Restart CSS pop so each beat feels like a new shot.
      void frameEl.offsetWidth;
      if (!finale) frameEl.classList.add("is-flip");
    }
    if (captionEl) {
      if (finale) {
        captionEl.textContent = TV_SIX_SEVEN_FINALE_LINE;
      } else if (isTvSixSevenRange()) {
        captionEl.textContent = corruptSixSevenText(
          tvSixSevenLine(tvFrameIndex, tvChannelIndex),
          tvSixSevenCorruptionLevel()
        );
      } else {
        captionEl.textContent = modOn ? "6-7." : frame.text;
      }
      captionEl.classList.toggle("is-cursed", finale);
    }
    if (screenEl) {
      screenEl.classList.toggle("is-cursed", finale);
      screenEl.classList.remove("is-tune");
      void screenEl.offsetWidth;
      screenEl.classList.add("is-tune");
    }
    if (isTvSixSevenRange() && tvPhase === "watch") paintTvCorruption();
    if (finale) applyTvSixSevenFinaleEffects();
    if (isTvSixSevenRange()) syncTvSixSevenCrowdChant();
  }

  function endTvSession(message) {
    closeTvPrompt({ force: true });
    setToast(state, message || "TV off");
    renderHud();
  }

  /** After 6-7 blackout — clear the curse and return the set to a fresh setup. */
  function resetTvAfterSixSevenBlackout() {
    if (!openTvPrompt) return;
    stopTvPlayback();
    stopTvCorruptTicker();
    clearTvSixSevenOutro();
    clearTvCorruptionPaint();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    window.KeaghanSfx?.stopSixSevenCrowdChant?.();
    window.KeaghanSfx?.stopOminousMusic?.();
    restoreTvFinaleBgm();

    setTvSixSevenScreenVisible(false);
    setTvSixSevenBlackoutVisible(false);
    setTvSixSevenVisibility(document.getElementById("tv-six-seven-cursed"), false);
    document.querySelector("#tv-modal .tv-panel")?.classList.remove(
      "is-six-seven-max-shake",
      "is-blackout-hidden"
    );
    document.getElementById("tv-screen")?.classList.remove("is-cursed");
    document.getElementById("tv-caption")?.classList.remove("is-cursed");
    document.getElementById("tv-frame")?.classList.remove("is-cursed-hidden");

    // Fresh controls — not locked on 6-7 again.
    tvLoopsPlanned = 0;
    tvSpeedLevel = TV_SPEED_MIN;
    tvChannelFirst = 0;
    tvChannelLast = TV_CHANNELS.length - 1;
    tvChannelIndex = 0;
    tvFrameIndex = 0;
    tvWrapsDone = 0;
    tvSixSevenWatchStartedAt = 0;
    tvSixSevenAwaitingStart = false;
    tvSixSevenWasLockdown = false;
    tvSixSevenMetersCursed = false;
    stopTvSixSevenLoopTimer();

    setTvPhase("setup");
    paintTvSetupControls();
    paintTvSixSevenLockdown();
    setToast(state, "TV reset — set loops, speed & channels");
    renderHud();
  }

  /* ——— 6-7 aftermath arena (second blackout → 16×16 chase) ——— */
  const SIX_SEVEN_ARENA_COLS = 16;
  const SIX_SEVEN_ARENA_ROWS = 16;
  const SIX_SEVEN_ARENA_BOSS_W = 4;
  const SIX_SEVEN_ARENA_BOSS_H = 4;
  const SIX_SEVEN_ARENA_MINION_HP = 100;
  const SIX_SEVEN_ARENA_SWARM_MAX = 25;
  const SIX_SEVEN_ARENA_HITS_MAX = 3;
  const SIX_SEVEN_ARENA_DOOR_XS = [5, 10];
  const SIX_SEVEN_ARENA_WHITEOUT_MS = 3000;
  const SIX_SEVEN_ARENA_INVULN_MS = 900;
  /** Night monsters step once per world-clock tick (5s). Arena chase scales from that. */
  const SIX_SEVEN_ARENA_MONSTER_STEP_MS = 5000;
  const SIX_SEVEN_ARENA_BOSS_STEP_MS = Math.round(SIX_SEVEN_ARENA_MONSTER_STEP_MS / 2); // 2× monsters
  const SIX_SEVEN_ARENA_MINION_STEP_MS = Math.round(SIX_SEVEN_ARENA_MONSTER_STEP_MS / 3); // 3× monsters

  let sixSevenArena = null;

  /** Overlay session (map, swarm, or whiteout). */
  function isSixSevenArenaActive() {
    return Boolean(sixSevenArena);
  }

  function isSixSevenArenaPlayable() {
    return Boolean(sixSevenArena?.active && sixSevenArena.phase === "map");
  }

  function makeSixSevenArenaTiles() {
    const tiles = [];
    for (let y = 0; y < SIX_SEVEN_ARENA_ROWS; y++) {
      for (let x = 0; x < SIX_SEVEN_ARENA_COLS; x++) {
        let kind = "floor";
        if (x === 0 || x === SIX_SEVEN_ARENA_COLS - 1) kind = "wall";
        else if (y === 0) {
          kind = SIX_SEVEN_ARENA_DOOR_XS.includes(x) ? "door" : "wall";
        }
        tiles.push({ x, y, kind });
      }
    }
    return tiles;
  }

  function sixSevenArenaTileAt(x, y) {
    if (!sixSevenArena) return null;
    if (x < 0 || y < 0 || x >= SIX_SEVEN_ARENA_COLS || y >= SIX_SEVEN_ARENA_ROWS) return null;
    return sixSevenArena.tiles[y * SIX_SEVEN_ARENA_COLS + x] || null;
  }

  function sixSevenArenaBossCovers(x, y) {
    const boss = sixSevenArena?.boss;
    if (!boss) return false;
    return (
      x >= boss.x &&
      x < boss.x + SIX_SEVEN_ARENA_BOSS_W &&
      y >= boss.y &&
      y < boss.y + SIX_SEVEN_ARENA_BOSS_H
    );
  }

  function sixSevenArenaMinionAt(x, y) {
    return sixSevenArena?.minions?.find((m) => m && m.x === x && m.y === y) || null;
  }

  function setSixSevenArenaVisible(show) {
    const el = document.getElementById("six-seven-arena");
    if (!el) return;
    el.hidden = !show;
    el.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) {
      const wo = document.getElementById("six-seven-arena-whiteout");
      if (wo) {
        wo.classList.remove("is-on");
        wo.hidden = true;
        wo.setAttribute("aria-hidden", "true");
      }
    }
  }

  function setSixSevenArenaHint(text) {
    const hint = document.getElementById("six-seven-arena-hint");
    if (hint) hint.textContent = text || "";
  }

  function clearSixSevenArenaSwarm() {
    const swarm = document.getElementById("six-seven-arena-swarm");
    if (swarm) swarm.innerHTML = "";
  }

  function spawnSixSevenArenaSwarmGlyph() {
    const swarm = document.getElementById("six-seven-arena-swarm");
    if (!swarm || !sixSevenArena) return;
    if ((sixSevenArena.swarmCount || 0) >= SIX_SEVEN_ARENA_SWARM_MAX) return;
    const el = document.createElement("div");
    el.className = "tv-six-seven tv-six-seven--cursed tv-six-seven--blackout-float";
    el.innerHTML =
      '<span class="tv-six-seven__six">6</span><span class="tv-six-seven__dash">-</span><span class="tv-six-seven__seven">7</span>';
    el.style.setProperty("--sx", `${8 + Math.random() * 84}%`);
    el.style.setProperty("--sy", `${6 + Math.random() * 88}%`);
    el.style.setProperty("--srot", `${Math.round((Math.random() - 0.5) * 40)}deg`);
    el.style.setProperty("--sscale", `${(0.55 + Math.random() * 1.35).toFixed(2)}`);
    swarm.appendChild(el);
    sixSevenArena.swarmCount = (sixSevenArena.swarmCount || 0) + 1;
  }

  function paintSixSevenArenaGrid() {
    const grid = document.getElementById("six-seven-arena-grid");
    if (!grid || !sixSevenArena) return;
    grid.style.setProperty("--cols", String(SIX_SEVEN_ARENA_COLS));
    grid.hidden = sixSevenArena.phase !== "map";
    grid.innerHTML = "";
    const px = sixSevenArena.player.x;
    const py = sixSevenArena.player.y;
    for (const tile of sixSevenArena.tiles) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "six-seven-arena__cell";
      btn.dataset.x = String(tile.x);
      btn.dataset.y = String(tile.y);
      if (tile.kind === "wall") {
        btn.classList.add("is-wall");
        btn.textContent = "▮";
        btn.title = "Wall";
      } else if (tile.kind === "door") {
        btn.classList.add("is-door");
        btn.textContent = "🚪";
        btn.title = "Door";
      } else {
        btn.textContent = "";
        btn.title = "Floor";
      }

      const onBoss = sixSevenArenaBossCovers(tile.x, tile.y);
      const minion = sixSevenArenaMinionAt(tile.x, tile.y);
      if (onBoss) {
        btn.classList.add("is-boss", "is-hit");
        btn.textContent = "6-7";
        btn.title = "6-7 Boss — too powerful";
      } else if (minion) {
        btn.classList.add("is-minion", "is-hit");
        btn.textContent = "6-7";
        btn.title = `6-7 minion ${minion.hp}/${SIX_SEVEN_ARENA_MINION_HP}`;
      }
      if (tile.x === px && tile.y === py) {
        btn.classList.add("is-player");
        if (!onBoss && !minion) btn.textContent = "🧑‍🔧";
        btn.title = (btn.title ? `${btn.title} · ` : "") + "You (WASD)";
      }
      grid.appendChild(btn);
    }
  }

  function stopSixSevenArenaTimers() {
    if (!sixSevenArena) return;
    for (const key of [
      "swarmTimer",
      "bossTimer",
      "minionTimer",
      "spawnTimer",
      "introTimer",
      "whiteoutTimer",
    ]) {
      if (sixSevenArena[key] != null) {
        window.clearInterval(sixSevenArena[key]);
        window.clearTimeout(sixSevenArena[key]);
        sixSevenArena[key] = null;
      }
    }
  }

  function endSixSevenArenaOverlay() {
    stopSixSevenArenaTimers();
    clearSixSevenArenaSwarm();
    const grid = document.getElementById("six-seven-arena-grid");
    if (grid) {
      grid.hidden = true;
      grid.innerHTML = "";
    }
    setSixSevenArenaVisible(false);
    sixSevenArena = null;
  }

  function wakeInBaseFromSixSevenArena() {
    if (!state) return;
    // Keep every item — this was never a real death.
    if (!isInsideBase(state)) {
      state.outdoorPlayer = { x: state.player.x, y: state.player.y };
      state.insideBase = true;
      rebuildInteriorMap(state);
    }
    // Living room near the TV.
    state.player = { x: 7, y: 2 };
    const here = getActiveTile(state, state.player.x, state.player.y);
    if (!isInteriorWalkable(here, state)) state.player = interiorSpawnPos();
    normalizePlayer(state);
    state.health = healthMax();
    state.healthWarned = false;
    normalizeHealth(state);
  }

  /** Fake death: overwhelmed in the void, wake in base with inventory intact. */
  function escapeSixSevenArena(message) {
    if (!sixSevenArena?.active) return;
    sixSevenArena.active = false;
    stopSixSevenArenaTimers();
    flashDamageVignette();
    window.KeaghanSfx?.stopOminousMusic?.();
    window.KeaghanSfx?.stopSixSevenBossMusic?.();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    restoreTvFinaleBgm();
    endSixSevenArenaOverlay();
    wakeInBaseFromSixSevenArena();
    setToast(
      state,
      message ||
        "The 6-7s overwhelm you… You black out — and wake in your base. Your items are safe. You didn't really die."
    );
    saveState(state);
    render();
  }

  function sixSevenArenaPlayerTouchingThreat() {
    if (!sixSevenArena?.player) return false;
    const { x, y } = sixSevenArena.player;
    // Caught only when a threat occupies your tile (boss is 4×4).
    return sixSevenArenaBossCovers(x, y) || Boolean(sixSevenArenaMinionAt(x, y));
  }

  function knockSixSevenArenaPlayerFromThreat() {
    if (!sixSevenArena?.player) return;
    const { x, y } = sixSevenArena.player;
    // Prefer stepping south / away from the doors so you aren't pinned on a threat.
    const tries = [
      { x, y: y + 1 },
      { x: x - 1, y: y + 1 },
      { x: x + 1, y: y + 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
    ];
    for (const step of tries) {
      const tile = sixSevenArenaTileAt(step.x, step.y);
      if (!tile || tile.kind === "wall") continue;
      if (sixSevenArenaBossCovers(step.x, step.y)) continue;
      if (sixSevenArenaMinionAt(step.x, step.y)) continue;
      sixSevenArena.player.x = step.x;
      sixSevenArena.player.y = step.y;
      return;
    }
  }

  /** Contact hit — 3 hits → fake-death. Brief invuln so one touch isn't triple-kill. */
  function applySixSevenArenaHit() {
    if (!isSixSevenArenaPlayable()) return;
    const now = performance.now();
    if (sixSevenArena.invulnUntil && now < sixSevenArena.invulnUntil) return;
    sixSevenArena.hits = (sixSevenArena.hits || 0) + 1;
    sixSevenArena.invulnUntil = now + SIX_SEVEN_ARENA_INVULN_MS;
    flashDamageVignette();
    knockSixSevenArenaPlayerFromThreat();
    if (sixSevenArena.hits >= SIX_SEVEN_ARENA_HITS_MAX) {
      escapeSixSevenArena(
        "Three hits… You black out — and wake in your base with everything you had. You didn't really die."
      );
      return;
    }
    const left = SIX_SEVEN_ARENA_HITS_MAX - sixSevenArena.hits;
    setSixSevenArenaHint(
      left === 1
        ? "1 hit left — next one and you fake-die."
        : `${sixSevenArena.hits}/${SIX_SEVEN_ARENA_HITS_MAX} hits — ${left} left.`
    );
    paintSixSevenArenaGrid();
  }

  function checkSixSevenArenaContact() {
    if (!isSixSevenArenaPlayable()) return;
    if (sixSevenArenaPlayerTouchingThreat()) applySixSevenArenaHit();
  }

  /** Reach a door → whiteout, then title screen with the 6-7 mod installed. */
  function beginSixSevenArenaWhiteoutEnding() {
    if (!sixSevenArena || sixSevenArena.phase === "whiteout") return;
    sixSevenArena.active = false;
    sixSevenArena.phase = "whiteout";
    stopSixSevenArenaTimers();
    window.KeaghanSfx?.stopOminousMusic?.();
    window.KeaghanSfx?.stopSixSevenBossMusic?.();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    setSixSevenArenaHint("You reached the door…");
    paintSixSevenArenaGrid();

    const wo = document.getElementById("six-seven-arena-whiteout");
    if (wo) {
      wo.hidden = false;
      wo.setAttribute("aria-hidden", "false");
      // Force reflow so the fade-in plays.
      void wo.offsetWidth;
      wo.classList.add("is-on");
    }

    sixSevenArena.whiteoutTimer = window.setTimeout(() => {
      if (sixSevenArena) sixSevenArena.whiteoutTimer = null;
      endSixSevenArenaOverlay();
      tvFinaleMutedBgm = false;
      window.KeaghanSfx?.pauseMusic?.();
      window.KeaghanSfx?.stopMusic?.();
      if (typeof window.KeaghanApp?.finishSixSevenDoorEscape === "function") {
        window.KeaghanApp.finishSixSevenDoorEscape();
      } else {
        window.dispatchEvent(new CustomEvent("keaghan-leave-game"));
      }
    }, SIX_SEVEN_ARENA_WHITEOUT_MS);
  }

  function spawnSixSevenArenaBoss() {
    if (!sixSevenArena || sixSevenArena.boss) return;
    // 4×4 under the doors — blocks the escape before you can reach it.
    const bx = Math.floor((SIX_SEVEN_ARENA_COLS - SIX_SEVEN_ARENA_BOSS_W) / 2);
    const by = 1;
    sixSevenArena.boss = { x: bx, y: by };
    setSixSevenArenaHint(
      "6-7 BOSS — 3 hits and you fake-die. Slip past to a door if you can…"
    );
    // Drop the ominous bed — boss music goes fully crazy.
    window.KeaghanSfx?.stopOminousMusic?.();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    window.KeaghanSfx?.startSixSevenBossMusic?.();

    sixSevenArena.bossTimer = window.setInterval(() => {
      if (!sixSevenArena?.active || !sixSevenArena.boss) return;
      stepSixSevenArenaBoss();
      checkSixSevenArenaContact();
      paintSixSevenArenaGrid();
    }, SIX_SEVEN_ARENA_BOSS_STEP_MS);

    sixSevenArena.minionTimer = window.setInterval(() => {
      if (!sixSevenArena?.active) return;
      for (const m of sixSevenArena.minions) stepSixSevenArenaMinion(m);
      checkSixSevenArenaContact();
      paintSixSevenArenaGrid();
    }, SIX_SEVEN_ARENA_MINION_STEP_MS);

    sixSevenArena.spawnTimer = window.setInterval(() => {
      if (!sixSevenArena?.active || !sixSevenArena.boss) return;
      spawnSixSevenArenaMinion();
      spawnSixSevenArenaSwarmGlyph();
      paintSixSevenArenaGrid();
    }, 1600);

    paintSixSevenArenaGrid();
  }

  function stepSixSevenArenaEntity(ent, w, h) {
    if (!sixSevenArena?.player || !ent) return;
    const px = sixSevenArena.player.x;
    const py = sixSevenArena.player.y;
    const cx = ent.x + Math.floor(w / 2);
    const cy = ent.y + Math.floor(h / 2);
    const dx = Math.sign(px - cx);
    const dy = Math.sign(py - cy);
    const tries = [];
    if (dx || dy) {
      tries.push({ x: ent.x + dx, y: ent.y + dy });
      if (dx && dy) {
        tries.push({ x: ent.x + dx, y: ent.y });
        tries.push({ x: ent.x, y: ent.y + dy });
      }
    }
    for (const step of tries) {
      let ok = true;
      for (let oy = 0; oy < h && ok; oy++) {
        for (let ox = 0; ox < w && ok; ox++) {
          const tile = sixSevenArenaTileAt(step.x + ox, step.y + oy);
          if (!tile || tile.kind === "wall") ok = false;
        }
      }
      if (!ok) continue;
      ent.x = step.x;
      ent.y = step.y;
      return;
    }
  }

  function stepSixSevenArenaBoss() {
    if (!sixSevenArena?.boss) return;
    stepSixSevenArenaEntity(sixSevenArena.boss, SIX_SEVEN_ARENA_BOSS_W, SIX_SEVEN_ARENA_BOSS_H);
  }

  function stepSixSevenArenaMinion(minion) {
    if (!minion || !sixSevenArena) return;
    const px = sixSevenArena.player.x;
    const py = sixSevenArena.player.y;
    const dx = Math.sign(px - minion.x);
    const dy = Math.sign(py - minion.y);
    const tries = [];
    if (dx || dy) {
      tries.push({ x: minion.x + dx, y: minion.y + dy });
      if (dx && dy) {
        tries.push({ x: minion.x + dx, y: minion.y });
        tries.push({ x: minion.x, y: minion.y + dy });
      }
    }
    for (const step of tries) {
      const tile = sixSevenArenaTileAt(step.x, step.y);
      if (!tile || tile.kind === "wall") continue;
      if (sixSevenArenaBossCovers(step.x, step.y)) continue;
      if (sixSevenArenaMinionAt(step.x, step.y)) continue;
      // May step onto the player — that's a catch.
      minion.x = step.x;
      minion.y = step.y;
      return;
    }
  }

  function spawnSixSevenArenaMinion() {
    if (!sixSevenArena?.boss) return;
    if (sixSevenArena.minions.length >= 24) return;
    const boss = sixSevenArena.boss;
    const candidates = [];
    for (let y = boss.y; y < boss.y + SIX_SEVEN_ARENA_BOSS_H; y++) {
      for (let x = boss.x; x < boss.x + SIX_SEVEN_ARENA_BOSS_W; x++) {
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (sixSevenArenaBossCovers(nx, ny)) continue;
          const tile = sixSevenArenaTileAt(nx, ny);
          if (!tile || tile.kind === "wall") continue;
          if (sixSevenArenaMinionAt(nx, ny)) continue;
          const p = sixSevenArena.player;
          if (p && p.x === nx && p.y === ny) continue;
          candidates.push({ x: nx, y: ny });
        }
      }
    }
    if (!candidates.length) return;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    sixSevenArena.minions.push({
      x: spot.x,
      y: spot.y,
      hp: SIX_SEVEN_ARENA_MINION_HP,
    });
  }

  function tryMoveSixSevenArena(dx, dy) {
    if (!isSixSevenArenaPlayable()) return false;
    const nx = sixSevenArena.player.x + dx;
    const ny = sixSevenArena.player.y + dy;
    const tile = sixSevenArenaTileAt(nx, ny);
    if (!tile || tile.kind === "wall") {
      setSixSevenArenaHint("Walls cage the void.");
      return false;
    }
    if (sixSevenArenaBossCovers(nx, ny) || sixSevenArenaMinionAt(nx, ny)) {
      sixSevenArena.player.x = nx;
      sixSevenArena.player.y = ny;
      paintSixSevenArenaGrid();
      checkSixSevenArenaContact();
      return true;
    }
    // Approaching the doors → boss appears before you can escape.
    if (!sixSevenArena.boss && (ny <= 6 || tile.kind === "door")) {
      sixSevenArena.player.x = nx;
      sixSevenArena.player.y = ny;
      spawnSixSevenArenaBoss();
      // Stay out of the fresh 4×4 footprint if this step would land inside it.
      if (sixSevenArenaBossCovers(sixSevenArena.player.x, sixSevenArena.player.y)) {
        sixSevenArena.player.y = Math.min(
          SIX_SEVEN_ARENA_ROWS - 1,
          sixSevenArena.boss.y + SIX_SEVEN_ARENA_BOSS_H + 1
        );
      }
      paintSixSevenArenaGrid();
      return true;
    }
    // Slip past the boss to a door → whiteout ending.
    if (tile.kind === "door") {
      sixSevenArena.player.x = nx;
      sixSevenArena.player.y = ny;
      paintSixSevenArenaGrid();
      beginSixSevenArenaWhiteoutEnding();
      return true;
    }
    sixSevenArena.player.x = nx;
    sixSevenArena.player.y = ny;
    paintSixSevenArenaGrid();
    checkSixSevenArenaContact();
    return true;
  }

  function hitSixSevenArenaAt(x, y) {
    if (!isSixSevenArenaPlayable()) return;
    const px = sixSevenArena.player.x;
    const py = sixSevenArena.player.y;
    if (Math.max(Math.abs(px - x), Math.abs(py - y)) > 1) {
      setSixSevenArenaHint("Too far to strike.");
      return;
    }
    if (sixSevenArenaBossCovers(x, y)) {
      setSixSevenArenaHint("The 6-7 boss is too powerful — you can't defeat it.");
      return;
    }
    const idx = sixSevenArena.minions.findIndex((m) => m.x === x && m.y === y);
    if (idx < 0) return;
    // Empty-handed: 1 damage; minions need 100 hits.
    const minion = sixSevenArena.minions[idx];
    minion.hp -= 1;
    if (minion.hp <= 0) {
      sixSevenArena.minions.splice(idx, 1);
      setSixSevenArenaHint("One minion falls. More keep coming.");
    } else {
      setSixSevenArenaHint(`Minion ${minion.hp}/${SIX_SEVEN_ARENA_MINION_HP} — you have nothing…`);
    }
    paintSixSevenArenaGrid();
    checkSixSevenArenaContact();
  }

  function startSixSevenArenaMapPhase() {
    if (!sixSevenArena?.active) return;
    sixSevenArena.phase = "map";
    const grid = document.getElementById("six-seven-arena-grid");
    if (grid) grid.hidden = false;
    setSixSevenArenaHint("WASD — doors up top. 3 hits = fake-death. Something's wrong…");
    paintSixSevenArenaGrid();
  }

  /** Pre-load Skip — jump straight into the arena map with the boss up. */
  function skipTvSixSevenPreloadToArena() {
    if (!isTvSixSevenLockdown() || isSixSevenArenaActive()) return;
    // Can't skip until you've unlocked the 6-7 Mod at least once.
    if (!window.KeaghanApp?.isSixSevenModUnlocked?.()) {
      if (state) {
        setToast(state, "Skip unlocks after you reach an arena door once.");
        renderHud();
      }
      return;
    }
    stopTvSixSevenLoopTimer();
    window.KeaghanSfx?.setSixSevenAudio?.("off");
    beginSixSevenArenaAftermath({ skipToBoss: true });
  }

  /**
   * After the TV blackout: another void with multiplying cursed 6-7s,
   * then a 16×16 cage — boss + minions — fake-death back to base.
   * @param {{ skipToBoss?: boolean }} [opts] skipToBoss skips the swarm intro.
   */
  function beginSixSevenArenaAftermath(opts = {}) {
    const skipToBoss = Boolean(opts.skipToBoss);

    // Close / reset the TV, then drop into the arena void.
    if (openTvPrompt) {
      resetTvAfterSixSevenBlackout();
      closeTvPrompt({ force: true });
    } else {
      window.KeaghanSfx?.stopSixSevenCrowdChant?.();
      window.KeaghanSfx?.stopOminousMusic?.();
    }

    // Normal theme stays dead for the whole arena (reset/close may have resumed it).
    tvFinaleMutedBgm = true;
    window.KeaghanSfx?.pauseMusic?.();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    window.KeaghanSfx?.stopSixSevenBossMusic?.();

    endSixSevenArenaOverlay();
    sixSevenArena = {
      active: true,
      phase: skipToBoss ? "map" : "swarm",
      tiles: makeSixSevenArenaTiles(),
      player: { x: 8, y: 13 },
      boss: null,
      minions: [],
      hits: 0,
      invulnUntil: 0,
      swarmCount: 0,
      swarmTimer: null,
      bossTimer: null,
      minionTimer: null,
      spawnTimer: null,
      introTimer: null,
      whiteoutTimer: null,
    };

    setSixSevenArenaVisible(true);
    clearSixSevenArenaSwarm();

    if (skipToBoss) {
      // Cap the cursed swarm instantly, then drop onto the boss map.
      for (let i = 0; i < SIX_SEVEN_ARENA_SWARM_MAX; i++) spawnSixSevenArenaSwarmGlyph();
      startSixSevenArenaMapPhase();
      spawnSixSevenArenaBoss();
      setSixSevenArenaHint(
        "Skipped pre-load — 6-7 BOSS is here. 3 hits = fake-die. Doors up top."
      );
      return;
    }

    setSixSevenArenaHint("Another blackout… cursed 6-7s keep coming.");
    window.KeaghanSfx?.startOminousMusic?.();

    // Multiply cursed glyphs — denser every beat.
    let burst = 3;
    spawnSixSevenArenaSwarmGlyph();
    spawnSixSevenArenaSwarmGlyph();
    sixSevenArena.swarmTimer = window.setInterval(() => {
      if (!sixSevenArena?.active) return;
      burst = Math.min(14, burst + 1);
      for (let i = 0; i < burst; i++) spawnSixSevenArenaSwarmGlyph();
      setSixSevenArenaHint(`Cursed 6-7 ×${sixSevenArena.swarmCount}…`);
    }, 450);

    sixSevenArena.introTimer = window.setTimeout(() => {
      if (!sixSevenArena?.active) return;
      // Keep swarm growing slowly under the map.
      startSixSevenArenaMapPhase();
    }, 4200);
  }

  function bindSixSevenArenaUi() {
    const grid = document.getElementById("six-seven-arena-grid");
    if (!grid || grid.dataset.bound === "1") return;
    grid.dataset.bound = "1";
    grid.addEventListener("click", (event) => {
      const cell = event.target.closest(".six-seven-arena__cell");
      if (!cell || !sixSevenArena?.active) return;
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      hitSixSevenArenaAt(x, y);
    });
  }

  function advanceTvPlayback() {
    if (tvSixSevenOutroActive) return;
    const channel = TV_CHANNELS[tvChannelIndex];
    if (!channel) return;

    // Finale 10s just ended — hard blackout, then the arena aftermath.
    if (isTvSixSevenFinale() && isTvSixSevenRange()) {
      beginTvSixSevenOutroBlackout(() => {
        beginSixSevenArenaAftermath();
      });
      return;
    }

    const nextFrame = tvFrameIndex + 1;
    if (nextFrame < channel.frames.length) {
      tvFrameIndex = nextFrame;
      paintTvFrame();
      return;
    }

    const playLast = tvPlaybackLast();
    const playFirst = tvPlaybackFirst();
    if (tvChannelIndex >= playLast) {
      // Finished playback last channel: wrap to first if loops remain.
      if (tvWrapsDone < tvLoopsPlanned) {
        tvWrapsDone += 1;
        tvChannelIndex = playFirst;
        tvFrameIndex = 0;
        if (isTvSixSevenRange()) dropTvSixSevenSpeedOneNotch();
        const restart = TV_CHANNELS[playFirst];
        const restartName = tvShowDisplayName(restart);
        if (isTvFinalLoop()) {
          setToast(state, `Final loop — ${restartName}`);
        } else {
          setToast(state, `Loop ${tvWrapsDone}/${tvLoopsPlanned}: ${restartName}`);
        }
      } else {
        endTvSession(
          tvLoopsPlanned <= 0 ? "No loops — TV turned off" : "Final loop done — TV turned off"
        );
        return;
      }
    } else {
      tvChannelIndex += 1;
      tvFrameIndex = 0;
      // 6-7: hitting the last channel wipes remaining loops (one-way ride).
      if (isTvSixSevenRange() && tvChannelIndex >= playLast) {
        enforceTvSixSevenLastChannelLoops();
      }
      setToast(state, `TV: ${tvShowDisplayName(TV_CHANNELS[tvChannelIndex])}`);
    }
    paintTvFrame();
  }

  /** One-shot timer so the cursed finale can hold for 10s at ×1. */
  function scheduleTvPlaybackTick() {
    stopTvPlayback();
    if (!openTvPrompt || tvPhase !== "watch" || tvSixSevenOutroActive) return;
    const interval = tvFrameIntervalMs();
    tvFrameTimer = window.setTimeout(() => {
      tvFrameTimer = null;
      if (!openTvPrompt || tvPhase !== "watch" || tvSixSevenOutroActive) return;
      advanceTvPlayback();
      if (openTvPrompt && tvPhase === "watch" && !tvSixSevenOutroActive) {
        scheduleTvPlaybackTick();
      }
    }, interval);
  }

  function startTvPlayback() {
    stopTvPlayback();
    paintTvFrame();
    scheduleTvPlaybackTick();
  }

  function beginTvWatch() {
    tvLoopsPlanned = clampTvLoops(tvLoopsPlanned);
    normalizeTvChannelRange();
    tvWrapsDone = 0;
    tvChannelIndex = tvPlaybackFirst();
    tvFrameIndex = 0;
    if (isTvSixSevenRange()) {
      // After cursed meters, loops are cleared for the ride — keep dial down.
      if (tvLoopsPlanned <= 0) {
        tvSpeedLevel = TV_SPEED_MIN;
        paintTvSpeedDial();
      } else {
        syncTvSixSevenSpeedFromLoops();
      }
    }
    setTvPhase("watch");
    paintTvSixSevenEgg();
    paintTvSixSevenLockdown();
    if (isTvSixSevenRange()) startTvCorruptTicker();
    else {
      stopTvCorruptTicker();
      clearTvCorruptionPaint();
    }
    startTvPlayback();
    {
      const mult = tvChannelSpeedMultiplier();
      const speedBit = mult > 1 ? ` · ×${mult}` : "";
      if (isTvSixSevenRange()) {
        setToast(state, `Watching 6-7 · CH 1–8 · ${tvLoopsPhrase()}${speedBit}`);
      } else {
        setToast(
          state,
          `Watching ${TV_CHANNELS[tvChannelFirst].name} · ${tvRangePhrase()} · ${tvLoopsPhrase()}${speedBit}`
        );
      }
    }
    renderHud();
  }

  function adjustTvLoops(delta) {
    if (isTvSixSevenLockdown()) return;
    tvLoopsPlanned = clampTvLoops(tvLoopsPlanned + delta);
    paintTvLoopPicker();
    paintTvSixSevenEgg();
    syncTvSixSevenLockdown();
  }

  function closeTvPrompt(opts = {}) {
    // 6-7 owns the set — no quitting mid pre-load, watch, or outro.
    if (isTvSixSevenTrapped() && !opts.force) {
      setToast(state, "6-7 won't let you leave…");
      renderHud();
      return;
    }
    stopTvPlayback();
    stopTvCorruptTicker();
    clearTvSixSevenOutro();
    clearTvCorruptionPaint();
    tvLeverDrag = null;
    tvSpeedDrag = null;
    openTvPrompt = false;
    tvPhase = "setup";
    tvSixSevenWatchStartedAt = 0;
    setTvSixSevenScreenVisible(false);
    clearTvSixSevenCursedFlash();
    setTvSixSevenBlackoutVisible(false);
    document.querySelector("#tv-modal .tv-panel")?.classList.remove("is-six-seven-max-shake");
    document
      .getElementById("tv-modal")
      ?.classList.remove("is-six-seven-lockdown", "is-six-seven-trapped", "is-six-seven-cursed-meters");
    const skipWrap = document.getElementById("tv-six-seven-skip-wrap");
    if (skipWrap) {
      skipWrap.hidden = true;
      skipWrap.setAttribute("aria-hidden", "true");
    }
    document.getElementById("tv-speed-dial-face")?.classList.remove("is-cursed-down");
    document.getElementById("tv-speed-value")?.classList.remove("is-cursed-67");
    document.getElementById("tv-loops-value")?.classList.remove("is-cursed-67");
    document.querySelector(".tv-setup__block--loops")?.classList.remove("is-cursed-67");
    document.getElementById("tv-screen")?.classList.remove("is-cursed");
    document.getElementById("tv-caption")?.classList.remove("is-cursed");
    setTvSixSevenVisibility(document.getElementById("tv-six-seven-cursed"), false);
    applyTvSixSevenCursedGlyphs(false);
    tvSixSevenAwaitingStart = false;
    tvSixSevenWasLockdown = false;
    tvSixSevenMetersCursed = false;
    stopTvSixSevenLoopTimer();
    setTvPhase("setup");
    window.KeaghanSfx?.stopSixSevenAudio?.();
    window.KeaghanSfx?.stopSixSevenCrowdChant?.();
    restoreTvFinaleBgm();
    hideModal("tv-modal");
  }

  /** Living room TV — pick loops + channel range, then watch. */
  function promptLivingRoomTv() {
    if (!state || !playActive || gamePaused) return;
    if (!isInsideBase(state)) return;

    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeRecipesUi();
    closeBuildUi();

    stopTvPlayback();
    tvLoopsPlanned = clampTvLoops(tvLoopsPlanned);
    normalizeTvChannelRange();
    tvWrapsDone = 0;
    tvChannelIndex = tvChannelFirst;
    tvFrameIndex = 0;
    setTvPhase("setup");
    paintTvSetupControls();

    openTvPrompt = true;
    showModal("tv-modal");
    speakAda(state, "firstTv");
    setToast(state, "Set loops, speed & channels, then Watch");
    saveState(state);
    renderHud();
  }

  function bindTvPrompt() {
    const modal = document.getElementById("tv-modal");
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      const lineBtn = event.target.closest("[data-tv-line]");
      if (lineBtn && tvPhase === "setup") {
        if (isTvSixSevenLockdown()) return;
        const line = Number(lineBtn.dataset.tvLine);
        if (!Number.isFinite(line)) return;
        const firstLine = tvFirstLeverLine();
        const lastLine = tvLastLeverLine();
        const distFirst = Math.abs(line - firstLine);
        const distLast = Math.abs(line - lastLine);
        moveTvLeverToLine(distFirst <= distLast ? "first" : "last", line);
        return;
      }

      const action = event.target.closest("[data-tv]")?.dataset.tv;
      if (!action) return;
      if (action === "off") {
        const wasWatching = tvPhase === "watch";
        if (isTvSixSevenTrapped()) {
          setToast(state, "6-7 won't let you leave…");
          renderHud();
          return;
        }
        closeTvPrompt();
        setToast(state, wasWatching ? "TV off" : "TV cancelled");
        renderHud();
        return;
      }
      if (action === "loops-down") {
        adjustTvLoops(-1);
        return;
      }
      if (action === "loops-up") {
        adjustTvLoops(1);
        return;
      }
      if (action === "forbidden") {
        if (!isTvForbiddenCodeArmed() || tvPhase !== "setup") return;
        const cabinet = document.getElementById("tv-forbidden");
        const cipher = document.getElementById("tv-forbidden-cipher");
        cabinet?.classList.add("is-pressed");
        cipher?.classList.add("is-pressed");
        window.setTimeout(() => {
          cabinet?.classList.remove("is-pressed");
          cipher?.classList.remove("is-pressed");
        }, 900);
        unlockEasterEgg("forbiddenChannel");
        setToast(state, "Forbidden channel — signal locked out… for now.");
        window.KeaghanSfx?.playMenuClick?.();
        renderHud();
        return;
      }
      if (action === "watch") {
        if (isTvSixSevenLockdown()) {
          setToast(state, "6-7 is loading the loops for you…");
          renderHud();
          return;
        }
        beginTvWatch();
        return;
      }
      if (action === "skip-arena") {
        if (!isTvSixSevenLockdown()) return;
        if (!window.KeaghanApp?.isSixSevenModUnlocked?.()) {
          if (state) {
            setToast(state, "Skip unlocks after you reach an arena door once.");
            renderHud();
          }
          return;
        }
        skipTvSixSevenPreloadToArena();
      }
    });

    const onPointerMove = (event) => {
      if (tvPhase !== "setup") return;
      if (isTvSixSevenLockdown()) return;
      if (tvSpeedDrag && event.pointerId === tvSpeedDrag.pointerId) {
        tvSpeedLevel = tvSpeedLevelFromClient(event.clientX, event.clientY);
        paintTvSpeedDial();
        return;
      }
      if (!tvLeverDrag || event.pointerId !== tvLeverDrag.pointerId) return;
      moveTvLeverToLine(tvLeverDrag.which, tvLineFromClientX(event.clientX));
    };

    const onPointerUp = (event) => {
      if (tvSpeedDrag && event.pointerId === tvSpeedDrag.pointerId) {
        tvSpeedDrag = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        return;
      }
      if (!tvLeverDrag || event.pointerId !== tvLeverDrag.pointerId) return;
      tvLeverDrag = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    modal.addEventListener("pointerdown", (event) => {
      if (tvPhase !== "setup") return;
      if (isTvSixSevenLockdown()) return;
      const dialFace = event.target.closest("#tv-speed-dial-face");
      if (dialFace) {
        event.preventDefault();
        tvSpeedDrag = { pointerId: event.pointerId };
        dialFace.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        tvSpeedLevel = tvSpeedLevelFromClient(event.clientX, event.clientY);
        paintTvSpeedDial();
        return;
      }
      const lever = event.target.closest("[data-tv-lever]");
      if (!lever) return;
      const which = lever.dataset.tvLever;
      if (which !== "first" && which !== "last") return;
      event.preventDefault();
      tvLeverDrag = { which, pointerId: event.pointerId };
      lever.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      moveTvLeverToLine(which, tvLineFromClientX(event.clientX));
    });

    modal.addEventListener("keydown", (event) => {
      if (tvPhase !== "setup") return;
      if (isTvSixSevenLockdown()) return;
      if (event.target?.id !== "tv-speed-dial-face") return;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        adjustTvSpeed(-1);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        adjustTvSpeed(1);
      } else if (event.key === "Home") {
        event.preventDefault();
        tvSpeedLevel = TV_SPEED_MIN;
        paintTvSpeedDial();
      } else if (event.key === "End") {
        event.preventDefault();
        tvSpeedLevel = TV_SPEED_MAX;
        paintTvSpeedDial();
      }
    });
  }

  /** Night only — ask before skipping to 6:00 a.m. Daytime is blocked. */
  function promptBedroomSleep() {
    if (!state || !playActive || gamePaused) return;
    if (!isInsideBase(state)) return;

    if (!isNightTime(state.worldMinutes)) {
      setToast(state, "Can't sleep now — it's daytime (6:00 a.m.–6:00 p.m.)");
      renderHud();
      return;
    }

    closeBaseEnterPrompt();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeTvPrompt();
    closeRecipesUi();
    closeBuildUi();

    const title = document.getElementById("sleep-title");
    const hint = document.getElementById("sleep-hint");
    if (title) title.textContent = "Sleep?";
    if (hint) {
      hint.textContent = `It's ${formatWorldTime(state.worldMinutes)}. Sleep until 6:00 a.m.? Monsters leave at dawn.`;
    }

    openSleepPrompt = true;
    showModal("sleep-modal");
    renderHud();
  }

  function sleepInBedroom() {
    if (!state || !playActive) return;
    if (!isInsideBase(state)) return;
    closeSleepPrompt();

    if (!isNightTime(state.worldMinutes)) {
      setToast(state, "Can't sleep now — it's daytime (6:00 a.m.–6:00 p.m.)");
      renderHud();
      return;
    }

    state.worldMinutes = DAWN_MINUTES;
    clearNightMonsters(state, { toast: false });
    regrowNodesAtDawn(state);
    setToast(state, "You sleep until 6:00 a.m.");
    updateGoals(state);
    saveState(state);
    render();
  }

  function bindSleepPrompt() {
    const modal = document.getElementById("sleep-modal");
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      const action = event.target.closest("[data-sleep]")?.dataset.sleep;
      if (!action) return;
      if (action === "cancel") {
        closeSleepPrompt();
        setToast(state, "Stayed awake");
        renderHud();
        return;
      }
      if (action === "sleep") {
        sleepInBedroom();
      }
    });
  }

  function canPlaceBase(gameState, originX, originY) {
    const cells = getStructureFootprint("base", originX, originY);
    for (const cell of cells) {
      const tile = getTile(gameState, cell.x, cell.y);
      if (!tile) {
        return { ok: false, reason: "Base needs a clear 5×3 on the island", cells };
      }
      const spot = canPlaceOnTile("base", tile);
      if (!spot.ok) {
        return {
          ok: false,
          reason:
            spot.reason === "Tile occupied"
              ? "Base area is blocked"
              : spot.reason,
          cells,
        };
      }
    }
    return { ok: true, cells };
  }

  function getBuildCost(type) {
    return GameData.buildCosts?.[type] || { [type]: 1 };
  }

  function formatCost(cost) {
    return Object.entries(cost)
      .map(([id, n]) => `${n} ${GameData.getItem(id).name}`)
      .join(", ");
  }

  function canBuildStructure(state, type) {
    return canAfford(state, getBuildCost(type));
  }

  /**
   * Grass or depleted nodes are buildable. Live trees / rocks / ores block structures
   * (except drills, which must sit on a resource node). A building on a depleted node
   * stops dawn regrowth until it is demolished.
   */
  function canPlaceOnTile(type, tile) {
    if (!tile || tile.machine) return { ok: false, reason: "Tile occupied" };
    if (type === "drill") {
      if (!tile.node) {
        return { ok: false, reason: "Drills must be placed on a resource node" };
      }
      return { ok: true };
    }
    if (tile.node && tile.hp > 0) {
      const label = GameData.nodeTypes[tile.node]?.label || "resource";
      return { ok: false, reason: `Can't build on live ${label} — harvest it first` };
    }
    return { ok: true };
  }

  /** True when the avatar stands on any footprint cell of the structure. */
  function playerBlocksBuild(gameState, type, originX, originY) {
    if (!gameState || !PLACEABLE.includes(type)) return false;
    normalizePlayer(gameState);
    const cells =
      type === "base"
        ? getStructureFootprint("base", originX, originY)
        : [{ x: originX, y: originY }];
    return cells.some(
      (c) => c.x === gameState.player.x && c.y === gameState.player.y
    );
  }

  /**
   * Build ghost under the cursor:
   * blocked (red) · player in the way (orange-yellow) · missing materials (yellow) ·
   * ready to place (light-blue).
   */
  function getBuildPreviewKind(gameState, type, tile) {
    if (!gameState || !tile || !PLACEABLE.includes(type)) return null;
    if (!isInPlayerReach(gameState, tile.x, tile.y)) return "blocked";
    if (type === "base") {
      if (!canPlaceBase(gameState, tile.x, tile.y).ok) return "blocked";
    } else if (!canPlaceOnTile(type, tile).ok) {
      return "blocked";
    }
    if (playerBlocksBuild(gameState, type, tile.x, tile.y)) return "player";
    if (!canAfford(gameState, getBuildCost(type))) return "missing";
    return "ready";
  }

  function buildStructureIcon(type) {
    return GameData.getItem(type)?.icon || "□";
  }

  function tileKey(x, y) {
    return `${x},${y}`;
  }

  function getTile(state, x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return state.tiles[y * COLS + x];
  }

  function powerLinkRange(type) {
    return GameData.powerLinkRange?.[type] || 1;
  }

  function isPowerConductor(type) {
    return (GameData.powerConductors || ["cable", "powerPole"]).includes(type);
  }

  function isPowerOutput(type) {
    return (GameData.powerOutputs || ["generator"]).includes(type);
  }

  function isPowerInput(type) {
    return (GameData.powerInputs || ["drill", "smelter"]).includes(type);
  }

  /**
   * Two network buildings link if in range and roles allow it.
   * Crafting Tables never link. Power Lines/poles bridge any network buildings;
   * otherwise only an output (generator) may touch an input (drill/smelter).
   */
  function canPowerLink(a, b) {
    if (!a || !b) return false;
    if (a.type === "craftingStation" || b.type === "craftingStation") return false;
    const network = new Set(GameData.powerNetwork || []);
    if (!network.has(a.type) || !network.has(b.type)) return false;

    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx === 0 && dy === 0) return false;
    const range = Math.max(powerLinkRange(a.type), powerLinkRange(b.type));
    const inRange = range <= 1 ? dx + dy === 1 : Math.max(dx, dy) <= range;
    if (!inRange) return false;

    if (isPowerConductor(a.type) || isPowerConductor(b.type)) return true;
    return (
      (isPowerOutput(a.type) && isPowerInput(b.type)) ||
      (isPowerInput(a.type) && isPowerOutput(b.type))
    );
  }

  const POWER_GRID_MAX = 20;
  /** Chart samples — one point per in-game minute for the last hour. */
  const POWER_HOUR_MINUTES = 60;
  const GEN_TEMP_AMBIENT = 20;
  const GEN_TEMP_OVERHEAT = 100;
  const GEN_TEMP_MAX = 120;
  /** Power draw per machine type on a generator's network. */
  const POWER_DRAW = {
    drill: 4,
    smelter: 2,
    fan: 2,
  };

  function chebyshevDist(ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  /** Powered fans chill adjacent Coal Generators. */
  function fanCoolsGenerators(gameState, poweredTiles) {
    if (!gameState) return;
    const drop = GameData.cooling?.fanGeneratorDropC ?? 3.2;
    for (const fan of gameState.machines) {
      if (fan.type !== "fan") continue;
      if (!isMachinePowered(gameState, fan, poweredTiles)) continue;
      for (const gen of gameState.machines) {
        if (gen.type !== "generator") continue;
        if (chebyshevDist(fan.x, fan.y, gen.x, gen.y) > 1) continue;
        ensureGeneratorShape(gen);
        gen.tempC = Math.max(GEN_TEMP_AMBIENT, gen.tempC - drop);
      }
    }
  }

  function playerNearPoweredFan(gameState, poweredTiles) {
    if (!gameState?.player || isInsideBase(gameState)) return false;
    const { x, y } = gameState.player;
    for (const fan of gameState.machines) {
      if (fan.type !== "fan") continue;
      if (chebyshevDist(fan.x, fan.y, x, y) > 1) continue;
      if (isMachinePowered(gameState, fan, poweredTiles)) return true;
    }
    return false;
  }

  function isGeneratorFueled(machine) {
    if (!machine || machine.type !== "generator") return false;
    ensureGeneratorShape(machine);
    return machine.fuelCount > 0 && (!machine.fuelId || machine.fuelId === "coal");
  }

  /** True when this generator is wired to at least one other network building. */
  function generatorHasConnection(state, machine) {
    if (!state || !machine) return false;
    const component = getNetworkComponent(state, machine);
    return component.some((node) => !(node.x === machine.x && node.y === machine.y));
  }

  /** Fueled, wired, and not tripped by overload. */
  function isGeneratorOnline(machine) {
    return (
      isGeneratorFueled(machine) &&
      !machine.outage &&
      generatorHasConnection(state, machine)
    );
  }

  /** Fueled generators flood through adjacent cables/poles/stations into a powered set. */
  function computePoweredTiles(state) {
    const network = new Set(GameData.powerNetwork || []);
    const nodes = state.machines.filter((m) => network.has(m.type));
    const fueledGens = nodes.filter((m) => isGeneratorOnline(m));
    const powered = new Set();
    const queue = [];

    for (const gen of fueledGens) {
      const key = tileKey(gen.x, gen.y);
      if (powered.has(key)) continue;
      powered.add(key);
      queue.push(gen);
    }

    while (queue.length) {
      const here = queue.shift();
      for (const other of nodes) {
        if (!canPowerLink(here, other)) continue;
        const key = tileKey(other.x, other.y);
        if (powered.has(key)) continue;
        powered.add(key);
        queue.push(other);
      }
    }

    return powered;
  }

  function isMachinePowered(state, machine, poweredTiles) {
    if (!GameData.powerConsumers?.includes(machine.type)) return true;
    return poweredTiles.has(tileKey(machine.x, machine.y));
  }

  function makeSmelterMachine(x, y) {
    return {
      type: "smelter",
      x,
      y,
      timer: 0,
      interval: 0,
      input: [], // up to 15 stacks: { id, count }
      output: [], // up to 5 stacks: { id, count }
      fuelId: null, // "coal" | "log" | "plank"
      fuelCount: 0,
      storedEnergy: 0,
      progressMinutes: 0,
      smeltingSlot: -1, // which input stack is currently being smelted
    };
  }

  function makeGeneratorMachine(x, y) {
    return {
      type: "generator",
      x,
      y,
      timer: 0,
      interval: 4,
      fuelId: null, // coal only
      fuelCount: 0,
      outage: false,
      gridLoad: 0,
      tempC: GEN_TEMP_AMBIENT,
      loadHistory: Array.from({ length: POWER_HOUR_MINUTES }, () => 0),
      loadTick: 0,
    };
  }

  function ensureGeneratorShape(m) {
    if (!m || m.type !== "generator") return m;
    if (!Number.isFinite(m.fuelCount) || m.fuelCount < 0) m.fuelCount = 0;
    if (m.fuelCount <= 0) {
      m.fuelId = null;
      m.fuelCount = 0;
    } else {
      m.fuelId = "coal";
    }
    if (!Number.isFinite(m.timer)) m.timer = 0;
    if (!Number.isFinite(m.interval) || m.interval <= 0) m.interval = 4;
    m.outage = Boolean(m.outage);
    if (!Number.isFinite(m.gridLoad) || m.gridLoad < 0) m.gridLoad = 0;
    if (!Number.isFinite(m.tempC)) m.tempC = GEN_TEMP_AMBIENT;
    m.tempC = Math.max(GEN_TEMP_AMBIENT, Math.min(GEN_TEMP_MAX, m.tempC));
    if (!Array.isArray(m.loadHistory) || !m.loadHistory.length) {
      m.loadHistory = Array.from({ length: POWER_HOUR_MINUTES }, () => 0);
    } else {
      m.loadHistory = m.loadHistory
        .map((n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0))
        .slice(-POWER_HOUR_MINUTES);
      while (m.loadHistory.length < POWER_HOUR_MINUTES) m.loadHistory.unshift(0);
    }
    if (!Number.isFinite(m.loadTick)) m.loadTick = 0;
    return m;
  }

  /** Target °C from running state + load. Higher load = hotter. */
  function generatorTempTarget(gameState, m) {
    if (!m || m.outage) return GEN_TEMP_AMBIENT;
    if (!isGeneratorFueled(m)) return GEN_TEMP_AMBIENT;
    if (!generatorHasConnection(gameState, m)) return 32;
    const load = Math.max(0, Math.round(m.gridLoad) || 0);
    // Online baseline ~48°C, approaching overheat near full load.
    return Math.min(GEN_TEMP_OVERHEAT - 2, 48 + load * 2.4);
  }

  function tickGeneratorTemp(gameState, m) {
    ensureGeneratorShape(m);
    const target = generatorTempTarget(gameState, m);
    const heating = m.tempC < target;
    // Heat climbs a bit faster under load; cools steadily when idle/tripped.
    const step = heating ? 1.6 + Math.min(2.2, (Math.round(m.gridLoad) || 0) * 0.08) : 2.2;
    if (heating) m.tempC = Math.min(target, m.tempC + step);
    else m.tempC = Math.max(target, m.tempC - step);
    m.tempC = Math.max(GEN_TEMP_AMBIENT, Math.min(GEN_TEMP_MAX, m.tempC));

    if (!m.outage && m.tempC >= GEN_TEMP_OVERHEAT) {
      m.outage = true;
      setToast(
        gameState,
        "Offline — generator overheated. Let it cool, refuel if needed, then slide the switch to ON."
      );
    }
  }

  /** Load drawn this minute while the generator is actually supplying power. */
  function generatorEnergyThisMinute(gameState, m) {
    if (!gameState || !m || m.outage) return 0;
    if (!isGeneratorFueled(m)) return 0;
    if (!generatorHasConnection(gameState, m)) return 0;
    return Math.max(0, Math.round(m.gridLoad) || 0);
  }

  function generatorHourEnergyUsed(m) {
    ensureGeneratorShape(m);
    return (m.loadHistory || []).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }

  /** Append one chart sample per in-game minute (rolling last hour). */
  function recordGeneratorHourEnergy(gameState, minutes) {
    const steps = Math.max(0, Math.floor(minutes));
    if (!gameState || steps < 1) return;
    for (const m of gameState.machines) {
      if (m.type !== "generator") continue;
      ensureGeneratorShape(m);
      const used = generatorEnergyThisMinute(gameState, m);
      for (let i = 0; i < steps; i++) m.loadHistory.push(used);
      if (m.loadHistory.length > POWER_HOUR_MINUTES) {
        m.loadHistory = m.loadHistory.slice(-POWER_HOUR_MINUTES);
      }
    }
  }

  function networkPowerDemand(state, gen) {
    const component = getNetworkComponent(state, gen);
    let demand = 0;
    for (const node of component) {
      demand += POWER_DRAW[node.type] || 0;
    }
    return demand;
  }

  /** Step live load toward demand (up, down, or flat), trip if over max. */
  function tickGeneratorLoad(state, m, dt) {
    ensureGeneratorShape(m);
    m.loadTick += dt;
    if (m.loadTick < 0.35) return;
    m.loadTick = 0;

    // Temperature always moves (heats online, cools during outage / idle).
    tickGeneratorTemp(state, m);

    // Outage freezes the live load needle; hour chart still advances via world time.
    if (m.outage) return;

    const demand = isGeneratorFueled(m) ? networkPowerDemand(state, m) : 0;
    const prev = Math.round(m.gridLoad) || 0;
    let next = prev;
    if (demand > prev) next = prev + 1;
    else if (demand < prev) next = prev - 1;
    // else stay flat

    m.gridLoad = Math.max(0, next);

    if (isGeneratorFueled(m) && m.gridLoad > POWER_GRID_MAX) {
      m.outage = true;
      setToast(state, "Offline — grid load exceeded 20. Slide the switch to ON to reset.");
    }
  }

  function resetGeneratorOutage(m) {
    if (!m || !m.outage) return false;
    ensureGeneratorShape(m);
    m.outage = false;
    const demand = state ? networkPowerDemand(state, m) : 0;
    m.gridLoad = Math.min(POWER_GRID_MAX, demand);
    return true;
  }

  function returnGeneratorContents(state, m) {
    ensureGeneratorShape(m);
    if (m.fuelId && m.fuelCount > 0) addItem(state, m.fuelId, m.fuelCount);
    m.fuelId = null;
    m.fuelCount = 0;
  }

  /** All network machines reachable from `start` (cables, poles, gens, drills…). */
  function getNetworkComponent(state, start) {
    const network = new Set(GameData.powerNetwork || []);
    if (!start || !network.has(start.type)) return [];
    const nodes = state.machines.filter((m) => network.has(m.type));
    const seen = new Set([tileKey(start.x, start.y)]);
    const out = [start];
    const queue = [start];
    while (queue.length) {
      const here = queue.shift();
      for (const other of nodes) {
        const key = tileKey(other.x, other.y);
        if (seen.has(key) || !canPowerLink(here, other)) continue;
        seen.add(key);
        out.push(other);
        queue.push(other);
      }
    }
    return out;
  }

  function getSmeltRecipe(inputId) {
    return GameData.smeltRecipes.find((r) => r.input === inputId) || null;
  }

  function isSmelterFuel(itemId) {
    return Boolean(GameData.smelter?.fuelEnergy?.[itemId]);
  }

  function fuelEnergyValue(itemId) {
    return GameData.smelter?.fuelEnergy?.[itemId] || 0;
  }

  function inputSlotCount() {
    return GameData.smelter?.inputSlots || 15;
  }

  function ensureSmelterShape(m) {
    if (m.type !== "smelter") return m;
    if (!Array.isArray(m.output)) m.output = [];
    if (!Array.isArray(m.input)) {
      m.input = [];
      // Migrate single-slot input saves.
      if (m.inputId && m.inputCount > 0) {
        m.input.push({ id: m.inputId, count: m.inputCount });
      }
    }
    delete m.inputId;
    delete m.inputCount;
    m.input = m.input.filter((s) => s && s.id && s.count > 0).slice(0, inputSlotCount());

    if (!Number.isFinite(m.fuelCount)) {
      m.fuelCount = Number.isFinite(m.fuelCoal) ? m.fuelCoal : 0;
      m.fuelId = m.fuelCount > 0 ? "coal" : null;
    }
    if (m.fuelCount <= 0) {
      m.fuelId = null;
      m.fuelCount = 0;
    } else if (!m.fuelId) {
      m.fuelId = "coal";
    }
    delete m.fuelCoal;
    if (!Number.isFinite(m.storedEnergy)) m.storedEnergy = 0;
    if (!Number.isFinite(m.progressMinutes)) m.progressMinutes = 0;
    if (!Number.isFinite(m.smeltingSlot)) m.smeltingSlot = -1;
    return m;
  }

  function findSmeltSource(m) {
    ensureSmelterShape(m);
    if (m.smeltingSlot >= 0) {
      const current = m.input[m.smeltingSlot];
      if (current && getSmeltRecipe(current.id)) return { index: m.smeltingSlot, stack: current };
    }
    for (let i = 0; i < m.input.length; i++) {
      const stack = m.input[i];
      if (stack && getSmeltRecipe(stack.id)) return { index: i, stack };
    }
    return null;
  }

  function burnFuelToEnergy(m) {
    if (!m.fuelId || m.fuelCount < 1) return false;
    const per = fuelEnergyValue(m.fuelId);
    if (per < 1) return false;
    m.fuelCount -= 1;
    m.storedEnergy += per;
    if (m.fuelCount <= 0) {
      m.fuelId = null;
      m.fuelCount = 0;
    }
    return true;
  }

  function stackMax() {
    return GameData.smelter?.stackMax || 50;
  }

  function outputFreeSpace(m, itemId) {
    const maxSlots = GameData.smelter?.outputSlots || 5;
    const max = stackMax();
    let free = 0;
    for (const stack of m.output) {
      if (stack.id === itemId) free += Math.max(0, max - stack.count);
    }
    free += Math.max(0, maxSlots - m.output.length) * max;
    return free;
  }

  function inputFreeSpace(m, itemId) {
    const maxSlots = inputSlotCount();
    const max = stackMax();
    let free = 0;
    for (const stack of m.input) {
      if (stack.id === itemId) free += Math.max(0, max - stack.count);
    }
    free += Math.max(0, maxSlots - m.input.length) * max;
    return free;
  }

  function tryPushOutput(m, itemId, count = 1) {
    const maxSlots = GameData.smelter?.outputSlots || 5;
    const max = stackMax();
    let left = count;

    for (const stack of m.output) {
      if (stack.id !== itemId || stack.count >= max) continue;
      const add = Math.min(left, max - stack.count);
      stack.count += add;
      left -= add;
      if (left <= 0) return true;
    }

    while (left > 0 && m.output.length < maxSlots) {
      const add = Math.min(left, max);
      m.output.push({ id: itemId, count: add });
      left -= add;
    }
    return left <= 0;
  }

  function tryPushInput(m, itemId, count = 1) {
    const maxSlots = inputSlotCount();
    const max = stackMax();
    let left = count;

    for (const stack of m.input) {
      if (stack.id !== itemId || stack.count >= max) continue;
      const add = Math.min(left, max - stack.count);
      stack.count += add;
      left -= add;
      if (left <= 0) return count;
    }

    while (left > 0 && m.input.length < maxSlots) {
      const add = Math.min(left, max);
      m.input.push({ id: itemId, count: add });
      left -= add;
    }
    return count - left;
  }

  function returnSmelterContents(state, m) {
    ensureSmelterShape(m);
    for (const stack of m.input) addItem(state, stack.id, stack.count);
    if (m.fuelId && m.fuelCount > 0) addItem(state, m.fuelId, m.fuelCount);
    for (const stack of m.output) addItem(state, stack.id, stack.count);
  }

  /** Advance all smelters by `minutes` of in-game time. */
  function tickSmelters(state, minutes) {
    const poweredTiles = computePoweredTiles(state);
    for (const m of state.machines) {
      if (m.type !== "smelter") continue;
      ensureSmelterShape(m);
      const electric = isMachinePowered(state, m, poweredTiles);

      let remaining = minutes;
      while (remaining > 0) {
        const source = findSmeltSource(m);
        if (!source) {
          m.progressMinutes = 0;
          m.smeltingSlot = -1;
          break;
        }

        const recipe = getSmeltRecipe(source.stack.id);
        m.smeltingSlot = source.index;

        if (outputFreeSpace(m, recipe.output) < 1) break;

        // Wired to a live generator → electric heat. Otherwise burn local fuel.
        if (!electric && m.storedEnergy <= 0) {
          if (!burnFuelToEnergy(m)) {
            m.progressMinutes = 0;
            break;
          }
        }

        const heatLeft = electric ? remaining : m.storedEnergy;
        const step = Math.min(remaining, heatLeft, recipe.minutes - m.progressMinutes);
        if (step <= 0) break;

        if (!electric) m.storedEnergy -= step;
        m.progressMinutes += step;
        remaining -= step;

        if (!electric && m.storedEnergy <= 0 && m.progressMinutes < recipe.minutes) {
          m.progressMinutes = 0;
          break;
        }

        if (m.progressMinutes >= recipe.minutes) {
          if (!tryPushOutput(m, recipe.output, 1)) break;
          source.stack.count -= 1;
          if (source.stack.count <= 0) {
            m.input.splice(source.index, 1);
            m.smeltingSlot = -1;
          }
          m.progressMinutes = 0;
          state.stats.manualSmelted = (state.stats.manualSmelted || 0) + 1;
          state.stats.smelted[recipe.output] = (state.stats.smelted[recipe.output] || 0) + 1;
          setToast(state, `Smelter finished +1 ${GameData.getItem(recipe.output).name}`);
        }
      }
    }
  }

  function placeMachine(state, tile, type) {
    if (!PLACEABLE.includes(type)) return false;
    if (!canActWithHealth(state)) return false;
    // Power Lines spend crafted Cable — Copper Wire is only a crafting ingredient.
    if (type === "cable" && (state.inventory.cable || 0) < 1) {
      setToast(state, "Need Cable — craft 2 Copper Wire horizontally in the Workroom");
      return false;
    }
    if (playerBlocksBuild(state, type, tile.x, tile.y)) {
      setToast(state, "A player is in the way");
      return false;
    }

    if (type === "base") {
      const check = canPlaceBase(state, tile.x, tile.y);
      if (!check.ok) {
        setToast(state, check.reason);
        return false;
      }
      const cost = getBuildCost(type);
      if (!canAfford(state, cost)) {
        setToast(state, `Need ${formatCost(cost)}`);
        return false;
      }
      spend(state, cost);
      const { w, h } = getStructureSize("base");
      for (const cell of check.cells) {
        const t = getTile(state, cell.x, cell.y);
        if (!t) continue;
        t.machine = "base";
        if (!t.node) t.kind = "machine";
      }
      // Walls shove monsters out of the yard.
      if (Array.isArray(state.monsters)) {
        const blocked = new Set(check.cells.map((c) => tileKey(c.x, c.y)));
        state.monsters = state.monsters.filter((m) => !blocked.has(tileKey(m.x, m.y)));
      }
      state.machines.push({
        type: "base",
        x: tile.x,
        y: tile.y,
        w,
        h,
        tier: 1,
        timer: 0,
        interval: 0,
      });
      setToast(state, "Wood Base raised — go inside to upgrade (Stone → Iron)");
      speakAda(state, "firstBase");
      applyHungerCost(state, hungerActionCost());
      ensurePlayerOnWalkable(state);
      ensureMonstersOnWalkable(state);
      return true;
    }

    const spot = canPlaceOnTile(type, tile);
    if (!spot.ok) {
      setToast(state, spot.reason);
      return false;
    }
    const cost = getBuildCost(type);
    if (!canAfford(state, cost)) {
      setToast(state, `Need ${formatCost(cost)}`);
      return false;
    }

    spend(state, cost);
    tile.machine = type;
    if (!tile.node) tile.kind = "machine";

    if (type === "drill") {
      const resource = tile.node ? GameData.nodeTypes[tile.node].resource : null;
      state.machines.push({
        type: "drill",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 1.4,
        resource,
      });
      setToast(
        state,
        resource
          ? "Drill placed — connect it with Power Lines or poles"
          : "Drill placed (needs a resource node + power)"
      );
    } else if (type === "smelter") {
      state.machines.push(makeSmelterMachine(tile.x, tile.y));
      setToast(state, "Smelter placed — wire power for electric heat, or add fuel");
      speakAda(state, "firstSmelter");
    } else if (type === "generator") {
      state.machines.push(makeGeneratorMachine(tile.x, tile.y));
      setToast(state, "Generator placed — click it to load Coal and check the power grid");
      speakAda(state, "firstGenerator");
    } else if (type === "fan") {
      state.machines.push({
        type: "fan",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 0,
      });
      setToast(state, "Fan placed — wire it next to a generator to keep things cool");
      speakAda(state, "firstFan");
    } else if (type === "powerPole") {
      state.machines.push({
        type: "powerPole",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 0,
      });
      setToast(state, "Power pole placed — run a line from generator to machines");
    } else if (type === "cable") {
      state.machines.push({
        type: "cable",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 0,
      });
      setToast(state, "Power Line laid — connects output buildings to input buildings");
    } else if (type === "craftingStation") {
      setToast(state, "Crafting Table removed — use the Workroom inside your Base");
      return false;
    }

    applyHungerCost(state, hungerActionCost());
    // Building on the player's tile is possible — slide them off if so.
    ensurePlayerOnWalkable(state);
    // Stay in build mode until the player presses Q.
    return true;
  }

  function demolishMachine(state, tile) {
    if (!tile.machine) return false;
    if (tile.machine === "deathCrate") {
      return lootDeathCrate(state, tile);
    }
    if (tile.machine === "waterBucket") {
      return pickupPlacedWaterBucket(state, tile);
    }
    if (!canActWithHealth(state)) return false;

    if (tile.machine === "base") {
      const base = findBaseMachine(state, tile.x, tile.y);
      if (!base) {
        tile.machine = null;
        if (!tile.node) tile.kind = "grass";
        else tile.kind = "node";
        return false;
      }
      const cells = getStructureFootprint("base", base.x, base.y);
      for (const cell of cells) {
        const t = getTile(state, cell.x, cell.y);
        if (!t || t.machine !== "base") continue;
        t.machine = null;
        if (!t.node) t.kind = "grass";
        else t.kind = "node";
      }
      state.machines = state.machines.filter((m) => m !== base);
      const refund = getBaseRefund(base);
      for (const [id, n] of Object.entries(refund)) addItem(state, id, n);
      const name = getBaseTierInfo(base.tier).name;
      setToast(state, `${name} demolished — refunded ${formatCost(refund)}`);
      applyHungerCost(state, hungerActionCost());
      return true;
    }

    const type = tile.machine;
    const machine = state.machines.find((m) => m.x === tile.x && m.y === tile.y);
    if (machine?.type === "smelter") returnSmelterContents(state, machine);
    if (machine?.type === "generator") returnGeneratorContents(state, machine);
    if (machine?.type === "craftingStation") {
      ensureCraftTableShape(machine);
      returnGridToInv(machine.craftGrid);
    }
    if (openSmelter && openSmelter.x === tile.x && openSmelter.y === tile.y) closeSmelterUi();
    if (openGenerator && openGenerator.x === tile.x && openGenerator.y === tile.y) closeGeneratorUi();
    if (openCraftTable && openCraftTable.x === tile.x && openCraftTable.y === tile.y) {
      openCraftTable = null;
      hideModal("craft-table-modal");
    }
    state.machines = state.machines.filter((m) => !(m.x === tile.x && m.y === tile.y));
    tile.machine = null;
    if (!tile.node) tile.kind = "grass";
    else tile.kind = "node";
    const refund = getBuildCost(type);
    for (const [id, n] of Object.entries(refund)) addItem(state, id, n);
    const label = MACHINE_LABELS[type] || type;
    setToast(
      state,
      tile.node && tile.hp <= 0
        ? `${label} removed — materials refunded, node can regrow at 6:00 a.m.`
        : `${label} demolished — refunded ${formatCost(refund)}`
    );
    applyHungerCost(state, hungerActionCost());
    return true;
  }

  function tickMachines(state, dt) {
    const poweredTiles = computePoweredTiles(state);

    // Burn coal / update load chart on each generator while online.
    for (const m of state.machines) {
      if (m.type !== "generator") continue;
      ensureGeneratorShape(m);
      tickGeneratorLoad(state, m, dt);
      if (!isGeneratorOnline(m)) continue;
      m.timer += dt;
      if (m.timer < m.interval) continue;
      m.timer = 0;
      m.fuelCount -= 1;
      if (m.fuelCount <= 0) {
        m.fuelCount = 0;
        m.fuelId = null;
        // Empty tank trips the breaker — same lever reset as an overload.
        if (!m.outage) {
          m.outage = true;
          setToast(
            state,
            "Offline — coal ran out. Refuel and slide the switch to ON to reset."
          );
        }
      }
    }

    // Recompute after possible fuel change this frame.
    const poweredNow = computePoweredTiles(state);
    fanCoolsGenerators(state, poweredNow);

    for (const m of state.machines) {
      if (
        m.type === "generator" ||
        m.type === "powerPole" ||
        m.type === "smelter" ||
        m.type === "fan" ||
        m.type === "cable" ||
        m.type === "waterBucket" ||
        m.type === "deathCrate" ||
        m.type === "base"
      ) {
        continue;
      }
      if (!isMachinePowered(state, m, poweredNow)) continue;

      m.timer += dt;
      if (m.timer < m.interval) continue;
      m.timer = 0;

      if (m.type === "drill") {
        if (!m.resource) continue;
        addItem(state, m.resource, 1);
        state.stats.drilled += 1;
        const wasPowered = state.stats.poweredDrill || 0;
        state.stats.poweredDrill = wasPowered + 1;
        state.stats.gathered[m.resource] = (state.stats.gathered[m.resource] || 0) + 1;
        if (wasPowered < 1) speakAda(state, "firstDrill");
      }
    }

    poweredTilesCache = poweredNow;
  }

  function burstConfetti({ count = 56 } = {}) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const colors = ["#3ddc97", "#f0b429", "#f2f7f4", "#7ec8ff", "#e29a3a", "#5ec4a8"];
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    layer.setAttribute("aria-hidden", "true");

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("span");
      const round = Math.random() < 0.28;
      piece.className = `confetti-piece${round ? " is-round" : ""}`;
      piece.style.setProperty("--x", `${4 + Math.random() * 92}%`);
      piece.style.setProperty("--c", colors[i % colors.length]);
      piece.style.setProperty("--w", `${5 + Math.floor(Math.random() * 7)}px`);
      piece.style.setProperty("--h", `${8 + Math.floor(Math.random() * 10)}px`);
      piece.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 180)}px`);
      piece.style.setProperty("--spin", `${Math.round(360 + Math.random() * 720)}deg`);
      piece.style.setProperty("--dur", `${1.25 + Math.random() * 0.9}s`);
      piece.style.setProperty("--delay", `${Math.random() * 0.18}s`);
      frag.appendChild(piece);
    }
    layer.appendChild(frag);
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 2600);
  }

  /** Falling easter eggs celebration when a secret is unlocked. */
  function burstEasterEggs({ count = 36, delaySpread = 0.35, sizeMin = 1.05, sizeMax = 2.2 } = {}) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const glyphs = ["🥚", "🥚", "🐣", "✨", "🥚", "🎉"];
    const layer = document.createElement("div");
    layer.className = "egg-rain-layer";
    layer.setAttribute("aria-hidden", "true");

    const frag = document.createDocumentFragment();
    const sizeSpan = Math.max(0, sizeMax - sizeMin);
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("span");
      piece.className = "egg-rain-piece";
      piece.textContent = glyphs[i % glyphs.length];
      piece.style.setProperty("--x", `${3 + Math.random() * 94}%`);
      piece.style.setProperty("--egg-size", `${sizeMin + Math.random() * sizeSpan}rem`);
      piece.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 220)}px`);
      piece.style.setProperty("--spin", `${Math.round(200 + Math.random() * 700)}deg`);
      piece.style.setProperty("--dur", `${1.55 + Math.random() * 1.15}s`);
      piece.style.setProperty("--delay", `${Math.random() * delaySpread}s`);
      frag.appendChild(piece);
    }
    layer.appendChild(frag);
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 3200 + delaySpread * 1000);
  }

  /** Big multi-wave egg rain when every easter egg is found. */
  function burstEasterEggWave() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const waves = [
      { count: 48, delaySpread: 0.55, sizeMin: 1.1, sizeMax: 2.35 },
      { count: 56, delaySpread: 0.75, sizeMin: 1.2, sizeMax: 2.6 },
      { count: 64, delaySpread: 0.95, sizeMin: 1.05, sizeMax: 2.8 },
    ];
    waves.forEach((opts, index) => {
      window.setTimeout(() => burstEasterEggs(opts), index * 520);
    });
  }

  function ensureEggsDone(gameState) {
    if (!gameState) return;
    if (!gameState.eggsDone || typeof gameState.eggsDone !== "object") {
      gameState.eggsDone = {};
    }
  }

  function areAllEasterEggsDone(gameState = state) {
    if (!gameState) return false;
    ensureEggsDone(gameState);
    const eggs = GameData.easterEggs || [];
    if (!eggs.length) return false;
    return eggs.every((egg) => Boolean(gameState.eggsDone[egg.id]));
  }

  /** Unlock a secret; rains eggs in-game once per egg id. */
  function unlockEasterEgg(eggId) {
    if (!state || !eggId) return false;
    ensureEggsDone(state);
    const egg = (GameData.easterEggs || []).find((e) => e.id === eggId);
    if (!egg) return false;
    if (state.eggsDone[eggId]) return false;

    state.eggsDone[eggId] = true;
    const allDone = areAllEasterEggsDone(state);
    setToast(state, `Easter egg: ${egg.text}`);
    burstEasterEggs();
    if (allDone) {
      // Last secret — dump a full wave on the player.
      window.setTimeout(() => {
        if (!state) return;
        setToast(state, "All easter eggs found — egg wave!");
        burstEasterEggWave();
        renderHud();
      }, 420);
    }
    easterEggsSig = "";
    renderEasterEggs();
    saveState(state);
    renderHud();
    return true;
  }

  function updateGoals(state) {
    let changed = false;
    for (const goal of GameData.goals) {
      if (!state.goalsDone[goal.id] && goal.check(state)) {
        state.goalsDone[goal.id] = true;
        setToast(state, `Goal complete: ${goal.text}`);
        burstConfetti();
        changed = true;
      }
    }
    if (changed) {
      advancementsSig = "";
      renderAdvancements();
    }
  }

  function currentGoal(state) {
    return GameData.goals.find((g) => !state.goalsDone[g.id]) || null;
  }

  // --- UI wiring ---
  let state = null;
  /** Outdoor thunder telegraph: center of the 3×3 about to be struck. */
  let lightningWarnCell = null;
  let raf = 0;
  let last = 0;
  let clockTimer = 0;
  let root = null;
  let bound = false;
  let poweredTilesCache = new Set();
  let openSmelter = null; // { x, y } of open smelter UI
  let openGenerator = null; // { x, y } of open generator UI
  let openPlayerInv = false;
  let openCraftTable = null; // { x, y } outdoor table, or { workroom: true }
  let openKitchen = false;
  let kitchenDrag = null; // { from: "inv"|"kitchen", itemId, count, slotIndex? }
  let openStorage = false;
  let storageDrag = null; // { from: "inv"|"storage", itemId, count, slotIndex? }
  let openRecipes = false;
  let recipesSelectedId = null; // null = category grid; set = detail view
  let recipesCategory = "everything"; // "everything" | "items" | "tools" | "food" | "buildings"
  let openBuildMenu = false;
  let openBaseEnterPrompt = false;
  let openBaseLeavePrompt = false;
  let openSleepPrompt = false;
  let openTvPrompt = false;
  /** Tile to shove the player back to if they decline entering the base. */
  let baseEnterFrom = null;
  /** Tile to shove the player back to if they decline leaving via an exit door. */
  let baseLeaveFrom = null;
  let gamePaused = false;
  let advancementsSig = "";
  let easterEggsSig = "";
  let playerCraftGrid = [null, null, null, null];
  let craftDrag = null;
  let smelterDrag = null; // { from, itemId, count, outIndex? }
  let generatorDrag = null; // { from, itemId, count }
  let playActive = false;
  let buildHover = null; // { x, y } while aiming a placeable structure

  function findOpenSmelterMachine() {
    if (!state || !openSmelter) return null;
    const m = state.machines.find(
      (machine) =>
        machine.type === "smelter" &&
        machine.x === openSmelter.x &&
        machine.y === openSmelter.y
    );
    return m ? ensureSmelterShape(m) : null;
  }

  function slotHtml(itemId, count, emptyLabel = "") {
    if (!itemId || count < 1) {
      return `<span class="smelter-slot__icon">${emptyLabel}</span>`;
    }
    const item = GameData.getItem(itemId);
    return `<span class="smelter-slot__icon">${item.icon}</span><span class="smelter-slot__count">${count}</span>`;
  }

  function refreshSmelterProgress() {
    const modal = document.getElementById("smelter-modal");
    if (!modal || modal.hidden || smelterDrag) return;
    const m = findOpenSmelterMachine();
    if (!m) return;

    const energyBar = document.getElementById("smelter-energy-bar");
    const energyValue = document.getElementById("smelter-energy-value");
    const progressBar = document.getElementById("smelter-progress-bar");
    const progressLabel = document.getElementById("smelter-progress-label");
    const progressTime = document.getElementById("smelter-progress-time");
    const fuelSlot = document.getElementById("smelter-fuel-slot");
    const inputGrid = document.getElementById("smelter-input-grid");

    const electric =
      (poweredTilesCache || computePoweredTiles(state)).has(tileKey(m.x, m.y));
    const energyCap = Math.max(
      fuelEnergyValue("coal"),
      fuelEnergyValue("log"),
      fuelEnergyValue("plank"),
      m.storedEnergy,
      1
    );
    if (energyBar) {
      energyBar.style.width = electric
        ? "100%"
        : `${Math.min(100, (m.storedEnergy / energyCap) * 100)}%`;
      energyBar.classList.toggle("is-electric", electric);
    }
    if (energyValue) {
      energyValue.textContent = electric ? "Electric" : `${m.storedEnergy}`;
    }

    const source = findSmeltSource(m);
    const recipe = source ? getSmeltRecipe(source.stack.id) : null;
    if (recipe) {
      const pct = Math.min(100, (m.progressMinutes / recipe.minutes) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressLabel) {
        progressLabel.textContent = `${GameData.getItem(recipe.input).name} → ${GameData.getItem(recipe.output).name}`;
      }
      if (progressTime) {
        progressTime.textContent = `${m.progressMinutes} / ${recipe.minutes} in-game min`;
      }
    } else {
      if (progressBar) progressBar.style.width = "0%";
      if (progressLabel) progressLabel.textContent = "No recipe — add iron or copper ore";
      if (progressTime) progressTime.textContent = "Iron = 10 min · Copper = 15 min";
    }

    if (fuelSlot) {
      fuelSlot.classList.toggle("is-empty", m.fuelCount < 1);
      fuelSlot.innerHTML = slotHtml(m.fuelId, m.fuelCount, "Fuel");
      fuelSlot.draggable = m.fuelCount > 0;
    }

    // Refresh input slot counts without killing drag mid-action.
    if (inputGrid && !smelterDrag) {
      const buttons = inputGrid.querySelectorAll("[data-smelter-in]");
      const maxIn = inputSlotCount();
      const pads = [...m.input];
      while (pads.length < maxIn) pads.push(null);
      buttons.forEach((btn, index) => {
        const stack = pads[index];
        if (!stack) {
          btn.classList.add("is-empty");
          btn.disabled = true;
          btn.draggable = false;
          btn.innerHTML = slotHtml(null, 0);
          return;
        }
        btn.classList.remove("is-empty");
        btn.disabled = false;
        btn.draggable = true;
        btn.innerHTML = slotHtml(stack.id, stack.count);
      });
    }
  }

  function renderSmelterUi() {
    const modal = document.getElementById("smelter-modal");
    if (!modal || modal.hidden) return;
    const m = findOpenSmelterMachine();
    if (!m) {
      closeSmelterUi();
      return;
    }

    const invGrid = document.getElementById("smelter-inv-grid");
    const outGrid = document.getElementById("smelter-output-grid");
    const inputGrid = document.getElementById("smelter-input-grid");
    const fuelSlot = document.getElementById("smelter-fuel-slot");

    // Pockets: show every carried item (no 15-slot cap).
    const stacks = Object.entries(state.inventory).filter(([, n]) => n > 0);
    if (invGrid) {
      if (!stacks.length) {
        invGrid.innerHTML = `<button type="button" class="smelter-slot is-empty" data-smelter-drop="inv" disabled>${slotHtml(null, 0)}</button>`;
      } else {
        invGrid.innerHTML = stacks
          .map(
            ([id, n]) =>
              `<button type="button" class="smelter-slot" data-smelter-drop="inv" data-smelter-inv="${id}" draggable="true">${slotHtml(id, n)}</button>`
          )
          .join("");
      }
    }

    const maxIn = inputSlotCount();
    if (inputGrid) {
      const pads = [...m.input];
      while (pads.length < maxIn) pads.push(null);
      inputGrid.innerHTML = pads
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-smelter-drop="input" data-smelter-in="${index}" disabled>${slotHtml(null, 0)}</button>`;
          }
          return `<button type="button" class="smelter-slot" data-smelter-drop="input" data-smelter-in="${index}" draggable="true">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    const maxOut = GameData.smelter?.outputSlots || 5;
    if (outGrid) {
      const outs = [...m.output];
      while (outs.length < maxOut) outs.push(null);
      outGrid.innerHTML = outs
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-smelter-drop="output" data-smelter-out="${index}" disabled>${slotHtml(null, 0)}</button>`;
          }
          return `<button type="button" class="smelter-slot" data-smelter-drop="output" data-smelter-out="${index}" draggable="true">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    if (fuelSlot) {
      fuelSlot.classList.toggle("is-empty", m.fuelCount < 1);
      fuelSlot.innerHTML = slotHtml(m.fuelId, m.fuelCount, "Fuel");
      fuelSlot.draggable = m.fuelCount > 0;
      fuelSlot.dataset.smelterDrop = "fuel";
      fuelSlot.dataset.smelterSlot = "fuel";
    }

    refreshSmelterProgress();
  }

  function afterSmelterChange() {
    renderSmelterUi();
    saveState(state);
    renderInventory();
    refreshTilePowerStyles();
  }

  function transferToInput(itemId, amount) {
    const m = findOpenSmelterMachine();
    if (!m || !itemId || amount < 1) return 0;
    if (!getSmeltRecipe(itemId)) {
      setToast(state, "Only iron or copper ore goes in input");
      return 0;
    }
    const room = inputFreeSpace(m, itemId);
    if (room < 1) {
      setToast(state, "Input is full");
      return 0;
    }
    const want = Math.min(amount, room, state.inventory[itemId] || 0);
    if (want < 1) return 0;
    const moved = tryPushInput(m, itemId, want);
    removeItem(state, itemId, moved);
    return moved;
  }

  function transferToFuel(itemId, amount) {
    const m = findOpenSmelterMachine();
    if (!m || amount < 1 || !isSmelterFuel(itemId)) {
      if (itemId && !isSmelterFuel(itemId)) setToast(state, "Only Log, Planks, or Coal for fuel");
      return 0;
    }
    if (m.fuelId && m.fuelId !== itemId) {
      setToast(state, "Empty the fuel slot first");
      return 0;
    }
    const max = stackMax();
    const room = max - m.fuelCount;
    if (room <= 0) {
      setToast(state, `Fuel stack full (${max})`);
      return 0;
    }
    const moved = Math.min(amount, room, state.inventory[itemId] || 0);
    if (moved < 1) return 0;
    removeItem(state, itemId, moved);
    m.fuelId = itemId;
    m.fuelCount += moved;
    return moved;
  }

  function transferInputToInv(index, amount = Infinity) {
    const m = findOpenSmelterMachine();
    if (!m) return 0;
    const stack = m.input[index];
    if (!stack) return 0;
    const moved = Math.min(amount, stack.count);
    addItem(state, stack.id, moved);
    stack.count -= moved;
    if (stack.count <= 0) {
      m.input.splice(index, 1);
      if (m.smeltingSlot === index) {
        m.smeltingSlot = -1;
        m.progressMinutes = 0;
      } else if (m.smeltingSlot > index) {
        m.smeltingSlot -= 1;
      }
    }
    return moved;
  }

  function transferFuelToInv(amount) {
    const m = findOpenSmelterMachine();
    if (!m?.fuelId || m.fuelCount < 1) return 0;
    const moved = Math.min(amount, m.fuelCount);
    addItem(state, m.fuelId, moved);
    m.fuelCount -= moved;
    if (m.fuelCount <= 0) {
      m.fuelId = null;
      m.fuelCount = 0;
    }
    return moved;
  }

  function transferOutputToInv(index) {
    const m = findOpenSmelterMachine();
    if (!m) return 0;
    const stack = m.output[index];
    if (!stack) return 0;
    addItem(state, stack.id, stack.count);
    const moved = stack.count;
    m.output.splice(index, 1);
    return moved;
  }

  function applySmelterDrop(target, extra = {}) {
    if (!smelterDrag || !target) return false;
    const { from, itemId, count, outIndex, inIndex } = smelterDrag;

    if (target === "input") {
      if (from === "inv") return transferToInput(itemId, count) > 0;
      return false;
    }
    if (target === "fuel") {
      if (from === "inv" && isSmelterFuel(itemId)) return transferToFuel(itemId, count) > 0;
      return false;
    }
    if (target === "inv") {
      if (from === "input") return transferInputToInv(inIndex, count) > 0;
      if (from === "fuel") return transferFuelToInv(count) > 0;
      if (from === "output") return transferOutputToInv(outIndex) > 0;
      return false;
    }
    return false;
  }

  function clearSmelterDrag() {
    smelterDrag = null;
    document.getElementById("smelter-modal")?.classList.remove("is-dragging");
    document.querySelectorAll(".smelter-slot.is-drag-source, .smelter-slot.is-drop-hover").forEach((el) => {
      el.classList.remove("is-drag-source", "is-drop-hover");
    });
  }

  function ensureSmelterAt(x, y) {
    let m = state.machines.find((machine) => machine.x === x && machine.y === y && machine.type === "smelter");
    if (!m) {
      m = makeSmelterMachine(x, y);
      state.machines.push(m);
      const tile = getTile(state, x, y);
      if (tile) tile.machine = "smelter";
    }
    return ensureSmelterShape(m);
  }

  function clearBuildMode(toastMsg = null) {
    if (!state || !state.buildMode) return;
    state.buildMode = null;
    buildHover = null;
    clearBuildPreview();
    if (toastMsg) setToast(state, toastMsg);
  }

  function toggleDemolishMode() {
    if (!state || !playActive) return;
    if (isInsideBase(state)) {
      setToast(state, "Can't demolish while inside the Base");
      renderHud();
      return;
    }
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeBuildUi();

    if (state.buildMode === "demolish") {
      state.buildMode = null;
      setToast(state, "Demolish mode off");
    } else {
      state.buildMode = "demolish";
      setToast(state, "Demolish locked (F) — click buildings to remove. F or a menu to exit.");
    }
    renderHud();
    saveState(state);
  }

  function openSmelterUi(x, y) {
    if (!state) return;
    clearBuildMode();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeBuildUi();
    ensureSmelterAt(x, y);
    openSmelter = { x, y };

    const modal = document.getElementById("smelter-modal");
    if (!modal) {
      setToast(state, "Smelter UI missing — hard-refresh the page (Ctrl+Shift+R)");
      return;
    }

    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.style.display = "grid";
    modal.style.visibility = "visible";
    modal.style.opacity = "1";
    modal.style.pointerEvents = "auto";
    modal.style.zIndex = "10000";

    renderSmelterUi();
    renderHud();
    setToast(state, "Smelter open — load ore & log/coal for heat");
  }

  function closeSmelterUi() {
    clearSmelterDrag();
    openSmelter = null;
    const modal = document.getElementById("smelter-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("hidden", "");
      modal.style.display = "none";
    }
  }

  function findOpenGeneratorMachine() {
    if (!state || !openGenerator) return null;
    const m = state.machines.find(
      (machine) =>
        machine.type === "generator" &&
        machine.x === openGenerator.x &&
        machine.y === openGenerator.y
    );
    return m ? ensureGeneratorShape(m) : null;
  }

  function clearGeneratorDrag() {
    generatorDrag = null;
    document.getElementById("generator-modal")?.classList.remove("is-dragging");
    document
      .querySelectorAll(
        "#generator-modal .smelter-slot.is-drag-source, #generator-modal .smelter-slot.is-drop-hover, #generator-modal .smelter-col--inv.is-drop-hover"
      )
      .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover"));
  }

  function transferToGeneratorFuel(itemId, amount) {
    const m = findOpenGeneratorMachine();
    if (!m || amount < 1) return 0;
    if (itemId !== "coal") {
      setToast(state, "Coal Generator only burns Coal");
      return 0;
    }
    const max = stackMax();
    const room = max - m.fuelCount;
    if (room <= 0) {
      setToast(state, `Fuel stack full (${max})`);
      return 0;
    }
    const moved = Math.min(amount, room, state.inventory.coal || 0);
    if (moved < 1) return 0;
    removeItem(state, "coal", moved);
    m.fuelId = "coal";
    m.fuelCount += moved;
    return moved;
  }

  function transferGeneratorFuelToInv(amount) {
    const m = findOpenGeneratorMachine();
    if (!m?.fuelId || m.fuelCount < 1) return 0;
    const moved = Math.min(amount, m.fuelCount);
    addItem(state, m.fuelId, moved);
    m.fuelCount -= moved;
    if (m.fuelCount <= 0) {
      m.fuelId = null;
      m.fuelCount = 0;
    }
    return moved;
  }

  function applyGeneratorDrop(target) {
    if (!generatorDrag || !target) return false;
    const { from, itemId, count } = generatorDrag;
    if (target === "cool") {
      if (from !== "inv" || !isCoolantItem(itemId)) {
        setToast(state, "Drop Ice on the thermometer to cool");
        return false;
      }
      const m = findOpenGeneratorMachine();
      return applyIceToGenerator(m);
    }
    if (target === "fuel") {
      if (from === "inv") {
        if (isCoolantItem(itemId)) {
          const m = findOpenGeneratorMachine();
          return applyIceToGenerator(m);
        }
        return transferToGeneratorFuel(itemId, count) > 0;
      }
      return false;
    }
    if (target === "inv") {
      if (from === "fuel") return transferGeneratorFuelToInv(count) > 0;
      return false;
    }
    return false;
  }

  function renderGeneratorPowerChart(m) {
    const line = document.getElementById("generator-power-line");
    const loadEl = document.getElementById("generator-grid-load");
    const hourEl = document.getElementById("generator-hour-energy");
    const summary = document.getElementById("generator-grid-summary");
    const gridCol = document.querySelector("#generator-modal .generator-col--grid");
    if (!m) return;

    ensureGeneratorShape(m);
    const history = m.loadHistory;
    const w = 200;
    const h = 100;
    const max = POWER_GRID_MAX;
    const points = history
      .map((value, index) => {
        const x = history.length <= 1 ? 0 : (index / (history.length - 1)) * w;
        const clamped = Math.max(0, Math.min(max, value));
        const y = h - (clamped / max) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    if (line) line.setAttribute("points", points);

    const load = Math.round(m.gridLoad) || 0;
    const hourUsed = generatorHourEnergyUsed(m);
    if (loadEl) {
      loadEl.innerHTML = `${load} <small>/ ${max} now</small>`;
      loadEl.classList.toggle("is-over", load > max || m.outage);
    }
    if (hourEl) {
      hourEl.textContent = `Hour used: ${hourUsed}`;
    }

    if (gridCol) gridCol.classList.toggle("is-tripped", Boolean(m.outage));

    if (summary) {
      const demand = networkPowerDemand(state, m);
      const wired = generatorHasConnection(state, m);
      if (m.outage) {
        summary.textContent = "OFFLINE — switch is OFF · slide up to ON";
      } else if (!isGeneratorFueled(m)) {
        summary.textContent = "Needs fuel — load Coal to power the grid";
      } else if (!wired) {
        summary.textContent = "Needs connection — run a Power Line or pole to a machine";
      } else if (demand <= 0) {
        summary.textContent = "Online — chart tracks energy used each minute (last hour)";
      } else {
        summary.textContent = `Demand ${demand} · chart = energy used over the last hour (max ${max})`;
      }
    }
  }

  function syncGeneratorOutageLayout(m) {
    const panel = document.querySelector("#generator-modal .generator-panel");
    const body = document.querySelector("#generator-modal .generator-panel__body");
    const leverCol = document.getElementById("generator-lever-col");
    const outage = Boolean(m?.outage);
    panel?.classList.toggle("is-outage", outage);
    body?.classList.toggle("is-outage", outage);
    if (leverCol) {
      leverCol.hidden = !outage;
      if (!outage) setOutageLeverPull(0);
    }
  }

  function setOutageLeverPull(ratio) {
    const handle = document.getElementById("outage-lever-handle");
    const track = handle?.parentElement;
    if (!handle || !track) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const travel = Math.max(0, track.clientHeight - handle.offsetHeight - 8);
    handle.style.bottom = `${4 + clamped * travel}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
  }

  function refreshGeneratorStatus() {
    const modal = document.getElementById("generator-modal");
    if (!modal || modal.hidden || generatorDrag) return;
    const m = findOpenGeneratorMachine();
    if (!m) return;

    const fuelSlot = document.getElementById("generator-fuel-slot");
    const fuelStatus = document.getElementById("generator-fuel-status");
    const online = isGeneratorOnline(m);

    if (fuelSlot) {
      fuelSlot.classList.toggle("is-empty", m.fuelCount < 1);
      fuelSlot.innerHTML = slotHtml(m.fuelId, m.fuelCount, "Coal");
      fuelSlot.draggable = m.fuelCount > 0;
      fuelSlot.dataset.generatorDrop = "fuel";
      fuelSlot.dataset.generatorSlot = "fuel";
    }

    if (fuelStatus) {
      // Offline = outage only. Then: needs fuel → needs connection → online.
      const wired = generatorHasConnection(state, m);
      let label = "Needs fuel";
      if (m.outage) label = "Offline";
      else if (!isGeneratorFueled(m)) label = "Needs fuel";
      else if (!wired) label = "Needs connection";
      else label = "Online";
      fuelStatus.textContent = label;
      fuelStatus.classList.toggle("is-online", online);
      fuelStatus.classList.toggle("is-offline", Boolean(m.outage));
      fuelStatus.classList.toggle("is-needs-fuel", !m.outage && !isGeneratorFueled(m));
      fuelStatus.classList.toggle("is-needs-connection", !m.outage && isGeneratorFueled(m) && !wired);
    }

    renderGeneratorTemp(m);
    syncGeneratorOutageLayout(m);
    renderGeneratorPowerChart(m);
    poweredTilesCache = computePoweredTiles(state);
  }

  function renderGeneratorTemp(m) {
    const fill = document.getElementById("generator-temp-fill");
    const label = document.getElementById("generator-temp-label");
    const wrap = document.getElementById("generator-temp");
    if (!m) return;
    ensureGeneratorShape(m);
    const temp = Math.round(m.tempC);
    const span = GEN_TEMP_MAX - GEN_TEMP_AMBIENT;
    const pct = Math.max(0, Math.min(100, ((temp - GEN_TEMP_AMBIENT) / span) * 100));
    if (fill) fill.style.height = `${pct}%`;
    if (label) label.textContent = `${temp}°C`;
    if (wrap) {
      wrap.classList.toggle("is-warm", temp >= 55 && temp < 85);
      wrap.classList.toggle("is-hot", temp >= 85 && temp < GEN_TEMP_OVERHEAT);
      wrap.classList.toggle("is-overheat", temp >= GEN_TEMP_OVERHEAT || m.outage);
      wrap.title = `Temperature ${temp}°C · drop Ice to cool · overheat at ${GEN_TEMP_OVERHEAT}°C`;
    }
  }

  function renderGeneratorUi() {
    const modal = document.getElementById("generator-modal");
    if (!modal || modal.hidden) return;
    const m = findOpenGeneratorMachine();
    if (!m) {
      closeGeneratorUi();
      return;
    }

    const invGrid = document.getElementById("generator-inv-grid");
    const stacks = Object.entries(state.inventory).filter(([, n]) => n > 0);
    if (invGrid) {
      if (!stacks.length) {
        invGrid.innerHTML = `<button type="button" class="smelter-slot is-empty" data-generator-drop="inv" disabled>${slotHtml(null, 0)}</button>`;
      } else {
        invGrid.innerHTML = stacks
          .map(
            ([id, n]) =>
              `<button type="button" class="smelter-slot" data-generator-drop="inv" data-generator-inv="${id}" draggable="true">${slotHtml(id, n)}</button>`
          )
          .join("");
      }
    }

    refreshGeneratorStatus();
  }

  function afterGeneratorChange() {
    renderGeneratorUi();
    saveState(state);
    renderInventory();
    refreshTilePowerStyles();
    renderHud();
  }

  function openGeneratorUi(x, y) {
    if (!state) return;
    clearBuildMode();
    closeSmelterUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeBuildUi();

    let m = state.machines.find((machine) => machine.x === x && machine.y === y && machine.type === "generator");
    if (!m) {
      m = makeGeneratorMachine(x, y);
      state.machines.push(m);
      const tile = getTile(state, x, y);
      if (tile) tile.machine = "generator";
    }
    ensureGeneratorShape(m);
    openGenerator = { x, y };

    const modal = document.getElementById("generator-modal");
    if (!modal) {
      setToast(state, "Generator UI missing — hard-refresh the page (Ctrl+Shift+R)");
      return;
    }

    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.style.display = "grid";
    modal.style.visibility = "visible";
    modal.style.opacity = "1";
    modal.style.pointerEvents = "auto";
    modal.style.zIndex = "10000";

    renderGeneratorUi();
    renderHud();
    setToast(state, "Coal Generator — load Coal to power the grid");
  }

  function closeGeneratorUi() {
    clearGeneratorDrag();
    openGenerator = null;
    const modal = document.getElementById("generator-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("hidden", "");
      modal.style.display = "none";
    }
  }

  function bindGeneratorUi() {
    const modal = document.getElementById("generator-modal");
    if (!modal) return;

    let leverDrag = null; // { startY, startPull }

    function pullRatioFromClientY(clientY) {
      const track = document.querySelector("#outage-lever .outage-lever__track");
      const handle = document.getElementById("outage-lever-handle");
      if (!track || !handle) return 0;
      const rect = track.getBoundingClientRect();
      const travel = Math.max(1, rect.height - handle.offsetHeight - 8);
      const fromBottom = rect.bottom - 4 - handle.offsetHeight / 2 - clientY;
      return Math.max(0, Math.min(1, fromBottom / travel));
    }

    function endLeverDrag(commit) {
      const lever = document.getElementById("outage-lever");
      lever?.classList.remove("is-pulling");
      if (!leverDrag) return;
      leverDrag = null;
      if (!commit) {
        setOutageLeverPull(0);
        return;
      }
      const m = findOpenGeneratorMachine();
      if (m && resetGeneratorOutage(m)) {
        setToast(state, "Power restored");
        afterGeneratorChange();
      } else {
        setOutageLeverPull(0);
      }
    }

    modal.addEventListener("click", (event) => {
      if (generatorDrag || leverDrag) return;
      if (event.target.closest("[data-generator-close]")) {
        closeGeneratorUi();
        return;
      }
      const invId = event.target.closest("[data-generator-inv]")?.dataset.generatorInv;
      if (invId) {
        if (invId === "coal") {
          if (transferToGeneratorFuel("coal", 1) > 0) afterGeneratorChange();
        } else {
          setToast(state, "Coal Generator only burns Coal");
        }
        return;
      }
      const slot = event.target.closest("[data-generator-slot]")?.dataset.generatorSlot;
      if (slot === "fuel") {
        if (transferGeneratorFuelToInv(1) > 0) afterGeneratorChange();
      }
    });

    modal.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("#outage-lever-handle");
      if (!handle) return;
      const m = findOpenGeneratorMachine();
      if (!m?.outage) return;
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      leverDrag = { startY: event.clientY, startPull: 0 };
      document.getElementById("outage-lever")?.classList.add("is-pulling");
      setOutageLeverPull(0);
    });

    modal.addEventListener("pointermove", (event) => {
      if (!leverDrag) return;
      const pull = pullRatioFromClientY(event.clientY);
      setOutageLeverPull(pull);
      if (pull >= 0.82) endLeverDrag(true);
    });

    modal.addEventListener("pointerup", () => {
      if (!leverDrag) return;
      const handle = document.getElementById("outage-lever-handle");
      const pull = Number(handle?.getAttribute("aria-valuenow") || 0) / 100;
      endLeverDrag(pull >= 0.75);
    });

    modal.addEventListener("pointercancel", () => endLeverDrag(false));

    modal.addEventListener("dragstart", (event) => {
      const slot = event.target.closest(".smelter-slot");
      if (!slot || slot.disabled) return;
      const m = findOpenGeneratorMachine();
      if (!m) return;

      const invId = slot.dataset.generatorInv;
      const kind = slot.dataset.generatorSlot;

      if (invId) {
        const available = state.inventory[invId] || 0;
        if (available < 1) return;
        generatorDrag = { from: "inv", itemId: invId, count: Math.min(available, stackMax()) };
      } else if (kind === "fuel" && m.fuelCount > 0) {
        generatorDrag = { from: "fuel", itemId: m.fuelId, count: m.fuelCount };
      } else {
        event.preventDefault();
        return;
      }

      slot.classList.add("is-drag-source");
      modal.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", generatorDrag.itemId);
    });

    modal.addEventListener("dragover", (event) => {
      const drop = event.target.closest(
        "[data-generator-drop], [data-generator-slot], .generator-col--inv, .gen-temp"
      );
      if (!drop || !generatorDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(
          ".smelter-slot.is-drop-hover, .smelter-col--inv.is-drop-hover, .gen-temp.is-drop-hover, .gen-temp.is-reject"
        )
        .forEach((el) => el.classList.remove("is-drop-hover", "is-reject"));
      const cool = event.target.closest("[data-generator-drop='cool'], .gen-temp");
      const slot = event.target.closest(".smelter-slot");
      if (cool) {
        cool.classList.add("is-drop-hover");
        if (!isCoolantItem(generatorDrag.itemId)) cool.classList.add("is-reject");
      } else if (slot) slot.classList.add("is-drop-hover");
      else if (drop.classList?.contains("generator-col--inv") || drop.classList?.contains("smelter-col--inv")) {
        drop.classList.add("is-drop-hover");
      }
    });

    modal.addEventListener("dragleave", (event) => {
      const slot = event.target.closest(".smelter-slot, .smelter-col--inv, .gen-temp");
      if (slot) slot.classList.remove("is-drop-hover", "is-reject");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      const slot = event.target.closest(".smelter-slot");
      const dropZone = event.target.closest("[data-generator-drop]");
      let target = dropZone?.dataset.generatorDrop || null;
      if (!target && slot?.dataset.generatorSlot) target = slot.dataset.generatorSlot;
      if (!target && event.target.closest(".generator-col--inv")) target = "inv";

      if (target && applyGeneratorDrop(target)) afterGeneratorChange();
      clearGeneratorDrag();
    });

    modal.addEventListener("dragend", () => {
      clearGeneratorDrag();
    });
  }

  function recipeButtonsHtml(recipes, { fromStation = false, dataAttr = null } = {}) {
    return recipes
      .map((recipe) => {
        const ok = canAfford(state, recipe.cost);
        const cost = Object.entries(recipe.cost)
          .map(([id, n]) => `${n} ${GameData.getItem(id).name}`)
          .join(", ");
        const out = GameData.getItem(recipe.output.id);
        const attr =
          dataAttr || (fromStation ? `data-station-craft="${recipe.id}"` : `data-craft="${recipe.id}"`);
        const fullAttr = dataAttr ? `${dataAttr}="${recipe.id}"` : attr;
        const tier = fromStation ? (recipe.atStation ? "Advanced · " : "Basic · ") : "";
        const stateClass = ok ? "is-ready" : "is-incomplete";
        return `<button type="button" class="craft-btn ${stateClass}" ${fullAttr} title="${ok ? "Click to arrange" : "Click to arrange what you have"}">
          <span class="craft-btn__icon">${out.icon}</span>
          <span class="craft-btn__body">
            <strong>${recipe.name}</strong>
            <small>${tier}${cost}${ok ? "" : " · missing parts"}</small>
          </span>
          <span class="craft-btn__out">×${recipe.output.count}</span>
        </button>`;
      })
      .join("");
  }

  function handRecipes() {
    return GameData.recipes.filter((r) => !r.atStation);
  }

  /** Crafting Table: basic (pocket) + advanced (station) recipes. */
  function tableRecipes() {
    return GameData.recipes.slice();
  }

  /** Map a recipe layout onto the active bench size (2×2 → top-left of 3×3). */
  function layoutForBench(recipe, benchSize) {
    const layout = Array.isArray(recipe.layout) ? recipe.layout : [];
    if (layout.length === benchSize) return layout;
    if (benchSize === 9 && layout.length === 4) {
      const out = Array(9).fill(null);
      out[0] = layout[0];
      out[1] = layout[1];
      out[3] = layout[2];
      out[4] = layout[3];
      return out;
    }
    const out = Array(benchSize).fill(null);
    for (let i = 0; i < Math.min(layout.length, benchSize); i++) out[i] = layout[i];
    return out;
  }

  function normalizeCraftGrid(grid, size) {
    const next = Array.isArray(grid) ? [...grid] : [];
    while (next.length < size) next.push(null);
    return next.slice(0, size).map((s) => {
      if (!s || !s.id) return null;
      if (s.missing) return { id: s.id, count: 0, missing: true };
      if (s.count > 0) return { id: s.id, count: s.count };
      return null;
    });
  }

  function returnGridToInv(grid) {
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) {
      const stack = grid[i];
      if (stack && !stack.missing && stack.count > 0) addItem(state, stack.id, stack.count);
      grid[i] = null;
    }
  }

  function craftGridCounts(grid) {
    const counts = {};
    for (const stack of grid || []) {
      if (!stack || stack.missing || stack.count < 1) continue;
      counts[stack.id] = (counts[stack.id] || 0) + stack.count;
    }
    return counts;
  }

  function gridHasMissing(grid) {
    return (grid || []).some((s) => s && s.missing);
  }

  function layoutCellId(cell) {
    if (!cell) return null;
    if (typeof cell === "string") return cell;
    if (cell.id) return cell.id;
    return null;
  }

  function gridSlotItemId(stack) {
    if (!stack || stack.missing || !(stack.count > 0)) return null;
    return stack.id || null;
  }

  function recipeGridDimensions(recipe) {
    const len = Array.isArray(recipe?.layout) ? recipe.layout.length : 0;
    if (len === 4) return { w: 2, h: 2 };
    if (len === 9) return { w: 3, h: 3 };
    return null;
  }

  function benchGridDimensions(benchSize) {
    if (benchSize === 4) return { w: 2, h: 2 };
    if (benchSize === 9) return { w: 3, h: 3 };
    const side = Math.round(Math.sqrt(benchSize));
    return { w: side, h: side };
  }

  /**
   * Shaped recipe pattern: shrink layout to its non-empty bounding box
   * (empties inside the box still matter).
   */
  function recipeShapePattern(recipe) {
    const dims = recipeGridDimensions(recipe);
    if (!dims) return null;
    const { w, h } = dims;
    const layout = recipe.layout;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!layoutCellId(layout[y * w + x])) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) return null;
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const pattern = Array(pw * ph).fill(null);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        pattern[(y - minY) * pw + (x - minX)] = layoutCellId(layout[y * w + x]);
      }
    }
    const filled = pattern.reduce((n, id) => n + (id ? 1 : 0), 0);
    return { pw, ph, pattern, filled };
  }

  function gridMatchesShapeAt(grid, benchW, benchH, shape, ox, oy) {
    const { pw, ph, pattern } = shape;
    for (let y = 0; y < benchH; y++) {
      for (let x = 0; x < benchW; x++) {
        const gId = gridSlotItemId(grid[y * benchW + x]);
        const inPat = x >= ox && x < ox + pw && y >= oy && y < oy + ph;
        if (inPat) {
          const pId = pattern[(y - oy) * pw + (x - ox)];
          if (pId) {
            if (gId !== pId) return false;
          } else if (gId) {
            return false;
          }
        } else if (gId) {
          return false;
        }
      }
    }
    return true;
  }

  /** True only when the grid shows this recipe's shape (may be shifted). */
  function gridMatchesRecipeLayout(grid, recipe, benchSize) {
    if (!recipe || gridHasMissing(grid)) return false;
    const shape = recipeShapePattern(recipe);
    if (!shape) return false;
    const { w: benchW, h: benchH } = benchGridDimensions(benchSize || grid.length);
    if (shape.pw > benchW || shape.ph > benchH) return false;
    for (let oy = 0; oy <= benchH - shape.ph; oy++) {
      for (let ox = 0; ox <= benchW - shape.pw; ox++) {
        if (gridMatchesShapeAt(grid, benchW, benchH, shape, ox, oy)) return true;
      }
    }
    return false;
  }

  function gridSatisfiesRecipe(grid, recipe) {
    if (!recipe) return false;
    return gridMatchesRecipeLayout(grid, recipe, grid?.length);
  }

  function findGridMatchedRecipe(grid, recipes) {
    if (gridHasMissing(grid)) return null;
    if (!Object.keys(craftGridCounts(grid)).length) return null;
    let best = null;
    let bestFilled = -1;
    for (const recipe of recipes) {
      if (!gridMatchesRecipeLayout(grid, recipe, grid.length)) continue;
      const filled = recipeShapePattern(recipe)?.filled || 0;
      // Prefer the more specific (more filled) shaped recipe if several match.
      if (filled > bestFilled) {
        best = recipe;
        bestFilled = filled;
      }
    }
    return best;
  }

  function craftRecipeFromGrid(recipeId) {
    const bench = getActiveBench();
    const recipe = GameData.recipes.find((r) => r.id === recipeId);
    if (!bench || !recipe) return false;
    if (!canActWithHealth(state)) return false;
    if (!bench.recipes.some((r) => r.id === recipe.id)) return false;
    if (gridHasMissing(bench.grid)) {
      setToast(state, "Missing materials (red slots)");
      return false;
    }
    if (!gridMatchesRecipeLayout(bench.grid, recipe, bench.size)) {
      setToast(state, "Wrong recipe shape — arrange it correctly");
      return false;
    }
    if (!spendFromCraftGrid(bench.grid, recipe.cost)) return false;
    applyCraftedRecipe(recipe);
    return true;
  }

  function spendFromCraftGrid(grid, cost) {
    const need = { ...cost };
    for (let i = 0; i < grid.length; i++) {
      const stack = grid[i];
      if (!stack || stack.missing || !need[stack.id]) continue;
      const take = Math.min(stack.count, need[stack.id]);
      stack.count -= take;
      need[stack.id] -= take;
      if (stack.count <= 0) grid[i] = null;
    }
    return Object.values(need).every((n) => n <= 0);
  }

  function applyCraftedRecipe(recipe) {
    addItem(state, recipe.output.id, recipe.output.count);
    grantRecipeReturns(state, recipe);
    if (!state.stats.crafted) state.stats.crafted = {};
    state.stats.crafted[recipe.output.id] =
      (state.stats.crafted[recipe.output.id] || 0) + recipe.output.count;
    if (recipe.unlocksTool) unlockTool(state, recipe.unlocksTool);
    if (recipe.unlocksTool && equippedToolId(state) === "hand") {
      if (!equipTool(state, recipe.unlocksTool)) {
        setToast(state, `Crafted ${recipe.name} — drag to Equipment`);
      }
    } else {
      setToast(
        state,
        recipe.unlocksTool
          ? `Crafted ${recipe.name} — drag to Equipment to use`
          : `Crafted ${recipe.name}`
      );
    }
    applyHungerCost(state, hungerActionCost());
    maybeAdaAfterCraft(state, recipe);
  }

  function ensureWorkroomCraft(gameState) {
    if (!gameState) return null;
    if (!gameState.workroomCraft || typeof gameState.workroomCraft !== "object") {
      gameState.workroomCraft = {
        type: "craftingStation",
        craftGrid: Array(9).fill(null),
      };
    }
    gameState.workroomCraft.type = "craftingStation";
    ensureCraftTableShape(gameState.workroomCraft);
    return gameState.workroomCraft;
  }

  function findCraftTableMachine() {
    if (!state || !openCraftTable) return null;
    if (openCraftTable.workroom) return ensureWorkroomCraft(state);
    return (
      state.machines.find(
        (m) =>
          m.type === "craftingStation" &&
          m.x === openCraftTable.x &&
          m.y === openCraftTable.y
      ) || null
    );
  }

  function ensureCraftTableShape(m) {
    if (!m || m.type !== "craftingStation") return m;
    m.craftGrid = normalizeCraftGrid(m.craftGrid, 9);
    return m;
  }

  /** Active bench: Tab inventory (2x2) or placed Crafting Table (3x3). */
  function getActiveBench() {
    if (openPlayerInv) {
      playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
      return {
        mode: "player",
        grid: playerCraftGrid,
        size: 4,
        recipes: handRecipes(),
        fromStation: false,
        modalId: "player-inv-modal",
        listId: "player-inv-list",
        gridId: "player-craft-grid",
        resultId: "player-craft-result",
        invId: "player-inv-grid",
        craftAttr: "data-player-craft",
      };
    }
    if (openCraftTable) {
      const m = findCraftTableMachine();
      if (!m) return null;
      ensureCraftTableShape(m);
      return {
        mode: "table",
        grid: m.craftGrid,
        size: 9,
        recipes: tableRecipes(),
        fromStation: true,
        modalId: "craft-table-modal",
        listId: "craft-table-list",
        gridId: "table-craft-grid",
        resultId: "table-craft-result",
        invId: "craft-table-inv-grid",
        craftAttr: "data-table-craft",
        machine: m,
      };
    }
    return null;
  }

  function pushToActiveGrid(itemId, amount = 1) {
    ensureBag(state);
    const bench = getActiveBench();
    if (!bench || !itemId || amount < 1) return 0;
    let left = Math.min(amount, state.inventory[itemId] || 0);
    let moved = 0;

    while (left > 0) {
      const slotIndex = state.bag.findIndex((s) => s && s.id === itemId);
      if (slotIndex < 0) break;
      const step = pushToActiveGridFromBag(slotIndex, 1);
      if (step < 1) break;
      moved += step;
      left -= step;
    }
    return moved;
  }

  function takeFromActiveGrid(index, amount = 1) {
    const bench = getActiveBench();
    if (!bench) return 0;
    const stack = bench.grid[index];
    if (!stack) return 0;
    if (stack.missing || stack.count < 1) {
      bench.grid[index] = null;
      return 0;
    }
    const moved = Math.min(amount, stack.count);
    addItem(state, stack.id, moved);
    stack.count -= moved;
    if (stack.count <= 0) bench.grid[index] = null;
    return moved;
  }

  function takeFromActiveGridToBagSlot(gridIndex, bagIndex, amount = Infinity) {
    const bench = getActiveBench();
    ensureBag(state);
    if (!bench) return 0;
    const stack = bench.grid[gridIndex];
    if (!stack) return 0;
    if (stack.missing || stack.count < 1) {
      bench.grid[gridIndex] = null;
      return 0;
    }
    const dest = state.bag[bagIndex];

    if (dest && dest.id !== stack.id) {
      // Swap whole stacks.
      state.bag[bagIndex] = { id: stack.id, count: stack.count };
      bench.grid[gridIndex] = { id: dest.id, count: dest.count };
      rebuildInventoryFromBag(state);
      return stack.count;
    }

    const moved = Math.min(amount === Infinity ? stack.count : amount, stack.count);
    if (!dest) {
      state.bag[bagIndex] = { id: stack.id, count: moved };
    } else {
      dest.count += moved;
    }
    stack.count -= moved;
    if (stack.count <= 0) bench.grid[gridIndex] = null;
    rebuildInventoryFromBag(state);
    return moved;
  }

  function takeActiveGridResult() {
    const bench = getActiveBench();
    if (!bench) return false;
    if (!canActWithHealth(state)) return false;
    if (gridHasMissing(bench.grid)) {
      setToast(state, "Missing materials (red slots)");
      return false;
    }
    const recipe = findGridMatchedRecipe(bench.grid, bench.recipes);
    if (!recipe) return false;
    if (!spendFromCraftGrid(bench.grid, recipe.cost)) return false;
    applyCraftedRecipe(recipe);
    return true;
  }

  function normalizeLayoutCell(cell) {
    if (!cell) return null;
    if (typeof cell === "string") return { id: cell, count: 1 };
    if (cell.id && cell.count > 0) return { id: cell.id, count: cell.count };
    return null;
  }

  /** Put recipe materials into the craft grid in the correct shape (does not craft yet). */
  function fillRecipeIntoActiveGrid(recipeId) {
    const bench = getActiveBench();
    const recipe = GameData.recipes.find((r) => r.id === recipeId);
    if (!bench || !recipe) return false;

    if (recipe.atStation && bench.mode !== "table") {
      setToast(state, "Craft that in the Base Workroom (3×3)");
      return false;
    }
    if (!Array.isArray(recipe.layout) || !recipe.layout.length) {
      setToast(state, "That recipe has no craft layout");
      return false;
    }

    ensureBag(state);
    returnGridToInv(bench.grid);
    for (let i = 0; i < bench.size; i++) bench.grid[i] = null;

    const layout = layoutForBench(recipe, bench.size);
    let placed = 0;
    let missing = 0;

    for (let i = 0; i < bench.size; i++) {
      const cell = normalizeLayoutCell(layout[i]);
      if (!cell) continue;
      if ((state.inventory[cell.id] || 0) >= cell.count) {
        removeItem(state, cell.id, cell.count);
        bench.grid[i] = { id: cell.id, count: cell.count };
        placed += 1;
      } else {
        // Ghost placeholder — dark item with red border in the UI.
        bench.grid[i] = { id: cell.id, count: 0, missing: true };
        missing += 1;
      }
    }

    if (missing > 0) {
      setToast(
        state,
        placed > 0
          ? `Arranged ${recipe.name} — red slots still needed`
          : `Need materials for ${recipe.name} (red slots)`
      );
    } else {
      setToast(state, `Arranged ${recipe.name} — take the result`);
    }
    return true;
  }

  function afterBenchChange() {
    renderActiveBenchUi();
    renderInventory();
    renderCraft();
    renderHud();
    updateGoals(state);
    saveState(state);
  }

  function hideModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
  }

  function showModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.style.display = "grid";
  }

  function closePlayerInvUi() {
    if (openPlayerInv) {
      playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
      returnGridToInv(playerCraftGrid);
      if (state) {
        renderInventory();
        saveState(state);
      }
    }
    openPlayerInv = false;
    hideModal("player-inv-modal");
  }

  function openPlayerInvUi() {
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeBuildUi();
    closeRecipesUi();
    openPlayerInv = true;
    playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
    showModal("player-inv-modal");
    renderActiveBenchUi();
    renderHud();
    setToast(state, "Inventory — 2×2 pocket craft (Tab to close · E recipes)");
  }

  function togglePlayerInvUi() {
    if (!state || !playActive) return;
    if (openPlayerInv) {
      closePlayerInvUi();
      renderInventory();
      renderHud();
      return;
    }
    // Tab while demolishing/building: exit that mode and open inventory.
    clearBuildMode();
    openPlayerInvUi();
  }

  function closeCraftTableUi() {
    const m = findCraftTableMachine();
    if (m) {
      ensureCraftTableShape(m);
      returnGridToInv(m.craftGrid);
      if (state) {
        renderInventory();
        saveState(state);
      }
    }
    openCraftTable = null;
    hideModal("craft-table-modal");
  }

  function prepareCraftTableModal(toastText) {
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeKitchenUi();
    closeStorageUi();
    closeBuildUi();
    closeRecipesUi();
    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    const title = document.getElementById("craft-table-title");
    if (title) title.textContent = "Workroom";
    const m = findCraftTableMachine();
    if (m) ensureCraftTableShape(m);
    showModal("craft-table-modal");
    renderActiveBenchUi();
    renderHud();
    setToast(state, toastText);
  }

  /** Indoor workroom — 3×3 station recipes (replaces the outdoor Crafting Table). */
  function openWorkroomCraftUi() {
    if (!state || !isInsideBase(state)) return;
    ensureWorkroomCraft(state);
    openCraftTable = { workroom: true };
    prepareCraftTableModal("Workroom — 3×3 workbench · E recipes");
  }

  function kitchenSlotCount() {
    return GameData.kitchen?.slots ?? 15;
  }

  function kitchenStackMax() {
    return GameData.kitchen?.stackMax ?? 50;
  }

  function ensureKitchenStorage(gameState) {
    if (!gameState) return;
    const slots = kitchenSlotCount();
    const max = kitchenStackMax();
    if (!Array.isArray(gameState.kitchenStorage)) {
      gameState.kitchenStorage = Array.from({ length: slots }, () => null);
    }
    while (gameState.kitchenStorage.length < slots) gameState.kitchenStorage.push(null);
    if (gameState.kitchenStorage.length > slots) {
      for (const stack of gameState.kitchenStorage.slice(slots)) {
        if (stack?.id && stack.count > 0) addItem(gameState, stack.id, stack.count);
      }
      gameState.kitchenStorage.length = slots;
    }
    for (let i = 0; i < slots; i++) {
      const stack = gameState.kitchenStorage[i];
      if (!stack?.id || stack.count < 1 || !isFoodItem(stack.id)) {
        if (stack?.id && stack.count > 0 && !isFoodItem(stack.id)) {
          addItem(gameState, stack.id, stack.count);
        }
        gameState.kitchenStorage[i] = null;
        continue;
      }
      if (stack.count > max) {
        addItem(gameState, stack.id, stack.count - max);
        stack.count = max;
      }
    }
  }

  function clearKitchenDrag() {
    kitchenDrag = null;
    const modal = document.getElementById("kitchen-modal");
    modal?.classList.remove("is-dragging");
    modal
      ?.querySelectorAll(".is-drag-source, .is-drop-hover")
      .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover"));
  }

  /** Move food from inventory into pantry. Returns amount stored. */
  function storeFoodInKitchen(gameState, itemId, amount, preferSlot = -1) {
    if (!gameState || !isFoodItem(itemId) || amount < 1) return 0;
    ensureKitchenStorage(gameState);
    ensureBag(gameState);
    const max = kitchenStackMax();
    let left = Math.min(amount, gameState.inventory[itemId] || 0);
    let moved = 0;

    const trySlot = (i) => {
      if (left < 1) return;
      const stack = gameState.kitchenStorage[i];
      if (stack) {
        if (stack.id !== itemId || stack.count >= max) return;
        const n = Math.min(max - stack.count, left);
        if (removeItem(gameState, itemId, n) < n) return;
        stack.count += n;
        left -= n;
        moved += n;
        return;
      }
      const n = Math.min(max, left);
      if (removeItem(gameState, itemId, n) < n) return;
      gameState.kitchenStorage[i] = { id: itemId, count: n };
      left -= n;
      moved += n;
    };

    if (preferSlot >= 0 && preferSlot < gameState.kitchenStorage.length) trySlot(preferSlot);
    for (let i = 0; i < gameState.kitchenStorage.length && left > 0; i++) {
      if (preferSlot === i) continue;
      const stack = gameState.kitchenStorage[i];
      if (stack?.id === itemId && stack.count < max) trySlot(i);
    }
    for (let i = 0; i < gameState.kitchenStorage.length && left > 0; i++) {
      if (preferSlot === i) continue;
      if (!gameState.kitchenStorage[i]) trySlot(i);
    }
    return moved;
  }

  function takeKitchenSlot(gameState, index, amount = Infinity) {
    if (!gameState) return 0;
    ensureKitchenStorage(gameState);
    const stack = gameState.kitchenStorage[index];
    if (!stack?.id || stack.count < 1) return 0;
    const n = Math.min(Number.isFinite(amount) ? amount : stack.count, stack.count);
    addItem(gameState, stack.id, n);
    stack.count -= n;
    if (stack.count <= 0) gameState.kitchenStorage[index] = null;
    return n;
  }

  function afterKitchenChange() {
    if (!state) return;
    ensureKitchenStorage(state);
    rebuildInventoryFromBag(state);
    saveState(state);
    renderKitchenUi();
    renderHud();
  }

  function renderKitchenUi() {
    if (!state || !openKitchen) return;
    ensureKitchenStorage(state);
    ensureBag(state);
    const max = kitchenStackMax();

    const storage = document.getElementById("kitchen-storage-grid");
    if (storage) {
      storage.innerHTML = state.kitchenStorage
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-kitchen-slot="${index}" data-kitchen-drop="slot" title="Empty food slot (max ${max})">${slotHtml(null, 0)}</button>`;
          }
          const name = GameData.getItem(stack.id).name;
          return `<button type="button" class="smelter-slot" data-kitchen-slot="${index}" data-kitchen-drop="slot" draggable="true" title="${name} (${stack.count}/${max})">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    const inv = document.getElementById("kitchen-inv-grid");
    if (inv) {
      inv.innerHTML = state.bag
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-bag-slot="${index}" disabled>${slotHtml(null, 0)}</button>`;
          }
          const food = isFoodItem(stack.id);
          const name = GameData.getItem(stack.id).name;
          return `<button type="button" class="smelter-slot${food ? "" : " is-empty"}" data-kitchen-inv-slot="${index}" data-bag-slot="${index}" draggable="${food ? "true" : "false"}" title="${food ? `${name} — store in pantry` : `${name} — food only`}">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }
  }

  function closeKitchenUi() {
    clearKitchenDrag();
    openKitchen = false;
    hideModal("kitchen-modal");
  }

  function openKitchenUi() {
    if (!state || !isInsideBase(state)) return;
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeStorageUi();
    closeBuildUi();
    closeRecipesUi();
    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    ensureKitchenStorage(state);
    openKitchen = true;
    showModal("kitchen-modal");
    renderKitchenUi();
    renderHud();
    setToast(
      state,
      `Kitchen pantry — ${kitchenSlotCount()} slots · ${kitchenStackMax()} food each`
    );
  }

  function bindKitchenUi() {
    const modal = document.getElementById("kitchen-modal");
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      if (kitchenDrag) return;
      if (event.target.closest("[data-kitchen-close]")) {
        closeKitchenUi();
        renderHud();
        return;
      }
      if (!openKitchen || !state) return;

      const invSlot = event.target.closest("[data-kitchen-inv-slot]")?.dataset.kitchenInvSlot;
      if (invSlot != null && invSlot !== "") {
        ensureBag(state);
        const stack = state.bag[Number(invSlot)];
        if (!stack) return;
        if (!isFoodItem(stack.id)) {
          setToast(state, "Kitchen stores food only (Apple / Carrot)");
          renderHud();
          return;
        }
        const moved = storeFoodInKitchen(state, stack.id, stack.count);
        if (moved < 1) setToast(state, "Pantry is full");
        else setToast(state, `Stored ${moved} ${GameData.getItem(stack.id).name}`);
        afterKitchenChange();
        return;
      }

      const slotIndex = event.target.closest("[data-kitchen-slot]")?.dataset.kitchenSlot;
      if (slotIndex != null && slotIndex !== "") {
        const n = takeKitchenSlot(state, Number(slotIndex));
        if (n < 1) return;
        setToast(state, "Took food from pantry");
        afterKitchenChange();
      }
    });

    modal.addEventListener("dragstart", (event) => {
      const slot = event.target.closest(".smelter-slot");
      if (!slot || !openKitchen || !state) return;
      const invSlot = slot.dataset.kitchenInvSlot;
      const kitSlot = slot.dataset.kitchenSlot;
      if (invSlot != null && invSlot !== "") {
        ensureBag(state);
        const stack = state.bag[Number(invSlot)];
        if (!stack || !isFoodItem(stack.id)) {
          event.preventDefault();
          return;
        }
        kitchenDrag = {
          from: "inv",
          itemId: stack.id,
          count: Math.min(stack.count, kitchenStackMax()),
          bagIndex: Number(invSlot),
        };
      } else if (kitSlot != null && kitSlot !== "") {
        ensureKitchenStorage(state);
        const stack = state.kitchenStorage[Number(kitSlot)];
        if (!stack) {
          event.preventDefault();
          return;
        }
        kitchenDrag = {
          from: "kitchen",
          itemId: stack.id,
          count: stack.count,
          slotIndex: Number(kitSlot),
        };
      } else {
        event.preventDefault();
        return;
      }
      slot.classList.add("is-drag-source");
      modal.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", kitchenDrag.itemId);
    });

    modal.addEventListener("dragover", (event) => {
      if (!kitchenDrag) return;
      const drop = event.target.closest(
        "[data-kitchen-drop], [data-kitchen-slot], .craft-station-col--inv"
      );
      if (!drop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(".is-drop-hover")
        .forEach((el) => el.classList.remove("is-drop-hover"));
      const slot = event.target.closest(".smelter-slot");
      if (slot) slot.classList.add("is-drop-hover");
      else drop.classList.add("is-drop-hover");
    });

    modal.addEventListener("dragleave", (event) => {
      const el = event.target.closest(".smelter-slot, .craft-station-col--inv");
      if (el) el.classList.remove("is-drop-hover");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!kitchenDrag || !state) {
        clearKitchenDrag();
        return;
      }
      const kitSlot = event.target.closest("[data-kitchen-slot]")?.dataset.kitchenSlot;
      const toInv = Boolean(
        event.target.closest("[data-kitchen-drop='inv']") ||
          event.target.closest(".craft-station-col--inv") ||
          event.target.closest("[data-kitchen-inv-slot]")
      );

      if (kitchenDrag.from === "inv") {
        if (toInv) {
          clearKitchenDrag();
          return;
        }
        const prefer = kitSlot != null && kitSlot !== "" ? Number(kitSlot) : -1;
        const moved = storeFoodInKitchen(state, kitchenDrag.itemId, kitchenDrag.count, prefer);
        if (moved < 1) setToast(state, "Can't store that here");
        else setToast(state, `Stored ${moved} ${GameData.getItem(kitchenDrag.itemId).name}`);
        afterKitchenChange();
      } else if (kitchenDrag.from === "kitchen") {
        if (!toInv && kitSlot != null && kitSlot !== "") {
          const from = kitchenDrag.slotIndex;
          const to = Number(kitSlot);
          ensureKitchenStorage(state);
          if (from !== to) {
            const a = state.kitchenStorage[from];
            const b = state.kitchenStorage[to];
            if (a && b && a.id === b.id) {
              const max = kitchenStackMax();
              const space = max - b.count;
              if (space > 0) {
                const n = Math.min(space, a.count);
                b.count += n;
                a.count -= n;
                if (a.count <= 0) state.kitchenStorage[from] = null;
              }
            } else {
              state.kitchenStorage[from] = b;
              state.kitchenStorage[to] = a;
            }
            afterKitchenChange();
          }
        } else if (toInv) {
          takeKitchenSlot(state, kitchenDrag.slotIndex, kitchenDrag.count);
          setToast(state, "Took food from pantry");
          afterKitchenChange();
        }
      }
      clearKitchenDrag();
    });

    modal.addEventListener("dragend", () => {
      clearKitchenDrag();
    });
  }

  function storageSlotCount() {
    return GameData.storageRoom?.slots ?? 15;
  }

  function storageStackMax() {
    return GameData.storageRoom?.stackMax ?? 50;
  }

  /** Storage room: materials/tools — not food, not the Base Key. */
  function canStoreInStorage(itemId) {
    if (!itemId || itemId === "baseKey") return false;
    return !isFoodItem(itemId);
  }

  function ensureStorageChest(gameState) {
    if (!gameState) return;
    const slots = storageSlotCount();
    const max = storageStackMax();
    if (!Array.isArray(gameState.storageChest)) {
      gameState.storageChest = Array.from({ length: slots }, () => null);
    }
    while (gameState.storageChest.length < slots) gameState.storageChest.push(null);
    if (gameState.storageChest.length > slots) {
      for (const stack of gameState.storageChest.slice(slots)) {
        if (stack?.id && stack.count > 0) addItem(gameState, stack.id, stack.count);
      }
      gameState.storageChest.length = slots;
    }
    for (let i = 0; i < slots; i++) {
      const stack = gameState.storageChest[i];
      if (!stack?.id || stack.count < 1 || !canStoreInStorage(stack.id)) {
        if (stack?.id && stack.count > 0) addItem(gameState, stack.id, stack.count);
        gameState.storageChest[i] = null;
        continue;
      }
      if (stack.count > max) {
        addItem(gameState, stack.id, stack.count - max);
        stack.count = max;
      }
    }
  }

  function clearStorageDrag() {
    storageDrag = null;
    const modal = document.getElementById("storage-modal");
    modal?.classList.remove("is-dragging");
    modal
      ?.querySelectorAll(".is-drag-source, .is-drop-hover")
      .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover"));
  }

  function storeItemInStorage(gameState, itemId, amount, preferSlot = -1) {
    if (!gameState || !canStoreInStorage(itemId) || amount < 1) return 0;
    ensureStorageChest(gameState);
    ensureBag(gameState);
    const max = storageStackMax();
    let left = Math.min(amount, gameState.inventory[itemId] || 0);
    let moved = 0;

    const trySlot = (i) => {
      if (left < 1) return;
      const stack = gameState.storageChest[i];
      if (stack) {
        if (stack.id !== itemId || stack.count >= max) return;
        const n = Math.min(max - stack.count, left);
        if (removeItem(gameState, itemId, n) < n) return;
        stack.count += n;
        left -= n;
        moved += n;
        return;
      }
      const n = Math.min(max, left);
      if (removeItem(gameState, itemId, n) < n) return;
      gameState.storageChest[i] = { id: itemId, count: n };
      left -= n;
      moved += n;
    };

    if (preferSlot >= 0 && preferSlot < gameState.storageChest.length) trySlot(preferSlot);
    for (let i = 0; i < gameState.storageChest.length && left > 0; i++) {
      if (preferSlot === i) continue;
      const stack = gameState.storageChest[i];
      if (stack?.id === itemId && stack.count < max) trySlot(i);
    }
    for (let i = 0; i < gameState.storageChest.length && left > 0; i++) {
      if (preferSlot === i) continue;
      if (!gameState.storageChest[i]) trySlot(i);
    }
    return moved;
  }

  function takeStorageSlot(gameState, index, amount = Infinity) {
    if (!gameState) return 0;
    ensureStorageChest(gameState);
    const stack = gameState.storageChest[index];
    if (!stack?.id || stack.count < 1) return 0;
    const n = Math.min(Number.isFinite(amount) ? amount : stack.count, stack.count);
    addItem(gameState, stack.id, n);
    stack.count -= n;
    if (stack.count <= 0) gameState.storageChest[index] = null;
    return n;
  }

  function afterStorageChange() {
    if (!state) return;
    ensureStorageChest(state);
    rebuildInventoryFromBag(state);
    saveState(state);
    renderStorageUi();
    renderHud();
  }

  function renderStorageUi() {
    if (!state || !openStorage) return;
    ensureStorageChest(state);
    ensureBag(state);
    const max = storageStackMax();

    const chest = document.getElementById("storage-chest-grid");
    if (chest) {
      chest.innerHTML = state.storageChest
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-storage-slot="${index}" data-storage-drop="slot" title="Empty crate slot (max ${max})">${slotHtml(null, 0)}</button>`;
          }
          const name = GameData.getItem(stack.id).name;
          return `<button type="button" class="smelter-slot" data-storage-slot="${index}" data-storage-drop="slot" draggable="true" title="${name} (${stack.count}/${max})">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    const inv = document.getElementById("storage-inv-grid");
    if (inv) {
      inv.innerHTML = state.bag
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-bag-slot="${index}" disabled>${slotHtml(null, 0)}</button>`;
          }
          const ok = canStoreInStorage(stack.id);
          const name = GameData.getItem(stack.id).name;
          let why = `${name} — store in crates`;
          if (stack.id === "baseKey") why = `${name} — hang on the key hook (can't store)`;
          else if (isFoodItem(stack.id)) why = `${name} — keep in the kitchen`;
          return `<button type="button" class="smelter-slot${ok ? "" : " is-empty"}" data-storage-inv-slot="${index}" data-bag-slot="${index}" draggable="${ok ? "true" : "false"}" title="${why}">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }
  }

  function closeStorageUi() {
    clearStorageDrag();
    openStorage = false;
    hideModal("storage-modal");
  }

  function openStorageUi() {
    if (!state || !isInsideBase(state)) return;
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeBuildUi();
    closeRecipesUi();
    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    ensureStorageChest(state);
    openStorage = true;
    showModal("storage-modal");
    renderStorageUi();
    renderHud();
    setToast(
      state,
      `Storage — ${storageSlotCount()} slots · ${storageStackMax()} each · no food / no Base Key`
    );
  }

  function bindStorageUi() {
    const modal = document.getElementById("storage-modal");
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      if (storageDrag) return;
      if (event.target.closest("[data-storage-close]")) {
        closeStorageUi();
        renderHud();
        return;
      }
      if (!openStorage || !state) return;

      const invSlot = event.target.closest("[data-storage-inv-slot]")?.dataset.storageInvSlot;
      if (invSlot != null && invSlot !== "") {
        ensureBag(state);
        const stack = state.bag[Number(invSlot)];
        if (!stack) return;
        if (stack.id === "baseKey") {
          setToast(state, "Base Key stays on the hook — can't store it");
          renderHud();
          return;
        }
        if (isFoodItem(stack.id)) {
          setToast(state, "Food goes in the Kitchen pantry");
          renderHud();
          return;
        }
        if (!canStoreInStorage(stack.id)) {
          setToast(state, "Can't store that here");
          renderHud();
          return;
        }
        const moved = storeItemInStorage(state, stack.id, stack.count);
        if (moved < 1) setToast(state, "Storage is full");
        else setToast(state, `Stored ${moved} ${GameData.getItem(stack.id).name}`);
        afterStorageChange();
        return;
      }

      const slotIndex = event.target.closest("[data-storage-slot]")?.dataset.storageSlot;
      if (slotIndex != null && slotIndex !== "") {
        const n = takeStorageSlot(state, Number(slotIndex));
        if (n < 1) return;
        setToast(state, "Took items from storage");
        afterStorageChange();
      }
    });

    modal.addEventListener("dragstart", (event) => {
      const slot = event.target.closest(".smelter-slot");
      if (!slot || !openStorage || !state) return;
      const invSlot = slot.dataset.storageInvSlot;
      const chestSlot = slot.dataset.storageSlot;
      if (invSlot != null && invSlot !== "") {
        ensureBag(state);
        const stack = state.bag[Number(invSlot)];
        if (!stack || !canStoreInStorage(stack.id)) {
          event.preventDefault();
          return;
        }
        storageDrag = {
          from: "inv",
          itemId: stack.id,
          count: Math.min(stack.count, storageStackMax()),
          bagIndex: Number(invSlot),
        };
      } else if (chestSlot != null && chestSlot !== "") {
        ensureStorageChest(state);
        const stack = state.storageChest[Number(chestSlot)];
        if (!stack) {
          event.preventDefault();
          return;
        }
        storageDrag = {
          from: "storage",
          itemId: stack.id,
          count: stack.count,
          slotIndex: Number(chestSlot),
        };
      } else {
        event.preventDefault();
        return;
      }
      slot.classList.add("is-drag-source");
      modal.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", storageDrag.itemId);
    });

    modal.addEventListener("dragover", (event) => {
      if (!storageDrag) return;
      const drop = event.target.closest(
        "[data-storage-drop], [data-storage-slot], .craft-station-col--inv"
      );
      if (!drop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(".is-drop-hover")
        .forEach((el) => el.classList.remove("is-drop-hover"));
      const slot = event.target.closest(".smelter-slot");
      if (slot) slot.classList.add("is-drop-hover");
      else drop.classList.add("is-drop-hover");
    });

    modal.addEventListener("dragleave", (event) => {
      const el = event.target.closest(".smelter-slot, .craft-station-col--inv");
      if (el) el.classList.remove("is-drop-hover");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!storageDrag || !state) {
        clearStorageDrag();
        return;
      }
      const chestSlot = event.target.closest("[data-storage-slot]")?.dataset.storageSlot;
      const toInv = Boolean(
        event.target.closest("[data-storage-drop='inv']") ||
          event.target.closest(".craft-station-col--inv") ||
          event.target.closest("[data-storage-inv-slot]")
      );

      if (storageDrag.from === "inv") {
        if (toInv) {
          clearStorageDrag();
          return;
        }
        const prefer = chestSlot != null && chestSlot !== "" ? Number(chestSlot) : -1;
        const moved = storeItemInStorage(state, storageDrag.itemId, storageDrag.count, prefer);
        if (moved < 1) setToast(state, "Can't store that here");
        else setToast(state, `Stored ${moved} ${GameData.getItem(storageDrag.itemId).name}`);
        afterStorageChange();
      } else if (storageDrag.from === "storage") {
        if (!toInv && chestSlot != null && chestSlot !== "") {
          const from = storageDrag.slotIndex;
          const to = Number(chestSlot);
          ensureStorageChest(state);
          if (from !== to) {
            const a = state.storageChest[from];
            const b = state.storageChest[to];
            if (a && b && a.id === b.id) {
              const max = storageStackMax();
              const space = max - b.count;
              if (space > 0) {
                const n = Math.min(space, a.count);
                b.count += n;
                a.count -= n;
                if (a.count <= 0) state.storageChest[from] = null;
              }
            } else {
              state.storageChest[from] = b;
              state.storageChest[to] = a;
            }
            afterStorageChange();
          }
        } else if (toInv) {
          takeStorageSlot(state, storageDrag.slotIndex, storageDrag.count);
          setToast(state, "Took items from storage");
          afterStorageChange();
        }
      }
      clearStorageDrag();
    });

    modal.addEventListener("dragend", () => {
      clearStorageDrag();
    });
  }

  function clearActiveCraftGrid() {
    const bench = getActiveBench();
    if (!bench || !state) return false;
    const had = (bench.grid || []).some((s) => s && !s.missing && s.count > 0);
    returnGridToInv(bench.grid);
    if (!had) {
      setToast(state, "Craft grid is already empty");
      return false;
    }
    setToast(state, "Erased craft grid — materials returned");
    return true;
  }

  function closeRecipesUi() {
    openRecipes = false;
    recipesSelectedId = null;
    recipesCategory = "everything";
    hideModal("recipes-modal");
  }

  const GUIDE_ITEMS = [
    "log",
    "plank",
    "stick",
    "stone",
    "coal",
    "ironOre",
    "copperOre",
    "ironIngot",
    "copperIngot",
    "gear",
    "copperWire",
    "cable",
    "bucket",
    "waterBucket",
    "ice",
  ];

  const GUIDE_TOOLS = ["woodPick", "stonePick", "ironPick", "ironSword"];

  const GUIDE_FOOD = ["apple", "carrot"];

  // powerLine = placed building (guide id); cable = crafted inventory item.
  const GUIDE_BUILDINGS = [
    "smelter",
    "generator",
    "fan",
    "powerPole",
    "powerLine",
    "drill",
    "base",
  ];

  const GUIDE_CATEGORIES = ["everything", "items", "tools", "food", "buildings"];

  function guideIdsForCategory(category) {
    const lists = {
      items: GUIDE_ITEMS,
      tools: GUIDE_TOOLS,
      food: GUIDE_FOOD,
      buildings: GUIDE_BUILDINGS,
      everything: [...GUIDE_ITEMS, ...GUIDE_TOOLS, ...GUIDE_FOOD, ...GUIDE_BUILDINGS],
    };
    const list = lists[category] || GUIDE_ITEMS;
    const seen = new Set();
    return list.filter((id) => {
      if (!GameData.getItemGuide(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function guideCategoryLabel(category) {
    if (category === "everything") return "Everything";
    if (category === "tools") return "Tools";
    if (category === "food") return "Food";
    if (category === "buildings") return "Buildings";
    return "Items";
  }

  /** Resolve guide tile icon/item — powerLine uses the Cable icon. */
  function guideItemForId(id) {
    if (id === "powerLine") return GameData.getItem("cable");
    return GameData.getItem(id);
  }

  function guideDisplayName(id, category) {
    if (id === "powerLine") return "Power Line";
    if (id === "cable") return "Cable";
    if (category === "buildings" && MACHINE_LABELS[id]) {
      return MACHINE_LABELS[id];
    }
    return GameData.getItem(id)?.name || id;
  }

  function recipesBrowserHtml() {
    // Detail view replaces the button grid entirely.
    if (recipesSelectedId) {
      const guide = GameData.getItemGuide(recipesSelectedId);
      const selected = guideItemForId(recipesSelectedId);
      if (!guide || !selected) {
        recipesSelectedId = null;
      } else {
        const title = guideDisplayName(recipesSelectedId, recipesCategory);
        return `
          <div class="recipes-layout recipes-layout--detail">
            <button type="button" class="recipes-back" data-guide-back title="Back to list">
              ← Return
            </button>
            <article class="recipes-detail" aria-live="polite">
              <header class="recipes-detail__head">
                <span class="recipes-detail__icon">${selected.icon}</span>
                <h3>${title}</h3>
              </header>
              <div class="recipes-detail__block">
                <h4>How to get / make</h4>
                <p>${guide.how}</p>
              </div>
              <div class="recipes-detail__block">
                <h4>Used for</h4>
                <p>${guide.uses}</p>
              </div>
            </article>
          </div>
        `;
      }
    }

    const ids = guideIdsForCategory(recipesCategory);
    const tiles = ids
      .map((id) => {
        const item = guideItemForId(id);
        const name = guideDisplayName(id, recipesCategory);
        return `<button type="button" class="recipes-tile" data-guide-item="${id}" title="${name}">
          <span class="recipes-tile__icon">${item.icon}</span>
          <span class="recipes-tile__name">${name}</span>
        </button>`;
      })
      .join("");

    const catButtons = GUIDE_CATEGORIES.map((cat) => {
      const active = recipesCategory === cat ? " is-active" : "";
      const label = guideCategoryLabel(cat);
      return `<button type="button" class="recipes-cat${active}" data-guide-cat="${cat}" role="tab" aria-selected="${recipesCategory === cat}">
            ${label}
          </button>`;
    }).join("");

    return `
      <div class="recipes-layout">
        <div class="recipes-cats" role="tablist" aria-label="Guide categories">
          ${catButtons}
        </div>
        <section class="recipes-section" aria-label="${guideCategoryLabel(recipesCategory)}">
          <div class="recipes-tile-grid">${tiles}</div>
        </section>
      </div>
    `;
  }

  function renderRecipesUi() {
    const browser = document.getElementById("recipes-browser");
    if (!browser || !state) return;
    browser.innerHTML = recipesBrowserHtml();
  }

  function openRecipesUi() {
    if (!state || !playActive) return;
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closeBuildUi();
    // Keep inventory / crafting table open underneath when already using them.
    openRecipes = true;
    recipesSelectedId = null;
    recipesCategory = "everything";
    showModal("recipes-modal");
    renderRecipesUi();
    renderHud();
    setToast(state, "Guide — Everything, or pick a category (E to close)");
  }

  function toggleRecipesUi() {
    if (!state || !playActive) return;
    if (openRecipes) {
      closeRecipesUi();
      renderHud();
      return;
    }
    openRecipesUi();
  }

  function onPlayKeyDown(event) {
    if (!playActive || !state) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;

    // Enter skips ADA while habitat speakers are talking.
    if (event.key === "Enter") {
      if (skipAdaSpeech()) {
        event.preventDefault();
        return;
      }
    }

    // Arena owns input until fake-death wake-up or door whiteout.
    if (isSixSevenArenaActive()) {
      if (event.key === "Escape") {
        event.preventDefault();
        setToast(state, "6-7 won't let you leave…");
        renderHud();
        return;
      }
      const arenaMove = event.key.length === 1 ? event.key.toLowerCase() : "";
      if (
        isSixSevenArenaPlayable() &&
        (arenaMove === "w" || arenaMove === "a" || arenaMove === "s" || arenaMove === "d")
      ) {
        event.preventDefault();
        const step =
          arenaMove === "w"
            ? [0, -1]
            : arenaMove === "s"
              ? [0, 1]
              : arenaMove === "a"
                ? [-1, 0]
                : [1, 0];
        tryMoveSixSevenArena(step[0], step[1]);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (gamePaused) {
        resumeGame();
        return;
      }
      if (openBaseEnterPrompt) {
        declineBaseEnter();
        return;
      }
      if (openBaseLeavePrompt) {
        declineBaseLeave();
        return;
      }
      if (openSleepPrompt) {
        closeSleepPrompt();
        renderHud();
        return;
      }
      if (openTvPrompt) {
        if (isTvSixSevenTrapped()) {
          setToast(state, "6-7 won't let you leave…");
          renderHud();
          return;
        }
        closeTvPrompt();
        renderHud();
        return;
      }
      if (openRecipes) {
        // From detail → back to category grid first.
        if (recipesSelectedId) {
          recipesSelectedId = null;
          renderRecipesUi();
          return;
        }
        closeRecipesUi();
        renderHud();
        return;
      }
      if (openPlayerInv) {
        closePlayerInvUi();
        renderHud();
        return;
      }
      if (openKitchen) {
        closeKitchenUi();
        renderHud();
        return;
      }
      if (openStorage) {
        closeStorageUi();
        renderHud();
        return;
      }
      if (openCraftTable) {
        closeCraftTableUi();
        renderHud();
        return;
      }
      if (openSmelter) {
        closeSmelterUi();
        renderHud();
        return;
      }
      if (openGenerator) {
        closeGeneratorUi();
        renderHud();
        return;
      }
      if (openBuildMenu) {
        closeBuildUi();
        renderHud();
        return;
      }
      if (state && isInsideBase(state)) {
        promptBaseLeave();
        return;
      }
      if (state.buildMode) {
        state.buildMode = null;
        setToast(state, "Build mode off");
        renderHud();
        saveState(state);
        return;
      }
      pauseGame();
      return;
    }

    if (gamePaused) return;

    // 1–6 switch structures anytime (including while already placing another).
    if (event.key >= "1" && event.key <= "9") {
      const index = Number(event.key) - 1;
      if (index < BUILD_STRUCTURES.length) {
        event.preventDefault();
        closeSmelterUi();
        closeGeneratorUi();
        closePlayerInvUi();
        closeCraftTableUi();
        closeRecipesUi();
        selectBuildMode(BUILD_STRUCTURES[index]);
        return;
      }
    }

    if (event.key === "Tab") {
      event.preventDefault();
      togglePlayerInvUi();
      return;
    }
    if (event.key === "e" || event.key === "E") {
      event.preventDefault();
      toggleRecipesUi();
      return;
    }
    if (event.key === "q" || event.key === "Q") {
      event.preventDefault();
      toggleBuildUi();
      return;
    }
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      toggleDemolishMode();
      return;
    }

    const move = event.key.length === 1 ? event.key.toLowerCase() : "";
    if (move === "w" || move === "a" || move === "s" || move === "d") {
      event.preventDefault();
      const step =
        move === "w" ? [0, -1] : move === "s" ? [0, 1] : move === "a" ? [-1, 0] : [1, 0];
      tryMovePlayer(step[0], step[1]);
    }
  }

  function closePauseUi() {
    gamePaused = false;
    hideModal("pause-modal");
  }

  function pauseGame() {
    if (!state || !playActive || gamePaused) return;
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeBuildUi();
    closeTvPrompt();
    closeBaseEnterPrompt();
    gamePaused = true;
    window.KeaghanSfx?.pauseMusic?.();
    window.KeaghanSfx?.stopAdaSpeech?.();
    showModal("pause-modal");
    setToast(state, "Paused");
    renderHud();
    if (state) saveState(state);
  }

  function resumeGame() {
    if (!gamePaused) return;
    closePauseUi();
    window.KeaghanSfx?.resumeMusic?.();
    setToast(state, "Resumed");
    renderHud();
  }

  function leaveGameFromPause() {
    if (state) saveState(state);
    closePauseUi();
    window.dispatchEvent(new CustomEvent("keaghan-leave-game"));
  }

  function bindPauseUi() {
    const modal = document.getElementById("pause-modal");
    modal?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-pause]")?.dataset.pause;
      if (action === "resume") resumeGame();
      else if (action === "leave") leaveGameFromPause();
    });
  }

  function closeBuildUi() {
    openBuildMenu = false;
    hideModal("build-modal");
  }

  function openBuildUi() {
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    openBuildMenu = true;
    showModal("build-modal");
    setBuildStatus("Craft Planks (Tab), then build a Base for the Workroom.");
    renderBuildUi();
    renderHud();
    setToast(state, "Build Structures — spend materials to place (like Satisfactory)");
  }

  function toggleBuildUi() {
    if (!state || !playActive) return;
    if (isInsideBase(state)) {
      setToast(state, "Can't build while inside the Base — go outside first");
      renderHud();
      return;
    }

    // Q while demolishing: exit demolish and open the build menu.
    if (state.buildMode === "demolish") {
      state.buildMode = null;
      closeBuildUi();
      openBuildUi();
      return;
    }

    // Q while placing a structure: only exit build mode.
    if (state.buildMode) {
      state.buildMode = null;
      closeBuildUi();
      setToast(state, "Build mode off");
      renderHud();
      saveState(state);
      return;
    }

    if (openBuildMenu) {
      closeBuildUi();
      renderHud();
      return;
    }
    openBuildUi();
  }

  function setBuildStatus(msg, isError = false) {
    const el = document.getElementById("build-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", Boolean(isError && msg));
  }

  function selectBuildMode(mode) {
    if (!state) return false;
    if (isInsideBase(state)) {
      setToast(state, "Can't build while inside the Base — go outside first");
      renderHud();
      return false;
    }
    if (mode === "demolish") {
      state.buildMode = "demolish";
    } else if (PLACEABLE.includes(mode)) {
      // Always enter build mode — materials are checked when placing (Satisfactory-style).
      state.buildMode = mode;
    } else {
      return false;
    }

    closeBuildUi();
    document.activeElement?.blur?.();

    let msg =
      BUILD_HINTS[state.buildMode] ||
      `Build: ${MACHINE_LABELS[state.buildMode] || state.buildMode}`;
    if (mode !== "demolish") {
      const cost = getBuildCost(mode);
      if (!canAfford(state, cost)) {
        msg = `${MACHINE_LABELS[mode] || mode} ready — need ${formatCost(cost)} to place`;
      }
    }
    setToast(state, msg);
    renderHud();
    refreshBuildPreview();
    saveState(state);
    return true;
  }

  function renderBuildUi() {
    const grid = document.getElementById("build-grid");
    const modal = document.getElementById("build-modal");
    if (!grid || !modal || modal.hidden || !state) return;
    ensureBag(state);

    grid.innerHTML = BUILD_STRUCTURES.map((id, index) => {
      const item = GameData.getItem(id);
      const label = MACHINE_LABELS[id] || item.name;
      const cost = getBuildCost(id);
      const afford = canBuildStructure(state, id);
      const selected = state.buildMode === id;
      const costText = formatCost(cost);
      const costShort = Object.entries(cost)
        .map(([cid, n]) => `${n}${GameData.getItem(cid).icon}`)
        .join(" ");
      const hotkey = String(index + 1);
      return `<button type="button" class="smelter-slot build-slot${afford ? "" : " is-empty"}${selected ? " is-selected" : ""}" data-build-pick="${id}" title="${hotkey}: ${label}: ${costText}">
        <span class="build-slot__hotkey">${hotkey}</span>
        <span class="smelter-slot__icon">${item.icon}</span>
        <span class="build-slot__cost">${costShort}</span>
        <span class="build-slot__name">${label}</span>
      </button>`;
    }).join("");

    if (!document.getElementById("build-status")?.textContent) {
      setBuildStatus("Craft Planks (Tab), then build a Base for the Workroom.");
    }
  }

  function bindBuildUi() {
    const modal = document.getElementById("build-modal");
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      const pickBtn = event.target.closest("[data-build-pick]");
      if (pickBtn) {
        event.preventDefault();
        event.stopPropagation();
        selectBuildMode(pickBtn.dataset.buildPick);
        return;
      }
      if (event.target.closest("[data-build-close]")) {
        closeBuildUi();
        renderHud();
      }
    });
  }

  function renderActiveBenchUi() {
    const bench = getActiveBench();
    if (!bench) return;
    const modal = document.getElementById(bench.modalId);
    if (!modal || modal.hidden) return;

    // Recipe shortcut buttons stay empty — use E recipes menu to arrange crafts.
    const list = document.getElementById(bench.listId);
    if (list) list.innerHTML = "";

    const gridEl = document.getElementById(bench.gridId);
    if (gridEl) {
      gridEl.innerHTML = bench.grid
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-craft-grid="${index}">${slotHtml(null, 0)}</button>`;
          }
          if (stack.missing) {
            const item = GameData.getItem(stack.id);
            return `<button type="button" class="smelter-slot is-missing" data-craft-grid="${index}" title="Missing ${item.name}" draggable="false">
              <span class="smelter-slot__icon">${item.icon}</span>
            </button>`;
          }
          return `<button type="button" class="smelter-slot" data-craft-grid="${index}" draggable="true">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    const result = document.getElementById(bench.resultId);
    const matched = findGridMatchedRecipe(bench.grid, bench.recipes);
    if (result) {
      if (matched) {
        result.classList.remove("is-empty");
        result.disabled = false;
        result.dataset.craftResult = matched.id;
        result.innerHTML = slotHtml(matched.output.id, matched.output.count);
        result.title = `Take ${matched.name}`;
      } else {
        result.classList.add("is-empty");
        result.disabled = true;
        delete result.dataset.craftResult;
        result.innerHTML = slotHtml(null, 0);
        result.title = "Crafted result";
      }
    }

    const invGrid = document.getElementById(bench.invId);
    if (invGrid) {
      ensureBag(state);
      invGrid.innerHTML = state.bag
        .map((stack, index) => {
          if (!stack) {
            return `<button type="button" class="smelter-slot is-empty" data-bag-slot="${index}">${slotHtml(null, 0)}</button>`;
          }
          const foodHint =
            isFoodItem(stack.id) && !canAcceptFood(state)
              ? " · Full (90%+) — drag to Eat won't work"
              : "";
          const name = GameData.getItem(stack.id).name;
          return `<button type="button" class="smelter-slot" data-bag-slot="${index}" draggable="true" title="${name}${foodHint}">${slotHtml(stack.id, stack.count)}</button>`;
        })
        .join("");
    }

    const equipSlot = document.getElementById("player-equip-slot");
    if (equipSlot && bench.mode === "player") {
      const tool = equippedToolId(state);
      const name = toolDisplayName(tool);
      const icon = toolDisplayIcon(tool);
      const holding = tool !== "hand";
      equipSlot.classList.toggle("is-empty", !holding);
      equipSlot.classList.toggle("is-equipped", holding);
      equipSlot.draggable = holding;
      equipSlot.title = holding
        ? `${name} (equipped) — drag back to inventory for Hand`
        : "Hand — drop a tool here to equip";
      equipSlot.innerHTML = holding
        ? `<span class="smelter-slot__icon">${icon}</span><span class="smelter-slot__count">E</span>`
        : `<span class="smelter-slot__icon">${icon}</span>`;
    }
  }

  function bindBenchModal(modalId, closeAttr, isOpen) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      if (event.target.closest(`[${closeAttr}]`)) {
        if (modalId === "player-inv-modal") closePlayerInvUi();
        else closeCraftTableUi();
        renderInventory();
        renderHud();
        return;
      }
      if (!isOpen()) return;

      const recipeBtn =
        event.target.closest("[data-player-craft]") || event.target.closest("[data-table-craft]");
      if (recipeBtn) {
        const id = recipeBtn.dataset.playerCraft || recipeBtn.dataset.tableCraft;
        const recipe = GameData.recipes.find((r) => r.id === id);
        const bench = getActiveBench();
        // Already arranged correctly → craft. Otherwise arrange materials in the grid.
        if (recipe && bench && gridSatisfiesRecipe(bench.grid, recipe)) {
          if (craftRecipeFromGrid(id)) afterBenchChange();
          else {
            renderActiveBenchUi();
            renderHud();
          }
        } else if (fillRecipeIntoActiveGrid(id)) {
          afterBenchChange();
        } else {
          renderActiveBenchUi();
          renderHud();
        }
        return;
      }

      const resultBtn = event.target.closest("#player-craft-result, #table-craft-result");
      if (resultBtn) {
        if (!resultBtn.disabled && takeActiveGridResult()) afterBenchChange();
        return;
      }

      const gridIndex = event.target.closest("[data-craft-grid]")?.dataset.craftGrid;
      if (gridIndex != null && gridIndex !== "") {
        const bench = getActiveBench();
        if (bench?.grid?.[Number(gridIndex)] && takeFromActiveGrid(Number(gridIndex), 1)) {
          afterBenchChange();
        }
        return;
      }

      const bagIndex = event.target.closest("[data-bag-slot]")?.dataset.bagSlot;
      if (bagIndex != null && bagIndex !== "") {
        ensureBag(state);
        if (state.bag[Number(bagIndex)]) {
          if (moveBagSlotToCraft(Number(bagIndex), 1) > 0) afterBenchChange();
          else setToast(state, "Crafting grid is full");
        }
      }
    });

    modal.addEventListener("dragstart", (event) => {
      const slot = event.target.closest(".smelter-slot");
      if (!slot || slot.disabled || !isOpen()) return;
      const bench = getActiveBench();
      if (!bench) return;
      ensureBag(state);

      const bagIndex = slot.dataset.bagSlot;
      const gridIndex = slot.dataset.craftGrid;
      const fromEquip = slot.hasAttribute("data-equip-slot");

      if (fromEquip && modalId === "player-inv-modal") {
        const tool = equippedToolId(state);
        if (tool === "hand") {
          event.preventDefault();
          return;
        }
        craftDrag = {
          from: "equip",
          itemId: tool,
          count: 1,
        };
      } else if (bagIndex != null && bagIndex !== "" && state.bag[Number(bagIndex)]) {
        const stack = state.bag[Number(bagIndex)];
        craftDrag = {
          from: "bag",
          bagIndex: Number(bagIndex),
          itemId: stack.id,
          count: stack.count,
        };
      } else if (gridIndex != null && gridIndex !== "" && bench.grid[Number(gridIndex)]) {
        const stack = bench.grid[Number(gridIndex)];
        if (stack.missing || stack.count < 1) {
          event.preventDefault();
          return;
        }
        craftDrag = {
          from: "grid",
          itemId: stack.id,
          count: stack.count,
          gridIndex: Number(gridIndex),
        };
      } else {
        event.preventDefault();
        return;
      }

      slot.classList.add("is-drag-source");
      modal.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", craftDrag.itemId);
    });

    modal.addEventListener("dragover", (event) => {
      if (!craftDrag) return;
      const drop = event.target.closest(
        "[data-craft-grid], [data-bag-slot], [data-inv-trash], [data-inv-eat], [data-inv-cool], [data-inv-equip], .craft-station-col--inv, .craft-grid"
      );
      if (!drop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(
          ".smelter-slot.is-drop-hover, .inv-trash.is-drop-hover, .inv-eat.is-drop-hover, .inv-eat.is-reject, .inv-cool.is-drop-hover, .inv-cool.is-reject, .inv-equip.is-drop-hover, .inv-equip.is-reject"
        )
        .forEach((el) => el.classList.remove("is-drop-hover", "is-reject"));
      const trash = event.target.closest("[data-inv-trash]");
      const eat = event.target.closest("[data-inv-eat]");
      const cool = event.target.closest("[data-inv-cool]");
      const equip = event.target.closest("[data-inv-equip]");
      const hover = event.target.closest(".smelter-slot:not([data-equip-slot])");
      if (trash) trash.classList.add("is-drop-hover");
      else if (cool) {
        cool.classList.add("is-drop-hover");
        if (!isCoolantItem(craftDrag.itemId)) cool.classList.add("is-reject");
      } else if (eat) {
        eat.classList.add("is-drop-hover");
        if (!isFoodItem(craftDrag.itemId) || !canAcceptFood(state)) {
          eat.classList.add("is-reject");
        }
      } else if (equip) {
        equip.classList.add("is-drop-hover");
        if (craftDrag.from === "equip" || !isEquippableTool(craftDrag.itemId)) {
          equip.classList.add("is-reject");
        }
      } else if (hover) hover.classList.add("is-drop-hover");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!craftDrag || !isOpen()) {
        craftDrag = null;
        return;
      }
      ensureBag(state);
      const trash = event.target.closest("[data-inv-trash]");
      const eat = event.target.closest("[data-inv-eat]");
      const cool = event.target.closest("[data-inv-cool]");
      const equip = event.target.closest("[data-inv-equip]");
      const gridSlot = event.target.closest("[data-craft-grid]");
      const bagSlot = event.target.closest("[data-bag-slot]");
      const toInvArea = event.target.closest(".craft-station-col--inv");

      let changed = false;
      if (equip && modalId === "player-inv-modal") {
        if (craftDrag.from === "equip") {
          changed = false;
        } else if (!isEquippableTool(craftDrag.itemId)) {
          setToast(state, "Only tools go in Equipment");
        } else if (craftDrag.from === "bag") {
          changed = equipTool(state, craftDrag.itemId, {
            from: "bag",
            bagIndex: craftDrag.bagIndex,
          });
        } else if (craftDrag.from === "grid") {
          changed = equipTool(state, craftDrag.itemId, {
            from: "grid",
            gridIndex: craftDrag.gridIndex,
          });
        }
      } else if (craftDrag.from === "equip") {
        if (trash) {
          changed = destroyEquippedTool(state);
        } else if (bagSlot) {
          changed = unequipTool(state, Number(bagSlot.dataset.bagSlot));
        } else if (toInvArea) {
          changed = unequipTool(state);
        } else if (gridSlot) {
          changed = unequipToolToCraftSlot(state, Number(gridSlot.dataset.craftGrid));
          if (!changed) setToast(state, "That craft slot can't take the tool");
        } else if (eat || cool) {
          setToast(state, "Tools aren't for that");
        }
      } else if (cool) {
        if (!isCoolantItem(craftDrag.itemId)) {
          setToast(state, "Only Ice goes on Cool");
        } else {
          changed = useCoolantFromDrag(craftDrag);
          if (changed) renderPlayerTemp();
        }
      } else if (eat) {
        changed = eatFromCraftDrag(craftDrag);
        if (changed) renderHunger();
      } else if (trash) {
        changed = destroyDraggedStack(craftDrag);
      } else if (gridSlot && craftDrag.from === "bag") {
        changed =
          placeBagIntoCraftSlot(craftDrag.bagIndex, Number(gridSlot.dataset.craftGrid)) > 0;
      } else if (bagSlot && craftDrag.from === "bag") {
        changed = swapOrMergeBagSlots(craftDrag.bagIndex, Number(bagSlot.dataset.bagSlot));
      } else if (bagSlot && craftDrag.from === "grid") {
        changed =
          takeFromActiveGridToBagSlot(
            craftDrag.gridIndex,
            Number(bagSlot.dataset.bagSlot),
            craftDrag.count
          ) > 0;
      } else if (toInvArea && craftDrag.from === "grid") {
        changed = takeFromActiveGrid(craftDrag.gridIndex, craftDrag.count) > 0;
      } else if (gridSlot && craftDrag.from === "grid") {
        // Swap craft grid cells.
        const bench = getActiveBench();
        const to = Number(gridSlot.dataset.craftGrid);
        const from = craftDrag.gridIndex;
        if (bench && from !== to) {
          const tmp = bench.grid[to];
          bench.grid[to] = bench.grid[from];
          bench.grid[from] = tmp;
          changed = true;
        }
      }

      if (changed) afterBenchChange();
      else {
        renderActiveBenchUi();
        renderHud();
      }
      craftDrag = null;
      modal.classList.remove("is-dragging");
      modal
        .querySelectorAll(".is-drag-source, .is-drop-hover, .is-reject")
        .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover", "is-reject"));
    });

    modal.addEventListener("dragend", () => {
      craftDrag = null;
      modal.classList.remove("is-dragging");
      modal
        .querySelectorAll(".is-drag-source, .is-drop-hover, .is-reject")
        .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover", "is-reject"));
    });
  }

  function bindPlayerInvUi() {
    bindBenchModal("player-inv-modal", "data-player-inv-close", () => openPlayerInv);
  }

  function bindCraftTableUi() {
    bindBenchModal("craft-table-modal", "data-craft-table-close", () => Boolean(openCraftTable));
  }

  function bindRecipesUi() {
    const modal = document.getElementById("recipes-modal");
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-recipes-close]")) {
        closeRecipesUi();
        renderHud();
        return;
      }
      if (!openRecipes) return;

      if (event.target.closest("[data-guide-back]")) {
        recipesSelectedId = null;
        renderRecipesUi();
        return;
      }

      const catBtn = event.target.closest("[data-guide-cat]");
      if (catBtn) {
        const next = catBtn.dataset.guideCat;
        recipesCategory = GUIDE_CATEGORIES.includes(next) ? next : "everything";
        recipesSelectedId = null;
        renderRecipesUi();
        return;
      }

      const guideBtn = event.target.closest("[data-guide-item]");
      if (guideBtn) {
        recipesSelectedId = guideBtn.dataset.guideItem;
        renderRecipesUi();
      }
    });
  }

  function moveInvToSmelter(itemId) {
    if (!itemId) return;
    if (isSmelterFuel(itemId)) transferToFuel(itemId, 1);
    else transferToInput(itemId, 1);
    afterSmelterChange();
  }

  function takeSmelterInput(index) {
    transferInputToInv(index, 1);
    afterSmelterChange();
  }

  function takeSmelterFuel() {
    transferFuelToInv(1);
    afterSmelterChange();
  }

  function takeSmelterOutput(index) {
    transferOutputToInv(index);
    afterSmelterChange();
  }

  function bindSmelterUi() {
    const modal = document.getElementById("smelter-modal");
    if (!modal) return;

    modal.addEventListener("click", (event) => {
      if (smelterDrag) return;
      if (event.target.closest("[data-smelter-close]")) {
        closeSmelterUi();
        return;
      }
      const invId = event.target.closest("[data-smelter-inv]")?.dataset.smelterInv;
      if (invId) {
        moveInvToSmelter(invId);
        return;
      }
      const inIndex = event.target.closest("[data-smelter-in]")?.dataset.smelterIn;
      if (inIndex != null && inIndex !== "") {
        takeSmelterInput(Number(inIndex));
        return;
      }
      const outIndex = event.target.closest("[data-smelter-out]")?.dataset.smelterOut;
      if (outIndex != null && outIndex !== "") {
        takeSmelterOutput(Number(outIndex));
        return;
      }
      const slot = event.target.closest("[data-smelter-slot]")?.dataset.smelterSlot;
      if (slot === "fuel") takeSmelterFuel();
    });

    modal.addEventListener("dragstart", (event) => {
      const slot = event.target.closest(".smelter-slot");
      if (!slot || slot.disabled) return;
      const m = findOpenSmelterMachine();
      if (!m) return;

      const invId = slot.dataset.smelterInv;
      const outIndex = slot.dataset.smelterOut;
      const inIndex = slot.dataset.smelterIn;
      const kind = slot.dataset.smelterSlot;

      if (invId) {
        const available = state.inventory[invId] || 0;
        if (available < 1) return;
        smelterDrag = { from: "inv", itemId: invId, count: Math.min(available, stackMax()) };
      } else if (inIndex != null && inIndex !== "" && m.input[Number(inIndex)]) {
        const stack = m.input[Number(inIndex)];
        smelterDrag = {
          from: "input",
          itemId: stack.id,
          count: stack.count,
          inIndex: Number(inIndex),
        };
      } else if (kind === "fuel" && m.fuelCount > 0) {
        smelterDrag = { from: "fuel", itemId: m.fuelId, count: m.fuelCount };
      } else if (outIndex != null && outIndex !== "" && m.output[Number(outIndex)]) {
        const stack = m.output[Number(outIndex)];
        smelterDrag = {
          from: "output",
          itemId: stack.id,
          count: stack.count,
          outIndex: Number(outIndex),
        };
      } else {
        event.preventDefault();
        return;
      }

      slot.classList.add("is-drag-source");
      modal.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", smelterDrag.itemId);
    });

    modal.addEventListener("dragover", (event) => {
      const drop = event.target.closest(
        "[data-smelter-drop], [data-smelter-slot], .smelter-col--inv, .smelter-col--input"
      );
      if (!drop || !smelterDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(".smelter-slot.is-drop-hover, .smelter-col--inv.is-drop-hover, .smelter-col--input.is-drop-hover")
        .forEach((el) => el.classList.remove("is-drop-hover"));
      const slot = event.target.closest(".smelter-slot");
      if (slot) slot.classList.add("is-drop-hover");
      else if (drop.classList?.contains("smelter-col--inv") || drop.classList?.contains("smelter-col--input")) {
        drop.classList.add("is-drop-hover");
      }
    });

    modal.addEventListener("dragleave", (event) => {
      const slot = event.target.closest(".smelter-slot, .smelter-col--inv, .smelter-col--input");
      if (slot) slot.classList.remove("is-drop-hover");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      const slot = event.target.closest(".smelter-slot");
      const dropZone = event.target.closest("[data-smelter-drop]");
      let target = dropZone?.dataset.smelterDrop || null;
      if (!target && slot?.dataset.smelterSlot) target = slot.dataset.smelterSlot;
      if (!target && event.target.closest(".smelter-col--inv")) target = "inv";
      if (!target && event.target.closest(".smelter-col--input")) target = "input";

      if (target && applySmelterDrop(target)) afterSmelterChange();
      clearSmelterDrag();
    });

    modal.addEventListener("dragend", () => {
      clearSmelterDrag();
    });
  }

  function isSmelterElectric(tile) {
    if (!state || !tile) return false;
    const powered = poweredTilesCache || computePoweredTiles(state);
    return powered.has(tileKey(tile.x, tile.y));
  }

  function isSmelterLit(tile) {
    const m = state?.machines?.find(
      (machine) => machine.type === "smelter" && machine.x === tile.x && machine.y === tile.y
    );
    if (!m) return false;
    ensureSmelterShape(m);
    // Electric grid heat, stored fuel heat, or fuel ready while ore is loaded.
    if (isSmelterElectric(tile)) return true;
    if (m.storedEnergy > 0) return true;
    return m.fuelCount > 0 && m.input.some((s) => s && getSmeltRecipe(s.id));
  }

  function tileClass(tile) {
    if (state && isInsideBase(state) && tile?.kind) {
      const tier = Math.max(1, Math.floor(Number(tile.tier) || 1));
      let cls = `tile tile--interior tile--interior-${tile.kind} tile--interior-t${tier}`;
      if (tile.room) cls += ` tile--room-${tile.room}`;
      if (tile.feature === "keyHook") {
        cls += state?.baseKeyOnHook
          ? " tile--interior-key-hook tile--interior-key-hook--held"
          : " tile--interior-key-hook";
      }
      if (!isInPlayerReach(state, tile.x, tile.y)) cls += " tile--out-of-reach";
      return cls;
    }
    const key = tileKey(tile.x, tile.y);
    const onGrid = poweredTilesCache.has(key);
    let cls = "tile";

    if (tile.machine === "generator") {
      const gen = state.machines.find(
        (machine) => machine.type === "generator" && machine.x === tile.x && machine.y === tile.y
      );
      cls = `tile tile--generator${isGeneratorOnline(gen) ? " is-powered" : " is-unpowered"}`;
    } else if (tile.machine === "fan") {
      cls = `tile tile--fan${onGrid ? " is-powered" : " is-unpowered"}`;
    } else if (tile.machine === "powerPole") {
      cls = `tile tile--pole${onGrid ? " is-powered" : " is-unpowered"}`;
    } else if (tile.machine === "cable") {
      cls = `tile tile--cable${onGrid ? " is-powered" : " is-unpowered"}`;
    } else if (tile.machine === "craftingStation") {
      cls = "tile tile--craft-station";
    } else if (tile.machine === "drill") {
      cls = `tile tile--drill${onGrid ? " is-powered" : " is-unpowered"}`;
    } else if (tile.machine === "smelter") {
      cls = `tile tile--smelter${isSmelterLit(tile) ? " is-lit" : " is-cold"}`;
    } else if (tile.machine === "deathCrate") {
      cls = "tile tile--death-crate";
    } else if (tile.machine === "waterBucket") {
      const bucket = state?.machines?.find(
        (m) => m.type === "waterBucket" && m.x === tile.x && m.y === tile.y
      );
      const freezing =
        bucket &&
        waterBucketBesidePoweredFan(
          state,
          bucket,
          poweredTilesCache || computePoweredTiles(state)
        );
      cls = `tile tile--water-bucket${freezing ? " is-freezing" : ""}`;
    } else if (tile.machine === "base") {
      const base = state ? findBaseMachine(state, tile.x, tile.y) : null;
      const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
      cls = `tile tile--base tile--base-t${tier}`;
    } else if (!tile.node) {
      cls = "tile tile--grass";
    } else if (tile.hp <= 0) {
      cls = `tile tile--${tile.node} tile--depleted`;
    } else {
      cls = `tile tile--${tile.node}`;
    }

    if (state && !isInPlayerReach(state, tile.x, tile.y)) {
      cls += " tile--out-of-reach";
    }
    return cls;
  }

  function tileLabel(tile) {
    let label = "";
    if (state && isInsideBase(state) && tile?.kind) {
      if (tile.icon) label = tile.icon;
      else if (tile.kind === "exit" || tile.kind === "door") label = "🚪";
      else if (tile.kind === "upgrade") label = "⬆";
      else if (tile.kind === "keyHook" || tile.feature === "keyHook") {
        label = tile.icon || (state?.baseKeyOnHook ? "🔑" : "🪝");
      } else if (tile.kind === "wall") label = "";
      else label = "";
    } else if (tile.machine === "drill") label = "🔩";
    else if (tile.machine === "smelter") label = "🔥";
    else if (tile.machine === "generator") label = "⚡";
    else if (tile.machine === "fan") label = "🌀";
    else if (tile.machine === "powerPole") label = "🗼";
    else if (tile.machine === "cable") label = "━";
    else if (tile.machine === "craftingStation") label = "🪚";
    else if (tile.machine === "waterBucket") label = "💧";
    else if (tile.machine === "base") {
      const base = state ? findBaseMachine(state, tile.x, tile.y) : null;
      label = getBaseTierInfo(base?.tier).icon || "🏠";
    } else if (tile.machine === "deathCrate") label = "📦";
    else if (!tile.node) label = "";
    else if (tile.hp <= 0) label = ""; // depleted: black + center glow (CSS)
    else {
      const map = {
        tree: "🌳",
        rock: "🪨",
        coal: "⬛",
        iron: "🟠",
        copper: "🟤",
        carrot: "🥕",
      };
      label = map[tile.node] || "?";
    }
    if (label && label !== "·" && isSixSevenModInstalled()) return "6-7";
    return label;
  }

  function refreshTilePowerStyles() {
    if (!root || !state || isInsideBase(state)) return;
    const grid = root.querySelector("#world-grid");
    if (!grid) return;
    for (const btn of grid.querySelectorAll(".tile")) {
      const x = Number(btn.dataset.x);
      const y = Number(btn.dataset.y);
      const tile = state.tiles[y * COLS + x];
      if (!tile) continue;
      const next = tileClass(tile);
      // Keep overlay classes — rewriting className would strip ghost / player markers.
      const keep = [
        "is-build-preview",
        "is-build-blocked",
        "is-build-player",
        "is-build-missing",
        "is-build-ready",
        "tile--player",
        "tile--monster",
      ].filter((c) => btn.classList.contains(c));
      const base = btn.className
        .split(/\s+/)
        .filter(
          (c) => c && !c.startsWith("is-build-") && c !== "tile--player" && c !== "tile--monster"
        )
        .join(" ");
      if (base === next) continue;
      btn.className = next;
      for (const c of keep) btn.classList.add(c);
    }
  }

  function isPlaceBuildMode() {
    if (state && isInsideBase(state)) return false;
    return Boolean(state?.buildMode && PLACEABLE.includes(state.buildMode));
  }

  function clearBuildPreview() {
    if (!root) return;
    const grid = root.querySelector("#world-grid");
    if (!grid) return;
    grid.classList.toggle("is-building", isPlaceBuildMode());
    for (const el of grid.querySelectorAll(".is-build-preview")) {
      el.classList.remove(
        "is-build-preview",
        "is-build-blocked",
        "is-build-player",
        "is-build-missing",
        "is-build-ready"
      );
      el.querySelector(".tile__ghost")?.remove();
    }
  }

  function applyBuildPreview(x, y) {
    clearBuildPreview();
    if (!isPlaceBuildMode()) {
      buildHover = null;
      return;
    }
    const tile = getTile(state, x, y);
    if (!tile) {
      buildHover = null;
      return;
    }
    const mode = state.buildMode;
    const kind = getBuildPreviewKind(state, mode, tile);
    if (!kind) {
      buildHover = null;
      return;
    }
    buildHover = { x, y };
    const grid = root.querySelector("#world-grid");
    if (!grid) return;

    const cells =
      mode === "base" ? getStructureFootprint("base", x, y) : [{ x, y }];
    const icon = buildStructureIcon(mode);
    const label = MACHINE_LABELS[mode] || mode;
    let reason = "";
    if (kind === "blocked") {
      if (!isInPlayerReach(state, x, y)) reason = "too far (move within 3×3)";
      else if (mode === "base") reason = canPlaceBase(state, x, y).reason;
      else reason = canPlaceOnTile(mode, tile).reason;
    } else if (kind === "player") {
      reason = "a player is in the way";
    } else if (kind === "missing") {
      reason = `need ${formatCost(getBuildCost(mode))}`;
    } else {
      reason =
        mode === "base"
          ? `click top-left to place 5×3 (${formatCost(getBuildCost(mode))})`
          : `click to place (${formatCost(getBuildCost(mode))})`;
    }

    for (const cell of cells) {
      const btn = grid.querySelector(`.tile[data-x="${cell.x}"][data-y="${cell.y}"]`);
      if (!btn) continue;
      btn.classList.add("is-build-preview", `is-build-${kind}`);
      const ghost = document.createElement("span");
      ghost.className = "tile__ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = icon;
      btn.appendChild(ghost);
      btn.title = `${label} — ${reason}`;
    }
  }

  function refreshBuildPreview() {
    if (!isPlaceBuildMode()) {
      buildHover = null;
      clearBuildPreview();
      return;
    }
    if (buildHover) applyBuildPreview(buildHover.x, buildHover.y);
    else clearBuildPreview();
  }

  function onWorldPointerMove(event) {
    if (gamePaused || !isPlaceBuildMode()) {
      if (buildHover) {
        buildHover = null;
        clearBuildPreview();
      }
      return;
    }
    const btn = event.target.closest(".tile");
    if (!btn) {
      if (buildHover) {
        buildHover = null;
        clearBuildPreview();
      }
      return;
    }
    const x = Number(btn.dataset.x);
    const y = Number(btn.dataset.y);
    if (buildHover && buildHover.x === x && buildHover.y === y) return;
    applyBuildPreview(x, y);
  }

  function onWorldPointerLeave() {
    if (!buildHover) return;
    buildHover = null;
    clearBuildPreview();
  }

  function renderWorld() {
    const grid = root.querySelector("#world-grid");
    const inside = isInsideBase(state);
    const { cols } = activeMapSize(state);
    const tiles = inside ? state.interiorTiles || [] : state.tiles;
    const nightOut = !inside && isNightTime(state.worldMinutes);
    const nightAmbient = nightOut ? nightMapAmbient(state) : 1;
    const dawnGlow = dawnApproachProgress(state.worldMinutes);
    grid.style.setProperty("--cols", cols);
    grid.style.setProperty("--dawn-glow", dawnGlow.toFixed(3));
    grid.classList.toggle("is-inside-base", inside);
    grid.classList.toggle("is-night", nightOut);
    grid.setAttribute("aria-label", inside ? "Inside the Base" : "Resource island");
    grid.innerHTML = "";
    normalizePlayer(state);
    const px = state.player.x;
    const py = state.player.y;
    for (const tile of tiles) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = tileClass(tile);
      btn.dataset.x = tile.x;
      btn.dataset.y = tile.y;
      if (tile.machine) btn.dataset.machine = tile.machine;
      if (tile.feature) btn.dataset.feature = tile.feature;
      // Outdoor hills: rise up; dirt face = uncovered steps vs south neighbor.
      let hillFace = 0;
      if (!inside) {
        const h = tileHeight(tile);
        hillFace = tileBackFaceHeight(state, tile);
        btn.dataset.height = String(h);
        btn.dataset.face = String(hillFace);
        btn.style.setProperty("--tile-h", String(h));
        btn.style.setProperty("--tile-face", String(hillFace));
        btn.style.setProperty("--tile-y", String(tile.y));
        if (h > 0) btn.classList.add("tile--hill");
        if (hillFace > 0) btn.classList.add("tile--hill-face");
        // Always mark the player's 3×3 so the ring can glow day + night.
        const reachDist = Math.max(Math.abs(tile.x - px), Math.abs(tile.y - py));
        if (reachDist === 1) btn.classList.add("tile--lit-ring");
        else if (reachDist === 0) btn.classList.add("tile--lit-core");
        if (nightOut) {
          const light = tileNightLight(state, tile.x, tile.y, nightAmbient);
          btn.style.setProperty("--tile-light", light.toFixed(3));
        }
        if (
          lightningWarnCell &&
          Math.max(
            Math.abs(tile.x - lightningWarnCell.x),
            Math.abs(tile.y - lightningWarnCell.y)
          ) <= 1
        ) {
          btn.classList.add("tile--lightning-warn");
        }
      } else {
        const reachDist = Math.max(Math.abs(tile.x - px), Math.abs(tile.y - py));
        if (reachDist === 1) btn.classList.add("tile--lit-ring");
        else if (reachDist === 0) btn.classList.add("tile--lit-core");
      }
      btn.innerHTML =
        (hillFace > 0
          ? `<span class="tile__hill-face" aria-hidden="true"></span>`
          : "") + `<span class="tile__icon">${tileLabel(tile)}</span>`;
      if (tile.x === px && tile.y === py) {
        btn.classList.add("tile--player");
        const youIcon = isSixSevenModInstalled() ? "6-7" : "🧑‍🔧";
        btn.insertAdjacentHTML(
          "beforeend",
          `<span class="tile__player" title="You" aria-label="You">${youIcon}</span>`
        );
      }
      const monster = inside ? null : monsterAt(state, tile.x, tile.y);
      if (monster) {
        btn.classList.add("tile--monster");
        const modOn = isSixSevenModInstalled();
        const mLabel = modOn ? "6-7" : GameData.monsters?.label || "Night Monster";
        const mIcon = modOn ? "6-7" : GameData.monsters?.icon || "🧟";
        btn.insertAdjacentHTML(
          "beforeend",
          `<span class="tile__monster" title="${mLabel}" aria-label="${mLabel}">${mIcon}</span>`
        );
      }
      if (inside) {
        if (tile.kind === "exit") btn.title = "Front door — walk on or click to leave";
        else if (tile.kind === "door") {
          if (doorNeedsKey(tile)) {
            btn.title = isDoorLocked(tile)
              ? hasBaseKey(state)
                ? "Locked door — click with Base Key to unlock"
                : "Locked door — need Base Key"
              : hasBaseKey(state)
                ? "Unlocked door — click with Base Key to lock"
                : "Unlocked door — walk through";
          } else {
            btn.title = tile.label || "Door";
          }
        } else if (tile.feature === "keyHook") {
          btn.title = state.baseKeyOnHook
            ? "Key hook — click to take the Base Key"
            : "Key hook — click to hang the Base Key";
        } else if (tile.kind === "upgrade") {
          const base = findPlayerBase(state);
          const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
          const next = GameData.baseTiers?.[tier + 1];
          btn.title = next?.cost
            ? `Upgrade Room — bench (${formatCost(next.cost)})`
            : "Upgrade Room — fully upgraded";
        } else if (tile.kind === "wall") btn.title = "Wall";
        else if (tile.room === "bedroom") btn.title = "Bedroom — click to sleep";
        else if (tile.room === "living") btn.title = "Living Room — click to watch TV";
        else if (tile.room === "kitchen") btn.title = "Kitchen — click to store food";
        else if (tile.room === "storage") btn.title = "Storage — click to store items";
        else if (tile.room === "workroom") btn.title = "Workroom — click to craft (3×3)";
        else btn.title = tile.label || INTERIOR_ROOM_LABELS[tile.room] || "Floor";
        if (tile.x === px && tile.y === py) {
          btn.title = (btn.title ? `${btn.title} · ` : "") + "You (WASD to move)";
        }
        grid.appendChild(btn);
        continue;
      }
      if (tile.node && tile.hp > 0 && !tile.machine) {
        const def = GameData.nodeTypes[tile.node];
        const minTool = def.minTool || "hand";
        const canMine = toolTiersMeet(state.activeTool || "hand", minTool);
        const need =
          minTool === "hand" ? "" : ` · needs ${GameData.getItem(minTool).name}`;
        btn.title = canMine
          ? `${def.label} (${tile.hp}/${tile.maxHp})`
          : `${def.label} (${tile.hp}/${tile.maxHp})${need}`;
      } else if (tile.machine) {
        const powered = poweredTilesCache.has(tileKey(tile.x, tile.y));
        const label = MACHINE_LABELS[tile.machine] || tile.machine;
        const blocking =
          tile.node && tile.hp <= 0
            ? ` · blocking ${GameData.nodeTypes[tile.node]?.label || "node"} regrowth`
            : "";
        if (tile.machine === "generator") {
          const gen = state.machines.find(
            (machine) => machine.type === "generator" && machine.x === tile.x && machine.y === tile.y
          );
          let genTitle = "Coal Generator (needs fuel) — click to open";
          if (gen?.outage) genTitle = "Coal Generator (offline) — click to reset";
          else if (!isGeneratorFueled(gen)) genTitle = "Coal Generator (needs fuel) — click to open";
          else if (!generatorHasConnection(state, gen)) {
            genTitle = "Coal Generator (needs connection) — click to open";
          } else if (isGeneratorOnline(gen)) {
            genTitle = "Coal Generator (online) — click to open";
          }
          btn.title = `${genTitle}${blocking}`;
        } else if (tile.machine === "fan") {
          btn.title = powered
            ? `Fan (blowing)${blocking}`
            : `Fan (needs power)${blocking}`;
        } else if (tile.machine === "powerPole") {
          btn.title = powered
            ? `Power Pole (live)${blocking}`
            : `Power Pole (no power)${blocking}`;
        } else if (tile.machine === "cable") {
          btn.title = powered ? `Power Line (live)${blocking}` : `Power Line (no power)${blocking}`;
        } else if (tile.machine === "craftingStation") {
          btn.title = `Old Crafting Table — click to refund (use Workroom)${blocking}`;
        } else if (tile.machine === "base") {
          const base = findBaseMachine(state, tile.x, tile.y);
          const name = getBaseTierInfo(base?.tier).name;
          btn.title = `${name} — walk on to go inside${blocking}`;
        } else if (tile.machine === "waterBucket") {
          const bucket = state.machines.find(
            (machine) =>
              machine.type === "waterBucket" && machine.x === tile.x && machine.y === tile.y
          );
          const freezing = waterBucketBesidePoweredFan(
            state,
            bucket,
            poweredTilesCache || computePoweredTiles(state)
          );
          const need = GameData.cooling?.fanFreezeMinutes ?? 5;
          const prog = Math.min(need, Math.floor(bucket?.freezeMinutes || 0));
          btn.title = freezing
            ? `Water Bucket freezing (${prog}/${need}m) — click to pick up${blocking}`
            : `Water Bucket — needs powered Fan beside it · click to pick up${blocking}`;
        } else if (tile.machine === "deathCrate") {
          const crate = state.machines.find(
            (machine) => machine.type === "deathCrate" && machine.x === tile.x && machine.y === tile.y
          );
          const n = Array.isArray(crate?.loot)
            ? crate.loot.reduce((sum, s) => sum + (s?.count || 0), 0)
            : 0;
          btn.title = `Death Crate — click to recover items (${n})${blocking}`;
        } else if (tile.machine === "smelter") {
          if (isSmelterElectric(tile)) {
            btn.title = `Smelter (powered) — click to open${blocking}`;
          } else if (isSmelterLit(tile)) {
            btn.title = `Smelter (lit) — click to open${blocking}`;
          } else {
            btn.title = `Smelter (cold) — wire to a generator or add fuel${blocking}`;
          }
        } else if (GameData.powerConsumers.includes(tile.machine)) {
          btn.title = powered
            ? `${label} (powered)${blocking}`
            : `${label} (no power — connect generator)${blocking}`;
        } else {
          btn.title = `${label}${blocking}`;
        }
      } else if (tile.node && tile.hp <= 0) {
        const label = GameData.nodeTypes[tile.node]?.label || "Resource";
        if (isWetWeather(state) && (state.inventory?.bucket || 0) > 0) {
          btn.title = `Depleted ${label} — click to fill Iron Bucket`;
        } else if ((state.inventory?.waterBucket || 0) > 0) {
          btn.title = `Depleted ${label} — click to place Water Bucket`;
        } else {
          btn.title = `Depleted ${label} — build here to block regrowth`;
        }
      } else if (isWetWeather(state) && (state.inventory?.bucket || 0) > 0) {
        btn.title = "Empty ground — click to fill Iron Bucket";
      } else if ((state.inventory?.waterBucket || 0) > 0) {
        btn.title = "Empty ground — click to place Water Bucket by a Fan";
      } else {
        btn.title = "Empty ground";
      }
      if (monster) {
        const mLabel = GameData.monsters?.label || "Night Monster";
        const maxHp = monsterMaxHp();
        const hp = Number.isFinite(monster.hp) ? monster.hp : maxHp;
        const swordReady =
          (state.activeTool || "hand") === (GameData.monsters?.swordTool || "ironSword");
        btn.title = !isInPlayerReach(state, tile.x, tile.y)
          ? `${mLabel} (${hp}/${maxHp}) — too far`
          : swordReady
            ? `${mLabel} (${hp}/${maxHp}) — sword one-shot`
            : `${mLabel} (${hp}/${maxHp}) — fist 1 dmg / sword one-shot`;
      }
      if (tile.x === px && tile.y === py) {
        btn.title = (btn.title ? `${btn.title} · ` : "") + "You (WASD to move)";
      }
      grid.appendChild(btn);
    }
    refreshBuildPreview();
  }

  function renderInventory() {
    // Side inventory panel removed — pockets live in Tab inventory / machine UIs.
  }

  function renderCraft() {
    // Side hand-crafting panel removed — use Tab (2×2) or Base Workroom (3×3).
  }

  function renderAdvancements() {
    if (!root || !state) return;
    const el = root.querySelector("#advancements-list");
    if (!el) return;

    let foundCurrent = false;
    const rows = GameData.goals.map((goal) => {
      const done = Boolean(state.goalsDone[goal.id]);
      let status = "locked";
      if (done) status = "done";
      else if (!foundCurrent) {
        status = "current";
        foundCurrent = true;
      }
      return { goal, status };
    });
    const sig = rows.map((r) => `${r.goal.id}:${r.status}`).join("|");
    if (sig === advancementsSig && el.childElementCount === rows.length) return;
    advancementsSig = sig;

    el.innerHTML = rows
      .map(({ goal, status }) => {
        const mark = status === "done" ? "✓" : status === "current" ? "▸" : "·";
        return `<li class="advancement is-${status}">
          <span class="advancement__mark" aria-hidden="true">${mark}</span>
          <span class="advancement__text">${goal.text}</span>
        </li>`;
      })
      .join("");
  }

  function renderEasterEggs() {
    if (!root || !state) return;
    const el = root.querySelector("#easter-eggs-list");
    if (!el) return;
    ensureEggsDone(state);

    const eggs = GameData.easterEggs || [];
    const rows = eggs.map((egg) => {
      const done = Boolean(state.eggsDone[egg.id]);
      return {
        egg,
        status: done ? "done" : "locked",
        label: done ? egg.text : egg.hint || "???",
      };
    });
    const sig = rows.map((r) => `${r.egg.id}:${r.status}`).join("|");
    if (sig === easterEggsSig && el.childElementCount === rows.length) return;
    easterEggsSig = sig;

    el.innerHTML = rows
      .map(({ status, label }) => {
        const mark = status === "done" ? "🥚" : "·";
        return `<li class="easter-egg is-${status}">
          <span class="easter-egg__mark" aria-hidden="true">${mark}</span>
          <span class="easter-egg__text">${label}</span>
        </li>`;
      })
      .join("");
  }

  function renderHud() {
    const tool = state.activeTool;
    const toolName = tool === "hand" ? "Hand" : GameData.getItem(tool).name;
    // HUD lives outside #game-root (sibling header), so query the document.
    const toolEl = document.getElementById("hud-tool");
    const buildEl = document.getElementById("hud-build");
    if (toolEl) toolEl.textContent = toolName;
    if (buildEl) {
      if (gamePaused) buildEl.textContent = "Paused (Esc)";
      else if (isInsideBase(state)) {
        const base = findPlayerBase(state);
        buildEl.textContent = `Inside ${getBaseTierInfo(base?.tier).name} · 🚪 leave · ⬆ upgrade`;
      } else if (!state.buildMode) buildEl.textContent = "Build: off (Q) · Demolish: F";
      else if (state.buildMode === "demolish") buildEl.textContent = "Demolish: ON (F to exit)";
      else buildEl.textContent = `Build: ${MACHINE_LABELS[state.buildMode] || state.buildMode}`;
    }

    const toast = root.querySelector("#game-toast");
    if (toast) {
      if (performance.now() < state.toastUntil && state.toast) {
        toast.textContent = state.toast;
        toast.hidden = false;
      } else {
        toast.hidden = true;
      }
    }
  }

  function render() {
    if (!root || !state) return;
    renderWorld();
    renderInventory();
    renderCraft();
    renderHud();
    renderAdvancements();
    renderEasterEggs();
    renderClock();
  }

  function onWorldClick(event) {
    if (gamePaused) return;
    const btn = event.target.closest(".tile");
    if (!btn) return;
    const x = Number(btn.dataset.x);
    const y = Number(btn.dataset.y);

    if (isInsideBase(state)) {
      const tile = getActiveTile(state, x, y);
      if (!tile) return;
      if (!isInPlayerReach(state, x, y)) {
        toastOutOfReach(state);
        renderHud();
        return;
      }
      if (tile.feature === "exit" || tile.kind === "exit") {
        promptBaseLeave();
        return;
      }
      if (tile.feature === "keyHook") {
        if (tryUseKeyHook(state, tile)) {
          updateGoals(state);
          saveState(state);
          render();
        } else {
          renderHud();
        }
        return;
      }
      if (tile.kind === "door") {
        if (doorNeedsKey(tile)) {
          if (tryToggleDoorWithKey(state, tile)) {
            updateGoals(state);
            saveState(state);
            render();
          } else {
            renderHud();
          }
          return;
        }
        setToast(state, "Door — walk through");
        renderHud();
        return;
      }
      if (tile.feature === "upgrade" || tile.kind === "upgrade") {
        if (upgradePlayerBase(state)) {
          updateGoals(state);
          saveState(state);
          render();
        } else {
          renderHud();
        }
        return;
      }
      if (tile.room === "bedroom") {
        promptBedroomSleep();
        return;
      }
      if (tile.room === "living") {
        promptLivingRoomTv();
        return;
      }
      if (tile.room === "kitchen") {
        openKitchenUi();
        return;
      }
      if (tile.room === "storage") {
        openStorageUi();
        return;
      }
      if (tile.room === "workroom") {
        openWorkroomCraftUi();
        return;
      }
      if (tile.kind === "wall") {
        setToast(state, "That's a wall");
        renderHud();
      }
      return;
    }

    const tile = state.tiles[y * COLS + x];
    rememberActionTile(state, x, y);

    // Harvest / open / build / demolish only inside the player's 3×3.
    if (!isInPlayerReach(state, x, y)) {
      toastOutOfReach(state);
      renderHud();
      return;
    }

    // Fight night monsters before other tile actions (not while placing/demolishing).
    if (!state.buildMode && hitMonsterAt(state, x, y)) {
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    // Build / demolish mode takes priority; only Q clears build mode.
    if (state.buildMode === "demolish") {
      demolishMachine(state, tile);
      updateGoals(state);
      saveState(state);
      render();
      return;
    }
    if (state.buildMode) {
      placeMachine(state, tile, state.buildMode);
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    if (tile.machine === "smelter") {
      closePlayerInvUi();
      openSmelterUi(x, y);
      return;
    }

    if (tile.machine === "generator") {
      closePlayerInvUi();
      openGeneratorUi(x, y);
      return;
    }

    if (tile.machine === "craftingStation") {
      retireOutdoorCraftingTables(state);
      setToast(state, "Crafting Tables removed — use the Workroom in your Base");
      saveState(state);
      render();
      return;
    }

    if (tile.machine === "deathCrate") {
      lootDeathCrate(state, tile);
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    if (tile.machine === "waterBucket") {
      pickupPlacedWaterBucket(state, tile);
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    if (tryCollectRainWater(state, tile)) {
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    if (tryPlaceWaterBucket(state, tile)) {
      updateGoals(state);
      saveState(state);
      render();
      return;
    }

    harvestTile(state, tile);
    updateGoals(state);
    saveState(state);
    render();
  }

  function onPanelClick(event) {
    const craftBtn = event.target.closest("[data-craft]");
    if (craftBtn) {
      craft(state, craftBtn.dataset.craft);
      updateGoals(state);
      saveState(state);
      render();
    }
  }

  function tickWorldClock() {
    if (!state || gamePaused) return;
    advanceWorldTime(state, 5);
    // Monsters move on the clock — refresh the island so their chase is visible.
    renderWorld();
    renderHud();
    renderClock();
    if (openSmelter) renderSmelterUi();
    if (openGenerator) renderGeneratorUi();
    updateGoals(state);
    saveState(state);
  }

  function loop(ts) {
    if (!state) return;
    if (gamePaused) {
      last = ts;
      raf = requestAnimationFrame(loop);
      return;
    }
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    tickMachines(state, dt);
    updateGoals(state);
    renderHud();
    // Do NOT rebuild the world DOM every frame — that cancels clicks mid-press.
    if (state.machines.length) {
      renderInventory();
      refreshTilePowerStyles();
    }
    if (openSmelter) refreshSmelterProgress();
    if (openGenerator) refreshGeneratorStatus();
    raf = requestAnimationFrame(loop);
  }

  function mount(playRoot) {
    root = playRoot;
    state = loadState();
    ensureBag(state);
    normalizeNodeHitPoints(state);
    if (!Number.isFinite(state.worldMinutes)) state.worldMinutes = 6 * 60;
    for (const m of state.machines) {
      if (m.type === "smelter") ensureSmelterShape(m);
      if (m.type === "generator") ensureGeneratorShape(m);
    }
    normalizeEquipment(state);
    if (!state.activeTool) state.activeTool = "hand";

    if (!bound) {
      const worldGrid = root.querySelector("#world-grid");
      worldGrid.addEventListener("click", onWorldClick);
      worldGrid.addEventListener("pointermove", onWorldPointerMove);
      worldGrid.addEventListener("pointerleave", onWorldPointerLeave);
      root.addEventListener("click", onPanelClick);
      document.addEventListener("keydown", onPlayKeyDown);
      bindSmelterUi();
      bindGeneratorUi();
      bindPlayerInvUi();
      bindCraftTableUi();
      bindKitchenUi();
      bindStorageUi();
      bindRecipesUi();
      bindBuildUi();
      bindBaseEnterPrompt();
      bindBaseLeavePrompt();
      bindSleepPrompt();
      bindTvPrompt();
      bindSixSevenArenaUi();
      bindPauseUi();
      bindAdaUi();
      bound = true;
    }

    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(tickWorldClock, 5000);

    playActive = true;
    gamePaused = false;
    resetClockHandTracking();
    advancementsSig = "";
    easterEggsSig = "";
    ensureEggsDone(state);
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeRecipesUi();
    closeBuildUi();
    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    closeTvPrompt();
    baseEnterFrom = null;
    baseLeaveFrom = null;
    closePauseUi();
    window.KeaghanSfx?.startMusic?.();
    normalizeAda(state);
    if (!state.adaHeard.welcome) speakAda(state, "welcome");
    else refreshAdaPanel();
    render();
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    playActive = false;
    gamePaused = false;
    lightningWarnCell = null;
    resetClockHandTracking();
    updateSkyBackground();
    window.KeaghanSfx?.stopMusic?.();
    window.KeaghanSfx?.stopOminousMusic?.();
    window.KeaghanSfx?.stopSixSevenBossMusic?.();
    window.KeaghanSfx?.stopSixSevenAudio?.();
    window.KeaghanSfx?.stopAdaSpeech?.();
    endSixSevenArenaOverlay();
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeKitchenUi();
    closeStorageUi();
    closeTvPrompt();
    closeRecipesUi();
    closeBuildUi();
    closeBaseEnterPrompt();
    closeBaseLeavePrompt();
    closeSleepPrompt();
    baseEnterFrom = null;
    baseLeaveFrom = null;
    closePauseUi();
    if (state) saveState(state);
  }

  function persistOnLeave() {
    if (state && playActive) saveState(state);
  }

  window.addEventListener("pagehide", persistOnLeave);
  window.addEventListener("beforeunload", persistOnLeave);

  return {
    SLOT_COUNT,
    mount,
    unmount,
    save: () => state && saveState(state),
    getSlotMeta,
    clearSlot,
    resetSlot,
    clearAllSlots,
    refreshAda: refreshAdaPanel,
    previewLightningStrike,
    clearLightningPreview,
    onLightningStrike,
  };
})();

window.IslandFoundry = (() => {
  const SAVE_KEY_BASE = "keaghans-game-save-v1";
  const SLOT_COUNT = 5;
  const COLS = 10;
  const ROWS = 10;
  /** Indoor base map — same size as the island, split into rooms. */
  const INTERIOR_COLS = 10;
  const INTERIOR_ROWS = 10;
  /** Bump when starter resource layout changes so saves pick up the new scramble. */
  const WORLD_LAYOUT_VERSION = 2;
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
  /** Each crafting-grid cell holds at most one item (Minecraft-style). */
  const CRAFT_SLOT_MAX = 1;

  function emptyBag() {
    return Array.from({ length: BAG_SIZE }, () => null);
  }

  function normalizeBag(bag) {
    const next = Array.isArray(bag) ? [...bag] : [];
    while (next.length < BAG_SIZE) next.push(null);
    return next.slice(0, BAG_SIZE).map((s) =>
      s && s.id && s.count > 0 ? { id: s.id, count: s.count } : null
    );
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

  function makeWorld() {
    const tiles = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        tiles.push({
          x,
          y,
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
      return {
        x: baseX,
        y: baseY,
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
  };

  /**
   * 10×10 indoor base:
   *   NW Kitchen · N Upgrade · NE Living
   *   SW Storage · SE Bedroom · rest Hall · doors on the east wall
   */
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
    // North front walls (mirror of south at y=6) — 3 tiles each side toward center
    set(1, 3, wall());
    set(2, 3, wall());
    set(3, 3, wall());
    set(6, 3, wall());
    set(7, 3, wall());
    set(8, 3, wall());
    // South front walls (storage SW + bedroom SE)
    set(1, 6, wall());
    set(2, 6, wall());
    set(3, 6, wall());
    set(6, 6, wall());
    set(7, 6, wall());
    set(8, 6, wall());
    // Doorways into rooms from the center hall
    set(3, 2, { kind: "floor", room: "hall", feature: null, icon: null, label: INTERIOR_ROOM_LABELS.hall });
    set(6, 2, { kind: "floor", room: "hall", feature: null, icon: null, label: INTERIOR_ROOM_LABELS.hall });
    set(3, 7, { kind: "floor", room: "hall", feature: null, icon: null, label: INTERIOR_ROOM_LABELS.hall });
    set(6, 7, { kind: "floor", room: "hall", feature: null, icon: null, label: INTERIOR_ROOM_LABELS.hall });

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
      [2, 2, "🧊", "Fridge"],
      [1, 2, "🔪", "Counter"],
      [7, 1, "🛋", "Sofa"],
      [8, 2, "🪑", "Chair"],
      [8, 1, "🪴", "Plant"],
      [1, 7, "📦", "Crate"],
      [2, 8, "📦", "Crate"],
      [1, 8, "📦", "Crate"],
      [7, 7, "🛏", "Bed"],
      [8, 7, "🧸", "Nightstand"],
      [8, 8, "🪟", "Window"],
      [4, 4, "🕯", "Hall lamp"],
      [5, 5, "🕯", "Hall lamp"],
    ];
    for (const [x, y, icon, label] of props) {
      const cell = cells[y][x];
      if (cell.kind === "wall" || cell.kind === "exit" || cell.feature === "upgrade") continue;
      const room = cell.room || "hall";
      set(x, y, {
        kind: "floor",
        room,
        feature: "prop",
        icon,
        label: `${INTERIOR_ROOM_LABELS[room] || "Room"} — ${label}`,
      });
    }

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

  function isInteriorWalkable(tile) {
    if (!tile) return false;
    return tile.kind === "floor" || tile.kind === "exit" || tile.kind === "upgrade";
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

  function isInPlayerReach(gameState, x, y) {
    if (!gameState) return false;
    normalizePlayer(gameState);
    const dx = Math.abs(Math.floor(x) - gameState.player.x);
    const dy = Math.abs(Math.floor(y) - gameState.player.y);
    return Math.max(dx, dy) <= PLAYER_REACH;
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
    if (gameState && isInsideBase(gameState)) return isInteriorWalkable(tile);
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
    window.KeaghanSfx?.playFoodPop?.();
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
      normalizeHunger(state);
      normalizeHealth(state);
      normalizeMonsters(state);
      normalizeBaseTiers(state);
      normalizeInsideBase(state);
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
        openSmelter ||
        openGenerator ||
        openRecipes ||
        openBuildMenu ||
        openBaseEnterPrompt ||
        openSleepPrompt
    );
  }

  /** WASD step — empty land only. Click still harvests / opens machines in 3×3 reach. */
  function tryMovePlayer(dx, dy) {
    if (!state || !playActive || gamePaused || menusBlockPlayerMove()) return false;
    ensurePlayerOnWalkable(state);
    const nx = state.player.x + dx;
    const ny = state.player.y + dy;
    const { cols, rows } = activeMapSize(state);
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return false;
    if (nx === state.player.x && ny === state.player.y) return false;
    const dest = getActiveTile(state, nx, ny);
    if (!isWalkableTile(dest, state)) {
      setToast(
        state,
        !isInsideBase(state) && monsterAt(state, nx, ny)
          ? "A monster blocks the way"
          : isInsideBase(state)
            ? "Can't walk through the wall"
            : "Can't walk there — only empty land"
      );
      renderHud();
      return false;
    }
    state.player.x = nx;
    state.player.y = ny;
    if (!isInsideBase(state)) rememberActionTile(state, nx, ny);
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

    // Craft cells never stack — only fill empty slots, 1 item each.
    for (let i = 0; i < bench.size && left > 0; i++) {
      const cell = bench.grid[i];
      if (cell && !cell.missing && cell.count > 0) continue;
      bench.grid[i] = { id: stack.id, count: CRAFT_SLOT_MAX };
      left -= 1;
      moved += 1;
      stack.count -= 1;
    }
    if (stack.count <= 0) state.bag[slotIndex] = null;
    rebuildInventoryFromBag(state);
    return moved;
  }

  /** Place exactly one item from a bag slot into a specific craft cell. */
  function placeOneFromBagIntoCraftSlot(bagIndex, gridIndex) {
    const bench = getActiveBench();
    ensureBag(state);
    const stack = state.bag[bagIndex];
    if (!bench || !stack || stack.count < 1) return 0;
    if (gridIndex < 0 || gridIndex >= bench.size) return 0;

    const cell = bench.grid[gridIndex];
    if (cell && !cell.missing && cell.count > 0) {
      if (cell.id === stack.id) return 0; // already full
      // Swap: craft keeps 1 of the bag item; leftover bag stack returns to inventory.
      const craftId = cell.id;
      const craftCount = Math.min(CRAFT_SLOT_MAX, cell.count);
      const bagId = stack.id;
      const bagLeft = stack.count - 1;
      bench.grid[gridIndex] = { id: bagId, count: CRAFT_SLOT_MAX };
      state.bag[bagIndex] = { id: craftId, count: craftCount };
      rebuildInventoryFromBag(state);
      if (bagLeft > 0) addItem(state, bagId, bagLeft);
      return 1;
    }

    bench.grid[gridIndex] = { id: stack.id, count: CRAFT_SLOT_MAX };
    stack.count -= 1;
    if (stack.count <= 0) state.bag[bagIndex] = null;
    rebuildInventoryFromBag(state);
    return 1;
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

  function setToast(state, msg) {
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
    if (fill) fill.style.transform = `scaleY(${Math.max(0, Math.min(1, points / max))})`;
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
  }

  function grantHarvest(state, resourceId, amount, labelHint) {
    addItem(state, resourceId, amount);
    state.stats.gathered[resourceId] = (state.stats.gathered[resourceId] || 0) + amount;
    const name = GameData.getItem(resourceId).name;
    setToast(state, labelHint ? `${labelHint} · +${amount} ${name}` : `+${amount} ${name}`);
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
      setToast(state, "Open a Crafting Table to make that");
      return false;
    }
    if (!canAfford(state, recipe.cost)) {
      setToast(state, "Need more materials");
      return false;
    }
    spend(state, recipe.cost);
    addItem(state, recipe.output.id, recipe.output.count);
    if (!state.stats.crafted) state.stats.crafted = {};
    state.stats.crafted[recipe.output.id] =
      (state.stats.crafted[recipe.output.id] || 0) + recipe.output.count;
    if (recipe.unlocksTool && !state.unlockedTools.includes(recipe.unlocksTool)) {
      state.unlockedTools.push(recipe.unlocksTool);
      state.activeTool = recipe.unlocksTool;
      setToast(state, `Equipped ${recipe.name}!`);
    } else {
      setToast(state, `Crafted ${recipe.name}`);
    }
    applyHungerCost(state, hungerActionCost());
    return true;
  }

  const PLACEABLE = [
    "drill",
    "smelter",
    "generator",
    "powerPole",
    "cable",
    "craftingStation",
    "base",
  ];
  const MACHINE_LABELS = {
    drill: "Drill",
    smelter: "Smelter",
    generator: "Coal Generator",
    powerPole: "Power Pole",
    cable: "Power Line",
    craftingStation: "Crafting Table",
    base: "Base",
    deathCrate: "Death Crate",
  };
  const BUILD_STRUCTURES = [
    "craftingStation",
    "smelter",
    "drill",
    "generator",
    "powerPole",
    "cable",
    "base",
  ];
  const BUILD_HINTS = {
    craftingStation: "Grass or depleted nodes — costs 4 Planks (not on live trees/ores)",
    smelter: "Grass or depleted nodes — costs Stone + Coal",
    drill: "Place on a resource node (ore/coal/rock/tree) — then power it",
    generator: "Grass or depleted nodes — click the generator to load Coal",
    powerPole: "Grass or depleted nodes — costs Iron Ingot + Cable",
    cable: "Grass or depleted nodes — costs 1 Cable; wires output buildings to input buildings",
    base: "Clear 5×3 — 50 Planks. Upgrade inside (30 Stone, then 30 Iron). LMB to go inside",
    demolish: "Demolish locked (F) — click buildings to remove. F or a menu to exit.",
  };

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

  /** Ask before going indoors — Enter / Stay outside. */
  function promptBaseEnter() {
    if (!state || !playActive || gamePaused) return;
    if (isInsideBase(state)) return;
    if (!isPlayerOnBase(state)) {
      setToast(state, "Stand on your Base, then click it to go inside");
      return;
    }
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeRecipesUi();
    closeBuildUi();

    const base = findPlayerBase(state);
    const name = getBaseTierInfo(base?.tier).name;
    const title = document.getElementById("base-enter-title");
    const hint = document.getElementById("base-enter-hint");
    if (title) title.textContent = `Enter ${name}?`;
    if (hint) {
      hint.textContent =
        "Go inside? 10×10 with rooms — doors on the east, upgrade room north, kitchen NW, living NE, storage SW, bedroom SE.";
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
    if (pos && gameState.insideBase) {
      gameState.player = pos;
      normalizePlayer(gameState);
      const here = getActiveTile(gameState, gameState.player.x, gameState.player.y);
      if (!isInteriorWalkable(here)) gameState.player = interiorSpawnPos();
    }
  }

  function enterBaseInterior() {
    if (!state || !playActive) return;
    if (isInsideBase(state)) return;
    if (!isPlayerOnBase(state)) {
      setToast(state, "Stand on your Base, then click it to go inside");
      return;
    }
    closeBaseEnterPrompt();
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
    updateGoals(state);
    saveState(state);
    render();
  }

  function leaveBaseInterior(gameState, { silent = false, skipRender = false } = {}) {
    if (!gameState || !isInsideBase(gameState)) return false;
    const outdoor = gameState.outdoorPlayer || defaultPlayerPos();
    gameState.insideBase = false;
    gameState.interiorTiles = null;
    gameState.outdoorPlayer = null;
    gameState.player = {
      x: Math.max(0, Math.min(COLS - 1, Math.floor(outdoor.x))),
      y: Math.max(0, Math.min(ROWS - 1, Math.floor(outdoor.y))),
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

  function bindBaseEnterPrompt() {
    const modal = document.getElementById("base-enter-modal");
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      const action = event.target.closest("[data-base-enter]")?.dataset.baseEnter;
      if (!action) return;
      if (action === "cancel") {
        closeBaseEnterPrompt();
        setToast(state, "Stayed outside");
        renderHud();
        return;
      }
      if (action === "enter") {
        enterBaseInterior();
      }
    });
  }

  function closeSleepPrompt() {
    openSleepPrompt = false;
    hideModal("sleep-modal");
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
  const POWER_LOAD_HISTORY = 28;
  /** Power draw per machine type on a generator's network. */
  const POWER_DRAW = {
    drill: 4,
    smelter: 2,
  };

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
      loadHistory: Array.from({ length: POWER_LOAD_HISTORY }, () => 0),
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
    if (!Array.isArray(m.loadHistory) || !m.loadHistory.length) {
      m.loadHistory = Array.from({ length: POWER_LOAD_HISTORY }, () => Math.round(m.gridLoad) || 0);
    } else {
      m.loadHistory = m.loadHistory
        .map((n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0))
        .slice(-POWER_LOAD_HISTORY);
      while (m.loadHistory.length < POWER_LOAD_HISTORY) m.loadHistory.unshift(0);
    }
    if (!Number.isFinite(m.loadTick)) m.loadTick = 0;
    return m;
  }

  function networkPowerDemand(state, gen) {
    const component = getNetworkComponent(state, gen);
    let demand = 0;
    for (const node of component) {
      demand += POWER_DRAW[node.type] || 0;
    }
    return demand;
  }

  /** Step load toward demand (up, down, or flat), trip if over max. */
  function tickGeneratorLoad(state, m, dt) {
    ensureGeneratorShape(m);
    m.loadTick += dt;
    if (m.loadTick < 0.35) return;
    m.loadTick = 0;

    // During an outage the chart freezes on the tripped reading.
    if (m.outage) {
      m.loadHistory.push(Math.round(m.gridLoad) || 0);
      if (m.loadHistory.length > POWER_LOAD_HISTORY) {
        m.loadHistory = m.loadHistory.slice(-POWER_LOAD_HISTORY);
      }
      return;
    }

    const demand = isGeneratorFueled(m) ? networkPowerDemand(state, m) : 0;
    const prev = Math.round(m.gridLoad) || 0;
    let next = prev;
    if (demand > prev) next = prev + 1;
    else if (demand < prev) next = prev - 1;
    // else stay flat

    m.gridLoad = Math.max(0, next);
    m.loadHistory.push(m.gridLoad);
    if (m.loadHistory.length > POWER_LOAD_HISTORY) {
      m.loadHistory = m.loadHistory.slice(-POWER_LOAD_HISTORY);
    }

    if (isGeneratorFueled(m) && m.gridLoad > POWER_GRID_MAX) {
      m.outage = true;
      setToast(state, "Offline — grid load exceeded 20. Pull the lever up to reset.");
    }
  }

  function resetGeneratorOutage(m) {
    if (!m || !m.outage) return false;
    ensureGeneratorShape(m);
    m.outage = false;
    const demand = state ? networkPowerDemand(state, m) : 0;
    m.gridLoad = Math.min(POWER_GRID_MAX, demand);
    m.loadHistory.push(m.gridLoad);
    if (m.loadHistory.length > POWER_LOAD_HISTORY) {
      m.loadHistory = m.loadHistory.slice(-POWER_LOAD_HISTORY);
    }
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
    for (const m of state.machines) {
      if (m.type !== "smelter") continue;
      ensureSmelterShape(m);

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

        if (m.storedEnergy <= 0) {
          if (!burnFuelToEnergy(m)) {
            m.progressMinutes = 0;
            break;
          }
        }

        const step = Math.min(remaining, m.storedEnergy, recipe.minutes - m.progressMinutes);
        if (step <= 0) break;

        m.storedEnergy -= step;
        m.progressMinutes += step;
        remaining -= step;

        if (m.storedEnergy <= 0 && m.progressMinutes < recipe.minutes) {
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
      setToast(state, "Need Cable — craft 2 Copper Wire horizontally at a Crafting Table");
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
          ? "Drill placed — connect it with Power Lines or poles (Crafting Tables have no power)"
          : "Drill placed (needs a resource node + power)"
      );
    } else if (type === "smelter") {
      state.machines.push(makeSmelterMachine(tile.x, tile.y));
      setToast(state, "Smelter placed — click it to open (log or coal for heat)");
    } else if (type === "generator") {
      state.machines.push(makeGeneratorMachine(tile.x, tile.y));
      setToast(state, "Generator placed — click it to load Coal and check the power grid");
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
      state.machines.push({
        type: "craftingStation",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 0,
        craftGrid: [null, null, null, null, null, null, null, null, null],
      });
      setToast(state, "Crafting Table placed — click it for the 3×3 workbench");
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
      }
    }

    // Recompute after possible fuel change this frame.
    const poweredNow = computePoweredTiles(state);

    for (const m of state.machines) {
      if (m.type === "generator" || m.type === "powerPole" || m.type === "smelter") continue;
      if (!isMachinePowered(state, m, poweredNow)) continue;

      m.timer += dt;
      if (m.timer < m.interval) continue;
      m.timer = 0;

      if (m.type === "drill") {
        if (!m.resource) continue;
        addItem(state, m.resource, 1);
        state.stats.drilled += 1;
        state.stats.poweredDrill = (state.stats.poweredDrill || 0) + 1;
        state.stats.gathered[m.resource] = (state.stats.gathered[m.resource] || 0) + 1;
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
  let raf = 0;
  let last = 0;
  let clockTimer = 0;
  let root = null;
  let bound = false;
  let poweredTilesCache = new Set();
  let openSmelter = null; // { x, y } of open smelter UI
  let openGenerator = null; // { x, y } of open generator UI
  let openPlayerInv = false;
  let openCraftTable = null; // { x, y } of open crafting table
  let openRecipes = false;
  let recipesSelectedId = null; // null = category grid; set = detail view
  let recipesCategory = "everything"; // "everything" | "items" | "tools" | "food" | "buildings"
  let openBuildMenu = false;
  let openBaseEnterPrompt = false;
  let openSleepPrompt = false;
  let gamePaused = false;
  let advancementsSig = "";
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

    const energyCap = Math.max(
      fuelEnergyValue("coal"),
      fuelEnergyValue("log"),
      fuelEnergyValue("plank"),
      m.storedEnergy,
      1
    );
    if (energyBar) energyBar.style.width = `${Math.min(100, (m.storedEnergy / energyCap) * 100)}%`;
    if (energyValue) energyValue.textContent = `${m.storedEnergy}`;

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
    if (target === "fuel") {
      if (from === "inv") return transferToGeneratorFuel(itemId, count) > 0;
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
    if (loadEl) {
      loadEl.innerHTML = `${load} <small>/ ${max}</small>`;
      loadEl.classList.toggle("is-over", load > max || m.outage);
    }

    if (gridCol) gridCol.classList.toggle("is-tripped", Boolean(m.outage));

    if (summary) {
      const demand = networkPowerDemand(state, m);
      const wired = generatorHasConnection(state, m);
      if (m.outage) {
        summary.textContent = "OFFLINE — pull the lever up to restore power";
      } else if (!isGeneratorFueled(m)) {
        summary.textContent = "Needs fuel — load Coal to power the grid";
      } else if (!wired) {
        summary.textContent = "Needs connection — run a Power Line or pole to a machine";
      } else if (demand <= 0) {
        summary.textContent = "Online — wired, no power draw yet";
      } else {
        summary.textContent = `Demand ${demand} · chart steps toward load (max ${max})`;
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

    syncGeneratorOutageLayout(m);
    renderGeneratorPowerChart(m);
    poweredTilesCache = computePoweredTiles(state);
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
        "[data-generator-drop], [data-generator-slot], .generator-col--inv"
      );
      if (!drop || !generatorDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(".smelter-slot.is-drop-hover, .smelter-col--inv.is-drop-hover")
        .forEach((el) => el.classList.remove("is-drop-hover"));
      const slot = event.target.closest(".smelter-slot");
      if (slot) slot.classList.add("is-drop-hover");
      else if (drop.classList?.contains("generator-col--inv") || drop.classList?.contains("smelter-col--inv")) {
        drop.classList.add("is-drop-hover");
      }
    });

    modal.addEventListener("dragleave", (event) => {
      const slot = event.target.closest(".smelter-slot, .smelter-col--inv");
      if (slot) slot.classList.remove("is-drop-hover");
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

  /** Craft cells hold 1 — refund any overflow into the bag. */
  function clampCraftGridToSlotMax(grid) {
    if (!grid || !state) return;
    for (let i = 0; i < grid.length; i++) {
      const stack = grid[i];
      if (!stack || stack.missing || !(stack.count > CRAFT_SLOT_MAX)) continue;
      const extra = stack.count - CRAFT_SLOT_MAX;
      stack.count = CRAFT_SLOT_MAX;
      addItem(state, stack.id, extra);
    }
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

  function recipeAffordableFromCounts(recipe, counts) {
    return Object.entries(recipe.cost).every(([id, n]) => (counts[id] || 0) >= n);
  }

  function countsExactCost(counts, cost) {
    const ids = new Set([...Object.keys(counts), ...Object.keys(cost)]);
    for (const id of ids) {
      if ((counts[id] || 0) !== (cost[id] || 0)) return false;
    }
    return true;
  }

  function gridSatisfiesRecipe(grid, recipe) {
    if (!recipe) return false;
    return recipeAffordableFromCounts(recipe, craftGridCounts(grid));
  }

  function findGridMatchedRecipe(grid, recipes) {
    if (gridHasMissing(grid)) return null;
    const counts = craftGridCounts(grid);
    if (!Object.keys(counts).length) return null;
    let exact = null;
    let best = null;
    let bestNeed = -1;
    for (const recipe of recipes) {
      if (!recipeAffordableFromCounts(recipe, counts)) continue;
      if (countsExactCost(counts, recipe.cost)) {
        const need = Object.values(recipe.cost).reduce((a, b) => a + b, 0);
        if (!exact || need > Object.values(exact.cost).reduce((a, b) => a + b, 0)) {
          exact = recipe;
        }
        continue;
      }
      const need = Object.values(recipe.cost).reduce((a, b) => a + b, 0);
      if (need > bestNeed) {
        best = recipe;
        bestNeed = need;
      }
    }
    return exact || best;
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
    if (!gridSatisfiesRecipe(bench.grid, recipe)) return false;
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
    if (!state.stats.crafted) state.stats.crafted = {};
    state.stats.crafted[recipe.output.id] =
      (state.stats.crafted[recipe.output.id] || 0) + recipe.output.count;
    if (recipe.unlocksTool && !state.unlockedTools.includes(recipe.unlocksTool)) {
      state.unlockedTools.push(recipe.unlocksTool);
      state.activeTool = recipe.unlocksTool;
      setToast(state, `Equipped ${recipe.name}!`);
    } else {
      setToast(state, `Crafted ${recipe.name}`);
    }
    applyHungerCost(state, hungerActionCost());
  }

  function findCraftTableMachine() {
    if (!state || !openCraftTable) return null;
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
    clampCraftGridToSlotMax(m.craftGrid);
    return m;
  }

  /** Active bench: Tab inventory (2x2) or placed Crafting Table (3x3). */
  function getActiveBench() {
    if (openPlayerInv) {
      playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
      clampCraftGridToSlotMax(playerCraftGrid);
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
      // Swap one bag item into the craft cell (craft slots hold 1).
      const craftId = stack.id;
      const craftCount = Math.min(CRAFT_SLOT_MAX, stack.count);
      const bagId = dest.id;
      const bagLeft = dest.count - 1;
      state.bag[bagIndex] = { id: craftId, count: craftCount };
      bench.grid[gridIndex] = { id: bagId, count: CRAFT_SLOT_MAX };
      rebuildInventoryFromBag(state);
      if (bagLeft > 0) addItem(state, bagId, bagLeft);
      return craftCount;
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
      setToast(state, "Open a Crafting Table to make that");
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
      const need = CRAFT_SLOT_MAX;
      if ((state.inventory[cell.id] || 0) >= need) {
        removeItem(state, cell.id, need);
        bench.grid[i] = { id: cell.id, count: need };
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

  function openCraftTableUi(x, y) {
    clearBuildMode();
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeBuildUi();
    closeRecipesUi();
    const exists = state.machines.some(
      (m) => m.type === "craftingStation" && m.x === x && m.y === y
    );
    if (!exists) {
      setToast(state, "No Crafting Table here");
      return;
    }
    openCraftTable = { x, y };
    const m = findCraftTableMachine();
    if (m) ensureCraftTableShape(m);
    showModal("craft-table-modal");
    renderActiveBenchUi();
    renderHud();
    setToast(state, "Crafting Table — 3×3 workbench · E recipes");
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
  ];

  const GUIDE_TOOLS = ["woodPick", "stonePick", "ironPick", "ironSword"];

  const GUIDE_FOOD = ["apple", "carrot"];

  const GUIDE_BUILDINGS = [
    "craftingStation",
    "smelter",
    "generator",
    "powerPole",
    "cable",
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
    // Dedupe (e.g. Cable appears as item + building) while keeping order.
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

  function guideDisplayName(id, category) {
    if ((category === "buildings" || category === "everything") && MACHINE_LABELS[id]) {
      return MACHINE_LABELS[id];
    }
    return GameData.getItem(id)?.name || id;
  }

  function recipesBrowserHtml() {
    // Detail view replaces the button grid entirely.
    if (recipesSelectedId) {
      const guide = GameData.getItemGuide(recipesSelectedId);
      const selected = GameData.getItem(recipesSelectedId);
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
        const item = GameData.getItem(id);
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

    if (event.key === "Escape") {
      event.preventDefault();
      if (gamePaused) {
        resumeGame();
        return;
      }
      if (openBaseEnterPrompt) {
        closeBaseEnterPrompt();
        renderHud();
        return;
      }
      if (openSleepPrompt) {
        closeSleepPrompt();
        renderHud();
        return;
      }
      if (state && isInsideBase(state)) {
        leaveBaseInterior(state);
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
    closeBaseEnterPrompt();
    gamePaused = true;
    window.KeaghanSfx?.pauseMusic?.();
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
    setBuildStatus("Craft Planks (Tab), then pick Crafting Table.");
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
      setBuildStatus("Craft Planks (Tab), then pick Crafting Table.");
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

    const list = document.getElementById(bench.listId);
    if (list) {
      list.innerHTML = recipeButtonsHtml(bench.recipes, {
        dataAttr: bench.craftAttr,
        fromStation: bench.fromStation,
      });
    }

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

    const toolsGrid = document.getElementById("player-tools-grid");
    if (toolsGrid && bench.mode === "player") {
      const tools = state.unlockedTools.length ? state.unlockedTools : ["hand"];
      toolsGrid.innerHTML = tools
        .map((id) => {
          const equipped = state.activeTool === id;
          const name = id === "hand" ? "Hand" : GameData.getItem(id).name;
          const icon = id === "hand" ? "✋" : GameData.getItem(id).icon;
          return `<button type="button" class="smelter-slot${equipped ? " is-equipped" : ""}" data-equip-tool="${id}" title="${name}${equipped ? " (equipped)" : ""}">
            <span class="smelter-slot__icon">${icon}</span>
            <span class="smelter-slot__count">${equipped ? "E" : ""}</span>
          </button>`;
        })
        .join("");
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

      const toolBtn = event.target.closest("[data-equip-tool]");
      if (toolBtn && modalId === "player-inv-modal") {
        const toolId = toolBtn.dataset.equipTool;
        if (toolId && state.unlockedTools.includes(toolId)) {
          state.activeTool = toolId;
          const name = toolId === "hand" ? "Hand" : GameData.getItem(toolId).name;
          setToast(state, `Equipped ${name}`);
          afterBenchChange();
        }
        return;
      }

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

      if (bagIndex != null && bagIndex !== "" && state.bag[Number(bagIndex)]) {
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
        "[data-craft-grid], [data-bag-slot], [data-inv-trash], [data-inv-eat], .craft-station-col--inv, .craft-grid"
      );
      if (!drop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal
        .querySelectorAll(
          ".smelter-slot.is-drop-hover, .inv-trash.is-drop-hover, .inv-eat.is-drop-hover, .inv-eat.is-reject"
        )
        .forEach((el) => el.classList.remove("is-drop-hover", "is-reject"));
      const trash = event.target.closest("[data-inv-trash]");
      const eat = event.target.closest("[data-inv-eat]");
      const hover = event.target.closest(".smelter-slot");
      if (trash) trash.classList.add("is-drop-hover");
      else if (eat) {
        eat.classList.add("is-drop-hover");
        if (!isFoodItem(craftDrag.itemId) || !canAcceptFood(state)) {
          eat.classList.add("is-reject");
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
      const gridSlot = event.target.closest("[data-craft-grid]");
      const bagSlot = event.target.closest("[data-bag-slot]");
      const toInvArea = event.target.closest(".craft-station-col--inv");

      let changed = false;
      if (eat) {
        changed = eatFromCraftDrag(craftDrag);
        if (changed) renderHunger();
      } else if (trash) {
        changed = destroyDraggedStack(craftDrag);
      } else if (gridSlot && craftDrag.from === "bag") {
        changed =
          placeOneFromBagIntoCraftSlot(craftDrag.bagIndex, Number(gridSlot.dataset.craftGrid)) > 0;
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

  function isSmelterLit(tile) {
    const m = state?.machines?.find(
      (machine) => machine.type === "smelter" && machine.x === tile.x && machine.y === tile.y
    );
    if (!m) return false;
    ensureSmelterShape(m);
    // Furnace glow comes from heat energy (or fuel ready to burn while smelting).
    if (m.storedEnergy > 0) return true;
    return m.fuelCount > 0 && m.input.some((s) => s && getSmeltRecipe(s.id));
  }

  function tileClass(tile) {
    if (state && isInsideBase(state) && tile?.kind) {
      const tier = Math.max(1, Math.floor(Number(tile.tier) || 1));
      let cls = `tile tile--interior tile--interior-${tile.kind} tile--interior-t${tier}`;
      if (tile.room) cls += ` tile--room-${tile.room}`;
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
    if (state && isInsideBase(state) && tile?.kind) {
      if (tile.icon) return tile.icon;
      if (tile.kind === "exit") return "🚪";
      if (tile.kind === "upgrade") return "⬆";
      if (tile.kind === "wall") return "";
      return "";
    }
    if (tile.machine === "drill") return "🔩";
    if (tile.machine === "smelter") return "🔥";
    if (tile.machine === "generator") return "⚡";
    if (tile.machine === "powerPole") return "🗼";
    if (tile.machine === "cable") return "━";
    if (tile.machine === "craftingStation") return "🪚";
    if (tile.machine === "base") {
      const base = state ? findBaseMachine(state, tile.x, tile.y) : null;
      return getBaseTierInfo(base?.tier).icon || "🏠";
    }
    if (tile.machine === "deathCrate") return "📦";
    if (!tile.node) return "";
    if (tile.hp <= 0) return "·";
    const map = {
      tree: "🌳",
      rock: "🪨",
      coal: "⬛",
      iron: "🟠",
      copper: "🟤",
      carrot: "🥕",
    };
    return map[tile.node] || "?";
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
    grid.style.setProperty("--cols", cols);
    grid.classList.toggle("is-inside-base", inside);
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
      btn.innerHTML = `<span class="tile__icon">${tileLabel(tile)}</span>`;
      if (tile.x === px && tile.y === py) {
        btn.classList.add("tile--player");
        btn.insertAdjacentHTML(
          "beforeend",
          `<span class="tile__player" title="You" aria-label="You">🧑‍🔧</span>`
        );
      }
      const monster = inside ? null : monsterAt(state, tile.x, tile.y);
      if (monster) {
        btn.classList.add("tile--monster");
        const mLabel = GameData.monsters?.label || "Night Monster";
        const mIcon = GameData.monsters?.icon || "🧟";
        btn.insertAdjacentHTML(
          "beforeend",
          `<span class="tile__monster" title="${mLabel}" aria-label="${mLabel}">${mIcon}</span>`
        );
      }
      if (inside) {
        if (tile.kind === "exit") btn.title = "Front door — click to go outside";
        else if (tile.kind === "upgrade") {
          const base = findPlayerBase(state);
          const tier = Math.max(1, Math.floor(Number(base?.tier) || 1));
          const next = GameData.baseTiers?.[tier + 1];
          btn.title = next?.cost
            ? `Upgrade Room — bench (${formatCost(next.cost)})`
            : "Upgrade Room — fully upgraded";
        } else if (tile.kind === "wall") btn.title = "Wall";
        else if (tile.room === "bedroom") btn.title = "Bedroom — click to sleep";
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
        } else if (tile.machine === "powerPole") {
          btn.title = powered
            ? `Power Pole (live)${blocking}`
            : `Power Pole (no power)${blocking}`;
        } else if (tile.machine === "cable") {
          btn.title = powered ? `Power Line (live)${blocking}` : `Power Line (no power)${blocking}`;
        } else if (tile.machine === "craftingStation") {
          btn.title = `Crafting Table — click for 3×3 workbench${blocking}`;
        } else if (tile.machine === "base") {
          const onBase = isPlayerOnBase(state);
          const base = findBaseMachine(state, tile.x, tile.y);
          const name = getBaseTierInfo(base?.tier).name;
          btn.title = onBase
            ? `${name} — click to go inside${blocking}`
            : `${name} — stand on it, then click to go inside${blocking}`;
        } else if (tile.machine === "deathCrate") {
          const crate = state.machines.find(
            (machine) => machine.type === "deathCrate" && machine.x === tile.x && machine.y === tile.y
          );
          const n = Array.isArray(crate?.loot)
            ? crate.loot.reduce((sum, s) => sum + (s?.count || 0), 0)
            : 0;
          btn.title = `Death Crate — click to recover items (${n})${blocking}`;
        } else if (tile.machine === "smelter") {
          btn.title = isSmelterLit(tile)
            ? `Smelter (lit) — click to open${blocking}`
            : `Smelter (cold) — click to open, add log or coal for heat${blocking}`;
        } else if (GameData.powerConsumers.includes(tile.machine)) {
          btn.title = powered
            ? `${label} (powered)${blocking}`
            : `${label} (no power — connect generator)${blocking}`;
        } else {
          btn.title = `${label}${blocking}`;
        }
      } else if (tile.node && tile.hp <= 0) {
        const label = GameData.nodeTypes[tile.node]?.label || "Resource";
        btn.title = `Depleted ${label} — build here to block regrowth`;
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
    // Side hand-crafting panel removed — use Tab (2×2) or Crafting Table (3×3).
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
        leaveBaseInterior(state);
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

    // Standing on the Base + LMB → ask whether to go inside.
    if (!state.buildMode && tile.machine === "base" && isPlayerOnBase(state)) {
      promptBaseEnter();
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
      openCraftTableUi(x, y);
      return;
    }

    if (tile.machine === "deathCrate") {
      lootDeathCrate(state, tile);
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
    if (!state.unlockedTools.includes("hand")) state.unlockedTools.unshift("hand");
    if (!state.activeTool) state.activeTool = bestTool(state);

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
      bindRecipesUi();
      bindBuildUi();
      bindBaseEnterPrompt();
      bindSleepPrompt();
      bindPauseUi();
      bound = true;
    }

    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(tickWorldClock, 5000);

    playActive = true;
    gamePaused = false;
    resetClockHandTracking();
    advancementsSig = "";
    closeSmelterUi();
    closeGeneratorUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeRecipesUi();
    closeBuildUi();
    closeBaseEnterPrompt();
    closeSleepPrompt();
    closePauseUi();
    window.KeaghanSfx?.startMusic?.();
    render();
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    playActive = false;
    gamePaused = false;
    resetClockHandTracking();
    updateSkyBackground();
    window.KeaghanSfx?.stopMusic?.();
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
    closeRecipesUi();
    closeBuildUi();
    closeBaseEnterPrompt();
    closeSleepPrompt();
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
  };
})();

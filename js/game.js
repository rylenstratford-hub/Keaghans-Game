window.IslandFoundry = (() => {
  const SAVE_KEY_BASE = "keaghans-game-save-v1";
  const SLOT_COUNT = 5;
  const COLS = 12;
  const ROWS = 8;
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

    // Starter grove + rocks near spawn-ish center-left
    place(1, 2, "tree");
    place(2, 1, "tree");
    place(2, 3, "tree");
    place(3, 2, "tree");
    place(1, 5, "tree");
    place(4, 6, "rock");
    place(5, 5, "rock");
    place(5, 7, "rock");
    place(3, 5, "rock");
    place(6, 2, "coal");
    place(7, 1, "coal");
    place(8, 3, "iron");
    place(9, 2, "iron");
    place(9, 4, "iron");
    place(10, 5, "copper");
    place(11, 4, "copper");
    place(10, 6, "copper");

    return tiles;
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
      // Minutes past midnight (0 = 12:00 a.m.). New games start at 6:00 a.m.
      worldMinutes: 6 * 60,
    };
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
      const machines = (saved.machines || []).map((m) =>
        m?.type === "powerStation" ? { ...m, type: "craftingStation" } : m
      );
      const tiles = saved.tiles
        ? saved.tiles.map((t) =>
            t?.machine === "powerStation" ? { ...t, machine: "craftingStation" } : t
          )
        : fresh.tiles;

      const state = {
        ...fresh,
        ...saved,
        worldMinutes,
        inventory,
        machines,
        tiles,
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
      return state;
    } catch {
      return createState();
    }
  }

  function saveState(gameState) {
    if (gameState) ensureBag(gameState);
    const { _poweredTiles, toast, toastUntil, ...persist } = gameState;
    localStorage.setItem(saveKey(), JSON.stringify(persist));
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
      if (!cell || cell.id !== stack.id) continue;
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

  const DAWN_MINUTES = 6 * 60; // 6:00 a.m.

  /** 0 = 12:00 a.m. … 720 = 12:00 p.m. Minutes wrap at 1440. */
  function advanceWorldTime(gameState, minutes = 5) {
    const day = 24 * 60;
    const prev = ((gameState.worldMinutes || 0) % day + day) % day;
    gameState.worldMinutes = (prev + minutes) % day;
    if (crossedDawn(prev, gameState.worldMinutes)) {
      regrowNodesAtDawn(gameState);
    }
    tickSmelters(gameState, minutes);
  }

  function crossedDawn(prev, next) {
    // With +5 steps this is prev in [355..359] → next in [360..364].
    if (prev === next) return false;
    if (prev < next) return prev < DAWN_MINUTES && next >= DAWN_MINUTES;
    // Wrapped past midnight in one step — can't reach 6:00 a.m. in a single +5.
    return false;
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

  function renderClock() {
    if (!root || !state) return;
    const timeEl = root.querySelector("#clock-time");
    const handEl = root.querySelector("#clock-hand");
    const label = formatWorldTime(state.worldMinutes);
    if (timeEl) timeEl.textContent = label;
    if (handEl) {
      // Keep hub-centered pivot from CSS; only set rotation angle.
      handEl.style.transform = `translate(-50%, -100%) rotate(${clockHandDegrees(state.worldMinutes)}deg)`;
    }
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

  /**
   * All tools deal 1 damage by default.
   * Stone pick: 2 vs rock/coal.
   * Iron pick: 3 vs rock/coal, 2 vs iron/copper.
   */
  function harvestDamage(toolId, nodeType) {
    const soft = nodeType === "rock" || nodeType === "coal";
    const hard = nodeType === "iron" || nodeType === "copper";
    if (toolId === "ironPick") {
      if (soft) return 3;
      if (hard) return 2;
      return 1;
    }
    if (toolId === "stonePick" && soft) return 2;
    return 1;
  }

  /** Keep saved nodes on the 3-hit scale after balance changes. */
  function normalizeNodeHitPoints(gameState) {
    if (!gameState?.tiles) return;
    for (const tile of gameState.tiles) {
      if (!tile.node) continue;
      const def = GameData.nodeTypes[tile.node];
      if (!def) continue;
      tile.maxHp = def.hp;
      if (tile.hp > 0) tile.hp = Math.min(tile.hp, def.hp);
    }
  }

  function harvestTile(state, tile) {
    if (!tile.node || tile.machine) return false;
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
      return true;
    }

    window.KeaghanSfx?.playHarvest?.(nodeType, true);
    grantHarvest(state, def.resource, 3);
    // Stay depleted until 6:00 a.m. (blocked further if a machine sits here).
    tile.hp = 0;
    tile.respawn = null;
    return true;
  }

  function craft(state, recipeId, { fromStation = false } = {}) {
    const recipe = GameData.recipes.find((r) => r.id === recipeId);
    if (!recipe) return false;
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
    return true;
  }

  const PLACEABLE = ["drill", "smelter", "generator", "powerPole", "cable", "craftingStation"];
  const MACHINE_LABELS = {
    drill: "Drill",
    smelter: "Smelter",
    generator: "Coal Generator",
    powerPole: "Power Pole",
    cable: "Cable",
    craftingStation: "Crafting Table",
  };
  const BUILD_STRUCTURES = [
    "craftingStation",
    "smelter",
    "drill",
    "generator",
    "powerPole",
    "cable",
  ];
  const BUILD_HINTS = {
    craftingStation: "Click empty grass to build — costs 4 Planks (not on trees/ores)",
    smelter: "Click empty grass to build — costs Stone + Coal",
    drill: "Place on a resource node (ore/coal/rock/tree) — then power it",
    generator: "Click empty grass to build — needs Coal afterward for power",
    powerPole: "Click empty grass — costs Iron Ingot + Cable",
    cable: "Click empty grass — costs 1 Cable (Copper Wire is not power cable)",
    demolish: "Demolish locked (F) — click buildings to remove. F or a menu to exit.",
  };

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

  /** Clear grass only — trees / rocks / ores stay free. Drills must sit on a resource node. */
  function canPlaceOnTile(type, tile) {
    if (!tile || tile.machine) return { ok: false, reason: "Tile occupied" };
    if (type === "drill") {
      if (!tile.node) {
        return { ok: false, reason: "Drills must be placed on a resource node" };
      }
      return { ok: true };
    }
    if (tile.node) {
      const label = GameData.nodeTypes[tile.node]?.label || "resource";
      return { ok: false, reason: `Can't build on ${label} — clear grass only` };
    }
    return { ok: true };
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

  /** Two network buildings link if within the larger of their ranges. */
  function canPowerLink(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx === 0 && dy === 0) return false;
    const range = Math.max(powerLinkRange(a.type), powerLinkRange(b.type));
    if (range <= 1) return dx + dy === 1; // orthogonal adjacency only
    return Math.max(dx, dy) <= range; // stations: king-move reach
  }

  /** Fueled generators flood through adjacent cables/poles/stations into a powered set. */
  function computePoweredTiles(state) {
    const network = new Set(GameData.powerNetwork || []);
    const nodes = state.machines.filter((m) => network.has(m.type));
    const fueledGens = nodes.filter(
      (m) => m.type === "generator" && (state.inventory.coal || 0) > 0
    );
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
    // Power lines require crafted Cable — Copper Wire is only a crafting ingredient.
    if (type === "cable" && (state.inventory.cable || 0) < 1) {
      setToast(state, "Need Cable — craft it from Copper Wire at a Crafting Table");
      return false;
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
          ? "Drill placed — connect it with cables, poles, or a station"
          : "Drill placed (needs a resource node + power)"
      );
    } else if (type === "smelter") {
      state.machines.push(makeSmelterMachine(tile.x, tile.y));
      setToast(state, "Smelter placed — click it to open (log or coal for heat)");
    } else if (type === "generator") {
      state.machines.push({
        type: "generator",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 4,
      });
      setToast(
        state,
        (state.inventory.coal || 0) > 0
          ? "Generator online — run cables/poles to your machines"
          : "Generator placed — needs Coal in inventory for fuel"
      );
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
      setToast(state, "Cable laid — cheap wiring between buildings");
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

    // Stay in build mode until the player presses Q.
    return true;
  }

  function demolishMachine(state, tile) {
    if (!tile.machine) return false;
    const type = tile.machine;
    const machine = state.machines.find((m) => m.x === tile.x && m.y === tile.y);
    if (machine?.type === "smelter") returnSmelterContents(state, machine);
    if (machine?.type === "craftingStation") {
      ensureCraftTableShape(machine);
      returnGridToInv(machine.craftGrid);
    }
    if (openSmelter && openSmelter.x === tile.x && openSmelter.y === tile.y) closeSmelterUi();
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
    return true;
  }

  function tickMachines(state, dt) {
    const poweredTiles = computePoweredTiles(state);

    // Burn coal in each fueled generator on its interval while the grid is up.
    for (const m of state.machines) {
      if (m.type !== "generator") continue;
      if ((state.inventory.coal || 0) < 1) continue;
      m.timer += dt;
      if (m.timer < m.interval) continue;
      m.timer = 0;
      removeItem(state, "coal", 1);
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

  function updateGoals(state) {
    let changed = false;
    for (const goal of GameData.goals) {
      if (!state.goalsDone[goal.id] && goal.check(state)) {
        state.goalsDone[goal.id] = true;
        setToast(state, `Goal complete: ${goal.text}`);
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
  let openPlayerInv = false;
  let openCraftTable = null; // { x, y } of open crafting table
  let openBuildMenu = false;
  let gamePaused = false;
  let advancementsSig = "";
  let playerCraftGrid = [null, null, null, null];
  let craftDrag = null;
  let smelterDrag = null; // { from, itemId, count, outIndex? }
  let playActive = false;

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
    if (toastMsg) setToast(state, toastMsg);
  }

  function toggleDemolishMode() {
    if (!state || !playActive) return;
    closeSmelterUi();
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
    closeCraftTableUi();
    closeBuildUi();
    openPlayerInv = true;
    playerCraftGrid = normalizeCraftGrid(playerCraftGrid, 4);
    showModal("player-inv-modal");
    renderActiveBenchUi();
    renderHud();
    setToast(state, "Inventory — 2×2 pocket craft (Tab to close)");
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
    closePlayerInvUi();
    closeBuildUi();
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
    setToast(state, "Crafting Table — 3×3 workbench");
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
        closePlayerInvUi();
        closeCraftTableUi();
        selectBuildMode(BUILD_STRUCTURES[index]);
        return;
      }
    }

    if (event.key === "Tab") {
      event.preventDefault();
      togglePlayerInvUi();
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
    }
  }

  function closePauseUi() {
    gamePaused = false;
    hideModal("pause-modal");
  }

  function pauseGame() {
    if (!state || !playActive || gamePaused) return;
    closeSmelterUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeBuildUi();
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
      const cost = getBuildCost(id);
      const afford = canBuildStructure(state, id);
      const selected = state.buildMode === id;
      const costText = formatCost(cost);
      const costShort = Object.entries(cost)
        .map(([cid, n]) => `${n}${GameData.getItem(cid).icon}`)
        .join(" ");
      const hotkey = String(index + 1);
      return `<button type="button" class="smelter-slot build-slot${afford ? "" : " is-empty"}${selected ? " is-selected" : ""}" data-build-pick="${id}" title="${hotkey}: ${item.name}: ${costText}">
        <span class="build-slot__hotkey">${hotkey}</span>
        <span class="smelter-slot__icon">${item.icon}</span>
        <span class="build-slot__cost">${costShort}</span>
        <span class="build-slot__name">${item.name}</span>
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
          return `<button type="button" class="smelter-slot" data-bag-slot="${index}" draggable="true">${slotHtml(stack.id, stack.count)}</button>`;
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
        "[data-craft-grid], [data-bag-slot], .craft-station-col--inv, .craft-grid"
      );
      if (!drop) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      modal.querySelectorAll(".smelter-slot.is-drop-hover").forEach((el) => el.classList.remove("is-drop-hover"));
      const hover = event.target.closest(".smelter-slot");
      if (hover) hover.classList.add("is-drop-hover");
    });

    modal.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!craftDrag || !isOpen()) {
        craftDrag = null;
        return;
      }
      ensureBag(state);
      const gridSlot = event.target.closest("[data-craft-grid]");
      const bagSlot = event.target.closest("[data-bag-slot]");
      const toInvArea = event.target.closest(".craft-station-col--inv");

      let changed = false;
      if (gridSlot && craftDrag.from === "bag") {
        changed = pushToActiveGridFromBag(craftDrag.bagIndex, craftDrag.count) > 0;
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
        .querySelectorAll(".is-drag-source, .is-drop-hover")
        .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover"));
    });

    modal.addEventListener("dragend", () => {
      craftDrag = null;
      modal.classList.remove("is-dragging");
      modal
        .querySelectorAll(".is-drag-source, .is-drop-hover")
        .forEach((el) => el.classList.remove("is-drag-source", "is-drop-hover"));
    });
  }

  function bindPlayerInvUi() {
    bindBenchModal("player-inv-modal", "data-player-inv-close", () => openPlayerInv);
  }

  function bindCraftTableUi() {
    bindBenchModal("craft-table-modal", "data-craft-table-close", () => Boolean(openCraftTable));
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
    const key = tileKey(tile.x, tile.y);
    const onGrid = poweredTilesCache.has(key);

    if (tile.machine === "generator") {
      return `tile tile--generator${(state.inventory.coal || 0) > 0 ? " is-powered" : " is-unpowered"}`;
    }
    if (tile.machine === "powerPole") {
      return `tile tile--pole${onGrid ? " is-powered" : " is-unpowered"}`;
    }
    if (tile.machine === "cable") {
      return `tile tile--cable${onGrid ? " is-powered" : " is-unpowered"}`;
    }
    if (tile.machine === "craftingStation") {
      return "tile tile--craft-station";
    }
    if (tile.machine === "drill") {
      return `tile tile--drill${onGrid ? " is-powered" : " is-unpowered"}`;
    }
    if (tile.machine === "smelter") {
      return `tile tile--smelter${isSmelterLit(tile) ? " is-lit" : " is-cold"}`;
    }
    if (!tile.node) return "tile tile--grass";
    if (tile.hp <= 0) return `tile tile--${tile.node} tile--depleted`;
    return `tile tile--${tile.node}`;
  }

  function tileLabel(tile) {
    if (tile.machine === "drill") return "🔩";
    if (tile.machine === "smelter") return "🔥";
    if (tile.machine === "generator") return "⚡";
    if (tile.machine === "powerPole") return "🗼";
    if (tile.machine === "cable") return "━";
    if (tile.machine === "craftingStation") return "🪚";
    if (!tile.node) return "";
    if (tile.hp <= 0) return "·";
    const map = { tree: "🌳", rock: "🪨", coal: "⬛", iron: "🟠", copper: "🟤" };
    return map[tile.node] || "?";
  }

  function refreshTilePowerStyles() {
    if (!root) return;
    const grid = root.querySelector("#world-grid");
    if (!grid) return;
    for (const btn of grid.querySelectorAll(".tile")) {
      const x = Number(btn.dataset.x);
      const y = Number(btn.dataset.y);
      const tile = state.tiles[y * COLS + x];
      if (!tile) continue;
      const next = tileClass(tile);
      // Only touch className when it changes — rewriting every frame restarts CSS animations.
      if (btn.className !== next) btn.className = next;
    }
  }

  function renderWorld() {
    const grid = root.querySelector("#world-grid");
    grid.style.setProperty("--cols", COLS);
    grid.innerHTML = "";
    for (const tile of state.tiles) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = tileClass(tile);
      btn.dataset.x = tile.x;
      btn.dataset.y = tile.y;
      if (tile.machine) btn.dataset.machine = tile.machine;
      btn.innerHTML = `<span class="tile__icon">${tileLabel(tile)}</span>`;
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
        if (tile.machine === "generator") {
          btn.title =
            (state.inventory.coal || 0) > 0
              ? "Coal Generator (burning fuel)"
              : "Coal Generator (needs Coal)";
        } else if (tile.machine === "powerPole") {
          btn.title = powered ? "Power Pole (live)" : "Power Pole (no power)";
        } else if (tile.machine === "cable") {
          btn.title = powered ? "Cable (live)" : "Cable (no power)";
        } else if (tile.machine === "craftingStation") {
          btn.title = "Crafting Table — click for 3×3 workbench";
        } else if (tile.machine === "smelter") {
          btn.title = isSmelterLit(tile)
            ? "Smelter (lit) — click to open"
            : "Smelter (cold) — click to open, add log or coal for heat";
        } else if (GameData.powerConsumers.includes(tile.machine)) {
          btn.title = powered ? `${label} (powered)` : `${label} (no power — connect generator)`;
        } else {
          btn.title = label;
        }
      } else {
        btn.title = "Empty ground";
      }
      grid.appendChild(btn);
    }
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
      else if (!state.buildMode) buildEl.textContent = "Build: off (Q) · Demolish: F";
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
    const tile = state.tiles[y * COLS + x];

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

    if (tile.machine === "craftingStation") {
      openCraftTableUi(x, y);
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
    renderClock();
    if (openSmelter) renderSmelterUi();
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
    }
    if (!state.unlockedTools.includes("hand")) state.unlockedTools.unshift("hand");
    if (!state.activeTool) state.activeTool = bestTool(state);

    if (!bound) {
      root.querySelector("#world-grid").addEventListener("click", onWorldClick);
      root.addEventListener("click", onPanelClick);
      document.addEventListener("keydown", onPlayKeyDown);
      bindSmelterUi();
      bindPlayerInvUi();
      bindCraftTableUi();
      bindBuildUi();
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
    closePlayerInvUi();
    closeCraftTableUi();
    closeBuildUi();
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
    window.KeaghanSfx?.stopMusic?.();
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = 0;
    }
    closeSmelterUi();
    closePlayerInvUi();
    closeCraftTableUi();
    closeBuildUi();
    closePauseUi();
    if (state) saveState(state);
  }

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

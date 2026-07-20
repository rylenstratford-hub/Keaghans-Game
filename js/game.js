window.IslandFoundry = (() => {
  const SAVE_KEY = "keaghans-game-save-v1";
  const COLS = 12;
  const ROWS = 8;
  const { GameData } = window;

  function emptyInv() {
    const inv = {};
    for (const id of Object.keys(GameData.items)) inv[id] = 0;
    return inv;
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
      unlockedTools: ["hand"],
      activeTool: "hand",
      buildMode: null, // null | "drill" | "smelter"
      tiles: makeWorld(),
      machines: [],
      stats: { gathered: {}, smelted: {}, drilled: 0 },
      goalsDone: {},
      toast: "",
      toastUntil: 0,
      startedAt: Date.now(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createState();
      const saved = JSON.parse(raw);
      const fresh = createState();
      return {
        ...fresh,
        ...saved,
        inventory: { ...fresh.inventory, ...saved.inventory },
        stats: {
          gathered: { ...saved.stats?.gathered },
          smelted: { ...saved.stats?.smelted },
          drilled: saved.stats?.drilled || 0,
        },
      };
    } catch {
      return createState();
    }
  }

  function saveState(state) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function canAfford(state, cost) {
    return Object.entries(cost).every(([id, n]) => (state.inventory[id] || 0) >= n);
  }

  function spend(state, cost) {
    for (const [id, n] of Object.entries(cost)) state.inventory[id] -= n;
  }

  function addItem(state, id, count) {
    state.inventory[id] = (state.inventory[id] || 0) + count;
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

  function harvestTile(state, tile) {
    if (!tile.node || tile.machine) return false;
    const def = GameData.nodeTypes[tile.node];
    const toolId = state.activeTool;
    const tool = GameData.tools[toolId] || GameData.tools.hand;
    tile.hp -= tool.power;
    if (tile.hp > 0) {
      setToast(state, `${def.label}… ${tile.hp}/${tile.maxHp}`);
      return true;
    }

    const gained = def.yield + (tool.yieldBonus || 0);
    addItem(state, def.resource, gained);
    state.stats.gathered[def.resource] = (state.stats.gathered[def.resource] || 0) + gained;
    setToast(state, `+${gained} ${GameData.getItem(def.resource).name}`);

    // Nodes respawn depleted for a bit, then refill
    tile.hp = 0;
    tile.respawn = 8;
    return true;
  }

  function craft(state, recipeId) {
    const recipe = GameData.recipes.find((r) => r.id === recipeId);
    if (!recipe) return false;
    if (recipe.requires?.some((r) => !state.unlockedTools.includes(r) && (state.inventory[r] || 0) < 1)) {
      // require prior tool unlocks when listed as tool ids
      const missing = recipe.requires.filter((r) => !state.unlockedTools.includes(r));
      if (missing.length) {
        setToast(state, "Craft earlier tools first");
        return false;
      }
    }
    if (!canAfford(state, recipe.cost)) {
      setToast(state, "Need more materials");
      return false;
    }
    spend(state, recipe.cost);
    addItem(state, recipe.output.id, recipe.output.count);
    if (recipe.unlocksTool && !state.unlockedTools.includes(recipe.unlocksTool)) {
      state.unlockedTools.push(recipe.unlocksTool);
      state.activeTool = recipe.unlocksTool;
      setToast(state, `Equipped ${recipe.name}!`);
    } else {
      setToast(state, `Crafted ${recipe.name}`);
    }
    return true;
  }

  function placeMachine(state, tile, type) {
    if (tile.machine) {
      setToast(state, "Tile occupied");
      return false;
    }
    if (type === "drill") {
      if (!tile.node || !["iron", "copper", "coal"].includes(tile.node)) {
        setToast(state, "Drills go on Iron, Copper, or Coal");
        return false;
      }
      if ((state.inventory.drill || 0) < 1) {
        setToast(state, "Craft a Drill first");
        return false;
      }
      state.inventory.drill -= 1;
      tile.machine = "drill";
      state.machines.push({
        type: "drill",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 1.4,
        resource: GameData.nodeTypes[tile.node].resource,
      });
      setToast(state, "Drill online — gathering!");
      state.buildMode = null;
      return true;
    }

    if (type === "smelter") {
      if (tile.kind !== "grass" && tile.node) {
        setToast(state, "Clear ground for Smelter");
        return false;
      }
      if (tile.node) {
        setToast(state, "Smelters need empty ground");
        return false;
      }
      if ((state.inventory.smelter || 0) < 1) {
        setToast(state, "Craft a Smelter first");
        return false;
      }
      state.inventory.smelter -= 1;
      tile.kind = "machine";
      tile.machine = "smelter";
      state.machines.push({
        type: "smelter",
        x: tile.x,
        y: tile.y,
        timer: 0,
        interval: 2.4,
        recipeIndex: 0,
      });
      setToast(state, "Smelter ready — feed it ore!");
      state.buildMode = null;
      return true;
    }
    return false;
  }

  function tickMachines(state, dt) {
    for (const m of state.machines) {
      m.timer += dt;
      if (m.timer < m.interval) continue;
      m.timer = 0;

      if (m.type === "drill") {
        addItem(state, m.resource, 1);
        state.stats.drilled += 1;
        state.stats.gathered[m.resource] = (state.stats.gathered[m.resource] || 0) + 1;
      }

      if (m.type === "smelter") {
        const recipe =
          GameData.smeltRecipes.find((r) => (state.inventory[r.input] || 0) > 0) || null;
        if (!recipe) continue;
        state.inventory[recipe.input] -= 1;
        addItem(state, recipe.output, 1);
        state.stats.smelted[recipe.output] = (state.stats.smelted[recipe.output] || 0) + 1;
      }
    }

    // Respawn harvested nodes
    for (const tile of state.tiles) {
      if (tile.node && tile.hp <= 0 && !tile.machine && tile.respawn != null) {
        tile.respawn -= dt;
        if (tile.respawn <= 0) {
          const def = GameData.nodeTypes[tile.node];
          tile.hp = def.hp;
          tile.maxHp = def.hp;
          tile.respawn = null;
        }
      }
    }
  }

  function updateGoals(state) {
    for (const goal of GameData.goals) {
      if (!state.goalsDone[goal.id] && goal.check(state)) {
        state.goalsDone[goal.id] = true;
        setToast(state, `Goal complete: ${goal.text}`);
      }
    }
  }

  function currentGoal(state) {
    return GameData.goals.find((g) => !state.goalsDone[g.id]) || null;
  }

  // --- UI wiring ---
  let state = null;
  let raf = 0;
  let last = 0;
  let root = null;
  let bound = false;

  function tileClass(tile) {
    if (tile.machine === "drill") return "tile tile--drill";
    if (tile.machine === "smelter") return "tile tile--smelter";
    if (!tile.node) return "tile tile--grass";
    if (tile.hp <= 0) return `tile tile--${tile.node} tile--depleted`;
    return `tile tile--${tile.node}`;
  }

  function tileLabel(tile) {
    if (tile.machine === "drill") return "🔩";
    if (tile.machine === "smelter") return "🔥";
    if (!tile.node) return "";
    if (tile.hp <= 0) return "·";
    const map = { tree: "🌳", rock: "🪨", coal: "⬛", iron: "🟠", copper: "🟤" };
    return map[tile.node] || "?";
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
      btn.innerHTML = `<span class="tile__icon">${tileLabel(tile)}</span>`;
      if (tile.node && tile.hp > 0 && !tile.machine) {
        btn.title = `${GameData.nodeTypes[tile.node].label} (${tile.hp}/${tile.maxHp})`;
      } else if (tile.machine) {
        btn.title = tile.machine === "drill" ? "Drill (auto-mining)" : "Smelter (auto-smelting)";
      } else {
        btn.title = "Empty ground";
      }
      grid.appendChild(btn);
    }
  }

  function renderInventory() {
    const el = root.querySelector("#inventory-list");
    const show = Object.entries(state.inventory).filter(([, n]) => n > 0);
    if (!show.length) {
      el.innerHTML = `<li class="inv-empty">Empty — click trees and rocks!</li>`;
      return;
    }
    el.innerHTML = show
      .map(([id, n]) => {
        const item = GameData.getItem(id);
        return `<li class="inv-item" title="${item.name}"><span>${item.icon}</span><b>${n}</b><em>${item.name}</em></li>`;
      })
      .join("");
  }

  function renderCraft() {
    const el = root.querySelector("#craft-list");
    el.innerHTML = GameData.recipes
      .map((recipe) => {
        const ok = canAfford(state, recipe.cost);
        const locked =
          recipe.requires?.some((r) => !state.unlockedTools.includes(r)) ?? false;
        const cost = Object.entries(recipe.cost)
          .map(([id, n]) => `${n} ${GameData.getItem(id).name}`)
          .join(", ");
        const out = GameData.getItem(recipe.output.id);
        return `<button type="button" class="craft-btn ${ok && !locked ? "is-ready" : ""}" data-craft="${recipe.id}" ${locked ? "disabled" : ""}>
          <span class="craft-btn__icon">${out.icon}</span>
          <span class="craft-btn__body">
            <strong>${recipe.name}</strong>
            <small>${locked ? "Locked — craft earlier tools" : cost}</small>
          </span>
          <span class="craft-btn__out">×${recipe.output.count}</span>
        </button>`;
      })
      .join("");
  }

  function renderHud() {
    const tool = state.activeTool;
    const toolName = tool === "hand" ? "Hand" : GameData.getItem(tool).name;
    root.querySelector("#hud-tool").textContent = toolName;
    root.querySelector("#hud-build").textContent = state.buildMode
      ? `Build: ${state.buildMode}`
      : "Build: off";

    const goal = currentGoal(state);
    root.querySelector("#hud-goal").textContent = goal
      ? `Goal: ${goal.text}`
      : "All starter goals complete — keep expanding!";

    const toast = root.querySelector("#game-toast");
    if (performance.now() < state.toastUntil && state.toast) {
      toast.textContent = state.toast;
      toast.hidden = false;
    } else {
      toast.hidden = true;
    }

    root.querySelector("#btn-build-drill").classList.toggle("is-active", state.buildMode === "drill");
    root.querySelector("#btn-build-smelter").classList.toggle(
      "is-active",
      state.buildMode === "smelter"
    );
    root.querySelector("#btn-build-drill").disabled = (state.inventory.drill || 0) < 1;
    root.querySelector("#btn-build-smelter").disabled = (state.inventory.smelter || 0) < 1;
  }

  function render() {
    if (!root || !state) return;
    renderWorld();
    renderInventory();
    renderCraft();
    renderHud();
  }

  function onWorldClick(event) {
    const btn = event.target.closest(".tile");
    if (!btn) return;
    const x = Number(btn.dataset.x);
    const y = Number(btn.dataset.y);
    const tile = state.tiles[y * COLS + x];

    if (state.buildMode) {
      placeMachine(state, tile, state.buildMode);
    } else {
      harvestTile(state, tile);
    }
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
      return;
    }

    const action = event.target.closest("[data-game]")?.dataset.game;
    if (!action) return;

    if (action === "tool-cycle") {
      const tools = state.unlockedTools;
      const i = tools.indexOf(state.activeTool);
      state.activeTool = tools[(i + 1) % tools.length];
      setToast(state, `Tool: ${state.activeTool === "hand" ? "Hand" : GameData.getItem(state.activeTool).name}`);
    }
    if (action === "build-drill") {
      state.buildMode = state.buildMode === "drill" ? null : "drill";
      setToast(state, state.buildMode ? "Select Iron/Copper/Coal for Drill" : "Build mode off");
    }
    if (action === "build-smelter") {
      state.buildMode = state.buildMode === "smelter" ? null : "smelter";
      setToast(state, state.buildMode ? "Select empty ground for Smelter" : "Build mode off");
    }
    if (action === "reset") {
      if (confirm("Reset Island Foundry progress?")) {
        localStorage.removeItem(SAVE_KEY);
        state = createState();
        setToast(state, "New island ready");
      }
    }
    saveState(state);
    render();
  }

  function loop(ts) {
    if (!state) return;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    tickMachines(state, dt);
    updateGoals(state);
    renderHud();
    // Light inventory refresh while machines run
    if (state.machines.length) renderInventory();
    raf = requestAnimationFrame(loop);
  }

  function mount(playRoot) {
    root = playRoot;
    state = loadState();
    if (!state.unlockedTools.includes("hand")) state.unlockedTools.unshift("hand");
    if (!state.activeTool) state.activeTool = bestTool(state);

    if (!bound) {
      root.querySelector("#world-grid").addEventListener("click", onWorldClick);
      root.addEventListener("click", onPanelClick);
      bound = true;
    }

    render();
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function unmount() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (state) saveState(state);
  }

  return { mount, unmount, save: () => state && saveState(state) };
})();

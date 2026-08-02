window.GameData = {
  items: {
    log: { id: "log", name: "Log", icon: "🪵", color: "#8b5a2b" },
    plank: { id: "plank", name: "Planks", icon: "🟫", color: "#c4a06a" },
    stone: { id: "stone", name: "Stone", icon: "🪨", color: "#8a93a0" },
    coal: { id: "coal", name: "Coal", icon: "⬛", color: "#3a3a3a" },
    ironOre: { id: "ironOre", name: "Iron Ore", icon: "🟠", color: "#c47a4a" },
    copperOre: { id: "copperOre", name: "Copper Ore", icon: "🟤", color: "#b87333" },
    ironIngot: { id: "ironIngot", name: "Iron Ingot", icon: "⬜", color: "#cfd6de" },
    copperIngot: { id: "copperIngot", name: "Copper Ingot", icon: "🟧", color: "#d9894b" },
    stick: { id: "stick", name: "Stick", icon: "/", color: "#a67c52" },
    woodPick: { id: "woodPick", name: "Wood Pick", icon: "⛏", color: "#c4a574" },
    stonePick: { id: "stonePick", name: "Stone Pick", icon: "⛏", color: "#9aa3ad" },
    ironPick: { id: "ironPick", name: "Iron Pick", icon: "⛏", color: "#d7dde4" },
    ironSword: { id: "ironSword", name: "Iron Sword", icon: "⚔", color: "#d7dde4" },
    drill: { id: "drill", name: "Drill", icon: "🔩", color: "#5ec4a8" },
    smelter: { id: "smelter", name: "Smelter", icon: "🔥", color: "#e29a3a" },
    gear: { id: "gear", name: "Gear", icon: "⚙️", color: "#9db0bf" },
    generator: { id: "generator", name: "Coal Generator", icon: "⚡", color: "#f0b429" },
    copperWire: {
      id: "copperWire",
      name: "Copper Wire",
      icon: "〰️",
      color: "#c9854a",
    },
    cable: {
      id: "cable",
      name: "Cable",
      icon: "━",
      color: "#4a6a8a",
    },
    powerPole: { id: "powerPole", name: "Power Pole", icon: "🗼", color: "#7ec8ff" },
    craftingStation: {
      id: "craftingStation",
      name: "Crafting Table",
      icon: "🪚",
      color: "#b8894a",
    },
    base: {
      id: "base",
      name: "Base",
      icon: "🏠",
      color: "#8a9bb0",
    },
    apple: {
      id: "apple",
      name: "Apple",
      icon: "🍎",
      color: "#c23b3b",
      food: true,
    },
    carrot: {
      id: "carrot",
      name: "Carrot",
      icon: "🥕",
      color: "#e67a2e",
      food: true,
    },
  },

  /**
   * Hunger: 10_000 max. 100 points = 1%.
   * Hit / craft / place / demolish each cost 50. Every 5 in-game minutes drains 5.
   * Any food restores 10% hunger + 10% HP. Warn at 5% (500 points).
   */
  hunger: {
    max: 10000,
    hitCost: 50,
    actionCost: 50,
    passivePerFiveMinutes: 5,
    warnPercent: 5,
    foodRestorePercent: 10,
    pointsPerPercent: 100,
  },

  /**
   * Health: 10_000 max (same scale as hunger).
   * Starving (0 hunger) drains 1% max HP each clock tick; well-fed (>50% hunger) regenerates.
   * Food restores 10% HP. At 0 HP you die — items go in a death crate; respawn with partial vitals.
   */
  health: {
    max: 10000,
    pointsPerPercent: 100,
    warnPercent: 5,
    foodRestorePercent: 10,
    starvePercentPerFiveMinutes: 1,
    regenPerFiveMinutes: 10,
    regenHungerPercent: 50,
    respawnHealthPercent: 50,
    respawnHungerPercent: 40,
  },

  /**
   * Night monsters: spawn at 6:00 p.m., flee at 6:00 a.m.
   * Chase the player; deal HP damage each clock tick while in 3×3 reach.
   * 20 HP each. Fist = 1 damage; Iron Sword = one-shot.
   */
  monsters: {
    count: 3,
    maxHp: 20,
    fistDamage: 1,
    swordDamage: 20,
    damagePercentPerFiveMinutes: 2,
    icon: "🧟",
    label: "Night Monster",
    swordTool: "ironSword",
  },

  getItem(id) {
    return this.items[id] || { id, name: id, icon: "?", color: "#888" };
  },

  /**
   * Codex entries for the E recipes browser.
   * how = how to make or get it; uses = what it’s for.
   */
  itemGuide: {
    log: {
      how: "Chop Trees on the island with your Hand (or any tool).",
      uses: "Craft Planks in Tab inventory. Can also fuel a Smelter.",
    },
    plank: {
      how: "Craft from 1 Log in Tab inventory (2×2 pocket craft).",
      uses: "Craft Sticks, build a Crafting Table (Q), and fuel a Smelter.",
    },
    stick: {
      how: "Craft from 2 Planks in Tab inventory.",
      uses: "Used with Planks to craft a Wood Pick at a Crafting Table.",
    },
    stone: {
      how: "Mine Rock nodes (needs Wood Pick or better).",
      uses: "Craft a Stone Pick, and build Smelters, Generators, and Power Poles (Q).",
    },
    coal: {
      how: "Mine Coal ore nodes on the island (needs Wood Pick or better).",
      uses: "Fuel for Smelters and Coal Generators.",
    },
    ironOre: {
      how: "Mine Iron nodes (needs Stone Pick or better), or gather with a powered Drill.",
      uses: "Smelt into Iron Ingots in a Smelter (needs fuel).",
    },
    copperOre: {
      how: "Mine Copper nodes (needs Stone Pick or better), or gather with a powered Drill.",
      uses: "Smelt into Copper Ingots in a Smelter (needs fuel).",
    },
    ironIngot: {
      how: "Smelt Iron Ore in a Smelter with fuel (Log, Planks, or Coal).",
      uses: "Craft Gears and Iron Picks; build Drills, Generators, and Power Poles (Q).",
    },
    copperIngot: {
      how: "Smelt Copper Ore in a Smelter with fuel (Log, Planks, or Coal).",
      uses: "Craft Copper Wire; build Drills and Coal Generators (Q).",
    },
    woodPick: {
      how: "Craft at a Crafting Table from 3 Planks + 2 Sticks.",
      uses: "Mine Rock and Coal. Required before stronger picks.",
    },
    stonePick: {
      how: "Craft at a Crafting Table from 8 Stone + 1 Wood Pick.",
      uses: "Mine Iron and Copper ore. Upgrade path to Iron Pick.",
    },
    ironPick: {
      how: "Craft at a Crafting Table from 8 Iron Ingots + 1 Stone Pick.",
      uses: "Strongest pick — mines every resource node.",
    },
    ironSword: {
      how: "Craft at a Crafting Table from 2 Iron Ingots + 1 Stick (vertical sword shape).",
      uses: "Equip in Tab → Tools. One-shots night monsters (fists only deal 1 of their 20 HP).",
    },
    gear: {
      how: "Craft at a Crafting Table from 2 Iron Ingots.",
      uses: "Build Drills (Q).",
    },
    copperWire: {
      how: "Craft at a Crafting Table from 1 Copper Ingot.",
      uses: "Craft Cable — place 2 Copper Wire side by side horizontally.",
    },
    cable: {
      how: "Craft at a Crafting Table: 2 Copper Wire in a horizontal row → 1 Cable.",
      uses: "Place with Q as a Power Line to wire Generators (output) to Drills/Smelters (input). Crafting Tables have no power ports.",
    },
    craftingStation: {
      how: "Build with Q using 4 Planks.",
      uses: "3×3 crafting for advanced recipes (picks, gears, wire, Cable). No power connection.",
    },
    base: {
      how: "Build with Q using 50 Planks (5×3, click top-left). Upgrade inside: 30 Stone → Stone Base, then 30 Iron Ingots → Iron Base.",
      uses: "Safe yard — monsters can't enter. Stand on it and left-click to enter a 10×10 indoor map (kitchen NW, upgrade north, living NE, storage SW, bedroom SE, hall elsewhere, doors east). Click the bedroom at night to sleep until 6:00 a.m.",
    },
    smelter: {
      how: "Build with Q using 8 Stone + 2 Coal.",
      uses: "Smelt ores into ingots. Burns Log, Planks, or Coal for heat.",
    },
    generator: {
      how: "Build with Q using Iron Ingots, Copper Ingots, Stone, and Coal.",
      uses: "Burns Coal to make power for Drills (connect with Power Lines / Power Poles).",
    },
    powerPole: {
      how: "Build with Q using 1 Iron Ingot + 1 Cable.",
      uses: "Extends the power network so machines farther apart can connect.",
    },
    drill: {
      how: "Build with Q using Iron Ingots, Gears, and Copper Ingots. Place on a resource node.",
      uses: "Automatically gathers ore when powered by a Coal Generator through Power Lines/Poles.",
    },
    apple: {
      how: "Sometimes drops when you chop Trees.",
      uses: "Food — drag onto Eat in inventory (no right-click). Restores 10% hunger and 10% HP. Can't eat at 90%+ food.",
    },
    carrot: {
      how: "Harvest Carrot plants on the island (Hand works — 1 hit).",
      uses: "Food — drag onto Eat in inventory (no right-click). Restores 10% hunger and 10% HP. Can't eat at 90%+ food.",
    },
  },

  getItemGuide(id) {
    return this.itemGuide[id] || null;
  },

  nodeTypes: {
    tree: { resource: "log", label: "Tree", hp: 5, yield: 1, minTool: "hand" },
    rock: { resource: "stone", label: "Rock", hp: 5, yield: 1, minTool: "woodPick" },
    coal: { resource: "coal", label: "Coal", hp: 5, yield: 1, minTool: "woodPick" },
    iron: { resource: "ironOre", label: "Iron", hp: 5, yield: 1, minTool: "stonePick" },
    copper: { resource: "copperOre", label: "Copper", hp: 5, yield: 1, minTool: "stonePick" },
    carrot: { resource: "carrot", label: "Carrot", hp: 1, yield: 1, minTool: "hand" },
  },

  /** Higher number = stronger tool. */
  toolTier: {
    hand: 0,
    woodPick: 1,
    stonePick: 2,
    ironPick: 3,
    ironSword: 0,
  },

  /** Base strike power — all tools deal 1 damage (5 hits to clear a node). */
  tools: {
    hand: { power: 1, yieldBonus: 0 },
    woodPick: { power: 1, yieldBonus: 0 },
    stonePick: { power: 1, yieldBonus: 0 },
    ironPick: { power: 1, yieldBonus: 0 },
    ironSword: { power: 1, yieldBonus: 0 },
  },

  recipes: [
    {
      id: "plank",
      name: "Planks",
      output: { id: "plank", count: 4 },
      cost: { log: 1 },
      // 2×2 layout (row-major). null = empty cell.
      layout: ["log", null, null, null],
    },
    {
      id: "stick",
      name: "Stick",
      output: { id: "stick", count: 4 },
      cost: { plank: 2 },
      layout: ["plank", null, "plank", null],
    },
    {
      id: "woodPick",
      name: "Wood Pick",
      output: { id: "woodPick", count: 1 },
      cost: { plank: 3, stick: 2 },
      unlocksTool: "woodPick",
      atStation: true,
      // 3×3 pickaxe shape
      layout: ["plank", "plank", "plank", null, "stick", null, null, "stick", null],
    },
    {
      id: "stonePick",
      name: "Stone Pick",
      output: { id: "stonePick", count: 1 },
      // Wood pick in the center, stone filling every other cell.
      cost: { stone: 8, woodPick: 1 },
      unlocksTool: "stonePick",
      atStation: true,
      layout: [
        "stone",
        "stone",
        "stone",
        "stone",
        "woodPick",
        "stone",
        "stone",
        "stone",
        "stone",
      ],
    },
    {
      id: "gear",
      name: "Gear",
      output: { id: "gear", count: 1 },
      cost: { ironIngot: 2 },
      atStation: true,
      layout: ["ironIngot", "ironIngot", null, null, null, null, null, null, null],
    },
    {
      id: "ironPick",
      name: "Iron Pick",
      output: { id: "ironPick", count: 1 },
      // Stone pick in the center, iron ingots all around.
      cost: { ironIngot: 8, stonePick: 1 },
      unlocksTool: "ironPick",
      atStation: true,
      layout: [
        "ironIngot",
        "ironIngot",
        "ironIngot",
        "ironIngot",
        "stonePick",
        "ironIngot",
        "ironIngot",
        "ironIngot",
        "ironIngot",
      ],
    },
    {
      id: "ironSword",
      name: "Iron Sword",
      output: { id: "ironSword", count: 1 },
      cost: { ironIngot: 2, stick: 1 },
      unlocksTool: "ironSword",
      atStation: true,
      // Vertical sword: 2 Iron Ingots over 1 Stick
      layout: [
        null,
        "ironIngot",
        null,
        null,
        "ironIngot",
        null,
        null,
        "stick",
        null,
      ],
    },
    {
      id: "copperWire",
      name: "Copper Wire",
      output: { id: "copperWire", count: 2 },
      cost: { copperIngot: 1 },
      atStation: true,
      layout: ["copperIngot", null, null, null, null, null, null, null, null],
    },
    {
      id: "cable",
      name: "Cable",
      output: { id: "cable", count: 1 },
      cost: { copperWire: 2 },
      atStation: true,
      // Two Copper Wire side-by-side horizontally → 1 Cable
      layout: ["copperWire", "copperWire", null, null, null, null, null, null, null],
    },
  ],

  /**
   * Satisfactory-style construction: Q-build spends these materials on place.
   * Craft Cable, then place it as a Power Line (buildable).
   * Copper Wire is NOT Cable — craft Cable first.
   */
  buildCosts: {
    craftingStation: { plank: 4 },
    smelter: { stone: 8, coal: 2 },
    drill: { ironIngot: 4, gear: 2, copperIngot: 2 },
    generator: { ironIngot: 5, copperIngot: 3, stone: 6, cable: 2 },
    powerPole: { ironIngot: 1, cable: 1 },
    // Explicit: only the Cable item. Never copperWire.
    cable: { cable: 1 },
    base: { plank: 50 },
  },

  /**
   * Base tiers: build at 1 (Wood), upgrade to 2 (Stone), then 3 (Iron).
   * upgradeFrom is the tier you must have to buy the next.
   */
  baseTiers: {
    1: { name: "Wood Base", icon: "🏠", label: "Wood" },
    2: {
      name: "Stone Base",
      icon: "🛖",
      label: "Stone",
      upgradeFrom: 1,
      cost: { stone: 30 },
    },
    3: {
      name: "Iron Base",
      icon: "🏰",
      label: "Iron",
      upgradeFrom: 2,
      cost: { ironIngot: 30 },
    },
  },

  /** Multi-tile footprints (origin = top-left click). */
  structureSize: {
    base: { w: 5, h: 3 },
  },

  smeltRecipes: [
    { input: "ironOre", output: "ironIngot", minutes: 10 },
    { input: "copperOre", output: "copperIngot", minutes: 15 },
  ],

  smelter: {
    inputSlots: 15,
    outputSlots: 5,
    stackMax: 50, // machine stacks (input/fuel/output); pockets have no limit
    // In-game heat-minutes per fuel item. Log burns 5 minutes shorter than coal.
    fuelEnergy: {
      coal: 20,
      log: 15,
      plank: 5,
    },
  },

  /** Buildings that consume grid power to operate. */
  powerConsumers: ["drill"],

  /**
   * Power network (Crafting Tables never join):
   * - Outputs supply power (generators)
   * - Inputs draw power (drills; smelters sit on the grid for wiring)
   * - Conductors (Power Lines, poles) bridge building ↔ building
   */
  powerOutputs: ["generator"],
  powerInputs: ["drill", "smelter"],
  powerConductors: ["cable", "powerPole"],
  powerNetwork: ["generator", "cable", "powerPole", "drill", "smelter"],

  /** Chebyshev link range for network buildings (default 1 = adjacent). */
  powerLinkRange: {
    cable: 1,
    powerPole: 1,
    generator: 1,
    drill: 1,
    smelter: 1,
  },

  goals: [
    {
      id: "gatherWood",
      text: "Chop 5 Logs from trees",
      check: (s) => (s.stats.gathered.log || 0) + (s.stats.gathered.wood || 0) >= 5,
    },
    {
      id: "craftPlanks",
      text: "Craft Planks from a Log (Tab)",
      check: (s) => (s.stats.crafted?.plank || 0) >= 1,
    },
    {
      id: "placeCraftStation",
      text: "Build a Crafting Table (Q — 4 Planks)",
      check: (s) => s.machines.some((m) => m.type === "craftingStation"),
    },
    {
      id: "craftPick",
      text: "Craft a Wood Pick at a Crafting Table",
      check: (s) => s.unlockedTools.includes("woodPick"),
    },
    {
      id: "manualSmelt",
      text: "Smelt an ingot in a Smelter (click to open)",
      check: (s) => (s.stats.manualSmelted || 0) >= 1,
    },
    { id: "smeltIron", text: "Produce an Iron Ingot", check: (s) => (s.stats.smelted.ironIngot || 0) >= 1 },
    {
      id: "craftWire",
      text: "Craft Copper Wire at a Crafting Table",
      check: (s) => (s.stats.crafted?.copperWire || 0) >= 1,
    },
    {
      id: "placeGenerator",
      text: "Place a Coal Generator",
      check: (s) => s.machines.some((m) => m.type === "generator"),
    },
    {
      id: "placeDrill",
      text: "Power a Drill (load Coal in a generator + Power Lines/poles)",
      check: (s) => (s.stats.poweredDrill || 0) >= 1,
    },
    { id: "automate", text: "Let a powered Drill gather 10 ore", check: (s) => (s.stats.drilled || 0) >= 10 },
  ],
};

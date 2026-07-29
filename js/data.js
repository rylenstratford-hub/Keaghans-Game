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
  },

  getItem(id) {
    return this.items[id] || { id, name: id, icon: "?", color: "#888" };
  },

  nodeTypes: {
    tree: { resource: "log", label: "Tree", hp: 3, yield: 1, minTool: "hand" },
    rock: { resource: "stone", label: "Rock", hp: 3, yield: 1, minTool: "woodPick" },
    coal: { resource: "coal", label: "Coal", hp: 3, yield: 1, minTool: "woodPick" },
    iron: { resource: "ironOre", label: "Iron", hp: 3, yield: 1, minTool: "stonePick" },
    copper: { resource: "copperOre", label: "Copper", hp: 3, yield: 1, minTool: "stonePick" },
  },

  /** Higher number = stronger tool. */
  toolTier: {
    hand: 0,
    woodPick: 1,
    stonePick: 2,
    ironPick: 3,
  },

  /** Base strike power; harvestDamage() applies node bonuses for stone/iron picks. */
  tools: {
    hand: { power: 1, yieldBonus: 0 },
    woodPick: { power: 1, yieldBonus: 0 },
    stonePick: { power: 1, yieldBonus: 0 },
    ironPick: { power: 1, yieldBonus: 0 },
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
      output: { id: "cable", count: 2 },
      cost: { copperWire: 2 },
      atStation: true,
      layout: ["copperWire", null, "copperWire", null, null, null, null, null, null],
    },
  ],

  /**
   * Satisfactory-style construction: Q-build spends these materials on place.
   * Craft components (planks, cable, gears…), then build structures from them.
   * Copper Wire is NOT power cable — craft Cable first, then place Cable.
   */
  buildCosts: {
    craftingStation: { plank: 4 },
    smelter: { stone: 8, coal: 2 },
    drill: { ironIngot: 4, gear: 2, copperIngot: 2 },
    generator: { ironIngot: 5, copperIngot: 3, stone: 6, cable: 2 },
    powerPole: { ironIngot: 1, cable: 1 },
    // Explicit: only the Cable item. Never copperWire.
    cable: { cable: 1 },
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

  /** Buildings that participate in the cable/pole power network. */
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
      text: "Power a Drill (generator + cables or poles)",
      check: (s) => (s.stats.poweredDrill || 0) >= 1,
    },
    { id: "automate", text: "Let a powered Drill gather 10 ore", check: (s) => (s.stats.drilled || 0) >= 10 },
  ],
};

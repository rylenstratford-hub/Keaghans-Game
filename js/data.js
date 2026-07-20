window.GameData = {
  items: {
    wood: { id: "wood", name: "Wood", icon: "🪵", color: "#8b5a2b" },
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
  },

  getItem(id) {
    return this.items[id] || { id, name: id, icon: "?", color: "#888" };
  },

  nodeTypes: {
    tree: { resource: "wood", label: "Tree", hp: 3, yield: 1 },
    rock: { resource: "stone", label: "Rock", hp: 4, yield: 1 },
    coal: { resource: "coal", label: "Coal", hp: 5, yield: 1 },
    iron: { resource: "ironOre", label: "Iron", hp: 6, yield: 1 },
    copper: { resource: "copperOre", label: "Copper", hp: 6, yield: 1 },
  },

  tools: {
    hand: { power: 1, yieldBonus: 0 },
    woodPick: { power: 2, yieldBonus: 0 },
    stonePick: { power: 3, yieldBonus: 1 },
    ironPick: { power: 4, yieldBonus: 1 },
  },

  recipes: [
    {
      id: "stick",
      name: "Stick",
      output: { id: "stick", count: 2 },
      cost: { wood: 1 },
    },
    {
      id: "woodPick",
      name: "Wood Pick",
      output: { id: "woodPick", count: 1 },
      cost: { wood: 3, stick: 2 },
      unlocksTool: "woodPick",
    },
    {
      id: "stonePick",
      name: "Stone Pick",
      output: { id: "stonePick", count: 1 },
      cost: { stone: 3, stick: 2 },
      unlocksTool: "stonePick",
      requires: ["woodPick"],
    },
    {
      id: "gear",
      name: "Gear",
      output: { id: "gear", count: 1 },
      cost: { ironIngot: 2 },
    },
    {
      id: "ironPick",
      name: "Iron Pick",
      output: { id: "ironPick", count: 1 },
      cost: { ironIngot: 3, stick: 2 },
      unlocksTool: "ironPick",
      requires: ["stonePick"],
    },
    {
      id: "smelter",
      name: "Smelter",
      output: { id: "smelter", count: 1 },
      cost: { stone: 8, coal: 2 },
    },
    {
      id: "drill",
      name: "Drill",
      output: { id: "drill", count: 1 },
      cost: { ironIngot: 4, gear: 2, copperIngot: 2 },
    },
  ],

  smeltRecipes: [
    { input: "ironOre", output: "ironIngot", time: 2.5 },
    { input: "copperOre", output: "copperIngot", time: 2.2 },
  ],

  goals: [
    { id: "gatherWood", text: "Chop 5 Wood from trees", check: (s) => (s.stats.gathered.wood || 0) >= 5 },
    { id: "craftPick", text: "Craft a Wood Pick", check: (s) => s.unlockedTools.includes("woodPick") },
    { id: "smeltIron", text: "Smelt your first Iron Ingot", check: (s) => (s.stats.smelted.ironIngot || 0) >= 1 },
    { id: "placeDrill", text: "Place a Drill on an ore node", check: (s) => s.machines.some((m) => m.type === "drill") },
    { id: "automate", text: "Let a Drill gather 10 ore for you", check: (s) => (s.stats.drilled || 0) >= 10 },
  ],
};

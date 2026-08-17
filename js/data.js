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
    fan: { id: "fan", name: "Fan", icon: "🌀", color: "#7ec8ff" },
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
    baseKey: {
      id: "baseKey",
      name: "Base Key",
      icon: "🔑",
      color: "#e6c34a",
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
    bucket: {
      id: "bucket",
      name: "Iron Bucket",
      icon: "🪣",
      color: "#9aa3ad",
    },
    waterBucket: {
      id: "waterBucket",
      name: "Water Bucket",
      icon: "💧",
      color: "#4aa8d8",
    },
    ice: {
      id: "ice",
      name: "Ice",
      icon: "🧊",
      color: "#7ec8ff",
      coolant: true,
    },
    charcoal: {
      id: "charcoal",
      name: "Charcoal",
      icon: "🌑",
      color: "#2a2420",
    },
    strangeNote: {
      id: "strangeNote",
      name: "Strange Note",
      icon: "📜",
      color: "#c4a06a",
    },
  },

  /** Ice (portable) + Fan (powered building) cooling. */
  cooling: {
    generatorDropC: 35,
    playerDropC: 10,
    playerMinutes: 45,
    /** °C dropped on adjacent generators each fan tick while powered. */
    fanGeneratorDropC: 3.2,
    /** Felt °C drop while standing next to a powered Fan. */
    fanPlayerDropC: 8,
    /** In-game minutes for a placed Water Bucket beside a powered Fan to freeze. */
    fanFreezeMinutes: 5,
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
    const item = this.items[id] || { id, name: id, icon: "?", color: "#888" };
    // 6-7 Mod: every item reads as 6-7 (cosmetic — ids/recipes unchanged).
    if (typeof window !== "undefined" && window.KeaghanApp?.isSixSevenModInstalled?.()) {
      return { ...item, name: "6-7", icon: "6-7" };
    }
    return item;
  },

  /**
   * Codex entries for the E recipes browser.
   * how = how to make or get it; uses = what it’s for.
   */
  itemGuide: {
    log: {
      how: "Chop Trees on the island with your Hand (or any tool).",
      uses: "Craft Planks in Tab inventory. Fuel a Smelter, or smelt a Log into Charcoal (5 minutes).",
    },
    plank: {
      how: "Craft from 1 Log in Tab inventory (2×2) — any single cell. Wrong extras block the craft.",
      uses: "Craft Sticks, build a Base (Q), and fuel a Smelter.",
    },
    stick: {
      how: "Craft from 2 Planks stacked vertically in Tab inventory (2×2).",
      uses: "Used with Planks to craft a Wood Pick in the Base Workroom.",
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
    charcoal: {
      how: "Smelt a Log in a Smelter — takes 5 in-game minutes (needs fuel or power).",
      uses: "Seats in the living-room TV hatch after you crack the hidden cipher.",
    },
    strangeNote: {
      how: "Lying in the middle of the Base hall. Click it to pick it up.",
      uses: "Click it in Tab inventory to read it once. After that it tracks how close you are to the realm of the 6-7s.",
    },
    ironIngot: {
      how: "Smelt Iron Ore in a Smelter with fuel (Log, Planks, or Coal).",
      uses: "Craft Gears, Iron Buckets, and Iron Picks; build Drills, Generators, Fans, and Power Poles (Q).",
    },
    copperIngot: {
      how: "Smelt Copper Ore in a Smelter with fuel (Log, Planks, or Coal).",
      uses: "Craft Copper Wire; build Drills and Coal Generators (Q).",
    },
    woodPick: {
      how: "Workroom 3×3 pickaxe shape: 3 Planks across the top, Stick in the center, Stick under that.",
      uses: "Drag onto Equipment in Tab. Mines Rock and Coal. Required before stronger picks.",
    },
    stonePick: {
      how: "Workroom 3×3: Wood Pick in the center, Stone in every other cell.",
      uses: "Drag onto Equipment in Tab. Mines Iron and Copper ore. Upgrade path to Iron Pick.",
    },
    ironPick: {
      how: "Workroom 3×3: Stone Pick in the center, Iron Ingots in every other cell.",
      uses: "Drag onto Equipment in Tab. Strongest pick — mines every resource node.",
    },
    ironSword: {
      how: "Workroom 3×3 vertical sword: Iron Ingot, Iron Ingot, Stick down one column.",
      uses: "Drag onto Equipment in Tab inventory. One-shots night monsters (fists only deal 1 of their 20 HP).",
    },
    gear: {
      how: "Workroom 3×3: 2 Iron Ingots side by side horizontally.",
      uses: "Build Drills (Q).",
    },
    copperWire: {
      how: "Workroom 3×3: 1 Copper Ingot in any single cell.",
      uses: "Craft ingredient only — 2 Copper Wire side by side horizontally make 1 Cable. Not a Power Line.",
    },
    cable: {
      how: "Workroom 3×3: 2 Copper Wire in a horizontal row → 1 Cable. Shape must match.",
      uses: "Inventory item. Spend 1 Cable with Q to place a Power Line on the island. Copper Wire is not Cable.",
    },
    bucket: {
      how: "Workroom 3×3 bucket shape: Iron Ingot, gap, Iron Ingot on top; Iron Ingot in the center.",
      uses: "Empty pail — outside in rain or thunder, click empty ground to fill it (becomes a Water Bucket).",
    },
    waterBucket: {
      how: "Fill an Iron Bucket outside during rain or thunder (click empty ground in your 3×3).",
      uses: "Place it on the ground next to a powered Fan to freeze into Ice (empty bucket comes back), or condense 2 Water Buckets in the Workroom.",
    },
    ice: {
      how: "Place a Water Bucket next to a powered Fan (freezes in a few minutes), or Workroom: 2 Water Buckets side by side → 1 Ice.",
      uses: "Portable cool-down — drag onto a generator thermometer, or onto Cool in Tab. For steady cooling, build a Fan next to the generator.",
    },
    // Guide-only: placed building (same machine id "cable" in the world).
    powerLine: {
      how: "Build with Q (Power Line) — costs 1 Cable from your inventory.",
      uses: "Connects Generators (output) to Drills/Smelters (input), often with Power Poles. Different from the Cable item you craft.",
    },
    base: {
      how: "Build with Q using 50 Planks (5×3, click top-left). Upgrade inside: 30 Stone → Stone Base, then 30 Iron Ingots → Iron Base.",
      uses: "Safe yard — monsters can't enter. Walk onto it to be asked inside (Stay outside steps you back). 10×10 indoor map: kitchen NW (click to store food — 15 slots × 50), upgrade north, living NE (click to watch TV — set loops, channels advance on their own), workroom west (click for 3×3 crafting, or flip the left lever down to smelt), storage SW (click to store non-food — 15×50, not the Base Key), bedroom SE, hall elsewhere, doors east. Room doors toggle with the Base Key from the south-hall hook. Click the bedroom at night to sleep until 6:00 a.m.",
    },
    baseKey: {
      how: "Hangs on the key hook in the south indoor hall (🔑). Stand next to it and click to take or hang it. You must hang it back before leaving.",
      uses: "Click a 1-tile room door to toggle it locked/unlocked. Hang it back on the south-hall hook before leaving — you can't take it outside. The 2-tile front doors don't use the key.",
    },
    smelter: {
      how: "Build with Q using 8 Stone + 2 Coal.",
      uses: "Smelt ores into ingots, or a Log into Charcoal (5 minutes). Wire it to a Coal Generator for electric heat, or burn Log / Planks / Coal in the fuel slot when there's no power.",
    },
    generator: {
      how: "Build with Q using Iron Ingots, Copper Ingots, Stone, and Coal.",
      uses: "Burns Coal to power Drills, Smelters, and Fans (wire with Power Lines / Poles). Chart shows energy used each minute for the last hour. Temperature rises with load — place a powered Fan next to it to cool, or drop Ice on the thermometer. Overload / empty coal / overheat flips the switch to OFF — slide it up to ON to reset.",
    },
    fan: {
      how: "Build with Q using 2 Iron Ingots + 1 Gear + 1 Copper Ingot.",
      uses: "Needs power. Place next to a Coal Generator to keep it cool. Place a Water Bucket beside it to freeze Ice. Stand beside a running Fan to cool yourself too.",
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
    {
      id: "bucket",
      name: "Iron Bucket",
      output: { id: "bucket", count: 1 },
      cost: { ironIngot: 3 },
      atStation: true,
      // Bucket / V shape
      layout: [
        "ironIngot",
        null,
        "ironIngot",
        null,
        "ironIngot",
        null,
        null,
        null,
        null,
      ],
    },
    {
      id: "ice",
      name: "Ice",
      output: { id: "ice", count: 1 },
      cost: { waterBucket: 2 },
      // Empty buckets returned after condensing
      returns: { bucket: 2 },
      atStation: true,
      // Condense: two Water Buckets side by side → Ice
      layout: ["waterBucket", "waterBucket", null, null, null, null, null, null, null],
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
    fan: { ironIngot: 2, gear: 1, copperIngot: 1 },
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
    { input: "log", output: "charcoal", minutes: 5 },
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

  /** Indoor kitchen pantry — food only. */
  kitchen: {
    slots: 15,
    stackMax: 50,
  },

  /** Indoor storage room — non-food items (not the Base Key). */
  storageRoom: {
    slots: 15,
    stackMax: 50,
  },

  /** Buildings that consume grid power to operate. */
  powerConsumers: ["drill", "smelter", "fan"],

  /**
   * Power network (Crafting Tables never join):
   * - Outputs supply power (generators)
   * - Inputs draw power (drills, smelters, fans)
   * - Conductors (Power Lines, poles) bridge building ↔ building
   */
  powerOutputs: ["generator"],
  powerInputs: ["drill", "smelter", "fan"],
  powerConductors: ["cable", "powerPole"],
  powerNetwork: ["generator", "cable", "powerPole", "drill", "smelter", "fan"],

  /** Chebyshev link range for network buildings (default 1 = adjacent). */
  powerLinkRange: {
    cable: 1,
    powerPole: 1,
    generator: 1,
    drill: 1,
    smelter: 1,
    fan: 1,
  },

  /**
   * ADA — Satisfactory-style helper. Lines play once per save (adaHeard).
   * Keep voice short, dry, and pioneer-facing.
   */
  ada: {
    name: "ADA",
    controls:
      "W A S D move · F1 player view (W/S walk, A/D turn) · interact in your 3×3 · monsters 6:00 p.m.–6:00 a.m. · walk onto Base to enter · doors leave · ⬆ upgrade · Tab craft · drag tools onto Equipment · E recipes · Q build · 1–7 buildings · F demolish · Enter skips ADA voice · Esc menus then pause. Nodes regrow at 6:00 a.m.",
    idle: "Standing by, pioneer. Habitat speakers carry my voice — stand on your Base or go inside. Press Enter to skip a line.",
    lines: {
      welcome:
        "Pioneer. Island Foundry online. Gather resources and establish a foothold. Build a Base to connect my habitat speakers.",
      firstLogs:
        "Timber acquired. Process Logs into Planks in your Tab inventory.",
      firstPlanks:
        "Planks fabricated. Construction pathways unlocked — a Base requires fifty.",
      firstBase:
        "Habitat secured. Speakers online. Your Base is a safe yard — walk onto it when you're ready to go inside.",
      enterBase:
        "Interior systems online. You are on habitat speakers. Workroom for advanced crafts. Kitchen and Storage for supplies. Hang the Base Key before leaving.",
      upgradeStone:
        "Structural upgrade complete. Stone Base reinforced. Iron tier remains available.",
      upgradeIron:
        "Iron Base achieved. Maximum habitat tier. Impressive work, pioneer.",
      woodPick:
        "Wood Pick assembled in the Workroom. Harder nodes are now within reach.",
      firstNight:
        "Nightfall. Hostiles detected on the island. Stay sharp until dawn.",
      firstSmelter:
        "Smelter online. Load ore — burn fuel for heat, or wire it to a Coal Generator for electric heat.",
      firstGenerator:
        "Coal Generator placed. Wire power to Drills and Smelters with Poles and Power Lines. A Fan beside it keeps the core cool.",
      firstFan:
        "Fan online. Keep it powered beside hot machines — airflow is free insurance.",
      firstBucket:
        "Iron Bucket fabricated. Fill it outside in the rain — metal holds the water.",
      firstWater:
        "Bucket filled. Place it next to a powered Fan to freeze Ice — or condense two Water Buckets in the Workroom.",
      firstFanIce:
        "Fan freeze complete. Ice ready — empty bucket returned.",
      firstIce:
        "Ice condensed. Portable coolant — drop it on a hot generator or Cool in Tab.",
      firstDrill:
        "Drill receiving power. Automated extraction underway.",
      firstWire:
        "Copper Wire fabricated. Two in a row make Cable — then you can wire the grid.",
      firstTv:
        "Recreation online. Pick loops, then slide the two channel levers. First lever on a line starts there; last lever sits one line past the final channel. Dial in exactly six and seven and that counter doubles channel speed each step. Ice-Fans is for ice lovers and Fan lovers. Leave with the corner button, or it powers down after your last channel when wraps are done.",
      witherStormUnlock:
        "Pioneer. A hidden module is now available. The Wither Storm — do not install it unless you are prepared to lose the island.",
      witherStormForm:
        "Command-block signature detected. It is inert while forming. When the reading hits five, it has awakened.",
      witherStormAwaken:
        "The Wither Storm has awakened at five health. Each tile it eats feeds it. The command block will bury itself as it grows.",
      witherStormHole:
        "The storm has torn a hole in its core. Step into it if you dare — the Belly of the Beast is waiting.",
      witherStormBelly:
        "The belly is a fifty-by-fifty maze. Little halls on the outside, big halls inward, and a large chamber around the command block. The halls will not harm you. Strike the core to begin its phases.",
      witherStormBellyPhase1:
        "First phase. Tentacles throw you out. Ten tainted monsters have risen around the core.",
      witherStormBellyPhase2:
        "Second phase. A mini-boss holds the chamber. It throws fire, arrows, and poison-heat magic — and it keeps releasing tainted. Nothing opens until every enemy is down.",
      witherStormBellyPhase3:
        "Third phase. Each tentacle is bound to three crystals scattered through the maze. Smash a tentacle's crystals and it goes dizzy — it cannot grab. The map sits left of the clock. Heads still pull, eat, and release skeletons. Nothing opens until every enemy is down.",
      witherStormBellyVictory:
        "The command block is breaking. Hold on.",
    },
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
      text: "Build a Base (Q — 50 Planks)",
      check: (s) => s.machines.some((m) => m.type === "base"),
    },
    {
      id: "craftPick",
      text: "Craft a Wood Pick in the Base Workroom",
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
      text: "Craft Copper Wire in the Base Workroom",
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

  /**
   * Secret discoveries. Unlock with unlockEasterEgg(id) — not auto-checked like goals.
   * hint = locked chart text; text = unlocked description.
   */
  easterEggs: [
    {
      id: "sixSeven",
      hint: "A strange dial pairing…",
      text: "6-7 — tuned the living-room TV to channels 6–7",
    },
    {
      id: "sixSevenMax",
      hint: "When the dial goes full send…",
      text: "6-7 MAX — max loops on 6–7 while pre-loading",
    },
    {
      id: "forbiddenChannel",
      hint: "Scratched into the living-room glass…",
      text: "Forbidden channel — cipher, charcoal, wires, keypad, then the last door",
    },
  ],
};

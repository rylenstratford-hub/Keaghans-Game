const SCREENS = {
  title: document.querySelector("#screen-title"),
  settings: document.querySelector("#screen-settings"),
  mod: document.querySelector("#screen-mod"),
  saves: document.querySelector("#screen-saves"),
  play: document.querySelector("#screen-play"),
  profile: document.querySelector("#screen-profile"),
};

const SETTINGS_KEY = "keaghans-game-settings";
const PROFILES_KEY = "keaghans-game-profiles-v1";
const MAX_PROFILES = 100;
const NAME_MAX = 24;
const SLOT_COUNT = window.IslandFoundry?.SLOT_COUNT ?? 5;

let gameMounted = false;
let activeSlot = 1;

window.KeaghanProfiles = {
  getActiveId() {
    return loadProfiles().activeId;
  },
  getActiveSlot() {
    return activeSlot;
  },
};

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return { profiles: [], activeId: null };
    const data = JSON.parse(raw);
    const profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, MAX_PROFILES) : [];
    const activeId =
      profiles.some((p) => p.id === data.activeId) ? data.activeId : profiles[0]?.id ?? null;
    return { profiles, activeId };
  } catch {
    return { profiles: [], activeId: null };
  }
}

function saveProfiles(data) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(data));
}

function getActiveProfile() {
  const data = loadProfiles();
  return data.profiles.find((p) => p.id === data.activeId) ?? null;
}

function makeProfileId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NAME_MAX);
}

function createProfile(rawName) {
  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: "Enter a profile name." };

  const data = loadProfiles();
  if (data.profiles.length >= MAX_PROFILES) {
    return { ok: false, error: `Profile limit reached (${MAX_PROFILES}).` };
  }
  if (data.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "That name is already used." };
  }

  const profile = { id: makeProfileId(), name, createdAt: Date.now() };
  data.profiles.push(profile);
  data.activeId = profile.id;
  saveProfiles(data);
  return { ok: true, profile };
}

function selectProfile(id) {
  const data = loadProfiles();
  if (!data.profiles.some((p) => p.id === id)) return false;
  if (gameMounted) {
    window.IslandFoundry.unmount();
    gameMounted = false;
  }
  data.activeId = id;
  activeSlot = 1;
  saveProfiles(data);
  return true;
}

function deleteProfile(id) {
  const data = loadProfiles();
  const next = data.profiles.filter((p) => p.id !== id);
  if (next.length === data.profiles.length) return;
  if (gameMounted && data.activeId === id) {
    window.IslandFoundry.unmount();
    gameMounted = false;
  }
  window.IslandFoundry.clearAllSlots(id);
  data.profiles = next;
  data.activeId = data.activeId === id ? next[0]?.id ?? null : data.activeId;
  saveProfiles(data);
}

function initialFromName(name) {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function setFormError(message) {
  const el = document.getElementById("profile-form-error");
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function formatSaveDate(ts) {
  if (!ts) return "Unknown date";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Unknown date";
  }
}

function toolLabel(toolId) {
  if (!toolId || toolId === "hand") return "Hand";
  return window.GameData?.getItem?.(toolId)?.name || toolId;
}

function renderSaveSlots() {
  const list = document.getElementById("save-slot-list");
  const label = document.getElementById("saves-profile-label");
  const active = getActiveProfile();
  if (!list) return;

  if (label) {
    if (active) {
      label.hidden = false;
      label.textContent = `Saves for ${active.name}`;
    } else {
      label.hidden = true;
      label.textContent = "";
    }
  }

  list.innerHTML = "";
  if (!active) return;

  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const meta = window.IslandFoundry.getSlotMeta(active.id, slot);
    const li = document.createElement("li");
    li.className = "save-slot-row";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "save-slot" + (meta.empty ? " is-empty" : "");
    openBtn.dataset.saveOpen = String(slot);

    const title = meta.empty ? "Empty Slot" : "Factory Save";
    const metaText = meta.empty
      ? "No data — start a new island"
      : `${formatSaveDate(meta.startedAt)} · Gathered ${meta.totalGathered} · ${toolLabel(meta.tool)}`;
    const action = meta.empty ? "New Game" : "Continue";

    openBtn.innerHTML = `
      <span class="save-slot__index">SLOT ${slot}</span>
      <span class="save-slot__body">
        <span class="save-slot__title">${title}</span>
        <span class="save-slot__meta">${escapeHtml(metaText)}</span>
      </span>
      <span class="save-slot__action">${action}</span>
    `;

    li.append(openBtn);

    if (!meta.empty) {
      const actions = document.createElement("div");
      actions.className = "save-slot__actions";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "save-slot__reset";
      resetBtn.dataset.saveReset = String(slot);
      resetBtn.textContent = "Reset progress";

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "save-slot__delete";
      deleteBtn.dataset.saveDelete = String(slot);
      deleteBtn.textContent = "Delete save";

      actions.append(resetBtn, deleteBtn);
      li.append(actions);
    }

    list.append(li);
  }
}

function renderProfileUi() {
  const active = getActiveProfile();
  const data = loadProfiles();
  const avatar = document.getElementById("profile-entry-avatar");
  const nameEl = document.getElementById("profile-entry-name");
  const playBtn = document.getElementById("play-button");
  const playHint = document.getElementById("play-gate-hint");
  const activeLabel = document.getElementById("profile-active-label");
  const countEl = document.getElementById("profile-count");
  const listEl = document.getElementById("profile-list");
  const emptyEl = document.getElementById("profile-empty");
  const createBtn = document.querySelector(".profile-create__btn");
  const chrome = document.getElementById("profile-chrome");
  const entry = document.getElementById("profile-entry");

  if (avatar) avatar.textContent = active ? initialFromName(active.name) : "+";
  if (nameEl) nameEl.textContent = active ? active.name : "Create profile";

  const canPlay = Boolean(active);
  if (playBtn) {
    playBtn.disabled = !canPlay;
    playBtn.classList.toggle("is-locked", !canPlay);
    playBtn.setAttribute("aria-disabled", String(!canPlay));
    playBtn.title = canPlay ? "Play" : "Create a profile first";
  }
  if (playHint) playHint.hidden = canPlay;

  const onPlay = SCREENS.play && !SCREENS.play.hidden;
  const showChrome = !onPlay;
  if (chrome) {
    chrome.classList.toggle("is-play-hidden", !showChrome);
    chrome.setAttribute("aria-hidden", String(!showChrome));
  }
  if (entry) {
    entry.hidden = false;
    entry.disabled = false;
    entry.tabIndex = showChrome ? 0 : -1;
    entry.classList.toggle("is-create", !active);
    entry.setAttribute("aria-label", active ? `Profile: ${active.name}` : "Create profile");
    entry.title = active ? active.name : "Create profile";
  }

  if (activeLabel) {
    if (active) {
      activeLabel.hidden = false;
      activeLabel.textContent = `Playing as ${active.name}`;
    } else {
      activeLabel.hidden = true;
      activeLabel.textContent = "";
    }
  }

  if (countEl) countEl.textContent = `(${data.profiles.length} / ${MAX_PROFILES})`;
  if (createBtn) createBtn.disabled = data.profiles.length >= MAX_PROFILES;

  if (listEl) {
    listEl.innerHTML = "";
    for (const profile of data.profiles) {
      const li = document.createElement("li");
      li.className = "profile-list__item" + (profile.id === data.activeId ? " is-active" : "");

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "profile-list__select";
      selectBtn.dataset.profileSelect = profile.id;
      selectBtn.innerHTML = `<span class="profile-list__avatar">${initialFromName(profile.name)}</span><span class="profile-list__name">${escapeHtml(profile.name)}</span>`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "profile-list__delete";
      deleteBtn.dataset.profileDelete = profile.id;
      deleteBtn.setAttribute("aria-label", `Delete ${profile.name}`);
      deleteBtn.textContent = "Delete";

      li.append(selectBtn, deleteBtn);
      listEl.append(li);
    }
  }

  if (emptyEl) emptyEl.hidden = data.profiles.length > 0;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showScreen(name) {
  if ((name === "play" || name === "saves") && !getActiveProfile()) {
    setFormError("Create a profile name to play.");
    name = "profile";
  }

  for (const [key, el] of Object.entries(SCREENS)) {
    if (!el) continue;
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }

  if (name === "saves") {
    renderSaveSlots();
  }

  if (name === "play") {
    window.IslandFoundry.mount(document.querySelector("#game-root"));
    gameMounted = true;
  } else if (gameMounted) {
    window.IslandFoundry.unmount();
    gameMounted = false;
  }

  renderProfileUi();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { volume: 70, showFps: false };
  } catch {
    return { volume: 70, showFps: false };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

window.KeaghanSettings = {
  getVolume() {
    return loadSettings().volume;
  },
};

function playMenuClick() {
  // Menu-only industrial button press (never used for in-world game clicks).
  window.KeaghanSfx?.playMenuClick?.();
}

function applySettingsToUi(settings) {
  const volume = document.getElementById("setting-volume");
  const fps = document.getElementById("setting-fps");
  if (volume) volume.value = String(settings.volume);
  if (fps) fps.checked = Boolean(settings.showFps);
}

function bindSettings() {
  const volume = document.getElementById("setting-volume");
  const fps = document.getElementById("setting-fps");
  applySettingsToUi(loadSettings());

  volume?.addEventListener("input", () => {
    saveSettings({ ...loadSettings(), volume: Number(volume.value) });
    window.KeaghanSfx?.refreshVolumes?.();
  });

  fps?.addEventListener("change", () => {
    saveSettings({ ...loadSettings(), showFps: fps.checked });
  });
}

function bindProfiles() {
  const form = document.getElementById("profile-create-form");
  const input = document.getElementById("profile-name-input");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = createProfile(input?.value);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    playMenuClick();
    setFormError("");
    if (input) input.value = "";
    renderProfileUi();
  });

  document.getElementById("profile-list")?.addEventListener("click", (event) => {
    const selectId = event.target.closest("[data-profile-select]")?.dataset.profileSelect;
    if (selectId) {
      playMenuClick();
      selectProfile(selectId);
      setFormError("");
      renderProfileUi();
      return;
    }

    const deleteId = event.target.closest("[data-profile-delete]")?.dataset.profileDelete;
    if (deleteId) {
      const profile = loadProfiles().profiles.find((p) => p.id === deleteId);
      if (!profile) return;
      if (!confirm(`Delete profile "${profile.name}" and all its saves?`)) return;
      playMenuClick();
      deleteProfile(deleteId);
      setFormError("");
      renderProfileUi();
    }
  });
}

function bindSaves() {
  document.getElementById("save-slot-list")?.addEventListener("click", (event) => {
    const resetSlot = event.target.closest("[data-save-reset]")?.dataset.saveReset;
    if (resetSlot) {
      event.stopPropagation();
      const active = getActiveProfile();
      if (!active) return;
      if (!confirm(`Reset progress in slot ${resetSlot}? The world will start over.`)) return;
      playMenuClick();
      window.IslandFoundry.resetSlot(active.id, Number(resetSlot));
      renderSaveSlots();
      return;
    }

    const deleteSlot = event.target.closest("[data-save-delete]")?.dataset.saveDelete;
    if (deleteSlot) {
      event.stopPropagation();
      const active = getActiveProfile();
      if (!active) return;
      if (!confirm(`Delete save in slot ${deleteSlot}?`)) return;
      playMenuClick();
      window.IslandFoundry.clearSlot(active.id, Number(deleteSlot));
      renderSaveSlots();
      return;
    }

    const openSlot = event.target.closest("[data-save-open]")?.dataset.saveOpen;
    if (!openSlot) return;
    if (!getActiveProfile()) {
      setFormError("Create a profile name to play.");
      showScreen("profile");
      return;
    }
    playMenuClick();
    activeSlot = Number(openSlot);
    showScreen("play");
  });
}

function bindActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;

    // Skip menu SFX while inside the game world (except leaving via Menu).
    const onPlay = SCREENS.play && !SCREENS.play.hidden;
    const action = button.dataset.action;
    const isMenuNav =
      action === "settings" ||
      action === "mod" ||
      action === "profile" ||
      action === "play" ||
      action === "back";

    if (isMenuNav && (!onPlay || action === "back")) {
      playMenuClick();
    }

    if (action === "settings") {
      showScreen("settings");
      return;
    }
    if (action === "mod") {
      showScreen("mod");
      return;
    }
    if (action === "profile") {
      showScreen("profile");
      document.getElementById("profile-name-input")?.focus();
      return;
    }
    if (action === "back") {
      if (onPlay) {
        showScreen("saves");
        return;
      }
      showScreen("title");
      return;
    }
    if (action === "play") {
      if (!getActiveProfile()) {
        setFormError("Create a profile name to play.");
        showScreen("profile");
        document.getElementById("profile-name-input")?.focus();
        return;
      }
      showScreen("saves");
    }
  });
}

bindSettings();
bindProfiles();
bindSaves();
bindActions();

window.addEventListener("keaghan-leave-game", () => {
  playMenuClick();
  showScreen("saves");
});

showScreen("title");

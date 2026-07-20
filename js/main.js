const SCREENS = {
  title: document.querySelector("#screen-title"),
  settings: document.querySelector("#screen-settings"),
  mod: document.querySelector("#screen-mod"),
  play: document.querySelector("#screen-play"),
};

const SETTINGS_KEY = "keaghans-game-settings";

function showScreen(name) {
  for (const [key, el] of Object.entries(SCREENS)) {
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }
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

function applySettingsToUi(settings) {
  const volume = document.getElementById("setting-volume");
  const fps = document.getElementById("setting-fps");
  if (volume) volume.value = String(settings.volume);
  if (fps) fps.checked = Boolean(settings.showFps);
}

function bindSettings() {
  const volume = document.getElementById("setting-volume");
  const fps = document.getElementById("setting-fps");
  const settings = loadSettings();
  applySettingsToUi(settings);

  volume?.addEventListener("input", () => {
    const next = { ...loadSettings(), volume: Number(volume.value) };
    saveSettings(next);
  });

  fps?.addEventListener("change", () => {
    const next = { ...loadSettings(), showFps: fps.checked };
    saveSettings(next);
  });
}

function bindActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action === "settings") showScreen("settings");
    if (action === "play") showScreen("play");
    if (action === "mod") showScreen("mod");
    if (action === "back") showScreen("title");
  });
}

bindSettings();
bindActions();
showScreen("title");

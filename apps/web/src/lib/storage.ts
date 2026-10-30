export type Profile = {
  name: string;
  languages: string;
  importantPeople: string;
  likes: string;
  needs: string;
};

export const EMPTY_PROFILE: Profile = {
  name: "",
  languages: "",
  importantPeople: "",
  likes: "",
  needs: "",
};

const K = {
  profile: "anomia.profile",
  picks: "anomia.recentPicks",
  voice: "anomia.voiceId",
  camera: "anomia.camera",
};

// Storage can throw in private windows, and the app must keep working without it.
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getProfile = (): Profile => ({ ...EMPTY_PROFILE, ...read(K.profile, {}) });
export const saveProfile = (p: Profile) => write(K.profile, JSON.stringify(p));

export const MAX_PICKS = 10;
export function addPick(list: string[], sentence: string): string[] {
  return [...list, sentence].slice(-MAX_PICKS);
}
export const getRecentPicks = (): string[] => read<string[]>(K.picks, []);
export function rememberPick(sentence: string) {
  write(K.picks, JSON.stringify(addPick(getRecentPicks(), sentence)));
}

export function getVoiceId(): string | null {
  try {
    return localStorage.getItem(K.voice);
  } catch {
    return null;
  }
}
export const voiceIdOrDefault = () => getVoiceId() || "default";
export function setVoiceId(id: string | null) {
  if (id) write(K.voice, id);
  else clearKey(K.voice);
}

export const getCameraOn = (): boolean => read(K.camera, false);
export const setCameraOn = (on: boolean) => write(K.camera, JSON.stringify(on));

function clearKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearAllData() {
  Object.values(K).forEach(clearKey);
}

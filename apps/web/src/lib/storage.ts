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
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getProfile = (): Profile => ({ ...EMPTY_PROFILE, ...read(K.profile, {}) });
export const saveProfile = (p: Profile) => localStorage.setItem(K.profile, JSON.stringify(p));

export const MAX_PICKS = 10;
export function addPick(list: string[], sentence: string): string[] {
  return [...list, sentence].slice(-MAX_PICKS);
}
export const getRecentPicks = (): string[] => read<string[]>(K.picks, []);
export function rememberPick(sentence: string) {
  localStorage.setItem(K.picks, JSON.stringify(addPick(getRecentPicks(), sentence)));
}

export const getVoiceId = (): string | null => localStorage.getItem(K.voice);
export const voiceIdOrDefault = () => getVoiceId() || "default";
export const setVoiceId = (id: string | null) =>
  id ? localStorage.setItem(K.voice, id) : localStorage.removeItem(K.voice);

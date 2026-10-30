import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Save, Trash2 } from "lucide-react";
import { AppShell, BigButton, inputClass } from "@/components/ui-kit";
import { clearAllData, EMPTY_PROFILE, getProfile, saveProfile, type Profile } from "@/lib/storage";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "About me | Anomia" },
      { name: "description", content: "Tell Anomia about you so suggestions fit your life." },
      { property: "og:title", content: "About me | Anomia" },
      { property: "og:description", content: "Tell Anomia about you so suggestions fit your life." },
    ],
  }),
  component: ProfileScreen,
});

const FIELDS: { key: keyof Profile; label: string; hint: string; long?: boolean }[] = [
  { key: "name", label: "My name", hint: "Anna" },
  { key: "languages", label: "Languages", hint: "English, Finnish" },
  { key: "importantPeople", label: "Important people", hint: "Mark (husband), Lily (daughter)", long: true },
  { key: "likes", label: "I like", hint: "Tea, gardening, football", long: true },
  { key: "needs", label: "I often need", hint: "Medicine at 8, glasses, rest", long: true },
];

function ProfileScreen() {
  return (
    <AppShell>
      <ProfileForm />
    </AppShell>
  );
}

function ProfileForm() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState(false);
  useEffect(() => setProfile(getProfile()), []);

  return (
    <form
      className="flex flex-1 flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        saveProfile(profile);
        setSaved(true);
      }}
    >
      <h1 className="text-3xl font-bold">About me</h1>
      {FIELDS.map((f) => {
        const props = {
          id: f.key,
          value: profile[f.key],
          placeholder: f.hint,
          className: inputClass,
          onChange: (e: { target: { value: string } }) => {
            setSaved(false);
            setProfile((p) => ({ ...p, [f.key]: e.target.value }));
          },
        };
        return (
          <div key={f.key} className="flex flex-col gap-2">
            <label htmlFor={f.key} className="text-xl font-bold">{f.label}</label>
            {f.long ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}
          </div>
        );
      })}
      <BigButton type="submit">
        {saved ? <Check className="size-7" aria-hidden /> : <Save className="size-7" aria-hidden />}
        {saved ? "Saved" : "Save"}
      </BigButton>
      <p className="text-base text-muted-foreground">
        Saved only on this device. It is sent with each request so suggestions fit your life, and it is never stored on a server.
      </p>
      <BigButton
        variant="ghost"
        onClick={() => {
          if (!window.confirm("Delete your profile, recent choices and voice link from this device?")) return;
          clearAllData();
          setProfile(EMPTY_PROFILE);
          setSaved(false);
        }}
      >
        <Trash2 className="size-7" aria-hidden /> Delete my data
      </BigButton>
      <footer className="mt-auto pt-4 text-center text-base text-muted-foreground">
        Communication aid prototype. Not a medical device.
      </footer>
    </form>
  );
}

import { Link } from "@tanstack/react-router";
import { Mic, User, AudioLines, RotateCcw, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "accent" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground border-2 border-border",
  accent: "bg-accent text-accent-foreground",
  ghost: "bg-transparent text-foreground border-2 border-border",
};

export function BigButton({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "tap flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-xl font-bold shadow-soft transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-10">
      <Loader2 className="size-16 animate-spin text-primary" aria-hidden />
      <p className="text-2xl font-bold">{label}</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-soft">
      <p className="text-2xl font-bold">{message}</p>
      <BigButton onClick={onRetry}>
        <RotateCcw className="size-7" aria-hidden /> Try again
      </BigButton>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: "/" | "/profile" | "/voice"; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="tap flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-base font-bold text-muted-foreground"
      activeProps={{ className: "bg-secondary text-foreground", "aria-current": "page" }}
      activeOptions={{ exact: true }}
    >
      {icon}
      {label}
    </Link>
  );
}

export function BottomNav() {
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-10 border-t-2 bg-card px-2 pb-[env(safe-area-inset-bottom)] pt-2">
      <div className="mx-auto flex max-w-md gap-2 pb-2">
        <NavItem to="/" icon={<Mic className="size-7" aria-hidden />} label="Speak" />
        <NavItem to="/profile" icon={<User className="size-7" aria-hidden />} label="Me" />
        <NavItem to="/voice" icon={<AudioLines className="size-7" aria-hidden />} label="Voice" />
      </div>
    </nav>
  );
}

export const inputClass =
  "tap w-full rounded-xl border-2 border-input bg-card px-4 py-3 text-xl text-foreground placeholder:text-muted-foreground";

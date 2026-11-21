"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { dispensers, findDispenser } from "@/config/dispensers";
import { Button, buttonClasses } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { ScreenHeading } from "@/components/ui/screen-heading";
import { saveDispenserId, useStoredDispenserId } from "@/lib/kiosk/dispenser-storage";

/** Lets an admin choose which physical dispenser this screen controls. */
export function SetupForm() {
  const router = useRouter();
  const storedId = useStoredDispenserId();
  const current = findDispenser(storedId);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = choice ?? current?.id ?? null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selected || !findDispenser(selected)) {
      setError("Choose a dispenser first.");
      return;
    }
    try {
      saveDispenserId(selected);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the dispenser.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="animate-fade-up" noValidate>
      <ScreenHeading className="text-7xl font-bold tracking-tight">Which dispenser is this?</ScreenHeading>
      <p className="mt-5 text-3xl/snug text-muted-foreground">
        This screen will control the dispenser you choose. The choice is saved on this device.
      </p>

      <fieldset className="mt-12">
        <legend className="sr-only">Dispenser</legend>
        <div className="grid gap-5">
          {dispensers.map((d, i) => {
            const checked = selected === d.id;
            return (
              <label
                key={d.id}
                className={`relative flex cursor-pointer items-center gap-6 rounded-card border-2 bg-surface p-7 shadow-card transition-[border-color,box-shadow] animate-fade-up has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ring ${
                  checked ? "border-primary ring-4 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <input
                  type="radio"
                  name="dispenser"
                  value={d.id}
                  checked={checked}
                  onChange={() => setChoice(d.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`grid size-20 shrink-0 place-items-center rounded-3xl text-3xl font-bold transition-colors ${
                    checked ? "bg-primary text-primary-foreground" : "bg-surface-muted text-primary"
                  }`}
                >
                  {checked ? <CheckIcon className="size-10" /> : d.id}
                </span>
                <span className="min-w-0 text-3xl font-semibold">{d.name}</span>
                {current?.id === d.id && (
                  <span className="ml-auto rounded-full bg-surface-muted px-4 py-1.5 text-lg font-medium text-muted-foreground">
                    Current
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-6 rounded-2xl bg-danger-soft px-6 py-4 text-2xl font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-5">
        <Button type="submit" size="lg" className="h-24 px-14 text-3xl" disabled={!selected}>
          Save and start
        </Button>
        {current && (
          <Link href="/" className={buttonClasses({ variant: "ghost", size: "lg", className: "h-24 px-12 text-3xl" })}>
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

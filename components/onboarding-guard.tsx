"use client";

import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppStore } from "@/stores/app-store";
import { AppShell } from "@/components/app-shell";

const ONBOARDING_PATH = "/onboarding";

// Track zustand persist's actual rehydration event via useSyncExternalStore,
// instead of a manual useEffect + setState flag. The server snapshot is
// always `false` (nothing is persisted yet during SSR), and the client
// snapshot reflects whether persisted state has finished loading from
// localStorage — avoiding a hydration mismatch on `isOnboarded`.
const subscribeToHydration = (callback: () => void) =>
  useAppStore.persist.onFinishHydration(callback);
const getHydratedSnapshot = () => useAppStore.persist.hasHydrated();
const getServerSnapshot = () => false;

const useHasHydrated = (): boolean =>
  useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerSnapshot
  );

export const OnboardingGuard = ({ children }: { children: ReactNode }) => {
  const isOnboarded = useAppStore((s) => s.isOnboarded);
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHasHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!isOnboarded && pathname !== ONBOARDING_PATH) {
      router.replace(ONBOARDING_PATH);
    } else if (isOnboarded && pathname === ONBOARDING_PATH) {
      router.replace("/");
    }
  }, [hydrated, isOnboarded, pathname, router]);

  if (!hydrated) return null;

  // Redirects above are in flight; render nothing until they land.
  if (!isOnboarded && pathname !== ONBOARDING_PATH) return null;
  if (isOnboarded && pathname === ONBOARDING_PATH) return null;

  // Onboarding page renders bare, without the sidebar/app shell.
  if (pathname === ONBOARDING_PATH) return <>{children}</>;

  return <AppShell>{children}</AppShell>;
};

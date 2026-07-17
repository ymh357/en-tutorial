"use client";

import { type ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { DictionaryPanel } from "./dictionary-panel";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export const AppShell = ({ children }: { children: ReactNode }) => {
  return (
    <>
      <SidebarNav />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:h-14 md:px-4">
          <SidebarTrigger className="-ml-1 min-h-[44px] min-w-[44px]" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="truncate text-xs text-muted-foreground md:text-sm">
            English Learning Tutor
          </span>
        </header>
        <main className="flex-1 overflow-auto p-3 md:p-6">{children}</main>
      </SidebarInset>
      <DictionaryPanel />
    </>
  );
};

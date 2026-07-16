"use client";

import { type ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";

export const Providers = ({ children }: { children: ReactNode }) => {
  return <SidebarProvider>{children}</SidebarProvider>;
};

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  PenLine,
  Brain,
  TrendingUp,
  ClipboardCheck,
  Settings,
  BookOpenText,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const NAV_ITEMS: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Conversation", href: "/conversation", icon: MessageSquare },
  { title: "Reader", href: "/reader", icon: BookOpen },
  { title: "Writing", href: "/writing", icon: PenLine },
  { title: "Review Cards", href: "/srs", icon: Brain },
  { title: "Profile", href: "/profile", icon: TrendingUp },
  { title: "Assessment", href: "/assessment", icon: ClipboardCheck },
];

export const SidebarNav = () => {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="p-3 md:p-4">
        <Link
          href="/"
          className="flex min-h-[44px] items-center gap-2 text-lg font-bold"
        >
          EnTutor
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Learn</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/guide"}
              render={<Link href="/guide" />}
            >
              <BookOpenText />
              <span>Guide</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/settings"}
              render={<Link href="/settings" />}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  PenLine,
  Headphones,
  Languages,
  Brain,
  TrendingUp,
  ClipboardCheck,
  Settings,
  BookOpenText,
  Map,
  History,
  GraduationCap,
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

type NavItem = { title: string; href: string; icon: LucideIcon };

// Grouped for scannable hierarchy: a single overview entry, the six core
// practice modes, then the review/progress tools that are visited less often.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Practice",
    items: [
      { title: "Conversation", href: "/conversation", icon: MessageSquare },
      { title: "IELTS Part 2", href: "/ielts/part2", icon: GraduationCap },
      { title: "Reader", href: "/reader", icon: BookOpen },
      { title: "Writing", href: "/writing", icon: PenLine },
      { title: "Listening", href: "/listening", icon: Headphones },
      { title: "Translate", href: "/translate", icon: Languages },
    ],
  },
  {
    label: "Review & Progress",
    items: [
      { title: "Review Cards", href: "/srs", icon: Brain },
      { title: "Roadmap", href: "/roadmap", icon: Map },
      { title: "Profile", href: "/profile", icon: TrendingUp },
      { title: "History", href: "/history", icon: History },
      { title: "Assessment", href: "/assessment", icon: ClipboardCheck },
    ],
  },
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
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
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
        ))}
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

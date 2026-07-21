import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { OnboardingGuard } from "@/components/onboarding-guard";
import "./globals.css";

// Design system typography: Bricolage Grotesque (display/headings),
// Public Sans (body/UI), JetBrains Mono (phonetics, band numbers, code).
const bodyFont = Public_Sans({
  variable: "--font-sans-src",
  subsets: ["latin"],
});

const displayFont = Bricolage_Grotesque({
  variable: "--font-heading-src",
  subsets: ["latin"],
});

const monoFont = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EnTutor - English Learning",
  description: "AI-powered English learning for practical fluency",
};

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">
        <Providers>
          <OnboardingGuard>{children}</OnboardingGuard>
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;

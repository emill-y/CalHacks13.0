import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CartCount } from "@/components/CartCount";
import { Toaster } from "@/components/Toaster";
import { WishWatcher } from "@/components/WishWatcher";

export const metadata: Metadata = {
  title: "ThisBut — shop by editing what you see",
  description: "Search with a photo plus an edit: “this shirt, but without the ribbon.” Every result is verified.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem("tb-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

const NAV = [
  { href: "/", label: "Shop" },
  { href: "/wishes", label: "My Wishes" },
  { href: "/merchant/gaps", label: "Merchant" },
  { href: "/privacy", label: "Privacy" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-paper text-ink">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <Link href="/" className="font-display text-2xl font-bold tracking-tight">
              This<span className="text-accent">But</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 overflow-x-auto text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-full px-3 py-1.5 hover:bg-soft">
                  {n.label}
                </Link>
              ))}
              <Link href="/cart" className="whitespace-nowrap rounded-full px-3 py-1.5 hover:bg-soft">
                Cart <CartCount />
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-24">{children}</main>
        <footer className="border-t border-line py-8 text-center text-xs text-muted">
          ThisBut is a hackathon demo. Catalog imagery from Fashionpedia (CC BY 4.0 annotations; Flickr CC images) used for
          demo purposes only. Test-mode checkout — no real payments.
        </footer>
        <Toaster />
        <WishWatcher />
      </body>
    </html>
  );
}

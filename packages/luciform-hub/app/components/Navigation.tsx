'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GlitchLink } from './GlitchText';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/products', label: 'Products' },
  { href: '/cv', label: 'CV' },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 w-full bg-slate-950/80 backdrop-blur-md border-b border-cyan-400/10 z-50">
      {/* Animated top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />

      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <img
              src="/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png"
              alt="Luciform Research Logo"
              className="w-8 h-8 rounded-lg object-cover transition-all duration-300
                group-hover:shadow-[0_0_15px_rgba(0,255,255,0.5)]"
            />
            {/* Glow effect on hover */}
            <div className="absolute inset-0 rounded-lg border border-cyan-400/0 group-hover:border-cyan-400/50 transition-all duration-300" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent
            group-hover:from-cyan-300 group-hover:to-purple-300 transition-all duration-300">
            Luciform Research
          </span>
        </Link>

        <div className="flex gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`relative px-2 py-1 transition-all duration-300 ${
                pathname === link.href
                  ? 'text-cyan-400'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              {pathname === link.href ? (
                <>
                  <GlitchLink gradient="from-cyan-400 to-cyan-400">{link.label}</GlitchLink>
                  {/* Active indicator */}
                  <span className="absolute -bottom-1 left-0 right-0 h-px bg-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.8)]" />
                </>
              ) : (
                <span className="relative">
                  {link.label}
                  {/* Hover underline */}
                  <span className="absolute -bottom-1 left-0 right-0 h-px bg-cyan-400/50 scale-x-0 hover:scale-x-100 transition-transform origin-left" />
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* Subtle scanline effect */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
        }}
      />
    </nav>
  );
}

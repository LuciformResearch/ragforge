'use client';

import { useEffect, useState, useRef } from 'react';

// Check if we're in print mode (via query param)
function useIsPrintMode() {
  const [isPrint, setIsPrint] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsPrint(params.get('print') === 'true');
  }, []);

  return isPrint;
}

interface GlitchTextProps {
  text: string;
  className?: string;
  /** Delay before glitch starts (ms) */
  delay?: number;
  /** How often to repeat the glitch (ms), 0 = no repeat */
  repeatInterval?: number;
  /** Speed of the glitch effect */
  speed?: 'slow' | 'normal' | 'fast';
  /** Glitch on hover only */
  hoverOnly?: boolean;
  /** Type of glitch effect */
  variant?: 'decode' | 'scramble' | 'flicker';
  /** Custom gradient colors */
  gradient?: string;
  /** Glow color */
  glowColor?: string;
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>[]{}';
const CYBER_CHARS = '01アイウエオカキクケコサシスセソ';

export function GlitchText({
  text,
  className = '',
  delay = 0,
  repeatInterval = 0,
  speed = 'normal',
  hoverOnly = false,
  variant = 'decode',
  gradient = 'from-cyan-400 via-purple-500 to-pink-500',
  glowColor = 'rgba(0,255,255,0.5)',
}: GlitchTextProps) {
  const isPrintMode = useIsPrintMode();
  const [displayText, setDisplayText] = useState(text);
  const [isGlitching, setIsGlitching] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const speedMap = {
    slow: 50,
    normal: 30,
    fast: 15,
  };

  const runGlitch = () => {
    if (isGlitching) return;
    setIsGlitching(true);

    const chars = variant === 'scramble' ? CYBER_CHARS : CHARS;
    let iterations = 0;
    const iterationSpeed = speedMap[speed];
    const iterationsPerChar = variant === 'flicker' ? 0.5 : 0.33;

    intervalRef.current = setInterval(() => {
      setDisplayText(
        text
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';

            if (variant === 'flicker') {
              // Flicker: random chars appear and disappear
              if (Math.random() < 0.3) {
                return chars[Math.floor(Math.random() * chars.length)];
              }
              return index < iterations ? char : chars[Math.floor(Math.random() * chars.length)];
            }

            // Decode: characters resolve left to right
            if (index < iterations) return char;
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join('')
      );

      iterations += iterationsPerChar;

      if (iterations >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        setIsGlitching(false);
      }
    }, iterationSpeed);
  };

  useEffect(() => {
    // Don't run glitch animations in print mode
    if (hoverOnly || isPrintMode) return;

    // Initial delay
    timeoutRef.current = setTimeout(() => {
      runGlitch();

      // Repeat interval
      if (repeatInterval > 0) {
        const repeat = setInterval(runGlitch, repeatInterval);
        return () => clearInterval(repeat);
      }
    }, delay);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, delay, repeatInterval, hoverOnly, isPrintMode]);

  // Update display text when text prop changes
  useEffect(() => {
    setDisplayText(text);
  }, [text]);

  const handleMouseEnter = () => {
    // Don't glitch on hover in print mode
    if (isPrintMode) return;
    if (hoverOnly || repeatInterval === 0) {
      runGlitch();
    }
  };

  // In print mode, show clean text without effects
  const showText = isPrintMode ? text : displayText;
  const showGlitchEffects = isGlitching && !isPrintMode;

  return (
    <span
      className={`bg-gradient-to-r ${gradient} bg-clip-text text-transparent relative ${className}`}
      style={{
        filter: showGlitchEffects ? `drop-shadow(0 0 20px ${glowColor})` : `drop-shadow(0 0 10px ${glowColor})`,
        transition: 'filter 0.3s ease',
      }}
      onMouseEnter={handleMouseEnter}
    >
      {showText}
      {/* Glitch overlay effect */}
      {showGlitchEffects && (
        <>
          <span
            className={`absolute inset-0 bg-gradient-to-r ${gradient} bg-clip-text text-transparent opacity-70`}
            style={{
              transform: 'translateX(2px)',
              clipPath: 'inset(10% 0 60% 0)',
            }}
          >
            {displayText}
          </span>
          <span
            className={`absolute inset-0 bg-gradient-to-r ${gradient} bg-clip-text text-transparent opacity-70`}
            style={{
              transform: 'translateX(-2px)',
              clipPath: 'inset(50% 0 20% 0)',
            }}
          >
            {displayText}
          </span>
        </>
      )}
    </span>
  );
}

// Simpler version for headings that just glitches on load
export function GlitchHeading({
  children,
  className = '',
  as: Component = 'h1',
  gradient = 'from-cyan-400 via-purple-500 to-pink-500',
  glowColor = 'rgba(0,255,255,0.5)',
}: {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span';
  gradient?: string;
  glowColor?: string;
}) {
  return (
    <Component className={className}>
      <GlitchText
        text={children}
        repeatInterval={10000}
        gradient={gradient}
        glowColor={glowColor}
      />
    </Component>
  );
}

// Version that only glitches on hover
export function GlitchLink({
  children,
  className = '',
  gradient = 'from-cyan-400 to-blue-500',
  glowColor = 'rgba(0,255,255,0.3)',
}: {
  children: string;
  className?: string;
  gradient?: string;
  glowColor?: string;
}) {
  return (
    <GlitchText
      text={children}
      hoverOnly
      speed="fast"
      className={className}
      gradient={gradient}
      glowColor={glowColor}
    />
  );
}

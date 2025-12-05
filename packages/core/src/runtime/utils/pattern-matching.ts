/**
 * Pattern Matching Utilities
 *
 * Custom glob and regex utilities for database queries
 * Inspired by minimatch but simplified for our use case
 */

/**
 * POSIX character classes mapped to Unicode properties
 * Supports patterns like [[:alpha:]], [[:digit:]], etc.
 */
const POSIX_CLASSES: Record<string, string> = {
  '[:alnum:]': '\\p{L}\\p{Nl}\\p{Nd}',
  '[:alpha:]': '\\p{L}\\p{Nl}',
  '[:ascii:]': '\\x00-\\x7f',
  '[:blank:]': '\\p{Zs}\\t',
  '[:cntrl:]': '\\p{Cc}',
  '[:digit:]': '\\p{Nd}',
  '[:lower:]': '\\p{Ll}',
  '[:print:]': '\\p{C}',
  '[:punct:]': '\\p{P}',
  '[:space:]': '\\p{Z}\\t\\r\\n\\v\\f',
  '[:upper:]': '\\p{Lu}',
  '[:word:]': '\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}',
  '[:xdigit:]': 'A-Fa-f0-9',
};

/**
 * Parse a character class [abc] or [a-z] or [[:alpha:]]
 * Returns [regexSource, needsUnicodeFlag]
 */
function parseCharacterClass(pattern: string, pos: number): [string, boolean, number] | null {
  if (pattern[pos] !== '[') return null;

  let i = pos + 1;
  let negate = false;
  let ranges: string[] = [];
  let needsUFlag = false;

  // Check for negation
  if (pattern[i] === '!' || pattern[i] === '^') {
    negate = true;
    i++;
  }

  let rangeStart = '';
  while (i < pattern.length) {
    const c = pattern[i];

    // End of character class
    if (c === ']' && i > pos + 1) {
      const result = negate ? `[^${ranges.join('')}]` : `[${ranges.join('')}]`;
      return [result, needsUFlag, i + 1];
    }

    // Check for POSIX character class
    if (c === '[' && pattern[i + 1] === ':') {
      for (const [posixClass, unicodePattern] of Object.entries(POSIX_CLASSES)) {
        if (pattern.startsWith(posixClass, i)) {
          ranges.push(unicodePattern);
          needsUFlag = unicodePattern.includes('\\p{');
          i += posixClass.length;
          continue;
        }
      }
    }

    // Handle range a-z
    if (pattern[i + 1] === '-' && pattern[i + 2] && pattern[i + 2] !== ']') {
      const start = c;
      const end = pattern[i + 2];
      if (end > start) {
        ranges.push(`${escapeRegexChar(start)}-${escapeRegexChar(end)}`);
      } else {
        ranges.push(escapeRegexChar(start));
      }
      i += 3;
      continue;
    }

    // Single character
    ranges.push(escapeRegexChar(c));
    i++;
  }

  // Unclosed bracket - treat as literal
  return null;
}

/**
 * Escape special regex characters for use in character class
 */
function escapeRegexChar(char: string): string {
  return char.replace(/[[\]\\-]/g, '\\$&');
}

/**
 * Escape all regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert GLOB pattern to regex pattern for Neo4j
 *
 * Two modes:
 * 1. String mode (default): Simple glob for entity names/identifiers where `*` matches everything
 * 2. File path mode: Full glob support for file paths where `*` doesn't match `/`
 *
 * Supported features:
 * - Basic wildcards: `*`, `?`
 * - Character classes: `[abc]`, `[a-z]`, `[^abc]`
 * - POSIX classes: `[[:alpha:]]`, `[[:digit:]]`, etc.
 * - Globstar: `**` for directory traversal (file path mode)
 *
 * Examples for string patterns (isFilePath=false):
 * - `*Service` matches "AuthService", "UserService", "src/AuthService"
 * - `Auth*` matches "AuthService", "Authentication"
 * - `?ame` matches "name", "game", "same"
 * - `*auth*` matches "authentication", "src/auth/service.ts", "myauth"
 * - `[A-Z]*` matches "AuthService", "UserService"
 *
 * Examples for file path patterns (isFilePath=true):
 * - `*.ts` matches "file.ts" but NOT "src/file.ts"
 * - `**\/*.ts` matches "file.ts", "src/file.ts", "src/sub/file.ts"
 * - `**\/auth/*` matches files in any auth directory
 * - `src/**` matches everything under src/
 *
 * @param globPattern - Shell-style glob pattern
 * @param isFilePath - If true, respects path separators; if false, `*` matches everything
 * @returns Regex pattern string suitable for Neo4j =~ operator, or null if invalid
 */
export function globToRegex(globPattern: string, isFilePath: boolean = false): string | null {
  // Fast-path optimizations for common patterns
  if (!isFilePath) {
    // String mode optimizations
    if (globPattern === '*') {
      return '^.+$'; // Match any non-empty string
    }
    if (/^\*+(\.[a-zA-Z0-9]+)$/.test(globPattern)) {
      // *.ext pattern - just check endsWith
      const ext = globPattern.match(/(\.[a-zA-Z0-9]+)$/)?.[1];
      if (ext) {
        return '^.*' + escapeRegex(ext) + '$';
      }
    }
    if (/^\?+$/.test(globPattern)) {
      // ???... pattern - exact length check
      return '^.{' + globPattern.length + '}$';
    }
  }

  try {
    let regex = '';
    let i = 0;
    let needsUFlag = false;

    while (i < globPattern.length) {
      const c = globPattern[i];

      // Globstar **
      if (c === '*' && globPattern[i + 1] === '*') {
        if (isFilePath) {
          // In file path mode, ** matches 0 or more directories
          // Use negative lookahead to avoid matching . and ..
          i += 2;
          // Check if there's a / after **
          if (globPattern[i] === '/') {
            // **/ pattern - match 0+ directories followed by optional /
            // This allows **/*.ts to match both file.ts and src/file.ts
            regex += '(?:(?:(?!(?:\\/|^)(?:\\.{1,2})(?:$|\\/)).)*?\\/)?';
            i++;
          } else {
            // ** at end or before non-/ - match everything
            regex += '(?:(?!(?:\\/|^)(?:\\.{1,2})(?:$|\\/)).)*?';
          }
        } else {
          // In string mode, ** is same as *
          regex += '.*';
          i += 2;
        }
        continue;
      }

      // Single wildcard *
      if (c === '*') {
        if (isFilePath) {
          // In file path mode, * doesn't match /
          regex += '[^\\/]*?'; // Non-greedy
        } else {
          // In string mode, * matches everything
          regex += '.*';
        }
        i++;
        continue;
      }

      // Single character wildcard ?
      if (c === '?') {
        if (isFilePath) {
          regex += '[^\\/]'; // Don't match /
        } else {
          regex += '.'; // Match any character
        }
        i++;
        continue;
      }

      // Character class [abc] or [a-z]
      if (c === '[') {
        const classResult = parseCharacterClass(globPattern, i);
        if (classResult) {
          const [classRegex, needsU, endPos] = classResult;
          regex += classRegex;
          needsUFlag = needsUFlag || needsU;
          i = endPos;
          continue;
        }
        // If parsing failed, treat [ as literal
        regex += '\\[';
        i++;
        continue;
      }

      // Literal character - escape if special regex char
      if (/[.*+?^${}()|[\]\\]/.test(c)) {
        regex += '\\' + c;
      } else {
        regex += c;
      }
      i++;
    }

    // Anchor to start and end
    regex = '^' + regex + '$';

    // Validate the regex
    try {
      new RegExp(regex, needsUFlag ? 'u' : '');
    } catch (e) {
      return null;
    }

    return regex;
  } catch (error) {
    return null;
  }
}

/**
 * Test if a string matches a GLOB pattern
 *
 * @param text - Text to test
 * @param globPattern - GLOB pattern
 * @param isFilePath - If true, `*` won't match `/` (default: false)
 * @returns True if text matches pattern
 */
export function matchesGlob(text: string, globPattern: string, isFilePath: boolean = false): boolean {
  const regexPattern = globToRegex(globPattern, isFilePath);
  if (!regexPattern) {
    return false; // Invalid pattern
  }

  // Check if pattern needs Unicode flag
  const needsUFlag = regexPattern.includes('\\p{');
  const regex = new RegExp(regexPattern, needsUFlag ? 'u' : '');
  return regex.test(text);
}

/**
 * Validate if a regex pattern is valid
 *
 * @param regexPattern - Regex pattern string
 * @returns True if pattern is valid regex
 */
export function isValidRegex(regexPattern: string): boolean {
  try {
    new RegExp(regexPattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert pattern operator to Neo4j Cypher operator
 *
 * Used by QueryBuilder to convert tool operators to Cypher
 *
 * @param operator - Operator from tool call (GLOB, REGEX, CONTAINS, etc.)
 * @param value - Value to match
 * @returns Object with Neo4j operator and potentially transformed value
 */
export function convertPatternOperator(
  operator: string,
  value: any
): { cypherOperator: string; cypherValue: any } {
  switch (operator) {
    case 'GLOB':
      // Convert GLOB to regex pattern for Neo4j =~
      const regexPattern = globToRegex(value);
      if (!regexPattern) {
        throw new Error(`Invalid GLOB pattern: ${value}`);
      }
      return {
        cypherOperator: '=~',
        cypherValue: regexPattern,
      };

    case 'REGEX':
      // Pass through regex directly to Neo4j =~
      return {
        cypherOperator: '=~',
        cypherValue: value,
      };

    case 'CONTAINS':
      // Neo4j CONTAINS operator (case-sensitive substring)
      return {
        cypherOperator: 'CONTAINS',
        cypherValue: value,
      };

    case 'STARTS WITH':
      // Neo4j STARTS WITH operator
      return {
        cypherOperator: 'STARTS WITH',
        cypherValue: value,
      };

    case 'ENDS WITH':
      // Neo4j ENDS WITH operator
      return {
        cypherOperator: 'ENDS WITH',
        cypherValue: value,
      };

    case 'IN':
      // Neo4j IN operator
      return {
        cypherOperator: 'IN',
        cypherValue: value,
      };

    default:
      // For =, !=, >, >=, <, <=
      return {
        cypherOperator: operator,
        cypherValue: value,
      };
  }
}

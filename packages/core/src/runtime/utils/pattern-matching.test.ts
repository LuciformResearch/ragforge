/**
 * Pattern Matching Tests
 */

import { describe, it, expect } from 'vitest';
import { globToRegex, matchesGlob, isValidRegex, convertPatternOperator } from './pattern-matching.js';

describe('pattern-matching', () => {
  describe('globToRegex', () => {
    it('should convert simple wildcard patterns in string mode', () => {
      const pattern1 = globToRegex('*Service');
      expect(pattern1).toBe('^.*Service$');
      expect(new RegExp(pattern1).test('AuthService')).toBe(true);
      expect(new RegExp(pattern1).test('UserService')).toBe(true);

      const pattern2 = globToRegex('Auth*');
      expect(pattern2).toBe('^Auth.*$');
      expect(new RegExp(pattern2).test('AuthService')).toBe(true);
      expect(new RegExp(pattern2).test('Auth')).toBe(true);
    });

    it('should convert ? for single character', () => {
      const pattern = globToRegex('?ame');
      expect(pattern).toBe('^.ame$');
      expect(new RegExp(pattern).test('name')).toBe(true);
      expect(new RegExp(pattern).test('game')).toBe(true);
      expect(new RegExp(pattern).test('same')).toBe(true);
      expect(new RegExp(pattern).test('frame')).toBe(false); // too long
      expect(new RegExp(pattern).test('ame')).toBe(false); // too short
    });

    it('should handle multiple wildcards in string mode', () => {
      const pattern = globToRegex('*auth*.ts');
      const regex = new RegExp(pattern);
      // String mode: * matches everything including /
      expect(regex.test('auth.ts')).toBe(true);
      expect(regex.test('auth-service.ts')).toBe(true);
      expect(regex.test('my-auth-helper.ts')).toBe(true);
      expect(regex.test('src/auth/service.ts')).toBe(true); // matches in string mode
      expect(regex.test('auth.js')).toBe(false);
    });

    it('should handle file path mode correctly', () => {
      // In file path mode, * doesn't match /
      const pattern1 = globToRegex('*.ts', true);
      expect(new RegExp(pattern1).test('file.ts')).toBe(true);
      expect(new RegExp(pattern1).test('src/file.ts')).toBe(false); // * doesn't match /

      // Use ** to match across directories
      const pattern2 = globToRegex('**/*.ts', true);
      expect(new RegExp(pattern2).test('file.ts')).toBe(true);
      expect(new RegExp(pattern2).test('src/file.ts')).toBe(true);
      expect(new RegExp(pattern2).test('src/sub/file.ts')).toBe(true);
    });

    it('should escape regex special characters', () => {
      const pattern = globToRegex('file.test.ts');
      // Dots should be escaped
      expect(new RegExp(pattern).test('file.test.ts')).toBe(true);
      expect(new RegExp(pattern).test('fileXtestXts')).toBe(false);
    });
  });

  describe('matchesGlob', () => {
    it('should match basic patterns', () => {
      expect(matchesGlob('AuthService', '*Service')).toBe(true);
      expect(matchesGlob('UserService', '*Service')).toBe(true);
      expect(matchesGlob('Service', '*Service')).toBe(true);
      expect(matchesGlob('ServiceAuth', '*Service')).toBe(false);
    });

    it('should match prefix patterns', () => {
      expect(matchesGlob('AuthService', 'Auth*')).toBe(true);
      expect(matchesGlob('AuthHelper', 'Auth*')).toBe(true);
      expect(matchesGlob('UserAuth', 'Auth*')).toBe(false);
    });

    it('should match middle patterns', () => {
      // Note: * doesn't match path separators by default
      expect(matchesGlob('authentication.ts', '*auth*')).toBe(true);
      expect(matchesGlob('myauthcode.ts', '*auth*')).toBe(true);
      expect(matchesGlob('auth-service', '*auth*')).toBe(true);
      expect(matchesGlob('service.ts', '*auth*')).toBe(false);
    });

    it('should match paths with **', () => {
      // Use ** for matching across directories (file path mode)
      // **/*auth* matches files with "auth" in the filename
      expect(matchesGlob('src/auth-service.ts', '**/*auth*', true)).toBe(true);
      expect(matchesGlob('auth.ts', '**/*auth*', true)).toBe(true);
      expect(matchesGlob('sub/dir/my-auth-file.ts', '**/*auth*', true)).toBe(true);

      // **/auth/* matches files in an "auth" directory
      expect(matchesGlob('src/auth/service.ts', '**/auth/*', true)).toBe(true);
      expect(matchesGlob('auth/service.ts', '**/auth/*', true)).toBe(true);

      // **/*service* matches files with "service" in the filename
      expect(matchesGlob('service.ts', '**/*service*', true)).toBe(true);
      expect(matchesGlob('src/my-service.ts', '**/*service*', true)).toBe(true);
    });

    it('should match single character wildcard', () => {
      expect(matchesGlob('name', '?ame')).toBe(true);
      expect(matchesGlob('game', '?ame')).toBe(true);
      expect(matchesGlob('same', '?ame')).toBe(true);
      expect(matchesGlob('frame', '?ame')).toBe(false);
      expect(matchesGlob('ame', '?ame')).toBe(false);
    });

    it('should be case-sensitive by default', () => {
      expect(matchesGlob('AuthService', '*service')).toBe(false);
      expect(matchesGlob('AuthService', '*Service')).toBe(true);
      expect(matchesGlob('authservice', '*service')).toBe(true);
    });
  });

  describe('isValidRegex', () => {
    it('should validate correct regex patterns', () => {
      expect(isValidRegex('.*Service$')).toBe(true);
      expect(isValidRegex('^Auth.*')).toBe(true);
      expect(isValidRegex('[a-z]+')).toBe(true);
      expect(isValidRegex('\\d{3}')).toBe(true);
    });

    it('should reject invalid regex patterns', () => {
      expect(isValidRegex('[')).toBe(false);
      expect(isValidRegex('(unclosed')).toBe(false);
      expect(isValidRegex('*')).toBe(false);
    });
  });

  describe('matchesGlob - negative cases', () => {
    it('should NOT match when pattern does not fit', () => {
      // Suffix patterns
      expect(matchesGlob('ServiceAuth', '*Service')).toBe(false);
      expect(matchesGlob('myService', '*Auth')).toBe(false);

      // Prefix patterns
      expect(matchesGlob('ServiceAuth', 'Auth*')).toBe(false);
      expect(matchesGlob('UserService', 'Auth*')).toBe(false);

      // Middle patterns
      expect(matchesGlob('service.ts', '*auth*')).toBe(false);
      expect(matchesGlob('file.js', '*auth*')).toBe(false);

      // Case sensitivity
      expect(matchesGlob('authservice', '*Auth*')).toBe(false);
      expect(matchesGlob('AUTHSERVICE', '*auth*')).toBe(false);
    });

    it('should NOT match wrong character count with ?', () => {
      expect(matchesGlob('frame', '?ame')).toBe(false); // too long
      expect(matchesGlob('ame', '?ame')).toBe(false); // too short
      expect(matchesGlob('names', '?ame')).toBe(false); // too long
      expect(matchesGlob('am', '?ame')).toBe(false); // too short
    });

    it('should NOT match outside character class', () => {
      expect(matchesGlob('dame', '[g-z]ame')).toBe(false); // d not in g-z (d < g)
      expect(matchesGlob('came', '[g-z]ame')).toBe(false); // c not in g-z (c < g)
      expect(matchesGlob('1ame', '[a-z]ame')).toBe(false); // digit not in a-z
      expect(matchesGlob('Name', '[a-z]ame')).toBe(false); // uppercase not in lowercase range
      expect(matchesGlob('!ame', '[a-z]ame')).toBe(false); // special char not in a-z
    });

    it('should NOT match negated character class', () => {
      expect(matchesGlob('name', '[^n]ame')).toBe(false); // n is negated
      expect(matchesGlob('game', '[^g]ame')).toBe(false); // g is negated
      expect(matchesGlob('same', '[^s]ame')).toBe(false); // s is negated
    });

    it('should respect path separators in file path mode', () => {
      // * should NOT match / in file path mode
      expect(matchesGlob('src/file.ts', '*.ts', true)).toBe(false);
      expect(matchesGlob('dir/subdir/file.js', '*.js', true)).toBe(false);

      // ** required to cross directories
      expect(matchesGlob('src/file.ts', '*file.ts', true)).toBe(false);

      // Wrong directory structure
      expect(matchesGlob('src/service.ts', '**/auth/*', true)).toBe(false);
      expect(matchesGlob('other/file.ts', '**/auth/*', true)).toBe(false);
    });

    it('should NOT match empty strings incorrectly', () => {
      expect(matchesGlob('', '*Service')).toBe(false);
      expect(matchesGlob('', '?ame')).toBe(false);
      expect(matchesGlob('', '[abc]')).toBe(false);
    });

    it('should NOT match partial patterns', () => {
      // Pattern must match full string
      expect(matchesGlob('AuthServiceImpl', 'AuthService')).toBe(false);
      expect(matchesGlob('MyAuthService', 'AuthService')).toBe(false);
      expect(matchesGlob('prefix-auth-suffix', 'auth')).toBe(false);
    });

    it('should handle invalid patterns gracefully', () => {
      // Unclosed brackets should not match or return null
      const invalidPattern = globToRegex('[abc', false);
      if (invalidPattern) {
        expect(new RegExp(invalidPattern).test('a')).toBe(false);
      } else {
        expect(invalidPattern).toBeNull();
      }
    });

    it('should NOT match with wrong file extensions', () => {
      expect(matchesGlob('file.ts', '*.js')).toBe(false);
      expect(matchesGlob('file.tsx', '*.ts')).toBe(false);
      expect(matchesGlob('file.ts.backup', '*.ts')).toBe(false); // .ts not at end
      expect(matchesGlob('filejs', '*.js')).toBe(false); // missing dot
    });

    it('should NOT match in string mode vs file path mode', () => {
      // In string mode, * matches /
      expect(matchesGlob('src/file.ts', '*auth*', false)).toBe(false); // no 'auth' anywhere

      // In file path mode, * doesn't match /
      expect(matchesGlob('src/file.ts', 'src*file.ts', true)).toBe(false); // * can't bridge the /
    });

    it('should NOT match special regex characters literally', () => {
      // These should be escaped and match literally
      expect(matchesGlob('test', 'te.t')).toBe(false); // . should not be wildcard
      expect(matchesGlob('test', 'te+t')).toBe(false); // + should not be regex +
      expect(matchesGlob('test', 't(es)t')).toBe(false); // () should not be group
    });
  });

  describe('convertPatternOperator', () => {
    it('should convert GLOB to regex', () => {
      const result = convertPatternOperator('GLOB', '*Service');
      expect(result.cypherOperator).toBe('=~');
      expect(result.cypherValue).toContain('Service');
    });

    it('should pass through REGEX', () => {
      const result = convertPatternOperator('REGEX', '.*Service$');
      expect(result.cypherOperator).toBe('=~');
      expect(result.cypherValue).toBe('.*Service$');
    });

    it('should handle CONTAINS', () => {
      const result = convertPatternOperator('CONTAINS', 'auth');
      expect(result.cypherOperator).toBe('CONTAINS');
      expect(result.cypherValue).toBe('auth');
    });

    it('should handle STARTS WITH', () => {
      const result = convertPatternOperator('STARTS WITH', 'Auth');
      expect(result.cypherOperator).toBe('STARTS WITH');
      expect(result.cypherValue).toBe('Auth');
    });

    it('should handle ENDS WITH', () => {
      const result = convertPatternOperator('ENDS WITH', 'Service');
      expect(result.cypherOperator).toBe('ENDS WITH');
      expect(result.cypherValue).toBe('Service');
    });

    it('should handle IN', () => {
      const result = convertPatternOperator('IN', ['AuthService', 'UserService']);
      expect(result.cypherOperator).toBe('IN');
      expect(result.cypherValue).toEqual(['AuthService', 'UserService']);
    });

    it('should pass through comparison operators', () => {
      expect(convertPatternOperator('=', 'value').cypherOperator).toBe('=');
      expect(convertPatternOperator('!=', 'value').cypherOperator).toBe('!=');
      expect(convertPatternOperator('>', 10).cypherOperator).toBe('>');
      expect(convertPatternOperator('<=', 100).cypherOperator).toBe('<=');
    });
  });
});

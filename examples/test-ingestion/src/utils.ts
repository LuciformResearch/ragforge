/**
 * Utility functions for the test project
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
}

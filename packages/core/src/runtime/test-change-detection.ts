/**
 * Test file for change detection
 * This file will be modified to test incremental ingestion
 */

export function testFunction() {
  console.log('Modified version - testing incremental ingestion!');
  console.log('Adding a second log line to test change detection');
  return 100; // Changed return value
}

export class TestClass {
  constructor(public name: string) {}

  greet() {
    return `Hello, ${this.name}!`;
  }
}

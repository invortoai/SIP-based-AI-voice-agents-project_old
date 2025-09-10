/* Fallback Jest globals to prevent editor/tsserver errors when @types/jest is unavailable locally.
   CI uses ts-jest with proper types; these declarations are no-ops for type checking only. */

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>, timeout?: number): void;
declare function it(name: string, fn: () => void | Promise<void>, timeout?: number): void;

declare function beforeAll(fn: () => void | Promise<void>, timeout?: number): void;
declare function afterAll(fn: () => void | Promise<void>, timeout?: number): void;
declare function beforeEach(fn: () => void | Promise<void>, timeout?: number): void;
declare function afterEach(fn: () => void | Promise<void>, timeout?: number): void;

interface BasicMatchers {
  toBe(value: any): void;
  toEqual(value: any): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeGreaterThan(value: number): void;
  toBeLessThan(value: number): void;
  toBeGreaterThanOrEqual(value: number): void;
  toBeLessThanOrEqual(value: number): void;
  // Permit other matchers without failing type-check
  [key: string]: any;
}

declare function expect<T = any>(actual: T): BasicMatchers;

declare namespace jest {
  type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = {
    (...args: Parameters<T>): ReturnType<T>;
    mock: {
      calls: any[];
      instances: any[];
      results: any[];
    };
  } & Partial<T>;

  function fn<T extends (...args: any[]) => any>(impl?: T): Mock<T>;
  function spyOn<T extends object, K extends keyof T>(object: T, method: K): any;
}
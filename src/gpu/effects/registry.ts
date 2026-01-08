/**
 * Effect Registry
 *
 * Manages registration and retrieval of GPU effects.
 */

import type { GPUContext } from '../GPUContext';
import type { Effect } from './Effect';
import type { EffectDefinition, EffectCategory } from '../types';

// Effect constructor type
type EffectConstructor = new (definition: EffectDefinition) => Effect;

interface RegisteredEffect {
  definition: EffectDefinition;
  constructor: EffectConstructor;
}

class EffectRegistry {
  private effects: Map<string, RegisteredEffect> = new Map();
  private compiledEffects: Map<string, Effect> = new Map();

  /**
   * Register an effect
   */
  register(
    definition: EffectDefinition,
    constructor: EffectConstructor
  ): void {
    if (this.effects.has(definition.name)) {
      console.warn(`Effect "${definition.name}" already registered, overwriting`);
    }
    this.effects.set(definition.name, { definition, constructor });
  }

  /**
   * Check if an effect is registered
   */
  has(name: string): boolean {
    return this.effects.has(name);
  }

  /**
   * Get an effect definition
   */
  getDefinition(name: string): EffectDefinition | undefined {
    return this.effects.get(name)?.definition;
  }

  /**
   * Get all registered effect definitions
   */
  getAllDefinitions(): EffectDefinition[] {
    return Array.from(this.effects.values()).map((e) => e.definition);
  }

  /**
   * Get effects by category
   */
  getByCategory(category: EffectCategory): EffectDefinition[] {
    return this.getAllDefinitions().filter((d) => d.category === category);
  }

  /**
   * Create an effect instance
   */
  create(name: string): Effect {
    const registered = this.effects.get(name);
    if (!registered) {
      throw new Error(`Effect "${name}" not registered`);
    }
    return new registered.constructor(registered.definition);
  }

  /**
   * Get or create a compiled effect instance
   * Effects are compiled once and reused
   */
  getCompiled(name: string, context: GPUContext): Effect {
    let effect = this.compiledEffects.get(name);

    if (!effect) {
      effect = this.create(name);
      effect.compile(context);
      this.compiledEffects.set(name, effect);
    }

    return effect;
  }

  /**
   * Dispose of all compiled effects
   */
  disposeAll(context: GPUContext): void {
    for (const effect of this.compiledEffects.values()) {
      effect.dispose(context);
    }
    this.compiledEffects.clear();
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.effects.clear();
    this.compiledEffects.clear();
  }
}

// Singleton instance
export const effectRegistry = new EffectRegistry();

import { MutationBuilder } from '@luciformresearch/ragforge-runtime';
import type { Scope, ScopeCreate, ScopeUpdate } from '../types.js';

/**
 * Mutation operations for Scope entities
 */
export class ScopeMutations extends MutationBuilder<Scope> {

  /**
   * Create a new Scope
   * @param data - Scope data (must include uuid)
   * @returns The created Scope
   */
  async create(data: ScopeCreate): Promise<Scope> {
    return super.create(data);
  }

  /**
   * Create multiple Scope entities in a single transaction
   * @param items - Array of Scope data
   * @returns Array of created Scope entities
   */
  async createBatch(items: ScopeCreate[]): Promise<Scope[]> {
    return super.createBatch(items);
  }

  /**
   * Update an existing Scope
   * @param uuid - Unique identifier
   * @param data - Fields to update
   * @returns The updated Scope
   */
  async update(uuid: string, data: ScopeUpdate): Promise<Scope> {
    return super.update(uuid, data);
  }

  /**
   * Delete a Scope by uuid
   * @param uuid - Unique identifier
   */
  async delete(uuid: string): Promise<void> {
    return super.delete(uuid);
  }

}
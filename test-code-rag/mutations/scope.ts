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

  /**
   * Add DEFINED_IN relationship to File
   * Scope DEFINED_IN File
   * @param uuid - Source Scope unique identifier
   * @param targetFileUuid - Target File unique identifier
   */
  async addDefinedIn(uuid: string, targetFileUuid: string): Promise<void> {
    return this.addRelationship(uuid, {
      type: 'DEFINED_IN',
      target: targetFileUuid,
      targetLabel: 'File',
    });
  }

  /**
   * Remove DEFINED_IN relationship to File
   * @param uuid - Source Scope unique identifier
   * @param targetFileUuid - Target File unique identifier
   */
  async removeDefinedIn(uuid: string, targetFileUuid: string): Promise<void> {
    return this.removeRelationship(uuid, {
      type: 'DEFINED_IN',
      target: targetFileUuid,
      targetLabel: 'File'
    });
  }

  /**
   * Add CONSUMES relationship to Scope
   * Scope CONSUMES Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async addConsumes(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.addRelationship(uuid, {
      type: 'CONSUMES',
      target: targetScopeUuid,
    });
  }

  /**
   * Remove CONSUMES relationship to Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async removeConsumes(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.removeRelationship(uuid, {
      type: 'CONSUMES',
      target: targetScopeUuid
    });
  }

  /**
   * Add HAS_PARENT relationship to Scope
   * Scope HAS_PARENT Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async addHasParent(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.addRelationship(uuid, {
      type: 'HAS_PARENT',
      target: targetScopeUuid,
    });
  }

  /**
   * Remove HAS_PARENT relationship to Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async removeHasParent(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.removeRelationship(uuid, {
      type: 'HAS_PARENT',
      target: targetScopeUuid
    });
  }

  /**
   * Add USES_LIBRARY relationship to ExternalLibrary
   * Scope USES_LIBRARY ExternalLibrary
   * @param uuid - Source Scope unique identifier
   * @param targetExternalLibraryUuid - Target ExternalLibrary unique identifier
   */
  async addUsesLibrary(uuid: string, targetExternalLibraryUuid: string): Promise<void> {
    return this.addRelationship(uuid, {
      type: 'USES_LIBRARY',
      target: targetExternalLibraryUuid,
      targetLabel: 'ExternalLibrary',
    });
  }

  /**
   * Remove USES_LIBRARY relationship to ExternalLibrary
   * @param uuid - Source Scope unique identifier
   * @param targetExternalLibraryUuid - Target ExternalLibrary unique identifier
   */
  async removeUsesLibrary(uuid: string, targetExternalLibraryUuid: string): Promise<void> {
    return this.removeRelationship(uuid, {
      type: 'USES_LIBRARY',
      target: targetExternalLibraryUuid,
      targetLabel: 'ExternalLibrary'
    });
  }

  /**
   * Add INHERITS_FROM relationship to Scope
   * Scope INHERITS_FROM Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async addInheritsFrom(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.addRelationship(uuid, {
      type: 'INHERITS_FROM',
      target: targetScopeUuid,
    });
  }

  /**
   * Remove INHERITS_FROM relationship to Scope
   * @param uuid - Source Scope unique identifier
   * @param targetScopeUuid - Target Scope unique identifier
   */
  async removeInheritsFrom(uuid: string, targetScopeUuid: string): Promise<void> {
    return this.removeRelationship(uuid, {
      type: 'INHERITS_FROM',
      target: targetScopeUuid
    });
  }

}
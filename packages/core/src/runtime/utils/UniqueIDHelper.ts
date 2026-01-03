/**
 * UniqueIDHelper - Generate and manage unique identifiers
 * Adapted from lr_webgpu_rendering_library
 */

import { createHash } from 'crypto';

export class UniqueIDHelper {
  private static _ObjById: Record<string, any> = {};
  private static _Lut: string[] | undefined = undefined;

  private static get Lut(): string[] {
    if (this._Lut === undefined) {
      const res: string[] = [];
      for (let i = 0; i < 256; i++) {
        res[i] = (i < 16 ? '0' : '') + i.toString(16);
      }
      this._Lut = res;
    }
    return this._Lut;
  }

  /**
   * Generate a deterministic UUID from input string
   * Uses SHA-256 hash to ensure the same input always produces the same UUID
   * @param input String to hash (e.g., "file.ts:MyClass:class:10")
   * @returns A deterministic UUID string
   */
  public static GenerateDeterministicUUID(input: string): string {
    const hash = createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 32);

    // Format as UUID: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
    return (
      hash.substring(0, 8) + '-' +
      hash.substring(8, 12) + '-' +
      hash.substring(12, 16) + '-' +
      hash.substring(16, 20) + '-' +
      hash.substring(20, 32)
    ).toUpperCase();
  }

  /**
   * Generate a RFC4122 v4 compliant UUID (random)
   * @returns A UUID string (e.g., "A3F2B9C1-D4E5-46F7-8A9B-0C1D2E3F4A5B")
   */
  public static GenerateUUID(): string {
    const lut = this.Lut;

    // Generate four random 32-bit numbers
    const d0 = (Math.random() * 0xffffffff) | 0;
    const d1 = (Math.random() * 0xffffffff) | 0;
    const d2 = (Math.random() * 0xffffffff) | 0;
    const d3 = (Math.random() * 0xffffffff) | 0;

    // Build UUID string from bytes
    const uuid =
      lut[d0 & 0xff] +
      lut[(d0 >> 8) & 0xff] +
      lut[(d0 >> 16) & 0xff] +
      lut[(d0 >> 24) & 0xff] +
      '-' +
      lut[d1 & 0xff] +
      lut[(d1 >> 8) & 0xff] +
      '-' +
      lut[((d1 >> 16) & 0x0f) | 0x40] +
      lut[(d1 >> 24) & 0xff] +
      '-' +
      lut[(d2 & 0x3f) | 0x80] +
      lut[(d2 >> 8) & 0xff] +
      '-' +
      lut[(d2 >> 16) & 0xff] +
      lut[(d2 >> 24) & 0xff] +
      lut[d3 & 0xff] +
      lut[(d3 >> 8) & 0xff] +
      lut[(d3 >> 16) & 0xff] +
      lut[(d3 >> 24) & 0xff];

    return uuid.toUpperCase();
  }

  /**
   * Get or create a UUID for an object
   * @param obj Object to get/assign UUID to
   * @returns The object's UUID
   */
  public static GetUUID(obj: any): string {
    if (obj.uuid === undefined) {
      let uuid = this.GenerateUUID();
      while (this._ObjById[uuid] !== undefined) {
        uuid = this.GenerateUUID();
      }
      obj.uuid = uuid;
      this._ObjById[uuid] = obj;
    }
    return obj.uuid;
  }

  /**
   * Get object by UUID
   * @param uuid UUID to look up
   * @returns The object associated with this UUID, or undefined
   */
  public static GetObjectById(uuid: string): any {
    return this._ObjById[uuid];
  }

  /**
   * Clear the UUID registry (useful for testing)
   */
  public static Clear(): void {
    this._ObjById = {};
  }

  // ==========================================================================
  // Conversation-specific UUID generators
  // ==========================================================================

  /**
   * Generate a deterministic UUID for a message in a conversation
   * Same conversation + turn + role = same UUID (idempotent)
   * @param conversationId The conversation UUID
   * @param turnIndex The turn index (0-based position in conversation)
   * @param role The message role ('user' | 'assistant' | 'system')
   * @param subIndex Optional sub-index for multiple messages of same role in a turn (default: 0)
   * @returns A deterministic UUID string
   */
  public static GenerateMessageUUID(
    conversationId: string,
    turnIndex: number,
    role: 'user' | 'assistant' | 'system',
    subIndex: number = 0
  ): string {
    const input = `msg:${conversationId}:${turnIndex}:${role}:${subIndex}`;
    return this.GenerateDeterministicUUID(input);
  }

  /**
   * Generate a deterministic UUID for a summary (L1, L2, etc.)
   * Same conversation + level + turn range = same UUID (no duplicate summaries)
   * @param conversationId The conversation UUID
   * @param level The summary level (1, 2, etc.)
   * @param startTurnIndex The first turn index covered by this summary
   * @param endTurnIndex The last turn index covered by this summary
   * @returns A deterministic UUID string
   */
  public static GenerateSummaryUUID(
    conversationId: string,
    level: number,
    startTurnIndex: number,
    endTurnIndex: number
  ): string {
    const input = `L${level}:${conversationId}:turn${startTurnIndex}-${endTurnIndex}`;
    return this.GenerateDeterministicUUID(input);
  }

  /**
   * Generate a deterministic UUID for a tool call
   * Same message + tool name + call index = same UUID
   * @param messageId The parent message UUID
   * @param toolName The tool being called
   * @param callIndex The index of this call within the message (for multiple calls)
   * @returns A deterministic UUID string
   */
  public static GenerateToolCallUUID(
    messageId: string,
    toolName: string,
    callIndex: number = 0
  ): string {
    const input = `tc:${messageId}:${toolName}:${callIndex}`;
    return this.GenerateDeterministicUUID(input);
  }

  /**
   * Generate a deterministic UUID for a tool result
   * Based on the tool call UUID
   * @param toolCallId The parent tool call UUID
   * @returns A deterministic UUID string
   */
  public static GenerateToolResultUUID(toolCallId: string): string {
    const input = `tr:${toolCallId}`;
    return this.GenerateDeterministicUUID(input);
  }

  // ==========================================================================
  // File-specific UUID generators
  // ==========================================================================

  /**
   * Generate a deterministic UUID for a file based on its absolute path
   * This ensures the same file always gets the same UUID, regardless of
   * whether it's accessed as an orphan (touched-files) or via ingest_directory
   * @param absolutePath The absolute path to the file
   * @returns A deterministic UUID string prefixed with "file:"
   */
  public static GenerateFileUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`file:${absolutePath}`);
    return `file:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a directory based on its path
   * @param dirPath The directory path (absolute)
   * @returns A deterministic UUID string prefixed with "dir:"
   */
  public static GenerateDirectoryUUID(dirPath: string): string {
    const uuid = this.GenerateDeterministicUUID(`dir:${dirPath}`);
    return `dir:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a MarkdownDocument
   * @param absolutePath The absolute path to the markdown file
   * @returns A deterministic UUID string prefixed with "markdown:"
   */
  public static GenerateMarkdownDocumentUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`markdown:${absolutePath}`);
    return `markdown:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a MarkdownSection
   * Identity = file + position (startLine)
   * @param absolutePath The absolute path to the markdown file
   * @param startLine The start line of the section
   * @returns A deterministic UUID string prefixed with "section:"
   */
  public static GenerateMarkdownSectionUUID(absolutePath: string, startLine: number): string {
    const uuid = this.GenerateDeterministicUUID(`section:${absolutePath}:${startLine}`);
    return `section:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a CodeBlock
   * Identity = file + position (startLine)
   * @param absolutePath The absolute path to the file containing the code block
   * @param startLine The start line of the code block
   * @returns A deterministic UUID string prefixed with "codeblock:"
   */
  public static GenerateCodeBlockUUID(absolutePath: string, startLine: number): string {
    const uuid = this.GenerateDeterministicUUID(`codeblock:${absolutePath}:${startLine}`);
    return `codeblock:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a Stylesheet (CSS/SCSS)
   * @param absolutePath The absolute path to the stylesheet file
   * @returns A deterministic UUID string prefixed with "stylesheet:"
   */
  public static GenerateStylesheetUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`stylesheet:${absolutePath}`);
    return `stylesheet:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a VueSFC component
   * @param absolutePath The absolute path to the Vue file
   * @returns A deterministic UUID string prefixed with "vue:"
   */
  public static GenerateVueSFCUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`vue:${absolutePath}`);
    return `vue:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a SvelteComponent
   * @param absolutePath The absolute path to the Svelte file
   * @returns A deterministic UUID string prefixed with "svelte:"
   */
  public static GenerateSvelteComponentUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`svelte:${absolutePath}`);
    return `svelte:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a WebDocument (HTML)
   * @param absolutePath The absolute path to the HTML file
   * @returns A deterministic UUID string prefixed with "webdoc:"
   */
  public static GenerateWebDocumentUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`webdoc:${absolutePath}`);
    return `webdoc:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a GenericFile
   * @param absolutePath The absolute path to the file
   * @returns A deterministic UUID string prefixed with "generic:"
   */
  public static GenerateGenericFileUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`generic:${absolutePath}`);
    return `generic:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a DataFile (JSON, YAML, etc.)
   * @param absolutePath The absolute path to the data file
   * @returns A deterministic UUID string prefixed with "datafile:"
   */
  public static GenerateDataFileUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`datafile:${absolutePath}`);
    return `datafile:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a DataSection within a DataFile
   * @param absolutePath The absolute path to the data file
   * @param sectionPath The JSON path or key path within the data file
   * @returns A deterministic UUID string prefixed with "datasection:"
   */
  public static GenerateDataSectionUUID(absolutePath: string, sectionPath: string): string {
    const uuid = this.GenerateDeterministicUUID(`datasection:${absolutePath}:${sectionPath}`);
    return `datasection:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a CSSVariable
   * @param absolutePath The absolute path to the stylesheet
   * @param variableName The CSS variable name
   * @returns A deterministic UUID string prefixed with "cssvar:"
   */
  public static GenerateCSSVariableUUID(absolutePath: string, variableName: string): string {
    const uuid = this.GenerateDeterministicUUID(`cssvar:${absolutePath}:${variableName}`);
    return `cssvar:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for an ExternalLibrary
   * @param libraryName The name of the external library/package
   * @returns A deterministic UUID string prefixed with "lib:"
   */
  public static GenerateExternalLibraryUUID(libraryName: string): string {
    const uuid = this.GenerateDeterministicUUID(`lib:${libraryName}`);
    return `lib:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for an ExternalURL
   * @param url The external URL
   * @returns A deterministic UUID string prefixed with "url:"
   */
  public static GenerateExternalURLUUID(url: string): string {
    const uuid = this.GenerateDeterministicUUID(`url:${url}`);
    return `url:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a PackageJson
   * @param absolutePath The absolute path to the package.json file
   * @returns A deterministic UUID string prefixed with "pkg:"
   */
  public static GeneratePackageJsonUUID(absolutePath: string): string {
    const uuid = this.GenerateDeterministicUUID(`pkg:${absolutePath}`);
    return `pkg:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a Project
   * @param projectId The project ID
   * @returns A deterministic UUID string prefixed with "proj:"
   */
  public static GenerateProjectUUID(projectId: string): string {
    const uuid = this.GenerateDeterministicUUID(`proj:${projectId}`);
    return `proj:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for a WebPage
   * @param url The page URL
   * @returns A deterministic UUID string prefixed with "webpage:"
   */
  public static GenerateWebPageUUID(url: string): string {
    const uuid = this.GenerateDeterministicUUID(`webpage:${url}`);
    return `webpage:${uuid}`;
  }

  /**
   * Generate a deterministic UUID for an Image node
   * @param absolutePath The absolute path to the file containing the image reference
   * @param line The line number where the image is referenced
   * @returns A deterministic UUID string prefixed with "img:"
   */
  public static GenerateImageUUID(absolutePath: string, line: number): string {
    const uuid = this.GenerateDeterministicUUID(`img:${absolutePath}:${line}`);
    return `img:${uuid}`;
  }

  /**
   * Generate a unique conversation UUID with database collision check
   * Retries with a new random UUID if collision detected
   * @param checkExists Async function that returns true if UUID already exists in DB
   * @param maxRetries Maximum number of retries (default: 10)
   * @returns A unique UUID string
   * @throws Error if max retries exceeded (indicates a serious problem)
   */
  public static async GenerateConversationUUID(
    checkExists: (uuid: string) => Promise<boolean>,
    maxRetries: number = 10
  ): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
      const uuid = this.GenerateUUID();
      const exists = await checkExists(uuid);
      if (!exists) {
        return uuid;
      }
      console.warn(`[UniqueIDHelper] Conversation UUID collision detected, retrying (${i + 1}/${maxRetries})`);
    }
    throw new Error(`Failed to generate unique conversation UUID after ${maxRetries} retries`);
  }
}

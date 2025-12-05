/**
 * Structured Prompt Builder
 *
 * Unified system for building LLM prompts with structured XML outputs.
 * Provides template rendering and response parsing with schema validation.
 *
 * Features:
 * - Simple Handlebars-like template engine
 * - Automatic XML instruction generation from schema
 * - XML response parsing with validation
 * - Support for nested structures
 */

import { LuciformXMLParser } from '@luciformresearch/xmlparser';

/**
 * Field definition for structured output
 */
export interface PromptField {
  /** Field name in XML */
  name: string;

  /** Data type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Human-readable description (shown in prompt) */
  description: string;

  /** Whether this field is required */
  required?: boolean;

  /** For nested objects */
  nested?: PromptField[];

  /** Use XML attributes instead of elements (for simple values) */
  asAttribute?: boolean;
}

/**
 * Configuration for structured prompt
 */
export interface StructuredPromptConfig {
  /** System context / role description */
  systemContext: string;

  /** User task description */
  userTask: string;

  /** Optional examples to show */
  examples?: string;

  /** Expected output format */
  outputFormat: {
    /** Root element name */
    rootElement: string;

    /** Fields in the output */
    fields: PromptField[];
  };

  /** Additional instructions */
  instructions?: string;
}

/**
 * Structured Prompt Builder
 *
 * Builds prompts with templating and parses structured XML responses.
 *
 * @example
 * ```typescript
 * const builder = new StructuredPromptBuilder({
 *   systemContext: 'You analyze code to extract information.',
 *   userTask: 'Analyze this code and extract key details.',
 *   outputFormat: {
 *     rootElement: 'analysis',
 *     fields: [
 *       { name: 'purpose', type: 'string', description: 'What the code does' },
 *       { name: 'concept', type: 'array', description: 'Programming concepts' }
 *     ]
 *   }
 * });
 *
 * const prompt = builder.render({ code: 'function foo() {...}' });
 * const response = await llm.generate(prompt);
 * const parsed = builder.parse(response);
 * ```
 */
export class StructuredPromptBuilder {
  constructor(private config: StructuredPromptConfig) {}

  /**
   * Render prompt with data injection
   *
   * @param data - Data to inject into template (available as {{key}} in templates)
   * @returns Complete prompt string ready for LLM
   */
  render(data: Record<string, any>): string {
    let prompt = '';

    // 1. System context
    prompt += this.renderTemplate(this.config.systemContext, data);
    prompt += '\n\n';

    // 2. User task
    prompt += this.renderTemplate(this.config.userTask, data);
    prompt += '\n\n';

    // 3. Inject data
    prompt += this.formatDataSection(data);
    prompt += '\n\n';

    // 4. Examples (if provided)
    if (this.config.examples) {
      prompt += this.renderTemplate(this.config.examples, data);
      prompt += '\n\n';
    }

    // 5. Output instructions
    prompt += this.generateOutputInstructions();

    return prompt;
  }

  /**
   * Parse XML response according to schema
   *
   * @param response - Raw LLM response (may contain markdown, etc.)
   * @returns Parsed structured data
   */
  parse(response: string): Record<string, any> {
    // Clean response (remove markdown code blocks if present)
    let xmlText = response.trim();

    if (xmlText.includes('```')) {
      const match = xmlText.match(/```(?:xml)?\s*\n?([\s\S]*?)\n?```/);
      if (match && match[1]) {
        xmlText = match[1].trim();
      } else {
        // Fallback: remove lines with backticks
        const lines = xmlText.split('\n');
        xmlText = lines.filter(line => !line.includes('```')).join('\n').trim();
      }
    }

    // Parse XML
    const parser = new LuciformXMLParser(xmlText, { mode: 'luciform-permissive' });
    const result = parser.parse();

    if (!result.document?.root) {
      throw new Error('No XML root element found in response');
    }

    const root = result.document.root;

    // Validate root element name
    if (root.name !== this.config.outputFormat.rootElement) {
      throw new Error(
        `Expected root element <${this.config.outputFormat.rootElement}>, got <${root.name}>`
      );
    }

    // Extract fields according to schema
    return this.extractFields(root, this.config.outputFormat.fields);
  }

  /**
   * Preview output instructions without rendering full prompt
   * Useful for debugging and documentation
   */
  previewInstructions(): string {
    return this.generateOutputInstructions();
  }

  /**
   * Render template with variable substitution
   *
   * Supports:
   * - {{variable}} - simple variable
   * - {{#if variable}}...{{/if}} - conditional
   * - {{#each array}}...{{/each}} - loop (TODO)
   */
  private renderTemplate(template: string, data: Record<string, any>): string {
    let result = template;

    // Replace {{variable}}
    result = result.replace(/\{\{([^}#/]+)\}\}/g, (_, key) => {
      const value = this.getNestedValue(data, key.trim());
      return value !== null && value !== undefined ? String(value) : '';
    });

    // Handle {{#if condition}}...{{/if}}
    result = result.replace(
      /\{\{#if ([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, condition, content) => {
        const value = this.getNestedValue(data, condition.trim());
        return value ? content : '';
      }
    );

    // TODO: {{#each}} loops if needed

    return result;
  }

  /**
   * Get nested value from object (e.g., "entity.name")
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[part];
    }, obj);
  }

  /**
   * Format data section of prompt
   */
  private formatDataSection(data: Record<string, any>): string {
    let section = '';

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;

      const label = this.formatLabel(key);

      if (typeof value === 'string' && value.length > 100) {
        // Multi-line value
        section += `${label}:\n${value}\n\n`;
      } else {
        // Single line value
        section += `${label}: ${String(value)}\n`;
      }
    }

    return section.trim();
  }

  /**
   * Format key as human-readable label
   */
  private formatLabel(key: string): string {
    return key
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Generate output instructions with XML schema
   */
  private generateOutputInstructions(): string {
    let instructions = '';

    instructions += 'IMPORTANT: You MUST respond with XML ONLY. ';
    instructions += 'Do NOT use JSON. Do NOT use markdown code blocks.\n\n';

    if (this.config.instructions) {
      instructions += this.config.instructions + '\n\n';
    }

    instructions += 'Instructions:\n';
    this.config.outputFormat.fields.forEach(field => {
      const required = field.required !== false ? ' (required)' : ' (optional)';
      instructions += `- ${field.name}${required}: ${field.description}\n`;
    });

    instructions += '\nExpected XML format:\n\n';
    instructions += this.generateExampleXML();
    instructions += '\n\nYour XML response:';

    return instructions;
  }

  /**
   * Generate example XML from schema
   */
  private generateExampleXML(indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    let xml = '';

    xml += `${spaces}<${this.config.outputFormat.rootElement}>\n`;

    for (const field of this.config.outputFormat.fields) {
      if (field.asAttribute) {
        // Attributes are shown in opening tag
        continue;
      }

      const fieldSpaces = '  '.repeat(indent + 1);

      if (field.type === 'array') {
        // Show 2 examples for arrays
        xml += `${fieldSpaces}<${field.name}>Example value 1</${field.name}>\n`;
        xml += `${fieldSpaces}<${field.name}>Example value 2</${field.name}>\n`;
      } else if (field.type === 'object' && field.nested) {
        // Nested object
        xml += `${fieldSpaces}<${field.name}>\n`;
        for (const nestedField of field.nested) {
          const nestedSpaces = '  '.repeat(indent + 2);
          xml += `${nestedSpaces}<${nestedField.name}>Example value</${nestedField.name}>\n`;
        }
        xml += `${fieldSpaces}</${field.name}>\n`;
      } else {
        // Simple value
        const exampleValue = this.getExampleValue(field.type);
        xml += `${fieldSpaces}<${field.name}>${exampleValue}</${field.name}>\n`;
      }
    }

    xml += `${spaces}</${this.config.outputFormat.rootElement}>`;

    return xml;
  }

  /**
   * Get example value for field type
   */
  private getExampleValue(type: PromptField['type']): string {
    switch (type) {
      case 'string':
        return 'Example text';
      case 'number':
        return '42';
      case 'boolean':
        return 'true';
      default:
        return 'value';
    }
  }

  /**
   * Extract fields from parsed XML according to schema
   */
  private extractFields(
    element: any,
    fields: PromptField[]
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const field of fields) {
      if (field.asAttribute) {
        // Extract from attributes
        const attrs = element.attributes as Map<string, string>;
        const value = attrs?.get(field.name);
        if (value !== undefined) {
          result[field.name] = this.coerceValue(value, field.type);
        }
      } else if (field.type === 'array') {
        // Extract all elements with this name
        const elements = element.children?.filter(
          (c: any) => c.type === 'element' && c.name === field.name
        ) || [];

        result[field.name] = elements.map((el: any) =>
          this.getTextContent(el)
        );
      } else if (field.type === 'object' && field.nested) {
        // Extract nested object
        const objElement = element.children?.find(
          (c: any) => c.type === 'element' && c.name === field.name
        );

        if (objElement) {
          result[field.name] = this.extractFields(objElement, field.nested);
        }
      } else {
        // Extract single element
        const fieldElement = element.children?.find(
          (c: any) => c.type === 'element' && c.name === field.name
        );

        if (fieldElement) {
          const textValue = this.getTextContent(fieldElement);
          result[field.name] = this.coerceValue(textValue, field.type);
        }
      }

      // Validate required fields
      if (field.required !== false && result[field.name] === undefined) {
        throw new Error(`Required field "${field.name}" not found in response`);
      }
    }

    return result;
  }

  /**
   * Get text content from XML element
   */
  private getTextContent(element: any): string {
    return element.children
      ?.filter((c: any) => c.type === 'text')
      ?.map((c: any) => c.content)
      ?.join('')
      .trim() || '';
  }

  /**
   * Coerce string value to target type
   */
  private coerceValue(value: string, type: PromptField['type']): any {
    switch (type) {
      case 'number':
        return parseFloat(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'string':
      default:
        return value;
    }
  }
}

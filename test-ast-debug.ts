/**
 * Debug AST structure to understand tree-sitter node types
 */
import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers';

const testCode = `
export class CodeSourceAdapter extends SourceAdapter {
  private test: string;

  async buildGraph() {
    return {};
  }
}

export interface QueryBuilder<T extends Entity> {
  where(field: string): this;
}

export enum Status {
  PENDING = 'pending',
  ACTIVE = 'active'
}
`;

async function debug() {
  console.log('🔍 Debugging AST structure via parser API...\n');

  const parser = new TypeScriptLanguageParser();

  // Use internal parser access to get raw AST
  const parserInternal = (parser as any).parser;
  await parserInternal.init();

  const tree = parserInternal.parser.parse(testCode);
  const rootNode = tree.rootNode;

  function printNode(node: any, indent = 0) {
    const prefix = '  '.repeat(indent);
    const text = node.text.length > 50 ? node.text.substring(0, 50) + '...' : node.text;
    console.log(`${prefix}${node.type} "${text.replace(/\n/g, '\\n')}"`);

    if (node.type === 'class_declaration' || node.type === 'interface_declaration' || node.type === 'enum_declaration') {
      console.log(`${prefix}  [FIELDS]:`);
      console.log(`${prefix}    name: ${node.childForFieldName('name')?.text || 'N/A'}`);
      console.log(`${prefix}    type_parameters: ${node.childForFieldName('type_parameters')?.text || 'N/A'}`);
      console.log(`${prefix}    class_heritage: ${node.childForFieldName('class_heritage')?.text || 'N/A'}`);
      console.log(`${prefix}    body: ${node.childForFieldName('body')?.type || 'N/A'}`);
      console.log(`${prefix}  [CHILDREN (${node.children.length})]:`);
      for (const child of node.children) {
        const childText = child.text.length > 30 ? child.text.substring(0, 30) + '...' : child.text;
        console.log(`${prefix}    - ${child.type}: "${childText.replace(/\n/g, '\\n')}"`);
      }
    }

    for (const child of node.children) {
      if (indent < 3 || child.type === 'class_declaration' || child.type === 'interface_declaration' || child.type === 'enum_declaration') {
        printNode(child, indent + 1);
      }
    }
  }

  printNode(rootNode);
}

debug().catch(console.error);

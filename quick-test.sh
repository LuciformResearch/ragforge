#!/bin/bash
# Quick test: just build packages + generate (no full setup)
# Usage: ./quick-test.sh

set -e

echo "⚡ Quick Build & Generate"
echo "========================"
echo ""

# Build packages
echo "📦 Building packages..."
cd packages/runtime && npm run build
cd ../core && npm run build
cd ../cli && npm run build
echo "✓ Packages built"
echo ""

# Generate
echo "📝 Generating test-code-rag..."
cd ../../test-code-rag
node ../packages/cli/dist/esm/index.js generate --config ragforge.config.yaml --out . --force
echo "✓ Generated"
echo ""

echo "✅ Done! Run 'npm run ingest' in test-code-rag to test"

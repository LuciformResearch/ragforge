#!/bin/bash

# Script to reset test project and run quickstart from scratch

echo "🧹 Cleaning up everything..."

# Stop and remove Docker container
echo "  → Removing Docker container..."
docker rm -f ragforge-test-quickstart-neo4j 2>/dev/null || true

# Remove Docker volumes
echo "  → Removing Docker volumes..."
docker volume ls -q | grep -E "(test-quickstart|test-quickstart-minimal)" | xargs -r docker volume rm 2>/dev/null || true

# Clean generated files
echo "  → Removing generated files..."
rm -rf generated/ docker-compose.yml ragforge.config.yaml.backup

echo ""
echo "📝 Recreating minimal config files..."

# Recreate minimal YAML config
cat > ragforge.config.yaml << 'EOF'
name: test-quickstart
version: 1.0.0
description: Minimal config - quickstart will expand this

source:
  type: code
  adapter: typescript
  root: .
  include:
    - "../packages/runtime/src/**/*.ts"
    - "../packages/core/src/**/*.ts"
    - "../packages/cli/src/**/*.ts"
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/*.test.ts"
    - "**/*.spec.ts"
EOF

# Recreate .env with only Gemini key
cat > .env << 'EOF'
# Gemini API Key for embeddings and summarization
GEMINI_API_KEY=AIzaSyDIazESzfh1EWqjrEx_v9ELGCZu4DDaed0
EOF

echo "✓ Config files recreated"
echo ""
echo "🚀 Running quickstart..."
echo ""

# Run quickstart
node ../packages/cli/dist/esm/index.js quickstart --force "$@"

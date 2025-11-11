#!/bin/bash
# Build all RagForge packages + Generate test project + Setup
# Usage: ./build-and-setup.sh

set -e  # Exit on error

echo "🚀 RagForge Complete Build & Setup"
echo "===================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build all packages
echo -e "${YELLOW}📦 Step 1/3: Building all packages${NC}"
echo ""

cd packages/runtime
echo "  Building runtime..."
npm run build
echo -e "${GREEN}  ✓ Runtime built${NC}"
echo ""

cd ../core
echo "  Building core..."
npm run build
echo -e "${GREEN}  ✓ Core built${NC}"
echo ""

cd ../cli
echo "  Building CLI..."
npm run build
echo -e "${GREEN}  ✓ CLI built${NC}"
echo ""

# Step 2: Generate test project
echo -e "${YELLOW}📝 Step 2/3: Generating test-code-rag project${NC}"
echo ""

cd ../../test-code-rag
node ../packages/cli/dist/esm/index.js generate --config ragforge.config.yaml --out . --force

echo -e "${GREEN}✓ Project generated${NC}"
echo ""

# Step 3: Setup (ingest + indexes + embeddings + summaries)
echo -e "${YELLOW}⚙️  Step 3/3: Running setup${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo "Please create .env with:"
    echo "  NEO4J_URI=bolt://localhost:7687"
    echo "  NEO4J_USERNAME=neo4j"
    echo "  NEO4J_PASSWORD=your-password"
    echo "  GEMINI_API_KEY=your-key"
    exit 1
fi

npm run setup

echo ""
echo -e "${GREEN}✅ Complete! All packages built, project generated, and setup finished${NC}"
echo ""
echo "You can now:"
echo "  - Test queries: npm run examples:01-semantic-search-source"
echo "  - View changes: npm run stats:changes"
echo "  - Watch files: npm run watch"

#!/bin/bash

# Cleanup and rebuild pipeline after fixing .js exclusion

echo "🔧 Cleanup and Rebuild Pipeline"
echo "================================"
echo ""

echo "Step 1: Delete .js scopes from Neo4j"
echo "-------------------------------------"
npx tsx scripts/delete-js-scopes.ts
echo ""

echo "Step 2: Rebuild XML scopes (no .js this time!)"
echo "-----------------------------------------------"
echo "⚠️  Run manually: npm run build:xml-scopes"
echo "   (in LR_CodeRag root directory)"
echo ""

echo "Step 3: Re-ingest to Neo4j"
echo "---------------------------"
echo "⚠️  Run manually: npm run ingest:xml"
echo "   (in LR_CodeRag root directory)"
echo ""

echo "Step 4: Reindex embeddings"
echo "---------------------------"
echo "⚠️  Run manually: npx tsx ragforge/scripts/reindex-embeddings.ts"
echo ""

echo "✅ Automated steps complete!"
echo "   Please run steps 2-4 manually as shown above"

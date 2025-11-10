#!/bin/bash
# Test all generated examples

cd generated

echo "🧪 Testing all generated examples"
echo "=================================="
echo ""

PASSED=0
FAILED=0
SKIPPED=0

examples=(
  "01-semantic-search-source.ts"
  "02-semantic-search-signature.ts"
  "03-semantic-search-name.ts"
  "04-llm-reranking.ts"
  "05-metadata-tracking.ts"
  "06-conditional-search.ts"
  "07-breadth-first.ts"
  "08-stopping-criteria.ts"
  "09-mutations-crud.ts"
  "10-batch-mutations.ts"
)

for example in "${examples[@]}"; do
  echo "Testing: $example"

  timeout 10s npx tsx examples/$example > /tmp/test-output.txt 2>&1
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo "  ✅ PASSED"
    PASSED=$((PASSED + 1))
  elif [ $exit_code -eq 124 ]; then
    echo "  ⏱️  TIMEOUT (10s)"
    FAILED=$((FAILED + 1))
  else
    echo "  ❌ FAILED (exit code: $exit_code)"
    # Show first error
    head -3 /tmp/test-output.txt | sed 's/^/     /'
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "=================================="
echo "📊 Results:"
echo "   ✅ Passed: $PASSED"
echo "   ❌ Failed: $FAILED"
echo "   Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✅ All examples work!"
  exit 0
else
  echo "⚠️  $FAILED example(s) need fixing"
  exit 1
fi

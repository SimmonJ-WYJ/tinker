#!/bin/bash

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   📋 验证划词功能文件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BASE_DIR="apps/electron"
ERRORS=0

check_file() {
    if [ -f "$1" ]; then
        echo "  ✅ $2"
    else
        echo "  ❌ $2 (未找到)"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "核心代码文件:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_file "$BASE_DIR/src/renderer/components/ai-elements/text-selection-toolbar.tsx" "text-selection-toolbar.tsx"
check_file "$BASE_DIR/src/renderer/components/ai-elements/selectable-message-response.tsx" "selectable-message-response.tsx"
check_file "$BASE_DIR/src/renderer/hooks/useTextSelection.ts" "useTextSelection.ts"
check_file "$BASE_DIR/src/renderer/atoms/text-selection-atoms.ts" "text-selection-atoms.ts"
check_file "$BASE_DIR/src/renderer/components/ai-elements/message.tsx" "message.tsx (已修改)"

echo ""
echo "示例代码文件:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_file "$BASE_DIR/src/renderer/components/ai-elements/text-selection-examples.tsx" "text-selection-examples.tsx"

echo ""
echo "文档文件:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
check_file "$BASE_DIR/TEXT_SELECTION_INDEX.md" "TEXT_SELECTION_INDEX.md"
check_file "$BASE_DIR/TEXT_SELECTION_QUICKREF.md" "TEXT_SELECTION_QUICKREF.md"
check_file "$BASE_DIR/TEXT_SELECTION_TODO.md" "TEXT_SELECTION_TODO.md"
check_file "$BASE_DIR/TEXT_SELECTION_FEATURE.md" "TEXT_SELECTION_FEATURE.md"
check_file "$BASE_DIR/TEXT_SELECTION_REPORT.md" "TEXT_SELECTION_REPORT.md"
check_file "$BASE_DIR/TEXT_SELECTION_DEMO.md" "TEXT_SELECTION_DEMO.md"
check_file "$BASE_DIR/TEXT_SELECTION_ARCHITECTURE.md" "TEXT_SELECTION_ARCHITECTURE.md"
check_file "$BASE_DIR/TEXT_SELECTION_SUMMARY.md" "TEXT_SELECTION_SUMMARY.md"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
    echo "  ✅ 所有文件都已创建！"
    echo ""
    echo "  📚 开始阅读: $BASE_DIR/TEXT_SELECTION_INDEX.md"
else
    echo "  ⚠️  发现 $ERRORS 个文件缺失"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

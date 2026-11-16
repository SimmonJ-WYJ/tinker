<a id="划词功能演示脚本"></a>

# Text Selection Feature Demo Script

<a id="-演示场景-1-add-to-chat-添加到对话"></a>

## 🎬 Demo Scenario 1: Add to Chat

<a id="用户操作流程"></a>

### User Workflow:

```
1. User sees useful content in an AI reply
   ┌────────────────────────────────────────┐
   │ AI: Quantum computing is based on      │
   │ quantum mechanics, using qubit        │
   │ superposition and entanglement...     │
   └────────────────────────────────────────┘

2. User drags the mouse to select text
   ┌────────────────────────────────────────┐
   │ AI: Quantum computing is based on      │
   │ quantum mechanics, using [qubit       │  ← Blue selection highlight
   │ superposition and entanglement]...    │
   └────────────────────────────────────────┘

3. Releasing the mouse fades in the floating toolbar
   ┌─────────────────────────────────────┐
   │  💬 1 selection                     │
   │  ├─ Ask in sidebar  ├─ Add to chat │  ← Toolbar slides in from above
   └─────────────────────────────────────┘
           ↓ Toolbar floats above selected text
   ┌────────────────────────────────────────┐
   │ AI: Quantum computing is based on      │
   │ quantum mechanics, using [qubit       │
   │ superposition and entanglement]...    │
   └────────────────────────────────────────┘

4. User clicks "Add to chat"
   [Click] → Toolbar fades away
           → Quoted content appears in the input

5. Input shows the quote (Markdown blockquote)
   ┌────────────────────────────────────────┐
   │ Input:                                  │
   │ > Qubit superposition and               │
   │ > entanglement for information processing│
   │                                        │
   │ █ ← Caret after quote, ready for typing  │
   └────────────────────────────────────────┘

6. User continues typing a question
   ┌────────────────────────────────────────┐
   │ Input:                                  │
   │ > Qubit superposition and               │
   │ > entanglement for information processing│
   │                                        │
   │ Explain the differences in detail█       │
   └────────────────────────────────────────┘

7. After sending, AI receives a quoted message
   ┌────────────────────────────────────────┐
   │ User:                                  │
   │ ┌──────────────────────────────────┐  │
   │ │ > Qubit superposition and           │  │
   │ │ > entanglement for information processing││
   │ │                                  │  │
   │ │ Explain the differences in detail  │  │
   │ └──────────────────────────────────┘  │
   └────────────────────────────────────────┘
```

---

<a id="-演示场景-2-ask-in-sidebar-侧边栏提问"></a>

## 🎬 Demo Scenario 2: Ask in Sidebar

<a id="用户操作流程-1"></a>

### User Workflow:

```
1. User selects code in an AI reply
   ┌────────────────────────────────────────┐
   │ AI: Here is a quicksort implementation:  │
   │                                        │
   │ [def quicksort(arr):                   │  ← Selected code block
   │     if len(arr) <= 1:                  │
   │         return arr]                    │
   └────────────────────────────────────────┘

2. Toolbar appears
   ┌─────────────────────────────────────┐
   │  💬 1 selection                     │
   │  ├─ Ask in sidebar  ├─ Add to chat │
   └─────────────────────────────────────┘

3. User clicks "Ask in sidebar"
   [Click] → Sidebar slides in from right
   
   Main view ◄───────────────┤ Sidebar
   ┌──────────────┐        ┌───────────────┐
   │              │        │ 💬 Ask in sidebar│
   │ Conversation │   ◄─── │                 │
   │              │        │ About this:     │
   │              │        │               │
   │              │        │ > def quick... │
   │              │        │ > if len...    │
   │              │        │ > return arr   │
   │              │        │               │
   │              │        │ ____________  │
   │              │        │ [Send]          │
   └──────────────┘        └───────────────┘

4. User types a question in the sidebar
   ┌───────────────────────┐
   │ 💬 Ask in sidebar         │
   │                       │
   │ About this:               │
   │                       │
   │ > def quicksort...    │
   │ > if len(arr)...      │
   │ > return arr          │
   │                       │
   │ This code's time complexity█│
   │ [Send]                    │
   └───────────────────────┘

5. Sidebar shows AI reply
   ┌───────────────────────┐
   │ 💬 Ask in sidebar           │
   │ ─────────────────     │
   │ User: What is this code's   │
   │ time complexity?            │
   │                       │
   │ AI: Quicksort averages      │
   │ O(n log n) time...          │
   │                       │
   │ ___________________   │
   │ [Ask another question]      │
   └───────────────────────┘
```

---

<a id="-演示场景-3-多次选择和取消"></a>

## 🎬 Demo Scenario 3: Repeated Selection and Cancellation

<a id="交互流程"></a>

### Interaction Flow:

```
1. First selection
   Select A → toolbar above A

2. Select another passage B without clicking buttons
   → Toolbar disappears immediately
   → New toolbar appears above B

3. Click blank space
   → Toolbar fades away
   → Selection clears

4. Click toolbar button
   → Perform corresponding action
   → Toolbar disappears
```

---

<a id="-视觉效果细节"></a>

## 📱 Visual Details

<a id="工具栏外观"></a>

### Toolbar Appearance:

```
┌─────────────────────────────────────────────────────┐
│  💬 1 selection │ Ask in sidebar │ Add to chat     │
└─────────────────────────────────────────────────────┘
 ↑                ↑                  ↑
 │                │                  │
 └─ Selection indicator └─ Action button     └─ Action button
    Gray text              With icon            With icon
    12px             14px             14px
```

<a id="颜色方案亮色主题"></a>

### Color Scheme (Light Theme):

```
Toolbar background: bg-background/95 (translucent white + background blur)
Border:             border-border/60 (light gray,60% opacity)
Shadow:             shadow-lg (large shadow)
Text:               text-muted-foreground (medium gray)
Button hover:       hover:bg-accent (accent background)
Icons:              size-3.5 (14px)
```

<a id="颜色方案暗色主题"></a>

### Color Scheme (Dark Theme):

```
Toolbar background: bg-background/95 (translucent dark + background blur)
Border:             border-border/60 (dark gray)
Shadow:             shadow-lg (dark shadow)
Text:               text-muted-foreground (light gray)
Button hover:       hover:bg-accent (dark accent background)
```

---

<a id="-动画效果"></a>

## 🎭 Animation Effects

<a id="工具栏出现动画"></a>

### Toolbar Entrance Animation:

```
Time:    0ms ──────────> 200ms
Opacity: 0% →100%
Scale:   95% →100%
Position: slightly below → final position

Keyframes:
  0ms:   opacity: 0, scale: 0.95, translateY: 2px
  200ms: opacity: 1, scale: 1, translateY: 0
```

<a id="工具栏消失动画"></a>

### Toolbar Exit Animation:

```
Time:    0ms ──────────> 150ms
Opacity: 100% →0%
Scale:   100% →98%

Keyframes:
  0ms:   opacity: 1, scale: 1
  150ms: opacity: 0, scale: 0.98
```

<a id="按钮悬停效果"></a>

### Button Hover Effects:

```
Mouse enters:
  ├─ Background: transparent → bg-accent (100ms ease)
  ├─ Text: text-muted-foreground → text-foreground (100ms ease)
  └─ Cursor: default → pointer

Mouse leaves:
  └─ Reverse animation
```

---

<a id="-尺寸规格"></a>

## 📐 Dimensions

```
Toolbar:
├─ Height:44px (py-1.5 =6px*2 +32px content)
├─ Radius:12px (rounded-xl)
├─ Padding:px-2 py-1.5 (8px horizontal,6px vertical)
└─ Minimum width:320px (adapts to content)

Selection indicator:
├─ Icon:14px (size-3.5)
├─ Text:12px (text-xs)
├─ Padding:px-2 py-1 (8px horizontal,4px vertical)
└─ Right border:border-r

Buttons:
├─ Height:32px (h-8)
├─ Icon:14px (size-3.5)
├─ Text:12px (text-xs)
├─ Gap:gap-1.5 (6px)
└─ Padding:px-3 (12px horizontal)
```

---

<a id="-细节打磨"></a>

## 🔍 Detail Refinement

<a id="工具栏位置计算"></a>

### Toolbar Position Calculation:

```
Reference: top center of selected region
Offset:8px upward, horizontally centered

Formula:
  left = selection.left + (selection.width / 2)
  top  = selection.top - toolbar.height - 8px

Boundary checks:
  if (left < viewport.left + toolbar.width/2)
    left = viewport.left + toolbar.width/2
  
  if (left > viewport.right - toolbar.width/2)
    left = viewport.right - toolbar.width/2
  
  if (top < viewport.top + 8)
    top = selection.bottom + 8  // Display below instead
```

<a id="响应式适配"></a>

### Responsive Adaptation:

```
Desktop (>=1024px):
  └─ Full toolbar, all buttons horizontal

Tablet (768px–1023px):
  └─ Compact mode, less gap/padding

Mobile (<768px):
  ├─ Icons only, hide text labels
  └─ Or arrange buttons vertically
```

---

<a id="-交互反馈"></a>

## 🎯 Interaction Feedback

<a id="成功状态"></a>

### Success State:

```
After clicking "Add to chat":
  └─ Toolbar disappears + input flashes/focuses (300ms)

After clicking "Ask in sidebar":
  └─ Toolbar disappears + sidebar slides in (300ms ease-out)
```

<a id="错误状态"></a>

### Error State:

```
If action fails (e.g. input not found):
  ├─ Toolbar shakes slightly (shake animation)
  └─ Toast: "Operation failed, please retry"
```

<a id="加载状态"></a>

### Loading State:

```
If operation takes time:
  ├─ Button shows loading icon
  ├─ Disable other actions
  └─ Restore when done
```

---

<a id="-视觉层次"></a>

## 🎨 Visual Hierarchy

```
Layer1 (highest): toolbar
  z-index: 50
  backdrop-filter: blur(12px)
  box-shadow: 0 10px 40px rgba(0,0,0,0.1)

Layer2: selected-text highlight
  background: selection color (browser default)
  
Layer3: message content
  z-index: 1
  
Layer4: background
  z-index: 0
```

This demo script details every visual and interaction aspect of the feature and can serve as a design and implementation reference!

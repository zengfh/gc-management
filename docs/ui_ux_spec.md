# UI/UX Design Specification

## 1. Design Philosophy
- **Dark Mode First:** Reduces eye strain for power users staring at inventory grids.
- **Data-Dense but Legible:** Optimize for tabular data and fast keyboard navigation.
- **High-Contrast Indicators:** Use semantic colors for card states and financial health.

## 2. Typography & Color Palette
- **Primary Font:** Inter (Sans-serif, highly legible for numbers).
- **Monospace Font:** JetBrains Mono or Fira Code (For card numbers and PINs).
- **Background:** `#121212` (Main), `#1E1E1E` (Surface/Cards).
- **Text:** `#E0E0E0` (Primary), `#A0A0A0` (Secondary).
- **Semantic Colors:**
  - Success/Available: `#4CAF50` (Green)
  - Warning/Reserved/In Use: `#FFC107` (Amber)
  - Danger/Void/Error: `#F44336` (Red)
  - Sold/Used Up: `#9E9E9E` (Grey, de-emphasized)
  - Primary Action: `#2196F3` (Blue)

## 3. Core Layout Components
### 3.1. App Shell
- **Sidebar (Left):** Navigation (Dashboard, Cards, Deals, Transactions, Usages, Audit Log, Settings).
- **Top Bar:** Global Search (Exact match card number), Add Deal CTA, Sync/Backup Status.

### 3.2. Data Tables (Grid)
- **Dense Padding:** Maximize rows visible.
- **Sticky Headers:** Keep context while scrolling.
- **Action Menu (Hover):** 'Sell', 'Use', 'Reserve', 'Edit' appear on row hover to save space.

### 3.3. Modals & Forms
- **Slide-overs for Data Entry:** Use right-side panels for adding Deals/Cards to keep background context visible.
- **Confirmation Dialogs:** Destructive actions (Void, Undo Sale) require explicit confirmation and reason input.

## 4. Key Interactions
- **Reveal on Click:** Card numbers, PINs, and CVVs are masked (`•••• 1234`) by default. Click to copy to clipboard and reveal for 5 seconds.
- **Batch Entry:** Keyboard-friendly grid for adding multiple cards to a deal. Tab navigates to the next cell; Enter creates a new row.

# Toolbar Responsive Debug Notes

## Summary of the Issue

**Root cause identified**: The search bar has `flex-1` which makes it grow to fill available space (906px at 1279px viewport), leaving only 313px for the filter section. But theoretically, if search stayed at 400px minimum, there would be 775px for filters.

**The chicken-and-egg problem**:
1. Filter section has `shrink-0 grow-0 basis-auto` above 900px - it only takes what its content needs
2. Tags start with `visibleCount=3`, so filter section sizes for 3 tags (~200px)
3. Calculation sees only 200px available, so it shows 3 tags
4. This becomes a self-reinforcing loop

## Two possible approaches

1. **CSS approach**: Change flex behavior so filter section gets more space
   - Make filter section `flex-1` so it shares space with search
   - Or cap search bar's max-width

2. **JS approach**: Calculate based on theoretical available space (toolbar minus search minimum) rather than actual filter section width

## Research needed

How do other toolbars/navbars handle this pattern?
- Collapsing tag/pill sections at various breakpoints
- Flex grow with collapsible content
- Priority-based content hiding (CSS-only vs JS-assisted)

## Current state

- Fixed: Horizontal overflow caused by measurement container positioned off-screen
- Broken: Tag calculation doesn't show more tags when space is available because filter section is sized by its content, not available space

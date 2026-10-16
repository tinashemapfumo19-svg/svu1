# South Valley University Design Language

> **Superseded (2026-10-07).** The official design language for the whole application is now
> [SVU_UI_STANDARD.md](SVU_UI_STANDARD.md). This file is historical reference only.

## Student Experience Update (2026-10-07)

For the proposed Study + Student Office student experience, use
[Student Design Language](STUDENT_DESIGN_LANGUAGE.md) as the detailed visual and
interaction reference. It documents the latest user-supplied Today homepage
brief and resolves student-specific differences: 1280px content width, two-space
navigation, accessible action/text tokens, component anatomy and responsive states.
The earlier guidance below remains a baseline for other roles and historical
work; it does not override the newer student-specific specification. Executable
student redesign work remains pending the user's go-ahead.

This is the working design reference for the rebuild. It condenses the supplied SVU e-learning design language into implementation rules for Codex and Claude.

## Direction

The platform should feel academic, modern, calm, intelligent, spacious, trustworthy, fluid, and premium.

Avoid dense admin dashboards, permanent dark sidebars, heavy borders, oversized decoration, excessive gradients, saturated blue backgrounds, and generic LMS clutter.

## Color

- Primary blue: `#1D9BF0`
- Blue hover: `#1689D9`
- Blue pressed: `#1479C2`
- Soft blue: `#EAF5FD`
- Very light blue: `#F5FAFE`
- Warm beige: `#F6F1E8`
- Beige soft: `#FBF8F3`
- Beige deep: `#EBE2D4`
- Page background: `#FCFCFD`
- Surface: `#FFFFFF`
- Strong text: `#0B1220`
- Body text: `#111827`
- Secondary text: `#667085`
- Muted text: `#98A2B3`
- Border: `#EAECF0`
- Strong border: `#D0D5DD`
- Success: `#16A34A`
- Warning: `#F59E0B`
- Danger: `#EF4444`
- Tertiary orange: `#F97316`

Blue should normally occupy less than 10-15% of a screen and should communicate action, active state, progress, links, focus, or important information.

## Layout

- Use a mostly white canvas with neutral hierarchy.
- Main content maximum width: `1440px`.
- Desktop padding: `32px`.
- Laptop/tablet padding: `20-32px`.
- Mobile padding: `16px`.
- Use an 8px spacing system: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.
- Dashboard layout should be asymmetric and content-led, not equal card blocks everywhere.

## Typography

Use:

```css
font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif;
```

Use size, weight, spacing, and line height for hierarchy. Keep color restraint. Avoid very heavy weights except for branding.

## Navigation

- Desktop uses a horizontal top navigation.
- Header height: `68-76px`.
- Header background: `rgba(255,255,255,0.9)` with optional blur.
- Active nav uses one consistent treatment: soft blue capsule or small underline.
- Mobile uses bottom navigation with Home, Courses or Admissions, Calendar/Foundation, Resources/Profile depending on the current product slice.

## Components

Build reusable primitives:

- AppShell
- TopNavigation
- MobileBottomNavigation
- PageContainer
- Hero
- StatCard
- CourseCard
- DeadlineCard
- ScheduleCard
- AnnouncementCard
- ProgressBar
- Tabs
- Badge
- Button
- IconButton
- Input
- SearchInput
- Modal
- Drawer
- EmptyState
- Skeleton
- Toast

Do not introduce new radii, blue tones, shadows, spacing units, icon styles, or font sizes without a clear semantic need.

## Learning Dashboard Priority

The dashboard should answer, in this order:

1. What am I learning?
2. Where did I stop?
3. What is due next?
4. What happens today?
5. How am I progressing?
6. Where do I go if I need help?

Everything else is secondary.

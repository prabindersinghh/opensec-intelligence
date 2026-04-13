---
name: frontend-design
description: "Guide for building web frontends with HTML, CSS, and JavaScript frameworks"
---

# Frontend Design

## Instructions

When the user asks you to build a frontend, web page, dashboard, or UI component:

1. **Start with semantic HTML** — use proper elements (`<nav>`, `<main>`, `<section>`, `<article>`, `<header>`, `<footer>`)
2. **Use modern CSS** — prefer flexbox/grid for layout, CSS custom properties for theming, avoid inline styles
3. **Progressive enhancement** — basic functionality should work without JS, enhance with interactivity
4. **Accessibility** — always include `alt` text, proper heading hierarchy, ARIA labels where needed, focusable interactive elements
5. **Responsive design** — mobile-first approach, use media queries for breakpoints

## CSS Architecture

- Use BEM naming convention for class names: `.block__element--modifier`
- Keep specificity low: prefer classes over IDs
- Use a consistent spacing scale (e.g., 4px, 8px, 16px, 24px, 32px)

## React Patterns

When building React components:
- Prefer functional components with hooks
- Use `useState` for local state, `useEffect` for side effects
- Extract custom hooks for reusable logic
- Keep components small and focused (< 100 lines)
- Use TypeScript interfaces for props

## Performance

- Lazy load images with `loading="lazy"`
- Minimize DOM depth
- Avoid layout thrashing (batch DOM reads/writes)
- Use `requestAnimationFrame` for animations

# design-system

This library was generated with [Nx](https://nx.dev).

## Running unit tests

Run `nx test design-system` to execute the unit tests.

## Themes

`styles/index.css` gives every app the tokens. Apps style only with the
semantic tokens of `styles/semantic.css` (Stylelint blocks raw colours and
spacing), so a theme is just a different set of values for them:

- **Light and dark.** `<html data-theme="light|dark">` picks one.
  `UiThemeService` sets it from your saved choice (localStorage key
  `life-island.theme`) or, until you choose, from the system setting, and
  follows that setting live. `<ui-theme-toggle />` switches theme with a
  circular reveal (a view transition; colours just fade where that is not
  supported, and nothing animates with reduced motion). Each app's
  `index.html` applies the theme before the first paint, so it never flashes.
- **Characters.** `data-character="ptera|trice|ankylo"` on any element re-tints
  the accent (and the tokens derived from it: `--accent-gradient`,
  `--accent-glow`, `--focus-ring`) for everything inside it.

To add a token, give it a value in both the `:root` and the
`:root[data-theme='dark']` blocks of `semantic.css`.

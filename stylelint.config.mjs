/**
 * Apps style with the design system's semantic tokens only
 * (docs/architecture.md, principle 10). The design system itself defines the
 * raw values, so it is linted without these rules.
 */
const spacing = [
  'margin',
  'padding',
  'gap',
  'row-gap',
  'column-gap',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
];
const spacingProps = `/^(${spacing.join('|')})(-.*)?$/`;

export default {
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
    ],
    'declaration-property-unit-disallowed-list': {
      [spacingProps]: ['px', 'rem', 'em'],
      'font-size': ['px', 'rem', 'em'],
      '/^border(-.*)?-radius$/': ['px', 'rem', 'em'],
    },
  },
  overrides: [
    {
      files: ['libs/design-system/**/*.css'],
      rules: {
        'color-no-hex': null,
        'color-named': null,
        'function-disallowed-list': null,
        'declaration-property-unit-disallowed-list': null,
      },
    },
  ],
};

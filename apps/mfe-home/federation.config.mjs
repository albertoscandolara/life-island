import {
  withNativeFederation,
  fromPackageJson,
} from '@angular-architects/native-federation/config';

export default withNativeFederation({
  name: 'mfe-home',

  // The shell mounts these routes at /home: Bills at /home/bills, Home at /home (apps/shell/src/app/app.routes.ts).
  exposes: {
    './routes': './apps/mfe-home/src/app/home.routes.ts',
  },

  //shareScope: autoShareScope({level: 'minor'}),

  shared: fromPackageJson({
    singleton: true,
    strictVersion: true,
    requiredVersion: 'auto',
    build: 'package',
  })
    .patch(['@angular/*'], { includeSecondaries: { keepAll: true } })
    .get(),

  // Only the design system is a shared singleton (architecture.md, Front-end
  // apps); contracts are plain types and constants, each bundle keeps its copy.
  sharedMappings: ['@life-island/design-system'],

  skip: ['rxjs/ajax', 'rxjs/fetch', 'rxjs/testing', 'rxjs/webSocket'],

  features: {
    denseChunking: true,
    denseExternals: true,
    strictImports: false,
  },
});

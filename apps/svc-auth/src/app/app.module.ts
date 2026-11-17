import { Module, type DynamicModule } from '@nestjs/common';
import { authSettingsFromEnv, createServiceDb } from '@life-island/be-common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CONFIG, SERVICE_DB, type AuthConfig } from './config.js';
import { HealthController } from './health.controller.js';

@Module({})
export class AppModule {
  static forRoot(config: AuthConfig): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'auth',
    });
    return {
      module: AppModule,
      controllers: [HealthController, AuthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        // AUTH_DEV_BYPASS: GET /session answers the local owner (development only).
        { provide: 'DEV_BYPASS', useValue: authSettingsFromEnv().devBypass },
        AuthService,
      ],
    };
  }
}

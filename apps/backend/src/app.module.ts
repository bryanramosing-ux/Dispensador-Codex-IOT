import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config';
import { SecurityModule } from './security/security';
import { FirebaseModule } from './persistence/firebase.module';
import { EventsModule } from './events/events.module';
import { HistoryModule } from './history/history.module';
import { DevicesModule } from './devices/devices.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { CommandsModule } from './commands/commands.module';
import { CameraModule } from './camera/camera.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    SecurityModule,
    FirebaseModule,
    EventsModule,
    HistoryModule,
    DevicesModule,
    TelemetryModule,
    CommandsModule,
    CameraModule,
    HealthModule,
  ],
})
export class AppModule {}

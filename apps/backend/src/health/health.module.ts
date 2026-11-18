import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { DevicesService } from '../devices/devices.service';
import { FirestoreService } from '../persistence/firestore.service';
import { LocalStore } from '../persistence/local-store';
import { AdminGuard } from '../security/security';

@Controller('api/health')
class HealthController {
  constructor(
    private readonly devices: DevicesService,
    private readonly firestore: FirestoreService,
    private readonly local: LocalStore,
  ) {}

  @Get() health() {
    return { status: 'ok', uptime_s: this.devices.uptime };
  }

  @Get('sync')
  @UseGuards(AdminGuard)
  sync() {
    return { pending: this.local.pendingCount(), last_synced_at: this.firestore.lastSyncedAt };
  }
}

@Module({ imports: [DevicesModule], controllers: [HealthController] })
export class HealthModule {}

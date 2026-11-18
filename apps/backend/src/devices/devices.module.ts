import { Controller, Get, Module, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DevicesService } from './devices.service';
import { SseService } from '../events/sse.service';
import { AdminGuard, SecurityService } from '../security/security';

@Controller('api')
@UseGuards(AdminGuard)
class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly sse: SseService,
    private readonly security: SecurityService,
  ) {}
  @Get('status') status() {
    return this.devices.snapshot();
  }
  @Get('events') events(@Req() req: Request, @Res() res: Response) {
    this.sse.subscribe(res, this.devices.snapshot(), () => this.security.authenticated(req));
  }
}

@Module({ providers: [DevicesService], controllers: [DevicesController], exports: [DevicesService] })
export class DevicesModule {}

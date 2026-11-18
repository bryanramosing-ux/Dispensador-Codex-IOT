import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceGuard, peerIp } from '../security/security';
import { TelemetryService } from './telemetry.service';
import { alertPipe, telemetryPipe, type AlertDto, type TelemetryDto } from './telemetry.dto';

@Controller('api/device')
@UseGuards(DeviceGuard)
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}
  @Post('telemetry')
  @HttpCode(200)
  receive(@Body(telemetryPipe) body: TelemetryDto, @Req() req: Request) {
    this.telemetry.receive(body, peerIp(req));
    return { ok: true };
  }
  @Post('alert')
  @HttpCode(200)
  alert(@Body(alertPipe) body: AlertDto) {
    this.telemetry.alert(body);
    return { ok: true };
  }
}

import { Controller, Delete, Get, Post, Req } from '@nestjs/common';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { DemoDataService } from './demo-data.service';

type AuthedRequest = { user: { id: string } };

/** Admin-only platform settings. Currently: the demo-data sandbox. */
@Controller('v1/settings')
export class SettingsController {
  constructor(private readonly demoData: DemoDataService) {}

  @Get('demo-data')
  @RequirePermissions('settings:manage')
  status() {
    return this.demoData.status();
  }

  @Post('demo-data')
  @RequirePermissions('settings:manage')
  seed(@Req() req: AuthedRequest) {
    return this.demoData.seed(req.user.id);
  }

  @Delete('demo-data')
  @RequirePermissions('settings:manage')
  remove(@Req() req: AuthedRequest) {
    return this.demoData.remove(req.user.id);
  }
}

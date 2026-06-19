import { Controller, Get, Post, HttpCode, HttpStatus, ForbiddenException, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './decorators/auth.decorators';
import { AuthService } from './auth.service';
import { BootstrapKeyBodyDto } from './dto/bootstrap-key.dto';
import { allowLoginKeyGeneration } from '../../config/anti-ban';

@ApiTags('auth')
@Controller('auth')
@SkipThrottle()
export class AuthBootstrapController {
  constructor(private readonly authService: AuthService) {}

  @Get('bootstrap-key')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check whether a bootstrap API key can be generated from the login page' })
  @ApiResponse({ status: 200, description: 'Bootstrap status' })
  async getBootstrapStatus(): Promise<{
    allowed: boolean;
    hasKeys: boolean;
    hasKeyFile: boolean;
    hint?: string;
  }> {
    const status = await this.authService.getBootstrapKeyStatus();
    return {
      allowed: allowLoginKeyGeneration(),
      ...status,
    };
  }

  @Post('bootstrap-key')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate or recover the bootstrap admin API key (login page)' })
  @ApiResponse({ status: 200, description: 'API key generated — shown once' })
  @ApiResponse({ status: 403, description: 'Login key generation disabled' })
  async generateBootstrapKey(@Body() body: BootstrapKeyBodyDto = {}): Promise<{
    apiKey: string;
    keyPrefix: string;
    created: boolean;
    recovered: boolean;
    message: string;
  }> {
    if (!allowLoginKeyGeneration()) {
      throw new ForbiddenException(
        'Login API key generation is disabled. Set ALLOW_LOGIN_KEY_GENERATION=true or use the server logs / data/.api-key file.',
      );
    }

    return this.authService.generateBootstrapApiKey({ force: body?.force === true });
  }
}
